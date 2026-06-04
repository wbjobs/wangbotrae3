#!/usr/bin/env python3
"""
并发写入测试：验证多进程/多线程同时写入同一文件时的正确性。
"""

import os
import sys
import time
import tempfile
import shutil
import threading
import multiprocessing
import stat
import errno
from typing import List, Tuple, Dict, Optional, Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import importlib
import collections

vfs_storage = importlib.import_module('vfs.storage')
vfs_version_control = importlib.import_module('vfs.version_control')

create_storage = vfs_storage.create_storage
VersionController = vfs_version_control.VersionController

FUSE_AVAILABLE = False

class FuseOSError(Exception):
    def __init__(self, errno):
        self.errno = errno
        super().__init__(os.strerror(errno))


class LRUCache:
    """LRU缓存实现"""
    def __init__(self, capacity: int = 1024 * 1024 * 1024):
        self.capacity = capacity
        self.cache: collections.OrderedDict[str, tuple] = collections.OrderedDict()
        self.current_size = 0
        self.lock = threading.Lock()

    def get(self, key: str):
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
    """文件句柄缓存"""
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
    """文件级锁管理器"""
    def __init__(self):
        self.locks: Dict[str, threading.RLock] = {}
        self.lock_counts: Dict[str, int] = {}
        self.global_lock = threading.Lock()

    def acquire(self, path: str) -> threading.RLock:
        with self.global_lock:
            if path not in self.locks:
                self.locks[path] = threading.RLock()
                self.lock_counts[path] = 0
            lock = self.locks[path]
            self.lock_counts[path] += 1
        
        lock.acquire()
        return lock

    def release(self, path: str, lock: threading.RLock):
        lock.release()
        
        with self.global_lock:
            if path in self.lock_counts:
                self.lock_counts[path] -= 1
                if self.lock_counts[path] <= 0:
                    del self.locks[path]
                    del self.lock_counts[path]


class FileContentCoordinator:
    """文件内容协调器"""
    def __init__(self):
        self.content_buffers: Dict[str, bytearray] = {}
        self.buffer_versions: Dict[str, int] = {}
        self.lock = threading.Lock()

    def get_buffer(self, path: str, current_version: int, 
                   current_content: bytes) -> bytearray:
        with self.lock:
            if (path not in self.content_buffers or 
                self.buffer_versions.get(path, 0) < current_version):
                self.content_buffers[path] = bytearray(current_content)
                self.buffer_versions[path] = current_version
            
            return self.content_buffers[path]

    def update_buffer(self, path: str, new_version: int, 
                      new_content: Optional[bytes] = None):
        with self.lock:
            if new_content is not None:
                self.content_buffers[path] = bytearray(new_content)
            self.buffer_versions[path] = new_version

    def invalidate_buffer(self, path: str):
        with self.lock:
            self.content_buffers.pop(path, None)
            self.buffer_versions.pop(path, None)

    def has_buffer(self, path: str) -> bool:
        with self.lock:
            return path in self.content_buffers


class TestableVersionedFUSE:
    """
    可测试的VersionedFUSE实现，不依赖FUSE库。
    实现核心的文件操作逻辑用于并发测试。
    """
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
        if not path:
            return '/'
        if path[0] != '/':
            path = '/' + path
        if len(path) > 1 and path.endswith('/'):
            path = path[:-1]
        return path
    
    def _get_cache_key(self, path: str, version: Optional[int] = None) -> str:
        if version:
            return f'{path}:v{version}'
        return path
    
    def destroy(self, path):
        """清理资源，关闭存储引擎"""
        try:
            self.content_coordinator = None
            self.file_handles = None
            self.content_cache.clear()
            self.metadata_cache.clear()
            self.dir_list_cache.clear()
            if hasattr(self, 'storage') and self.storage:
                self.storage.close()
        except Exception:
            pass
    
    def create(self, path: str, mode: int, fi: Optional[Any] = None) -> int:
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
        
        return self.open(path, os.O_RDWR)
    
    def open(self, path: str, flags: int) -> int:
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
        原子追加写入。
        在同一把锁内完成：读取当前大小 -> 写入数据。
        这确保了并发追加不会互相覆盖。
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


class MockFileHandle:
    """模拟的文件句柄，用于测试"""
    def __init__(self, fs, path: str, flags: int):
        self.fs = fs
        self.path = path
        self.fh = fs.open(path, flags)
        self.closed = False
    
    def write(self, data: bytes, offset: int) -> int:
        return self.fs.write(self.path, data, offset, self.fh)
    
    def append(self, data: bytes) -> int:
        """原子追加：在锁内读取当前大小并写入"""
        return self.fs.append(self.path, data, self.fh)
    
    def read(self, size: int, offset: int) -> bytes:
        return self.fs.read(self.path, size, offset, self.fh)
    
    def flush(self):
        self.fs.flush(self.path, self.fh)
    
    def close(self):
        if not self.closed:
            self.fs.release(self.path, self.fh)
            self.closed = True
    
    def __del__(self):
        self.close()


def test_concurrent_append_threads():
    """测试多线程并发追加写入"""
    print("[TEST] Testing concurrent append with threads...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_concurrency_test_')
    
    try:
        fs = TestableVersionedFUSE(tmp_dir, backend='sqlite')
        test_file = '/test_concurrent.txt'
        
        initial_content = b'Initial content.\n'
        fs.create(test_file, 0o644)
        
        fh1 = MockFileHandle(fs, test_file, os.O_RDWR)
        fh1.write(initial_content, 0)
        fh1.flush()
        
        num_threads = 5
        writes_per_thread = 20
        chunk_size = 50
        
        results = []
        errors = []
        
        def writer_thread(thread_id: int, fh_factory):
            try:
                fh = fh_factory()
                thread_results = []
                
                for i in range(writes_per_thread):
                    data = f"[T{thread_id}-{i}]".encode().ljust(chunk_size, b'-')
                    bytes_written = fh.append(data)
                    fh.flush()
                    thread_results.append((thread_id, i, -1, bytes_written))
                
                fh.close()
                return thread_results
            except Exception as e:
                errors.append((thread_id, str(e)))
                return []
        
        def create_fh():
            return MockFileHandle(fs, test_file, os.O_RDWR)
        
        threads = []
        for i in range(num_threads):
            t = threading.Thread(
                target=lambda tid=i: results.extend(writer_thread(tid, create_fh))
            )
            threads.append(t)
        
        start_time = time.time()
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join()
        
        elapsed = time.time() - start_time
        
        if errors:
            print(f"  [FAIL] Errors occurred: {errors}")
            return False
        
        fh1.close()
        
        final_content = fs.read(test_file, 1024 * 1024, 0, 1)
        
        expected_length = len(initial_content) + num_threads * writes_per_thread * chunk_size
        actual_length = len(final_content)
        
        print(f"  Expected length: {expected_length}")
        print(f"  Actual length:   {actual_length}")
        
        if actual_length != expected_length:
            print(f"  [FAIL] Length mismatch!")
            return False
        
        has_interleaving = False
        for i in range(num_threads):
            for j in range(writes_per_thread):
                expected = f"[T{i}-{j}]".encode()
                if expected not in final_content:
                    print(f"  [FAIL] Missing expected chunk: [T{i}-{j}]")
                    has_interleaving = True
        
        if has_interleaving:
            return False
        
        print(f"  All {num_threads * writes_per_thread} writes accounted for")
        print(f"  Time: {elapsed:.3f}s")
        
        versions = fs.vc.list_file_versions(test_file)
        print(f"  Total versions created: {len(versions)}")
        
        print("  [OK] Concurrent thread append test passed")
        return True
        
    finally:
        try:
            if 'fh1' in locals():
                fh1.close()
        except Exception:
            pass
        fs.destroy('/')
        time.sleep(0.5)
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_concurrent_append_simulated():
    """模拟多进程并发追加写入（使用多线程模拟）"""
    print("\n[TEST] Testing concurrent append (simulated multi-process)...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_concurrent_sim_')
    
    try:
        fs = TestableVersionedFUSE(tmp_dir, backend='sqlite')
        test_file = '/test_append.txt'
        
        fs.create(test_file, 0o644)
        
        initial_fh = MockFileHandle(fs, test_file, os.O_RDWR)
        initial_fh.close()
        
        process_a_data = [b'hello', b'world', b'foo', b'bar']
        process_b_data = [b'HELLO', b'WORLD', b'FOO', b'BAR']
        
        offsets_a = []
        offsets_b = []
        
        def process_a_writer():
            fh = MockFileHandle(fs, test_file, os.O_RDWR)
            for data in process_a_data:
                offsets_a.append(-1)
                fh.append(data + b'\n')
                fh.flush()
            fh.close()
        
        def process_b_writer():
            fh = MockFileHandle(fs, test_file, os.O_RDWR)
            for data in process_b_data:
                offsets_b.append(-1)
                fh.append(data + b'\n')
                fh.flush()
            fh.close()
        
        t1 = threading.Thread(target=process_a_writer)
        t2 = threading.Thread(target=process_b_writer)
        
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        
        final_content = fs.read(test_file, 1024 * 1024, 0, 1).decode()
        lines = [line for line in final_content.strip().split('\n') if line]
        
        print(f"  Final content ({len(lines)} lines):")
        for i, line in enumerate(lines):
            print(f"    {i}: {line}")
        
        all_writes = process_a_data + process_b_data
        all_writes_lower = [w.decode().lower() for w in all_writes]
        lines_lower = [l.lower() for l in lines]
        
        missing = []
        for w in all_writes_lower:
            if w not in lines_lower:
                missing.append(w)
        
        if missing:
            print(f"  [FAIL] Missing writes: {missing}")
            return False
        
        has_interleaving = False
        for line in lines:
            clean_line = line.strip()
            if (len(clean_line) > 0 and 
                not any(clean_line == w.decode() for w in all_writes)):
                print(f"  [FAIL] Interleaved/corrupted line found: '{clean_line}'")
                has_interleaving = True
        
        if has_interleaving:
            return False
        
        expected_total = sum(len(w) + 1 for w in all_writes)
        actual_total = len(final_content)
        
        print(f"  Expected total bytes: {expected_total}")
        print(f"  Actual total bytes:   {actual_total}")
        
        if actual_total != expected_total:
            print(f"  [FAIL] Total bytes mismatch!")
            return False
        
        print("  [OK] Concurrent append simulation test passed")
        return True
        
    finally:
        try:
            if 'fh1' in locals():
                fh1.close()
        except Exception:
            pass
        fs.destroy('/')
        time.sleep(0.5)
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_no_data_corruption():
    """测试极端的并发写入场景，确保没有数据损坏"""
    print("\n[TEST] Testing no data corruption under heavy concurrency...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_corruption_test_')
    
    try:
        fs = TestableVersionedFUSE(tmp_dir, backend='sqlite')
        test_file = '/test_no_corrupt.txt'
        
        fs.create(test_file, 0o644)
        
        num_threads = 10
        writes_per_thread = 50
        chunk_size = 100
        
        errors = []
        
        def writer(thread_id: int):
            try:
                fh = MockFileHandle(fs, test_file, os.O_RDWR)
                for i in range(writes_per_thread):
                    marker = f"T{thread_id:02d}I{i:03d}"
                    data = f"[{marker}]".encode().ljust(chunk_size, b'=')
                    
                    fh.append(data)
                    
                    if i % 10 == 0:
                        fh.flush()
                
                fh.flush()
                fh.close()
            except Exception as e:
                errors.append((thread_id, str(e)))
                import traceback
                traceback.print_exc()
        
        threads = []
        for i in range(num_threads):
            t = threading.Thread(target=writer, args=(i,))
            threads.append(t)
        
        start_time = time.time()
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join()
        
        elapsed = time.time() - start_time
        
        if errors:
            print(f"  [FAIL] Errors during concurrent writes: {errors}")
            return False
        
        final_content = fs.read(test_file, 1024 * 1024 * 10, 0, 1)
        
        expected_length = num_threads * writes_per_thread * chunk_size
        actual_length = len(final_content)
        
        print(f"  Expected: {expected_length} bytes, Actual: {actual_length} bytes")
        print(f"  Time: {elapsed:.3f}s, Throughput: {expected_length/elapsed/1024:.1f} KB/s")
        
        if actual_length != expected_length:
            print(f"  [FAIL] Length mismatch!")
            return False
        
        missing_chunks = []
        corrupted_chunks = []
        
        for thread_id in range(num_threads):
            for i in range(writes_per_thread):
                full_marker = f"[T{thread_id:02d}I{i:03d}]".encode()
                if full_marker not in final_content:
                    missing_chunks.append(full_marker.decode())
                else:
                    pos = final_content.find(full_marker)
                    chunk_start = pos
                    chunk_end = chunk_start + chunk_size
                    chunk = final_content[chunk_start:chunk_end]
                    
                    if not chunk.startswith(b'[') or not chunk.endswith(b'='):
                        corrupted_chunks.append((full_marker.decode(), chunk[:20]))
        
        if missing_chunks:
            print(f"  [FAIL] Missing {len(missing_chunks)} chunks")
            print(f"    First 5 missing: {missing_chunks[:5]}")
            return False
        
        if corrupted_chunks:
            print(f"  [FAIL] {len(corrupted_chunks)} corrupted chunks detected")
            for marker, snippet in corrupted_chunks[:5]:
                print(f"    {marker}: {snippet}...")
            return False
        
        versions = fs.vc.list_file_versions(test_file)
        print(f"  Total versions: {len(versions)}")
        print(f"  No data corruption detected!")
        print("  [OK] Data corruption test passed")
        
        return True
        
    finally:
        try:
            if 'fh1' in locals():
                fh1.close()
        except Exception:
            pass
        fs.destroy('/')
        time.sleep(0.5)
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_version_atomicity():
    """测试版本创建的原子性"""
    print("\n[TEST] Testing version creation atomicity...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_atomicity_test_')
    
    try:
        fs = TestableVersionedFUSE(tmp_dir, backend='sqlite')
        test_file = '/test_atomic.txt'
        
        fs.create(test_file, 0o644)
        
        num_writers = 5
        barrier = threading.Barrier(num_writers)
        
        versions_written = []
        lock = threading.Lock()
        
        def writer(thread_id: int):
            fh = MockFileHandle(fs, test_file, os.O_RDWR)
            
            barrier.wait()
            
            data = f"Data from thread {thread_id}\n".encode()
            
            bytes_written = fh.append(data)
            fh.flush()
            
            with lock:
                versions_written.append((thread_id, -1, bytes_written))
            
            fh.close()
        
        threads = []
        for i in range(num_writers):
            t = threading.Thread(target=writer, args=(i,))
            threads.append(t)
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join()
        
        versions = fs.vc.list_file_versions(test_file)
        print(f"  Number of versions created: {len(versions)}")
        
        min_expected_versions = num_writers
        if len(versions) < min_expected_versions:
            print(f"  [FAIL] Expected at least {min_expected_versions} versions, got {len(versions)}")
            return False
        
        final_content = fs.read(test_file, 1024 * 1024, 0, 1).decode()
        lines = [l for l in final_content.strip().split('\n') if l]
        
        print(f"  Final content lines: {len(lines)}")
        for i, line in enumerate(lines):
            print(f"    v{i+1}: {line.strip()}")
        
        all_data_present = all(
            f"Data from thread {i}" in final_content
            for i in range(num_writers)
        )
        
        if not all_data_present:
            print("  [FAIL] Some thread data is missing!")
            return False
        
        print("  [OK] Version atomicity test passed")
        return True
        
    finally:
        try:
            if 'fh1' in locals():
                fh1.close()
        except Exception:
            pass
        fs.destroy('/')
        time.sleep(0.5)
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main():
    print("=" * 70)
    print("VersionedFS Concurrency Tests")
    print("=" * 70)
    print()
    
    all_passed = True
    
    if not test_concurrent_append_threads():
        all_passed = False
    
    if not test_concurrent_append_simulated():
        all_passed = False
    
    if not test_no_data_corruption():
        all_passed = False
    
    if not test_version_atomicity():
        all_passed = False
    
    print()
    print("=" * 70)
    if all_passed:
        print("[PASS] All concurrency tests PASSED!")
        print("=" * 70)
        return 0
    else:
        print("[FAIL] Some concurrency tests FAILED!")
        print("=" * 70)
        return 1


if __name__ == '__main__':
    sys.exit(main())
