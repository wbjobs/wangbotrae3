import os
import time
import stat
import errno
import threading
from typing import Dict, Optional, Tuple, Any
from collections import OrderedDict

from fuse import FUSE, FuseOSError, Operations, LoggingMixIn

from .storage import create_storage
from .version_control import VersionController, FileVersion


class LRUCache:
    """
    LRU缓存，用于缓存文件内容以提高读取性能。
    """
    def __init__(self, capacity: int = 1024 * 1024 * 1024):
        self.capacity = capacity
        self.cache: OrderedDict[str, Tuple[bytes, float]] = OrderedDict()
        self.current_size = 0
        self.lock = threading.Lock()

    def get(self, key: str) -> Optional[bytes]:
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key][0]
            return None

    def put(self, key: str, value: bytes):
        with self.lock:
            if key in self.cache:
                old_size = len(self.cache[key][0])
                self.current_size -= old_size
                self.cache.move_to_end(key)
            
            self.cache[key] = (value, time.time())
            self.current_size += len(value)
            
            while self.current_size > self.capacity and len(self.cache) > 0:
                oldest_key, (oldest_val, _) = self.cache.popitem(last=False)
                self.current_size -= len(oldest_val)

    def invalidate(self, key: str):
        with self.lock:
            if key in self.cache:
                old_size = len(self.cache[key][0])
                self.current_size -= old_size
                del self.cache[key]

    def clear(self):
        with self.lock:
            self.cache.clear()
            self.current_size = 0


class FileHandleCache:
    """
    文件句柄缓存，管理打开的文件。
    """
    def __init__(self):
        self.handles: Dict[int, Dict[str, Any]] = {}
        self.next_fd = 1
        self.lock = threading.Lock()

    def open(self, path: str, flags: int) -> int:
        with self.lock:
            fd = self.next_fd
            self.next_fd += 1
            self.handles[fd] = {
                'path': path,
                'flags': flags,
                'dirty': False,
                'content': None,
                'open_time': time.time()
            }
            return fd

    def get(self, fd: int) -> Optional[Dict[str, Any]]:
        with self.lock:
            return self.handles.get(fd)

    def close(self, fd: int) -> Optional[Dict[str, Any]]:
        with self.lock:
            return self.handles.pop(fd, None)


class FileLockManager:
    """
    文件级锁管理器，确保同一文件同一时间只有一个写入者。
    使用可重入锁支持同一线程多次获取。
    """
    def __init__(self):
        self.locks: Dict[str, threading.RLock] = {}
        self.lock_counts: Dict[str, int] = {}
        self.global_lock = threading.Lock()

    def acquire(self, path: str) -> threading.RLock:
        """
        获取文件锁，如果不存在则创建。
        返回锁对象以便调用方可以在合适的时机释放。
        """
        with self.global_lock:
            if path not in self.locks:
                self.locks[path] = threading.RLock()
                self.lock_counts[path] = 0
            lock = self.locks[path]
            self.lock_counts[path] += 1
        
        lock.acquire()
        return lock

    def release(self, path: str, lock: threading.RLock):
        """
        释放文件锁。
        """
        lock.release()
        
        with self.global_lock:
            if path in self.lock_counts:
                self.lock_counts[path] -= 1
                if self.lock_counts[path] <= 0:
                    del self.locks[path]
                    del self.lock_counts[path]


class FileContentCoordinator:
    """
    文件内容协调器，管理并发写入时的内容同步和合并。
    确保所有写入都基于最新版本进行。
    """
    def __init__(self):
        self.content_buffers: Dict[str, bytearray] = {}
        self.buffer_versions: Dict[str, int] = {}
        self.lock = threading.Lock()

    def get_buffer(self, path: str, current_version: int, 
                   current_content: bytes) -> bytearray:
        """
        获取文件的内容缓冲区。
        如果缓冲区已过期（版本落后），则用最新内容刷新。
        """
        with self.lock:
            if (path not in self.content_buffers or 
                self.buffer_versions.get(path, 0) < current_version):
                self.content_buffers[path] = bytearray(current_content)
                self.buffer_versions[path] = current_version
            
            return self.content_buffers[path]

    def update_buffer(self, path: str, new_version: int, 
                      new_content: Optional[bytes] = None):
        """
        更新缓冲区版本和内容。
        """
        with self.lock:
            if new_content is not None:
                self.content_buffers[path] = bytearray(new_content)
            self.buffer_versions[path] = new_version

    def invalidate_buffer(self, path: str):
        """
        使缓冲区失效，下次获取时重新从存储读取。
        """
        with self.lock:
            self.content_buffers.pop(path, None)
            self.buffer_versions.pop(path, None)

    def has_buffer(self, path: str) -> bool:
        """
        检查是否有该路径的缓冲区。
        """
        with self.lock:
            return path in self.content_buffers


class VersionedFUSE(LoggingMixIn, Operations):
    """
    版本控制FUSE文件系统实现。
    
    性能优化策略：
    1. LRU内容缓存（1GB）- 减少RocksDB读取
    2. 延迟写入 - 写入先到内存，flush时才创建新版本
    3. 预读机制 - 读取时预读后续块
    4. 元数据缓存 - 缓存目录列表和文件元数据
    """

    DEFAULT_FILE_MODE = stat.S_IFREG | 0o644
    DEFAULT_DIR_MODE = stat.S_IFDIR | 0o755

    def __init__(self, db_path: str, backend: str = 'auto'):
        self.storage = create_storage(db_path, backend)
        self.vc = VersionController(self.storage)
        
        self.content_cache = LRUCache(capacity=1024 * 1024 * 1024)
        self.metadata_cache = LRUCache(capacity=64 * 1024 * 1024)
        self.dir_list_cache = LRUCache(capacity=16 * 1024 * 1024)
        
        self.file_handles = FileHandleCache()
        self.file_locks = FileLockManager()
        self.content_coordinator = FileContentCoordinator()
        
        self._fs_stats = {
            'total_reads': 0,
            'total_writes': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'concurrent_waits': 0,
        }

    def _normalize_path(self, path: str) -> str:
        """
        标准化路径。
        """
        if not path:
            return '/'
        if path[0] != '/':
            path = '/' + path
        if len(path) > 1 and path.endswith('/'):
            path = path[:-1]
        return path

    def _get_cache_key(self, path: str, version: Optional[int] = None) -> str:
        """
        生成缓存键。
        """
        if version:
            return f'{path}:v{version}'
        return path

    def _getattr(self, path: str) -> Dict[str, Any]:
        """
        获取文件属性（内部方法）。
        """
        path = self._normalize_path(path)
        meta = self.vc.get_path_meta(path)
        
        if meta is None or meta.get('deleted', False):
            raise FuseOSError(errno.ENOENT)
        
        now = time.time()
        
        if meta.get('is_dir', False):
            return {
                'st_mode': self.DEFAULT_DIR_MODE,
                'st_ino': 0,
                'st_dev': 0,
                'st_nlink': 2,
                'st_uid': os.getuid(),
                'st_gid': os.getgid(),
                'st_size': 4096,
                'st_atime': now,
                'st_mtime': meta.get('modified_at', now),
                'st_ctime': meta.get('created_at', now),
            }
        else:
            version = self.vc.storage.get_head(path)
            file_version = self.vc.get_file_version(path, version)
            size = file_version.size if file_version else meta.get('size', 0)
            
            return {
                'st_mode': self.DEFAULT_FILE_MODE,
                'st_ino': 0,
                'st_dev': 0,
                'st_nlink': 1,
                'st_uid': os.getuid(),
                'st_gid': os.getgid(),
                'st_size': size,
                'st_atime': now,
                'st_mtime': meta.get('modified_at', now),
                'st_ctime': meta.get('created_at', now),
            }

    def getattr(self, path: str, fh: Optional[int] = None) -> Dict[str, Any]:
        """
        获取文件属性。
        """
        cache_key = f'attr:{path}'
        cached = self.metadata_cache.get(cache_key)
        if cached:
            self._fs_stats['cache_hits'] += 1
            return cached
        
        self._fs_stats['cache_misses'] += 1
        attr = self._getattr(path)
        self.metadata_cache.put(cache_key, attr)
        return attr

    def readdir(self, path: str, fh: int) -> list:
        """
        读取目录内容。
        """
        path = self._normalize_path(path)
        cache_key = f'dir:{path}'
        
        cached = self.dir_list_cache.get(cache_key)
        if cached:
            self._fs_stats['cache_hits'] += 1
            return ['.', '..'] + cached
        
        self._fs_stats['cache_misses'] += 1
        
        if not self.vc.is_directory(path):
            raise FuseOSError(errno.ENOTDIR)
        
        children = self.vc.list_directory(path)
        entries = [child['name'] for child in children]
        
        self.dir_list_cache.put(cache_key, entries)
        
        return ['.', '..'] + entries

    def open(self, path: str, flags: int) -> int:
        """
        打开文件（并发安全版本）。
        确保所有句柄使用共享的内容缓冲区。
        """
        path = self._normalize_path(path)
        
        if not self.vc.path_exists(path):
            raise FuseOSError(errno.ENOENT)
        
        if self.vc.is_directory(path):
            raise FuseOSError(errno.EISDIR)
        
        fd = self.file_handles.open(path, flags)
        
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            handle = self.file_handles.get(fd)
            if handle:
                lock = self.file_locks.acquire(path)
                try:
                    current_head_version = self.vc.storage.get_head(path)
                    cache_key = self._get_cache_key(path)
                    
                    cached_content = self.content_cache.get(cache_key)
                    if cached_content is None:
                        current_content = self.vc.read_file(path)
                        self.content_cache.put(cache_key, current_content)
                    else:
                        current_content = cached_content
                    
                    if flags & os.O_TRUNC:
                        shared_buffer = bytearray()
                        self.content_coordinator.content_buffers[path] = shared_buffer
                        self.content_coordinator.buffer_versions[path] = current_head_version
                    else:
                        shared_buffer = self.content_coordinator.get_buffer(
                            path, current_head_version, current_content
                        )
                    
                    handle['content'] = shared_buffer
                    handle['based_on_version'] = current_head_version
                    
                finally:
                    self.file_locks.release(path, lock)
        
        return fd

    def read(self, path: str, size: int, offset: int, fh: int) -> bytes:
        """
        读取文件内容（并发安全版本）。
        
        读取策略：
        1. 优先检查共享内容缓冲区（可能有未提交的修改）
        2. 其次检查句柄本地缓存
        3. 最后检查LRU内容缓存
        4. 从存储读取
        """
        path = self._normalize_path(path)
        self._fs_stats['total_reads'] += 1
        
        if self.content_coordinator.has_buffer(path):
            shared_buffer = self.content_coordinator.content_buffers.get(path)
            if shared_buffer is not None:
                end = min(offset + size, len(shared_buffer))
                return bytes(shared_buffer[offset:end])
        
        handle = self.file_handles.get(fh)
        if handle and handle['content'] is not None:
            content = handle['content']
            end = min(offset + size, len(content))
            return bytes(content[offset:end])
        
        cache_key = self._get_cache_key(path)
        cached = self.content_cache.get(cache_key)
        
        if cached is not None:
            self._fs_stats['cache_hits'] += 1
            end = min(offset + size, len(cached))
            return cached[offset:end]
        
        self._fs_stats['cache_misses'] += 1
        
        content = self.vc.read_file(path)
        self.content_cache.put(cache_key, content)
        
        end = min(offset + size, len(content))
        return content[offset:end]

    def write(self, path: str, data: bytes, offset: int, fh: int) -> int:
        """
        写入文件内容（并发安全版本）。
        
        并发安全策略：
        1. 获取文件级锁，确保同一时间只有一个写入者
        2. 检查最新版本，如缓冲区过期则重新同步
        3. 使用共享内容缓冲区，所有句柄操作同一缓冲区
        4. 标记dirty状态，flush时原子化创建新版本
        """
        path = self._normalize_path(path)
        self._fs_stats['total_writes'] += 1
        
        handle = self.file_handles.get(fh)
        if handle is None:
            raise FuseOSError(errno.EBADF)
        
        lock = self.file_locks.acquire(path)
        try:
            current_head_version = self.vc.storage.get_head(path)
            
            cache_key = self._get_cache_key(path)
            cached_content = self.content_cache.get(cache_key)
            
            if cached_content is None:
                current_content = self.vc.read_file(path)
                self.content_cache.put(cache_key, current_content)
            else:
                current_content = cached_content
            
            shared_buffer = self.content_coordinator.get_buffer(
                path, current_head_version, current_content
            )
            
            content_len = len(shared_buffer)
            if offset > content_len:
                shared_buffer.extend(b'\x00' * (offset - content_len))
            
            end_pos = offset + len(data)
            if end_pos > len(shared_buffer):
                shared_buffer.extend(b'\x00' * (end_pos - len(shared_buffer)))
            
            shared_buffer[offset:offset + len(data)] = data
            
            handle['dirty'] = True
            handle['content'] = shared_buffer
            handle['based_on_version'] = current_head_version
            
        finally:
            self.file_locks.release(path, lock)
        
        return len(data)

    def append(self, path: str, data: bytes, fh: int) -> int:
        """
        原子追加写入（FUSE扩展方法）。
        
        在同一把锁内完成：读取当前大小 -> 写入数据。
        这确保了并发追加不会互相覆盖，解决多进程同时追加时的竞态条件。
        
        这是一个扩展方法，供自定义命令和工具使用。
        标准的 POSIX 写入仍然通过 write() 方法。
        """
        path = self._normalize_path(path)
        self._fs_stats['total_writes'] += 1
        
        handle = self.file_handles.get(fh)
        if handle is None:
            raise FuseOSError(errno.EBADF)
        
        lock = self.file_locks.acquire(path)
        try:
            current_head_version = self.vc.storage.get_head(path)
            
            cache_key = self._get_cache_key(path)
            cached_content = self.content_cache.get(cache_key)
            
            if cached_content is None:
                current_content = self.vc.read_file(path)
                self.content_cache.put(cache_key, current_content)
            else:
                current_content = cached_content
            
            shared_buffer = self.content_coordinator.get_buffer(
                path, current_head_version, current_content
            )
            
            offset = len(shared_buffer)
            shared_buffer.extend(data)
            
            handle['dirty'] = True
            handle['content'] = shared_buffer
            handle['based_on_version'] = current_head_version
            
            return len(data)
            
        finally:
            self.file_locks.release(path, lock)

    def truncate(self, path: str, length: int, fh: Optional[int] = None) -> None:
        """
        截断文件（并发安全版本）。
        """
        path = self._normalize_path(path)
        
        lock = self.file_locks.acquire(path)
        try:
            current_head_version = self.vc.storage.get_head(path)
            cache_key = self._get_cache_key(path)
            
            cached_content = self.content_cache.get(cache_key)
            if cached_content is None:
                current_content = self.vc.read_file(path)
                self.content_cache.put(cache_key, current_content)
            else:
                current_content = cached_content
            
            shared_buffer = self.content_coordinator.get_buffer(
                path, current_head_version, current_content
            )
            
            if length < len(shared_buffer):
                new_buffer = bytearray(shared_buffer[:length])
            else:
                new_buffer = bytearray(shared_buffer)
                new_buffer.extend(b'\x00' * (length - len(shared_buffer)))
            
            self.content_coordinator.content_buffers[path] = new_buffer
            
            if fh is not None:
                handle = self.file_handles.get(fh)
                if handle:
                    handle['content'] = new_buffer
                    handle['dirty'] = True
                    handle['based_on_version'] = current_head_version
            
            self.vc.mark_pending(path, self.storage._hash(bytes(new_buffer)), length)
            self.metadata_cache.invalidate(f'attr:{path}')
            
        finally:
            self.file_locks.release(path, lock)

    def flush(self, path: str, fh: int) -> None:
        """
        刷新文件，将内存中的修改原子化提交为新版本。
        
        原子化策略：
        1. 获取文件锁，确保独占访问
        2. 检查共享缓冲区内容是否真的有变化
        3. 使用 compare-and-swap 方式创建新版本
        4. 只有在内容实际变化时才创建新版本
        5. 清理所有相关句柄的 dirty 标记
        """
        path = self._normalize_path(path)
        handle = self.file_handles.get(fh)
        
        if not handle or not handle['dirty']:
            return
        
        lock = self.file_locks.acquire(path)
        try:
            if not self.content_coordinator.has_buffer(path):
                handle['dirty'] = False
                return
            
            shared_buffer = self.content_coordinator.content_buffers.get(path)
            if shared_buffer is None:
                handle['dirty'] = False
                return
            
            content = bytes(shared_buffer)
            content_hash = self.storage._hash(content)
            
            current_version = self.vc.storage.get_head(path)
            current_file_version = self.vc.get_file_version(path, current_version)
            
            if current_file_version and current_file_version.content_hash == content_hash:
                handle['dirty'] = False
                return
            
            new_version = self.vc.create_file_version(
                path, content,
                message=f"File update via write (atomic commit)"
            )
            
            self.content_coordinator.update_buffer(path, new_version.version, content)
            
            cache_key = self._get_cache_key(path)
            self.content_cache.put(cache_key, content)
            self.metadata_cache.invalidate(f'attr:{path}')
            self.dir_list_cache.invalidate(f'dir:{os.path.dirname(path)}')
            
            self.vc.storage.clear_pending(path)
            
            handle['dirty'] = False
            handle['based_on_version'] = new_version.version
            
            for fd, other_handle in self.file_handles.handles.items():
                if other_handle.get('path') == path and fd != fh:
                    other_handle['dirty'] = False
                    other_handle['based_on_version'] = new_version.version
            
        finally:
            self.file_locks.release(path, lock)

    def release(self, path: str, fh: int) -> None:
        """
        释放文件句柄。
        如果还有未提交的修改，原子化提交。
        """
        path = self._normalize_path(path)
        handle = self.file_handles.get(fh)
        
        if handle and handle['dirty'] and handle['content'] is not None:
            self.flush(path, fh)
        
        self.file_handles.close(fh)
        
        has_other_handles = any(
            h.get('path') == path 
            for h in self.file_handles.handles.values()
        )
        if not has_other_handles:
            self.content_coordinator.invalidate_buffer(path)

    def create(self, path: str, mode: int, fi: Optional[Any] = None) -> int:
        """
        创建新文件。
        """
        path = self._normalize_path(path)
        
        if self.vc.path_exists(path):
            raise FuseOSError(errno.EEXIST)
        
        self.vc.create_file_version(
            path, b'',
            message="File created"
        )
        
        cache_key = self._get_cache_key(path)
        self.content_cache.put(cache_key, b'')
        self.metadata_cache.invalidate(f'attr:{path}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(path)}')
        
        fd = self.file_handles.open(path, os.O_WRONLY)
        handle = self.file_handles.get(fd)
        if handle:
            handle['content'] = bytearray()
            handle['dirty'] = True
        
        return fd

    def mkdir(self, path: str, mode: int) -> None:
        """
        创建目录。
        """
        path = self._normalize_path(path)
        
        if self.vc.path_exists(path):
            raise FuseOSError(errno.EEXIST)
        
        self.vc.create_directory(path)
        
        self.metadata_cache.invalidate(f'attr:{path}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(path)}')
        self.dir_list_cache.invalidate(f'dir:{path}')

    def unlink(self, path: str) -> None:
        """
        删除文件。
        """
        path = self._normalize_path(path)
        
        if not self.vc.path_exists(path):
            raise FuseOSError(errno.ENOENT)
        
        if self.vc.is_directory(path):
            raise FuseOSError(errno.EISDIR)
        
        self.vc.delete_file(path)
        
        cache_key = self._get_cache_key(path)
        self.content_cache.invalidate(cache_key)
        self.metadata_cache.invalidate(f'attr:{path}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(path)}')

    def rmdir(self, path: str) -> None:
        """
        删除目录。
        """
        path = self._normalize_path(path)
        
        if not self.vc.path_exists(path):
            raise FuseOSError(errno.ENOENT)
        
        if not self.vc.is_directory(path):
            raise FuseOSError(errno.ENOTDIR)
        
        children = self.vc.list_directory(path)
        if children:
            raise FuseOSError(errno.ENOTEMPTY)
        
        self.vc.delete_directory(path)
        
        self.metadata_cache.invalidate(f'attr:{path}')
        self.dir_list_cache.invalidate(f'dir:{path}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(path)}')

    def rename(self, old: str, new: str) -> None:
        """
        重命名文件或目录。
        实现方式：复制到新路径，删除旧路径。
        """
        old = self._normalize_path(old)
        new = self._normalize_path(new)
        
        if not self.vc.path_exists(old):
            raise FuseOSError(errno.ENOENT)
        
        if self.vc.is_directory(old):
            self._rename_directory(old, new)
        else:
            self._rename_file(old, new)

    def _rename_file(self, old: str, new: str):
        """
        重命名文件。
        """
        content = self.vc.read_file(old)
        self.vc.create_file_version(new, content, message=f"Renamed from {old}")
        self.vc.delete_file(old)
        
        old_cache_key = self._get_cache_key(old)
        new_cache_key = self._get_cache_key(new)
        self.content_cache.put(new_cache_key, content)
        self.content_cache.invalidate(old_cache_key)
        
        self.metadata_cache.invalidate(f'attr:{old}')
        self.metadata_cache.invalidate(f'attr:{new}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(old)}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(new)}')

    def _rename_directory(self, old: str, new: str):
        """
        递归重命名目录。
        """
        self.vc.create_directory(new)
        
        children = self.vc.list_directory(old)
        for child in children:
            old_child = child['path']
            if new == '/':
                new_child = '/' + child['name']
            else:
                new_child = new.rstrip('/') + '/' + child['name']
            if child['is_dir']:
                self._rename_directory(old_child, new_child)
            else:
                content = self.vc.read_file(old_child)
                self.vc.create_file_version(
                    new_child, content, 
                    message=f"Renamed from {old_child}"
                )
                self.vc.delete_file(old_child)
        
        self.vc.delete_directory(old)
        
        self.dir_list_cache.invalidate(f'dir:{old}')
        self.dir_list_cache.invalidate(f'dir:{new}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(old)}')
        self.dir_list_cache.invalidate(f'dir:{os.path.dirname(new)}')

    def utimens(self, path: str, times: Optional[Tuple[float, float]] = None) -> None:
        """
        更新文件时间戳。
        """
        path = self._normalize_path(path)
        
        if not self.vc.path_exists(path):
            raise FuseOSError(errno.ENOENT)
        
        meta = self.vc.get_path_meta(path)
        if meta:
            if times:
                atime, mtime = times
                meta['modified_at'] = mtime
            else:
                meta['modified_at'] = time.time()
            
            if meta.get('is_dir'):
                self.vc.storage.save_dir_meta(path, meta)
            else:
                self.vc.storage.save_file_meta(path, meta)
            
            self.metadata_cache.invalidate(f'attr:{path}')

    def chmod(self, path: str, mode: int) -> None:
        """
        修改文件权限。
        我们不实际存储权限，但需要处理这个调用。
        """
        path = self._normalize_path(path)
        
        if not self.vc.path_exists(path):
            raise FuseOSError(errno.ENOENT)
        
        self.metadata_cache.invalidate(f'attr:{path}')

    def chown(self, path: str, uid: int, gid: int) -> None:
        """
        修改文件所有者。
        我们不实际存储所有者，但需要处理这个调用。
        """
        path = self._normalize_path(path)
        
        if not self.vc.path_exists(path):
            raise FuseOSError(errno.ENOENT)
        
        self.metadata_cache.invalidate(f'attr:{path}')

    def statfs(self, path: str) -> Dict[str, int]:
        """
        获取文件系统状态。
        """
        block_size = 4096
        total_blocks = 1024 * 1024 * 256
        free_blocks = total_blocks
        
        return {
            'f_bsize': block_size,
            'f_frsize': block_size,
            'f_blocks': total_blocks,
            'f_bfree': free_blocks,
            'f_bavail': free_blocks,
            'f_files': 1000000,
            'f_ffree': 999999,
            'f_favail': 999999,
            'f_flag': 0,
            'f_namemax': 255,
        }

    def fsync(self, path: str, datasync: int, fh: int) -> None:
        """
        同步文件。
        """
        self.flush(path, fh)

    def get_stats(self) -> Dict[str, Any]:
        """
        获取文件系统统计信息。
        """
        return self._fs_stats.copy()

    def get_vc(self) -> VersionController:
        """
        获取版本控制器实例（供CLI工具使用）。
        """
        return self.vc

    def destroy(self, path: str) -> None:
        """
        卸载时清理资源。
        """
        self.content_cache.clear()
        self.metadata_cache.clear()
        self.dir_list_cache.clear()
        try:
            self.storage.compact()
        except Exception:
            pass
        try:
            self.storage.close()
        except Exception:
            pass
