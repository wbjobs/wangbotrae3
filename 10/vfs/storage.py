import os
import abc
import sqlite3
import msgpack
import xxhash
from typing import Optional, Iterator, Tuple, List, Dict, Any


class BaseStorage(abc.ABC):
    """
    存储引擎抽象基类。
    """

    BLOCK_SIZE = 64 * 1024

    @abc.abstractmethod
    def begin_batch(self):
        """开始批量写入。"""
        pass

    @abc.abstractmethod
    def commit_batch(self):
        """提交批量写入。"""
        pass

    @abc.abstractmethod
    def rollback_batch(self):
        """回滚批量写入。"""
        pass

    @abc.abstractmethod
    def get_next_counter(self, prefix: str = 'global') -> int:
        """获取下一个计数器值。"""
        pass

    @abc.abstractmethod
    def write_file_content(self, file_id: str, data: bytes) -> Dict[str, Any]:
        """写入文件内容。"""
        pass

    @abc.abstractmethod
    def read_file_content(self, file_id: str, offset: int = 0,
                          length: Optional[int] = None) -> bytes:
        """读取文件内容。"""
        pass

    @abc.abstractmethod
    def delete_file_content(self, file_id: str):
        """删除文件内容。"""
        pass

    @abc.abstractmethod
    def save_file_meta(self, path: str, meta: Dict[str, Any]):
        """保存文件元数据。"""
        pass

    @abc.abstractmethod
    def get_file_meta(self, path: str) -> Optional[Dict[str, Any]]:
        """获取文件元数据。"""
        pass

    @abc.abstractmethod
    def delete_file_meta(self, path: str):
        """删除文件元数据。"""
        pass

    @abc.abstractmethod
    def save_file_version(self, file_id: str, version: int,
                          version_info: Dict[str, Any]):
        """保存文件版本信息。"""
        pass

    @abc.abstractmethod
    def get_file_version(self, file_id: str, version: int) -> Optional[Dict[str, Any]]:
        """获取文件版本信息。"""
        pass

    @abc.abstractmethod
    def list_file_versions(self, file_id: str) -> List[int]:
        """列出文件的所有版本。"""
        pass

    @abc.abstractmethod
    def save_dir_meta(self, dir_path: str, meta: Dict[str, Any]):
        """保存目录元数据。"""
        pass

    @abc.abstractmethod
    def get_dir_meta(self, dir_path: str) -> Optional[Dict[str, Any]]:
        """获取目录元数据。"""
        pass

    @abc.abstractmethod
    def delete_dir_meta(self, dir_path: str):
        """删除目录元数据。"""
        pass

    @abc.abstractmethod
    def save_dir_children(self, dir_path: str, children: List[Dict[str, Any]]):
        """保存目录子项列表。"""
        pass

    @abc.abstractmethod
    def get_dir_children(self, dir_path: str) -> List[Dict[str, Any]]:
        """获取目录子项列表。"""
        pass

    @abc.abstractmethod
    def delete_dir_children(self, dir_path: str):
        """删除目录子项列表。"""
        pass

    @abc.abstractmethod
    def save_snapshot(self, dir_path: str, snapshot_id: str,
                      snapshot_data: Dict[str, Any]):
        """保存目录快照。"""
        pass

    @abc.abstractmethod
    def get_snapshot(self, snapshot_id: str) -> Optional[Dict[str, Any]]:
        """获取目录快照。"""
        pass

    @abc.abstractmethod
    def list_snapshots(self, dir_path: str) -> List[str]:
        """列出目录的所有快照。"""
        pass

    @abc.abstractmethod
    def set_head(self, path: str, version: int):
        """设置文件的当前HEAD版本。"""
        pass

    @abc.abstractmethod
    def get_head(self, path: str) -> int:
        """获取文件的当前HEAD版本。"""
        pass

    @abc.abstractmethod
    def close(self):
        """关闭存储引擎，释放资源。"""
        pass

    @abc.abstractmethod
    def set_pending(self, path: str, pending: Dict[str, Any]):
        """设置文件的未提交修改标记。"""
        pass

    @abc.abstractmethod
    def get_pending(self, path: str) -> Optional[Dict[str, Any]]:
        """获取文件的未提交修改标记。"""
        pass

    @abc.abstractmethod
    def clear_pending(self, path: str):
        """清除文件的未提交修改标记。"""
        pass

    def has_pending(self, path: str) -> bool:
        """检查文件是否有未提交的修改。"""
        return self.get_pending(path) is not None

    @abc.abstractmethod
    def list_all_files(self) -> Iterator[str]:
        """列出所有文件。"""
        pass

    @abc.abstractmethod
    def list_all_dirs(self) -> Iterator[str]:
        """列出所有目录。"""
        pass

    @abc.abstractmethod
    def compact(self):
        """压缩/优化存储。"""
        pass

    @abc.abstractmethod
    def close(self):
        """关闭存储。"""
        pass

    def _serialize(self, obj: Any) -> bytes:
        """序列化对象。"""
        return msgpack.packb(obj, use_bin_type=True)

    def _deserialize(self, data: bytes) -> Any:
        """反序列化对象。"""
        return msgpack.unpackb(data, raw=False)

    def _hash(self, data: bytes) -> str:
        """计算数据哈希。"""
        return xxhash.xxh64(data).hexdigest()

    def _ensure_dir(self, path: str):
        """确保目录存在。"""
        if not os.path.exists(path):
            os.makedirs(path)


class SQLiteStorage(BaseStorage):
    """
    SQLite 存储引擎实现（Windows 兼容备选方案）。
    使用 SQLite 模拟 LSM Tree 的键值存储功能。
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_dir(db_path)
        self.db_file = os.path.join(db_path, 'versionedfs.db')
        self.db = self._open_db()
        self._in_batch = False
        self._batch_operations = []

    def _open_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_file, check_same_thread=False, timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-65536")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA mmap_size=2147483648")
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value BLOB
            ) WITHOUT ROWID
        """)
        
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_kv_prefix ON kv_store(key)
        """)
        
        conn.commit()
        return conn

    def begin_batch(self):
        self._in_batch = True
        self._batch_operations = []

    def commit_batch(self):
        if self._in_batch and self._batch_operations:
            try:
                cursor = self.db.cursor()
                cursor.execute("BEGIN")
                for op_type, key, value in self._batch_operations:
                    if op_type == 'PUT':
                        cursor.execute(
                            "INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)",
                            (key, value)
                        )
                    elif op_type == 'DELETE':
                        cursor.execute(
                            "DELETE FROM kv_store WHERE key = ?",
                            (key,)
                        )
                self.db.commit()
            except Exception as e:
                self.db.rollback()
                raise e
            finally:
                self._in_batch = False
                self._batch_operations = []

    def rollback_batch(self):
        self._in_batch = False
        self._batch_operations = []

    def _write(self, key: str, value: bytes):
        if self._in_batch:
            self._batch_operations.append(('PUT', key, value))
        else:
            self.db.execute(
                "INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)",
                (key, value)
            )
            self.db.commit()

    def _delete(self, key: str):
        if self._in_batch:
            self._batch_operations.append(('DELETE', key, None))
        else:
            self.db.execute("DELETE FROM kv_store WHERE key = ?", (key,))
            self.db.commit()

    def _get(self, key: str) -> Optional[bytes]:
        if self._in_batch:
            for op_type, op_key, op_value in reversed(self._batch_operations):
                if op_key == key:
                    if op_type == 'PUT':
                        return op_value
                    elif op_type == 'DELETE':
                        return None
        
        cursor = self.db.execute("SELECT value FROM kv_store WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row[0] if row else None

    def _scan_prefix(self, prefix: str) -> Iterator[Tuple[str, bytes]]:
        cursor = self.db.execute(
            "SELECT key, value FROM kv_store WHERE key >= ? AND key < ? ORDER BY key",
            (prefix, prefix[:-1] + chr(ord(prefix[-1]) + 1))
        )
        
        db_results = {}
        for row in cursor:
            db_results[row[0]] = row[1]
        
        if self._in_batch:
            for op_type, op_key, op_value in self._batch_operations:
                if op_key.startswith(prefix):
                    if op_type == 'PUT':
                        db_results[op_key] = op_value
                    elif op_type == 'DELETE':
                        db_results.pop(op_key, None)
        
        for key in sorted(db_results.keys()):
            yield key, db_results[key]

    def get_next_counter(self, prefix: str = 'global') -> int:
        key = f'counter:{prefix}'
        val = self._get(key)
        current = 0 if val is None else int(val)
        new_val = current + 1
        self._write(key, str(new_val).encode())
        return new_val

    def write_file_content(self, file_id: str, data: bytes) -> Dict[str, Any]:
        size = len(data)
        block_count = (size + self.BLOCK_SIZE - 1) // self.BLOCK_SIZE
        blocks = []

        for i in range(block_count):
            start = i * self.BLOCK_SIZE
            end = min(start + self.BLOCK_SIZE, size)
            block_data = data[start:end]
            block_hash = self._hash(block_data)
            key = f'f:content:{file_id}:{i}'
            self._write(key, block_data)
            blocks.append({
                'index': i,
                'hash': block_hash,
                'size': len(block_data)
            })

        return {
            'file_id': file_id,
            'size': size,
            'block_count': block_count,
            'blocks': blocks,
            'content_hash': self._hash(data)
        }

    def read_file_content(self, file_id: str, offset: int = 0,
                          length: Optional[int] = None) -> bytes:
        result = bytearray()
        start_block = offset // self.BLOCK_SIZE
        start_offset = offset % self.BLOCK_SIZE

        current = 0
        block_idx = start_block

        while True:
            key = f'f:content:{file_id}:{block_idx}'
            block_data = self._get(key)

            if block_data is None:
                break

            if block_idx == start_block:
                chunk = block_data[start_offset:]
            else:
                chunk = block_data

            if length is not None:
                remaining = length - current
                if len(chunk) > remaining:
                    chunk = chunk[:remaining]

            result.extend(chunk)
            current += len(chunk)
            block_idx += 1

            if length is not None and current >= length:
                break

        return bytes(result)

    def delete_file_content(self, file_id: str):
        prefix = f'f:content:{file_id}:'
        keys_to_delete = []
        for key, _ in self._scan_prefix(prefix):
            if key.startswith(prefix):
                keys_to_delete.append(key)

        for key in keys_to_delete:
            self._delete(key)

    def save_file_meta(self, path: str, meta: Dict[str, Any]):
        key = f'f:meta:{path}'
        self._write(key, self._serialize(meta))

    def get_file_meta(self, path: str) -> Optional[Dict[str, Any]]:
        key = f'f:meta:{path}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def delete_file_meta(self, path: str):
        key = f'f:meta:{path}'
        self._delete(key)

    def save_file_version(self, file_id: str, version: int,
                          version_info: Dict[str, Any]):
        key = f'f:version:{file_id}:{version:010d}'
        self._write(key, self._serialize(version_info))

    def get_file_version(self, file_id: str, version: int) -> Optional[Dict[str, Any]]:
        key = f'f:version:{file_id}:{version:010d}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def list_file_versions(self, file_id: str) -> List[int]:
        versions = []
        prefix = f'f:version:{file_id}:'

        for key, _ in self._scan_prefix(prefix):
            if not key.startswith(prefix):
                break
            parts = key.split(':')
            versions.append(int(parts[-1]))

        return sorted(versions)

    def save_dir_meta(self, dir_path: str, meta: Dict[str, Any]):
        key = f'd:meta:{dir_path}'
        self._write(key, self._serialize(meta))

    def get_dir_meta(self, dir_path: str) -> Optional[Dict[str, Any]]:
        key = f'd:meta:{dir_path}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def delete_dir_meta(self, dir_path: str):
        key = f'd:meta:{dir_path}'
        self._delete(key)

    def save_dir_children(self, dir_path: str, children: List[Dict[str, Any]]):
        key = f'd:children:{dir_path}'
        self._write(key, self._serialize(children))

    def get_dir_children(self, dir_path: str) -> List[Dict[str, Any]]:
        key = f'd:children:{dir_path}'
        val = self._get(key)
        return self._deserialize(val) if val else []

    def delete_dir_children(self, dir_path: str):
        key = f'd:children:{dir_path}'
        self._delete(key)

    def save_snapshot(self, dir_path: str, snapshot_id: str,
                      snapshot_data: Dict[str, Any]):
        key = f'd:snapshot:{snapshot_id}'
        self._write(key, self._serialize(snapshot_data))

        list_key = f'd:snapshots:{dir_path}'
        snapshots = self._get(list_key)
        snapshot_list = self._deserialize(snapshots) if snapshots else []
        snapshot_list.append(snapshot_id)
        self._write(list_key, self._serialize(snapshot_list))

    def get_snapshot(self, snapshot_id: str) -> Optional[Dict[str, Any]]:
        key = f'd:snapshot:{snapshot_id}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def list_snapshots(self, dir_path: str) -> List[str]:
        key = f'd:snapshots:{dir_path}'
        val = self._get(key)
        return self._deserialize(val) if val else []

    def set_head(self, path: str, version: int):
        key = f'HEAD:{path}'
        self._write(key, str(version).encode())

    def get_head(self, path: str) -> int:
        key = f'HEAD:{path}'
        val = self._get(key)
        return int(val) if val else 0

    def set_pending(self, path: str, pending: Dict[str, Any]):
        key = f'pending:{path}'
        self._write(key, self._serialize(pending))

    def get_pending(self, path: str) -> Optional[Dict[str, Any]]:
        key = f'pending:{path}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def clear_pending(self, path: str):
        key = f'pending:{path}'
        self._delete(key)

    def close(self):
        """关闭存储引擎，释放资源"""
        try:
            if hasattr(self, 'db') and self.db is not None:
                self.db.commit()
                self.db.close()
                self.db = None
        except Exception:
            pass

    def list_all_files(self) -> Iterator[str]:
        prefix = 'f:meta:'
        for key, _ in self._scan_prefix(prefix):
            if not key.startswith(prefix):
                break
            yield key[len('f:meta:'):]

    def list_all_dirs(self) -> Iterator[str]:
        prefix = 'd:meta:'
        for key, _ in self._scan_prefix(prefix):
            if not key.startswith(prefix):
                break
            yield key[len('d:meta:'):]

    def compact(self):
        self.db.execute("PRAGMA optimize")
        self.db.execute("VACUUM")
        self.db.commit()

    def close(self):
        if hasattr(self, 'db') and self.db:
            try:
                self.db.commit()
            except:
                pass
            self.db.close()


class RocksDBStorage(BaseStorage):
    """
    LSM Tree 存储引擎，基于 RocksDB 实现（高性能版本）。
    """

    def __init__(self, db_path: str):
        import rocksdb
        self._rocksdb = rocksdb
        
        self.db_path = db_path
        self._ensure_dir(db_path)
        self.db = self._open_db()
        self._write_batch = None

    def _open_db(self):
        rocksdb = self._rocksdb
        opts = rocksdb.Options()
        opts.create_if_missing = True
        opts.max_open_files = 300000
        opts.write_buffer_size = 64 * 1024 * 1024
        opts.max_write_buffer_number = 3
        opts.target_file_size_base = 64 * 1024 * 1024
        opts.level_compaction_dynamic_level_bytes = True
        opts.optimize_level_style_compaction(512 * 1024 * 1024)

        table_opts = rocksdb.BlockBasedTableOptions()
        table_opts.block_size = 32 * 1024
        table_opts.block_cache = rocksdb.LRUCache(2 * 1024 * 1024 * 1024)
        table_opts.filter_policy = rocksdb.BloomFilterPolicy(10)
        opts.table_factory = rocksdb.BlockBasedTableFactory(table_opts)

        return rocksdb.DB(self.db_path, opts)

    def begin_batch(self):
        self._write_batch = self._rocksdb.WriteBatch()

    def commit_batch(self):
        if self._write_batch:
            self.db.write(self._write_batch)
            self._write_batch = None

    def rollback_batch(self):
        self._write_batch = None

    def _write(self, key: str, value: bytes):
        key_bytes = key.encode() if isinstance(key, str) else key
        if self._write_batch:
            self._write_batch.put(key_bytes, value)
        else:
            self.db.put(key_bytes, value)

    def _delete(self, key: str):
        key_bytes = key.encode() if isinstance(key, str) else key
        if self._write_batch:
            self._write_batch.delete(key_bytes)
        else:
            self.db.delete(key_bytes)

    def _get(self, key: str) -> Optional[bytes]:
        key_bytes = key.encode() if isinstance(key, str) else key
        return self.db.get(key_bytes)

    def get_next_counter(self, prefix: str = 'global') -> int:
        key = f'counter:{prefix}'
        val = self._get(key)
        current = 0 if val is None else int(val)
        new_val = current + 1
        self._write(key, str(new_val).encode())
        return new_val

    def write_file_content(self, file_id: str, data: bytes) -> Dict[str, Any]:
        size = len(data)
        block_count = (size + self.BLOCK_SIZE - 1) // self.BLOCK_SIZE
        blocks = []

        for i in range(block_count):
            start = i * self.BLOCK_SIZE
            end = min(start + self.BLOCK_SIZE, size)
            block_data = data[start:end]
            block_hash = self._hash(block_data)
            key = f'f:content:{file_id}:{i}'
            self._write(key, block_data)
            blocks.append({
                'index': i,
                'hash': block_hash,
                'size': len(block_data)
            })

        return {
            'file_id': file_id,
            'size': size,
            'block_count': block_count,
            'blocks': blocks,
            'content_hash': self._hash(data)
        }

    def read_file_content(self, file_id: str, offset: int = 0,
                          length: Optional[int] = None) -> bytes:
        result = bytearray()
        start_block = offset // self.BLOCK_SIZE
        start_offset = offset % self.BLOCK_SIZE

        current = 0
        block_idx = start_block

        while True:
            key = f'f:content:{file_id}:{block_idx}'
            block_data = self._get(key)

            if block_data is None:
                break

            if block_idx == start_block:
                chunk = block_data[start_offset:]
            else:
                chunk = block_data

            if length is not None:
                remaining = length - current
                if len(chunk) > remaining:
                    chunk = chunk[:remaining]

            result.extend(chunk)
            current += len(chunk)
            block_idx += 1

            if length is not None and current >= length:
                break

        return bytes(result)

    def delete_file_content(self, file_id: str):
        prefix = f'f:content:{file_id}:'.encode()
        it = self.db.iteritems()
        it.seek(prefix)

        keys_to_delete = []
        for key, _ in it:
            if not key.startswith(prefix):
                break
            keys_to_delete.append(key)

        for key in keys_to_delete:
            self._delete(key)

    def save_file_meta(self, path: str, meta: Dict[str, Any]):
        key = f'f:meta:{path}'
        self._write(key, self._serialize(meta))

    def get_file_meta(self, path: str) -> Optional[Dict[str, Any]]:
        key = f'f:meta:{path}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def delete_file_meta(self, path: str):
        key = f'f:meta:{path}'
        self._delete(key)

    def save_file_version(self, file_id: str, version: int,
                          version_info: Dict[str, Any]):
        key = f'f:version:{file_id}:{version:010d}'
        self._write(key, self._serialize(version_info))

    def get_file_version(self, file_id: str, version: int) -> Optional[Dict[str, Any]]:
        key = f'f:version:{file_id}:{version:010d}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def list_file_versions(self, file_id: str) -> List[int]:
        versions = []
        prefix = f'f:version:{file_id}:'.encode()
        it = self.db.iterkeys()
        it.seek(prefix)

        for key in it:
            if not key.startswith(prefix):
                break
            parts = key.decode().split(':')
            versions.append(int(parts[-1]))

        return sorted(versions)

    def save_dir_meta(self, dir_path: str, meta: Dict[str, Any]):
        key = f'd:meta:{dir_path}'
        self._write(key, self._serialize(meta))

    def get_dir_meta(self, dir_path: str) -> Optional[Dict[str, Any]]:
        key = f'd:meta:{dir_path}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def delete_dir_meta(self, dir_path: str):
        key = f'd:meta:{dir_path}'
        self._delete(key)

    def save_dir_children(self, dir_path: str, children: List[Dict[str, Any]]):
        key = f'd:children:{dir_path}'
        self._write(key, self._serialize(children))

    def get_dir_children(self, dir_path: str) -> List[Dict[str, Any]]:
        key = f'd:children:{dir_path}'
        val = self._get(key)
        return self._deserialize(val) if val else []

    def delete_dir_children(self, dir_path: str):
        key = f'd:children:{dir_path}'
        self._delete(key)

    def save_snapshot(self, dir_path: str, snapshot_id: str,
                      snapshot_data: Dict[str, Any]):
        key = f'd:snapshot:{snapshot_id}'
        self._write(key, self._serialize(snapshot_data))

        list_key = f'd:snapshots:{dir_path}'
        snapshots = self._get(list_key)
        snapshot_list = self._deserialize(snapshots) if snapshots else []
        snapshot_list.append(snapshot_id)
        self._write(list_key, self._serialize(snapshot_list))

    def get_snapshot(self, snapshot_id: str) -> Optional[Dict[str, Any]]:
        key = f'd:snapshot:{snapshot_id}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def list_snapshots(self, dir_path: str) -> List[str]:
        key = f'd:snapshots:{dir_path}'
        val = self._get(key)
        return self._deserialize(val) if val else []

    def set_head(self, path: str, version: int):
        key = f'HEAD:{path}'
        self._write(key, str(version).encode())

    def get_head(self, path: str) -> int:
        key = f'HEAD:{path}'
        val = self._get(key)
        return int(val) if val else 0

    def set_pending(self, path: str, pending: Dict[str, Any]):
        key = f'pending:{path}'
        self._write(key, self._serialize(pending))

    def get_pending(self, path: str) -> Optional[Dict[str, Any]]:
        key = f'pending:{path}'
        val = self._get(key)
        return self._deserialize(val) if val else None

    def clear_pending(self, path: str):
        key = f'pending:{path}'
        self._delete(key)

    def close(self):
        """关闭存储引擎，释放资源"""
        try:
            if hasattr(self, 'db') and self.db is not None:
                self.db.commit()
                self.db.close()
                self.db = None
        except Exception:
            pass

    def list_all_files(self) -> Iterator[str]:
        prefix = b'f:meta:'
        it = self.db.iterkeys()
        it.seek(prefix)

        for key in it:
            if not key.startswith(prefix):
                break
            yield key.decode()[len('f:meta:'):]

    def list_all_dirs(self) -> Iterator[str]:
        prefix = b'd:meta:'
        it = self.db.iterkeys()
        it.seek(prefix)

        for key in it:
            if not key.startswith(prefix):
                break
            yield key.decode()[len('d:meta:'):]

    def compact(self):
        self.db.compact_range()

    def close(self):
        if hasattr(self, 'db') and self.db:
            del self.db


def create_storage(db_path: str, backend: str = 'auto') -> BaseStorage:
    """
    工厂函数，创建存储引擎实例。
    
    Args:
        db_path: 数据库路径
        backend: 'auto' | 'rocksdb' | 'sqlite'
    """
    if backend == 'auto':
        try:
            import rocksdb
            return RocksDBStorage(db_path)
        except ImportError:
            return SQLiteStorage(db_path)
    elif backend == 'rocksdb':
        return RocksDBStorage(db_path)
    elif backend == 'sqlite':
        return SQLiteStorage(db_path)
    else:
        raise ValueError(f"Unknown backend: {backend}")
