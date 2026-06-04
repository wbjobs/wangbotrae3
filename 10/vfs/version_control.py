import os
import time
import uuid
from typing import Dict, List, Optional, Tuple, Any, Set
from dataclasses import dataclass, field
from enum import Enum

from .storage import RocksDBStorage


class ConflictType(Enum):
    MODIFIED_MODIFIED = "modified_modified"
    MODIFIED_DELETED = "modified_deleted"
    DELETED_MODIFIED = "deleted_modified"


class ConflictResolution(Enum):
    OVERWRITE_LOCAL = "overwrite_local"
    KEEP_LOCAL = "keep_local"
    MERGE = "merge"


@dataclass
class ConflictInfo:
    path: str
    conflict_type: ConflictType
    local_version: Optional[int]
    target_version: Optional[int]
    local_content_hash: Optional[str]
    target_content_hash: Optional[str]
    resolution: Optional[ConflictResolution] = None


@dataclass
class FileVersion:
    version: int
    file_id: str
    content_hash: str
    size: int
    blocks: List[Dict[str, Any]]
    timestamp: float
    author: str
    message: str
    parent_version: Optional[int] = None


@dataclass
class Snapshot:
    snapshot_id: str
    dir_path: str
    timestamp: float
    message: str
    file_versions: Dict[str, int] = field(default_factory=dict)


class VersionController:
    """
    版本控制器核心模块，负责：
    - 文件版本管理
    - 目录快照管理
    - 冲突检测与处理（乐观策略）
    - Checkout操作
    """

    def __init__(self, storage: 'BaseStorage'):
        self.storage = storage
        self._ensure_root()

    def _ensure_root(self):
        if not self.path_exists('/'):
            meta = {
                'path': '/',
                'name': '/',
                'is_dir': True,
                'created_at': time.time(),
                'modified_at': time.time(),
            }
            self.storage.save_dir_meta('/', meta)
            self.storage.save_dir_children('/', [])

    def _get_file_id(self, path: str) -> str:
        meta = self.storage.get_file_meta(path)
        if meta and 'file_id' in meta:
            return meta['file_id']
        new_file_id = f'file_{uuid.uuid4().hex}'
        if meta is None:
            meta = {}
        meta['file_id'] = new_file_id
        self.storage.save_file_meta(path, meta)
        return new_file_id

    def create_file_version(self, path: str, data: bytes, 
                           message: str = "", author: str = "user") -> FileVersion:
        """
        创建文件的新版本。每次写入都会自动创建新版本。
        每个版本使用独立的 file_id 存储内容，确保历史版本不被覆盖。
        """
        self.storage.begin_batch()
        
        try:
            base_file_id = self._get_file_id(path)
            current_head = self.storage.get_head(path)
            new_version = self.storage.get_next_counter(f'version:{path}')
            
            version_file_id = f'{base_file_id}_v{new_version}'
            content_info = self.storage.write_file_content(version_file_id, data)
            
            version_info = FileVersion(
                version=new_version,
                file_id=version_file_id,
                content_hash=content_info['content_hash'],
                size=content_info['size'],
                blocks=content_info['blocks'],
                timestamp=time.time(),
                author=author,
                message=message or f"Update to version {new_version}",
                parent_version=current_head if current_head > 0 else None
            )
            
            self.storage.save_file_version(
                base_file_id, new_version, version_info.__dict__
            )
            
            meta = self.storage.get_file_meta(path) or {}
            meta.update({
                'path': path,
                'file_id': base_file_id,
                'current_version': new_version,
                'current_file_id': version_file_id,
                'size': content_info['size'],
                'created_at': meta.get('created_at', time.time()),
                'modified_at': time.time(),
                'is_dir': False,
            })
            self.storage.save_file_meta(path, meta)
            
            self.storage.set_head(path, new_version)
            self.storage.clear_pending(path)
            
            self._update_parent_directory(path)
            
            self.storage.commit_batch()
            
            return version_info
        except Exception as e:
            self.storage.rollback_batch()
            raise e

    def get_file_version(self, path: str, version: Optional[int] = None) -> Optional[FileVersion]:
        """
        获取文件的指定版本，默认获取当前HEAD版本。
        """
        if version is None:
            version = self.storage.get_head(path)
        
        if version == 0:
            return None
        
        file_id = self._get_file_id(path)
        version_data = self.storage.get_file_version(file_id, version)
        
        if version_data:
            return FileVersion(**version_data)
        return None

    def read_file(self, path: str, version: Optional[int] = None,
                  offset: int = 0, length: Optional[int] = None) -> bytes:
        """
        读取文件内容，支持指定版本。
        """
        file_version = self.get_file_version(path, version)
        if file_version is None:
            return b''
        
        return self.storage.read_file_content(
            file_version.file_id, offset, length
        )

    def list_file_versions(self, path: str) -> List[FileVersion]:
        """
        列出文件的所有版本。
        """
        file_id = self._get_file_id(path)
        version_numbers = self.storage.list_file_versions(file_id)
        
        versions = []
        for v_num in version_numbers:
            v_data = self.storage.get_file_version(file_id, v_num)
            if v_data:
                versions.append(FileVersion(**v_data))
        
        return sorted(versions, key=lambda v: v.version)

    def create_directory(self, path: str):
        """
        创建目录。
        """
        parent_path = os.path.dirname(path)
        dir_name = os.path.basename(path)
        
        meta = {
            'path': path,
            'name': dir_name,
            'is_dir': True,
            'created_at': time.time(),
            'modified_at': time.time(),
        }
        
        self.storage.save_dir_meta(path, meta)
        self.storage.save_dir_children(path, [])
        
        if parent_path and parent_path != path:
            self._add_child_to_parent(parent_path, dir_name, True)

    def delete_file(self, path: str):
        """
        删除文件（软删除，保留历史版本）。
        不从父目录子项列表中移除，而是通过 meta.deleted 标记过滤。
        """
        meta = self.storage.get_file_meta(path)
        if meta:
            meta['deleted'] = True
            meta['deleted_at'] = time.time()
            self.storage.save_file_meta(path, meta)
            
            current_file_id = meta.get('current_file_id')
            if current_file_id:
                self.storage.delete_file_content(current_file_id)

    def delete_directory(self, path: str):
        """
        删除目录（软删除）。
        不从父目录子项列表中移除，而是通过 meta.deleted 标记过滤。
        """
        meta = self.storage.get_dir_meta(path)
        if meta:
            meta['deleted'] = True
            meta['deleted_at'] = time.time()
            self.storage.save_dir_meta(path, meta)

    def list_directory(self, path: str, include_deleted: bool = False) -> List[Dict[str, Any]]:
        """
        列出目录内容。
        """
        children = self.storage.get_dir_children(path)
        result = []
        
        for child in children:
            if path == '/':
                child_path = '/' + child['name']
            else:
                child_path = path.rstrip('/') + '/' + child['name']
            
            if child['is_dir']:
                meta = self.storage.get_dir_meta(child_path)
            else:
                meta = self.storage.get_file_meta(child_path)
            
            if meta and (include_deleted or not meta.get('deleted', False)):
                result.append({
                    'name': child['name'],
                    'is_dir': child['is_dir'],
                    'path': child_path,
                    'meta': meta,
                })
        
        return result

    def get_path_meta(self, path: str) -> Optional[Dict[str, Any]]:
        """
        获取路径的元数据（文件或目录）。
        """
        dir_meta = self.storage.get_dir_meta(path)
        if dir_meta:
            return dir_meta
        
        file_meta = self.storage.get_file_meta(path)
        if file_meta:
            return file_meta
        
        return None

    def create_snapshot(self, dir_path: str, message: str = "") -> Snapshot:
        """
        创建目录级别的快照，记录当前目录下所有文件的版本。
        """
        snapshot_id = f'snap_{uuid.uuid4().hex[:12]}'
        
        file_versions = {}
        self._collect_file_versions_recursive(dir_path, file_versions)
        
        snapshot = Snapshot(
            snapshot_id=snapshot_id,
            dir_path=dir_path,
            timestamp=time.time(),
            message=message or f"Snapshot of {dir_path} at {time.ctime()}",
            file_versions=file_versions
        )
        
        self.storage.save_snapshot(dir_path, snapshot_id, snapshot.__dict__)
        
        return snapshot

    def _collect_file_versions_recursive(self, dir_path: str, 
                                          result: Dict[str, int]):
        """
        递归收集目录下所有文件的当前版本。
        """
        children = self.list_directory(dir_path)
        
        for child in children:
            child_path = child['path']
            if child['is_dir']:
                self._collect_file_versions_recursive(child_path, result)
            else:
                head_version = self.storage.get_head(child_path)
                if head_version > 0:
                    result[child_path] = head_version

    def list_snapshots(self, dir_path: str) -> List[Snapshot]:
        """
        列出目录的所有快照。
        """
        snapshot_ids = self.storage.list_snapshots(dir_path)
        snapshots = []
        
        for snap_id in snapshot_ids:
            snap_data = self.storage.get_snapshot(snap_id)
            if snap_data:
                snapshots.append(Snapshot(**snap_data))
        
        return sorted(snapshots, key=lambda s: s.timestamp, reverse=True)

    def check_conflicts(self, path: str, target_version: int) -> List[ConflictInfo]:
        """
        检查checkout操作中的冲突。
        采用乐观策略：只在checkout时检测冲突。
        """
        conflicts = []
        
        pending = self.storage.get_pending(path)
        if pending:
            pending_hash = pending.get('content_hash')
            current_head = self.storage.get_head(path)
            
            target_file_version = self.get_file_version(path, target_version)
            current_file_version = self.get_file_version(path, current_head)
            
            if target_file_version and current_file_version:
                if pending_hash != current_file_version.content_hash:
                    if pending_hash != target_file_version.content_hash:
                        conflicts.append(ConflictInfo(
                            path=path,
                            conflict_type=ConflictType.MODIFIED_MODIFIED,
                            local_version=current_head,
                            target_version=target_version,
                            local_content_hash=pending_hash,
                            target_content_hash=target_file_version.content_hash
                        ))
        
        return conflicts

    def check_checkout_conflicts(self, target: str, 
                                  target_is_snapshot: bool = False) -> List[ConflictInfo]:
        """
        检查checkout整个目录或快照的冲突。
        """
        conflicts = []
        
        if target_is_snapshot:
            snapshot_data = self.storage.get_snapshot(target)
            if not snapshot_data:
                raise ValueError(f"Snapshot {target} not found")
            
            snapshot = Snapshot(**snapshot_data) if isinstance(snapshot_data, dict) else snapshot_data
            
            for file_path, target_version in snapshot.file_versions.items():
                file_conflicts = self.check_conflicts(file_path, target_version)
                conflicts.extend(file_conflicts)
        else:
            conflicts = self._check_dir_checkout_conflicts(target)
        
        return conflicts

    def _check_dir_checkout_conflicts(self, dir_path: str) -> List[ConflictInfo]:
        """
        检查目录checkout的冲突。
        """
        conflicts = []
        children = self.list_directory(dir_path)
        
        for child in children:
            child_path = child['path']
            if child['is_dir']:
                conflicts.extend(self._check_dir_checkout_conflicts(child_path))
            else:
                head_version = self.storage.get_head(child_path)
                file_conflicts = self.check_conflicts(child_path, head_version)
                conflicts.extend(file_conflicts)
        
        return conflicts

    def checkout_version(self, path: str, target_version: int,
                        resolution: Optional[ConflictResolution] = None) -> Tuple[bool, List[ConflictInfo]]:
        """
        Checkout文件到指定版本。
        """
        conflicts = self.check_conflicts(path, target_version)
        
        if conflicts and resolution is None:
            return False, conflicts
        
        self.storage.begin_batch()
        
        try:
            for conflict in conflicts:
                if resolution == ConflictResolution.OVERWRITE_LOCAL:
                    self._resolve_overwrite(conflict, target_version)
                elif resolution == ConflictResolution.KEEP_LOCAL:
                    continue
                elif resolution == ConflictResolution.MERGE:
                    self._resolve_merge(conflict, target_version)
            
            target_file_version = self.get_file_version(path, target_version)
            if target_file_version:
                self.storage.set_head(path, target_version)
            
            self.storage.commit_batch()
            return True, conflicts
        except Exception as e:
            self.storage.rollback_batch()
            raise e

    def checkout_snapshot(self, snapshot_id: str,
                         resolution: Optional[ConflictResolution] = None) -> Tuple[bool, List[ConflictInfo]]:
        """
        Checkout整个目录到某个快照。
        """
        conflicts = self.check_checkout_conflicts(snapshot_id, target_is_snapshot=True)
        
        if conflicts and resolution is None:
            return False, conflicts
        
        snapshot_data = self.storage.get_snapshot(snapshot_id)
        if not snapshot_data:
            raise ValueError(f"Snapshot {snapshot_id} not found")
        
        snapshot = Snapshot(**snapshot_data) if isinstance(snapshot_data, dict) else snapshot_data
        
        self.storage.begin_batch()
        
        try:
            for conflict in conflicts:
                if resolution == ConflictResolution.OVERWRITE_LOCAL:
                    target_version = snapshot.file_versions.get(conflict.path)
                    if target_version:
                        self._resolve_overwrite(conflict, target_version)
                elif resolution == ConflictResolution.KEEP_LOCAL:
                    continue
                elif resolution == ConflictResolution.MERGE:
                    target_version = snapshot.file_versions.get(conflict.path)
                    if target_version:
                        self._resolve_merge(conflict, target_version)
            
            for file_path, target_version in snapshot.file_versions.items():
                if not any(c.path == file_path and 
                          resolution == ConflictResolution.KEEP_LOCAL 
                          for c in conflicts):
                    self.storage.set_head(file_path, target_version)
            
            self.storage.commit_batch()
            return True, conflicts
        except Exception as e:
            self.storage.rollback_batch()
            raise e

    def _resolve_overwrite(self, conflict: ConflictInfo, target_version: int):
        """
        覆盖本地修改。
        """
        self.storage.set_head(conflict.path, target_version)
        self.storage.clear_pending(conflict.path)

    def _resolve_merge(self, conflict: ConflictInfo, target_version: int):
        """
        合并修改。简单实现：创建新版本，内容为目标版本。
        """
        target_content = self.read_file(conflict.path, target_version)
        self.create_file_version(
            conflict.path, target_content,
            message=f"Merged: overwrote with version {target_version}"
        )

    def mark_pending(self, path: str, content_hash: str, size: int):
        """
        标记文件有未提交的修改。
        """
        pending = {
            'content_hash': content_hash,
            'size': size,
            'timestamp': time.time()
        }
        self.storage.set_pending(path, pending)

    def _update_parent_directory(self, path: str):
        """
        更新父目录的子项列表。
        """
        parent_path = os.path.dirname(path)
        file_name = os.path.basename(path)
        
        if parent_path:
            self._add_child_to_parent(parent_path, file_name, False)

    def _add_child_to_parent(self, parent_path: str, name: str, is_dir: bool):
        """
        添加子项到父目录。
        """
        children = self.storage.get_dir_children(parent_path)
        
        existing = next((c for c in children if c['name'] == name), None)
        if not existing:
            children.append({
                'name': name,
                'is_dir': is_dir,
                'added_at': time.time()
            })
            self.storage.save_dir_children(parent_path, children)

    def _remove_child_from_parent(self, parent_path: str, name: str):
        """
        从父目录移除子项。
        """
        children = self.storage.get_dir_children(parent_path)
        children = [c for c in children if c['name'] != name]
        self.storage.save_dir_children(parent_path, children)

    def get_file_log(self, path: str, limit: int = 50) -> List[FileVersion]:
        """
        获取文件的版本历史日志。
        """
        versions = self.list_file_versions(path)
        return versions[-limit:] if limit else versions

    def get_modified_files(self) -> List[str]:
        """
        获取所有有未提交修改的文件。
        """
        modified = []
        for file_path in self.storage.list_all_files():
            if self.storage.has_pending(file_path):
                modified.append(file_path)
        return modified

    def path_exists(self, path: str) -> bool:
        """
        检查路径是否存在。
        """
        meta = self.get_path_meta(path)
        return meta is not None and not meta.get('deleted', False)

    def is_directory(self, path: str) -> bool:
        """
        检查路径是否为目录。
        """
        meta = self.get_path_meta(path)
        return meta is not None and meta.get('is_dir', False)
