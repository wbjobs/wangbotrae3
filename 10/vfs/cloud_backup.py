import os
import io
import time
import json
import sqlite3
import hashlib
import threading
import logging
from typing import Dict, List, Optional, Tuple, Any, Set
from dataclasses import dataclass, field
from enum import Enum

import xxhash
import msgpack

logger = logging.getLogger('vfs.cloud')

BLOCK_SIZE = 64 * 1024
MANIFEST_PREFIX = 'manifests/'
BLOCK_PREFIX = 'blocks/'
SNAPSHOT_PREFIX = 'snapshots/'
SYNC_STATE_KEY = '__sync_state__'


class CloudStorageBackend(Enum):
    S3 = 's3'
    LOCAL = 'local'


@dataclass
class S3Config:
    endpoint: str = ''
    region: str = 'us-east-1'
    bucket: str = ''
    access_key: str = ''
    secret_key: str = ''
    prefix: str = 'versionedfs/'
    storage_class: str = 'STANDARD'

    @classmethod
    def from_dict(cls, d: Dict[str, str]) -> 'S3Config':
        return cls(
            endpoint=d.get('endpoint', ''),
            region=d.get('region', 'us-east-1'),
            bucket=d.get('bucket', ''),
            access_key=d.get('access_key', ''),
            secret_key=d.get('secret_key', ''),
            prefix=d.get('prefix', 'versionedfs/'),
            storage_class=d.get('storage_class', 'STANDARD'),
        )

    def to_dict(self) -> Dict[str, str]:
        return {
            'endpoint': self.endpoint,
            'region': self.region,
            'bucket': self.bucket,
            'access_key': self.access_key,
            'secret_key': self.secret_key,
            'prefix': self.prefix,
            'storage_class': self.storage_class,
        }

    def validate(self) -> List[str]:
        errors = []
        if not self.bucket:
            errors.append('bucket is required')
        if not self.access_key:
            errors.append('access_key is required')
        if not self.secret_key:
            errors.append('secret_key is required')
        return errors


class CloudStorage:
    """
    S3兼容云存储抽象层。
    支持真实S3（boto3）和本地文件系统模拟（用于测试）。
    """

    def __init__(self, config: S3Config):
        self.config = config
        self._s3_client = None
        self._local_root = None
        self._backend = CloudStorageBackend.LOCAL

        if config.endpoint == '' and config.bucket.startswith('local://'):
            self._local_root = config.bucket[len('local://'):]
            os.makedirs(self._local_root, exist_ok=True)
            self._backend = CloudStorageBackend.LOCAL
        else:
            try:
                import boto3
                session_kwargs = {}
                if config.endpoint:
                    session_kwargs['endpoint_url'] = config.endpoint
                if config.region:
                    session_kwargs['region_name'] = config.region

                self._s3_client = boto3.client(
                    's3',
                    aws_access_key_id=config.access_key,
                    aws_secret_access_key=config.secret_key,
                    **session_kwargs
                )
                self._backend = CloudStorageBackend.S3
                self._ensure_bucket()
            except ImportError:
                if config.bucket.startswith('local://'):
                    self._local_root = config.bucket[len('local://'):]
                    os.makedirs(self._local_root, exist_ok=True)
                    self._backend = CloudStorageBackend.LOCAL
                else:
                    logger.warning("boto3 not available, using local storage fallback")
                    self._local_root = os.path.join(
                        os.path.dirname(config.bucket), 'cloud_fallback'
                    )
                    os.makedirs(self._local_root, exist_ok=True)
                    self._backend = CloudStorageBackend.LOCAL

    def _ensure_bucket(self):
        if self._backend != CloudStorageBackend.S3:
            return
        try:
            self._s3_client.head_bucket(Bucket=self.config.bucket)
        except Exception:
            try:
                self._s3_client.create_bucket(Bucket=self.config.bucket)
            except Exception as e:
                logger.error(f"Failed to create bucket: {e}")

    @property
    def backend_type(self) -> CloudStorageBackend:
        return self._backend

    def _object_key(self, key: str) -> str:
        return f"{self.config.prefix}{key}"

    def put_object(self, key: str, data: bytes, metadata: Optional[Dict] = None):
        full_key = self._object_key(key)
        if self._backend == CloudStorageBackend.S3:
            kwargs = {
                'Bucket': self.config.bucket,
                'Key': full_key,
                'Body': data,
                'StorageClass': self.config.storage_class,
            }
            if metadata:
                kwargs['Metadata'] = {k: str(v) for k, v in metadata.items()}
            self._s3_client.put_object(**kwargs)
        else:
            file_path = os.path.join(self._local_root, full_key.replace('/', os.sep))
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, 'wb') as f:
                f.write(data)
            if metadata:
                meta_path = file_path + '.meta'
                with open(meta_path, 'w') as f:
                    json.dump(metadata, f)

    def get_object(self, key: str) -> Optional[bytes]:
        full_key = self._object_key(key)
        if self._backend == CloudStorageBackend.S3:
            try:
                resp = self._s3_client.get_object(
                    Bucket=self.config.bucket, Key=full_key
                )
                return resp['Body'].read()
            except Exception:
                return None
        else:
            file_path = os.path.join(self._local_root, full_key.replace('/', os.sep))
            if os.path.exists(file_path):
                with open(file_path, 'rb') as f:
                    return f.read()
            return None

    def delete_object(self, key: str):
        full_key = self._object_key(key)
        if self._backend == CloudStorageBackend.S3:
            try:
                self._s3_client.delete_object(
                    Bucket=self.config.bucket, Key=full_key
                )
            except Exception:
                pass
        else:
            file_path = os.path.join(self._local_root, full_key.replace('/', os.sep))
            if os.path.exists(file_path):
                os.remove(file_path)
            meta_path = file_path + '.meta'
            if os.path.exists(meta_path):
                os.remove(meta_path)

    def list_objects(self, prefix: str = '') -> List[str]:
        full_prefix = self._object_key(prefix)
        if self._backend == CloudStorageBackend.S3:
            objects = []
            paginator = self._s3_client.get_paginator('list_objects_v2')
            for page in paginator.paginate(
                Bucket=self.config.bucket, Prefix=full_prefix
            ):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    if key.startswith(self.config.prefix):
                        objects.append(key[len(self.config.prefix):])
            return objects
        else:
            dir_path = os.path.join(self._local_root, full_prefix.replace('/', os.sep))
            if not os.path.exists(dir_path):
                return []
            result = []
            prefix_len = len(self.config.prefix)
            for root, dirs, files in os.walk(dir_path):
                for fname in files:
                    if fname.endswith('.meta'):
                        continue
                    full = os.path.join(root, fname)
                    rel = os.path.relpath(full, self._local_root)
                    rel = rel.replace(os.sep, '/')
                    if rel.startswith(self.config.prefix):
                        result.append(rel[prefix_len:])
            return result

    def object_exists(self, key: str) -> bool:
        full_key = self._object_key(key)
        if self._backend == CloudStorageBackend.S3:
            try:
                self._s3_client.head_object(
                    Bucket=self.config.bucket, Key=full_key
                )
                return True
            except Exception:
                return False
        else:
            file_path = os.path.join(self._local_root, full_key.replace('/', os.sep))
            return os.path.exists(file_path)

    def get_object_metadata(self, key: str) -> Optional[Dict]:
        full_key = self._object_key(key)
        if self._backend == CloudStorageBackend.S3:
            try:
                resp = self._s3_client.head_object(
                    Bucket=self.config.bucket, Key=full_key
                )
                return resp.get('Metadata', {})
            except Exception:
                return None
        else:
            file_path = os.path.join(self._local_root, full_key.replace('/', os.sep))
            meta_path = file_path + '.meta'
            if os.path.exists(meta_path):
                with open(meta_path, 'r') as f:
                    return json.load(f)
            return None

    def put_multipart(self, key: str, data: bytes, part_size: int = 8 * 1024 * 1024,
                      metadata: Optional[Dict] = None):
        if len(data) < part_size or self._backend != CloudStorageBackend.S3:
            self.put_object(key, data, metadata)
            return

        full_key = self._object_key(key)
        kwargs = {
            'Bucket': self.config.bucket,
            'Key': full_key,
            'StorageClass': self.config.storage_class,
        }
        if metadata:
            kwargs['Metadata'] = {k: str(v) for k, v in metadata.items()}

        mpu = self._s3_client.create_multipart_upload(**kwargs)
        upload_id = mpu['UploadId']
        parts = []

        try:
            for i in range(0, len(data), part_size):
                part_num = len(parts) + 1
                chunk = data[i:i + part_size]
                resp = self._s3_client.upload_part(
                    Bucket=self.config.bucket,
                    Key=full_key,
                    PartNumber=part_num,
                    UploadId=upload_id,
                    Body=chunk
                )
                parts.append({'PartNumber': part_num, 'ETag': resp['ETag']})

            self._s3_client.complete_multipart_upload(
                Bucket=self.config.bucket,
                Key=full_key,
                UploadId=upload_id,
                MultipartUpload={'Parts': parts}
            )
        except Exception:
            try:
                self._s3_client.abort_multipart_upload(
                    Bucket=self.config.bucket,
                    Key=full_key,
                    UploadId=upload_id
                )
            except Exception:
                pass
            raise


@dataclass
class BlockRef:
    block_hash: str
    offset: int
    size: int
    is_new: bool = False


@dataclass
class BackupManifest:
    manifest_id: str
    timestamp: float
    parent_manifest_id: Optional[str]
    block_refs: Dict[str, List[BlockRef]]
    file_metas: Dict[str, Dict[str, Any]]
    file_versions: Dict[str, int]
    total_blocks: int = 0
    new_blocks: int = 0
    total_bytes: int = 0
    new_bytes: int = 0


@dataclass
class CloudSnapshot:
    snapshot_id: str
    timestamp: float
    manifest_id: str
    parent_snapshot_id: Optional[str]
    message: str
    file_count: int = 0
    total_size: int = 0


@dataclass
class RestoreProgress:
    total_files: int = 0
    restored_files: int = 0
    total_bytes: int = 0
    restored_bytes: int = 0
    current_file: str = ''
    started_at: float = 0.0
    last_update: float = 0.0
    completed: bool = False
    error: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            'total_files': self.total_files,
            'restored_files': self.restored_files,
            'total_bytes': self.total_bytes,
            'restored_bytes': self.restored_bytes,
            'current_file': self.current_file,
            'started_at': self.started_at,
            'last_update': self.last_update,
            'completed': self.completed,
            'error': self.error,
        }

    @classmethod
    def from_dict(cls, d: Dict) -> 'RestoreProgress':
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


class DedupIndex:
    """
    块级去重索引。
    维护 block_hash -> cloud_key 的映射，避免重复上传相同块。
    持久化到本地SQLite数据库。
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS block_index (
                block_hash TEXT PRIMARY KEY,
                cloud_key TEXT NOT NULL,
                size INTEGER NOT NULL,
                ref_count INTEGER DEFAULT 1,
                first_seen REAL NOT NULL,
                last_seen REAL NOT NULL
            )
        """)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS manifest_index (
                manifest_id TEXT PRIMARY KEY,
                timestamp REAL NOT NULL,
                parent_manifest_id TEXT,
                data BLOB NOT NULL
            )
        """)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS snapshot_chain (
                snapshot_id TEXT PRIMARY KEY,
                timestamp REAL NOT NULL,
                manifest_id TEXT NOT NULL,
                parent_snapshot_id TEXT,
                message TEXT,
                data BLOB NOT NULL
            )
        """)
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL
            )
        """)
        self.db.commit()
        self.lock = threading.Lock()

    def has_block(self, block_hash: str) -> bool:
        with self.lock:
            cur = self.db.execute(
                "SELECT 1 FROM block_index WHERE block_hash = ?",
                (block_hash,)
            )
            return cur.fetchone() is not None

    def get_block_cloud_key(self, block_hash: str) -> Optional[str]:
        with self.lock:
            cur = self.db.execute(
                "SELECT cloud_key FROM block_index WHERE block_hash = ?",
                (block_hash,)
            )
            row = cur.fetchone()
            return row[0] if row else None

    def add_block(self, block_hash: str, cloud_key: str, size: int):
        with self.lock:
            now = time.time()
            cur = self.db.execute(
                "SELECT ref_count FROM block_index WHERE block_hash = ?",
                (block_hash,)
            )
            row = cur.fetchone()
            if row:
                self.db.execute(
                    "UPDATE block_index SET ref_count = ref_count + 1, last_seen = ? WHERE block_hash = ?",
                    (now, block_hash)
                )
            else:
                self.db.execute(
                    "INSERT INTO block_index (block_hash, cloud_key, size, ref_count, first_seen, last_seen) VALUES (?, ?, ?, 1, ?, ?)",
                    (block_hash, cloud_key, size, now, now)
                )
            self.db.commit()

    def remove_block_ref(self, block_hash: str) -> int:
        with self.lock:
            cur = self.db.execute(
                "SELECT ref_count FROM block_index WHERE block_hash = ?",
                (block_hash,)
            )
            row = cur.fetchone()
            if row and row[0] > 1:
                self.db.execute(
                    "UPDATE block_index SET ref_count = ref_count - 1 WHERE block_hash = ?",
                    (block_hash,)
                )
                self.db.commit()
                return row[0] - 1
            elif row:
                self.db.execute(
                    "DELETE FROM block_index WHERE block_hash = ?",
                    (block_hash,)
                )
                self.db.commit()
                return 0
            return 0

    def save_manifest(self, manifest: BackupManifest):
        data = msgpack.packb({
            'manifest_id': manifest.manifest_id,
            'timestamp': manifest.timestamp,
            'parent_manifest_id': manifest.parent_manifest_id,
            'block_refs': {
                path: [{'block_hash': b.block_hash, 'offset': b.offset,
                        'size': b.size, 'is_new': b.is_new}
                       for b in refs]
                for path, refs in manifest.block_refs.items()
            },
            'file_metas': manifest.file_metas,
            'file_versions': manifest.file_versions,
            'total_blocks': manifest.total_blocks,
            'new_blocks': manifest.new_blocks,
            'total_bytes': manifest.total_bytes,
            'new_bytes': manifest.new_bytes,
        }, use_bin_type=True)
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO manifest_index (manifest_id, timestamp, parent_manifest_id, data) VALUES (?, ?, ?, ?)",
                (manifest.manifest_id, manifest.timestamp,
                 manifest.parent_manifest_id, data)
            )
            self.db.commit()

    def get_manifest(self, manifest_id: str) -> Optional[BackupManifest]:
        with self.lock:
            cur = self.db.execute(
                "SELECT data FROM manifest_index WHERE manifest_id = ?",
                (manifest_id,)
            )
            row = cur.fetchone()
            if row:
                return self._decode_manifest(row[0])
            return None

    def list_manifests(self) -> List[Tuple[str, float]]:
        with self.lock:
            cur = self.db.execute(
                "SELECT manifest_id, timestamp FROM manifest_index ORDER BY timestamp DESC"
            )
            return cur.fetchall()

    def save_cloud_snapshot(self, snapshot: CloudSnapshot):
        data = msgpack.packb({
            'snapshot_id': snapshot.snapshot_id,
            'timestamp': snapshot.timestamp,
            'manifest_id': snapshot.manifest_id,
            'parent_snapshot_id': snapshot.parent_snapshot_id,
            'message': snapshot.message,
            'file_count': snapshot.file_count,
            'total_size': snapshot.total_size,
        }, use_bin_type=True)
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO snapshot_chain (snapshot_id, timestamp, manifest_id, parent_snapshot_id, message, data) VALUES (?, ?, ?, ?, ?, ?)",
                (snapshot.snapshot_id, snapshot.timestamp,
                 snapshot.manifest_id, snapshot.parent_snapshot_id,
                 snapshot.message, data)
            )
            self.db.commit()

    def get_cloud_snapshot(self, snapshot_id: str) -> Optional[CloudSnapshot]:
        with self.lock:
            cur = self.db.execute(
                "SELECT data FROM snapshot_chain WHERE snapshot_id = ?",
                (snapshot_id,)
            )
            row = cur.fetchone()
            if row:
                d = msgpack.unpackb(row[0], raw=False)
                return CloudSnapshot(**d)
            return None

    def list_cloud_snapshots(self) -> List[CloudSnapshot]:
        with self.lock:
            cur = self.db.execute(
                "SELECT data FROM snapshot_chain ORDER BY timestamp DESC"
            )
            results = []
            for row in cur.fetchall():
                d = msgpack.unpackb(row[0], raw=False)
                results.append(CloudSnapshot(**d))
            return results

    def get_latest_snapshot(self) -> Optional[CloudSnapshot]:
        with self.lock:
            cur = self.db.execute(
                "SELECT data FROM snapshot_chain ORDER BY timestamp DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row:
                d = msgpack.unpackb(row[0], raw=False)
                return CloudSnapshot(**d)
            return None

    def save_sync_state(self, key: str, value: bytes):
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
                (key, value)
            )
            self.db.commit()

    def get_sync_state(self, key: str) -> Optional[bytes]:
        with self.lock:
            cur = self.db.execute(
                "SELECT value FROM sync_state WHERE key = ?",
                (key,)
            )
            row = cur.fetchone()
            return row[0] if row else None

    def get_stats(self) -> Dict[str, Any]:
        with self.lock:
            cur1 = self.db.execute("SELECT COUNT(*), SUM(size) FROM block_index")
            block_row = cur1.fetchone()
            cur2 = self.db.execute("SELECT COUNT(*) FROM manifest_index")
            manifest_count = cur2.fetchone()[0]
            cur3 = self.db.execute("SELECT COUNT(*) FROM snapshot_chain")
            snapshot_count = cur3.fetchone()[0]
            return {
                'total_blocks': block_row[0] or 0,
                'total_block_bytes': block_row[1] or 0,
                'total_manifests': manifest_count,
                'total_snapshots': snapshot_count,
            }

    def _decode_manifest(self, data: bytes) -> BackupManifest:
        d = msgpack.unpackb(data, raw=False)
        block_refs = {}
        for path, refs_data in d.get('block_refs', {}).items():
            block_refs[path] = [
                BlockRef(**ref) for ref in refs_data
            ]
        return BackupManifest(
            manifest_id=d['manifest_id'],
            timestamp=d['timestamp'],
            parent_manifest_id=d.get('parent_manifest_id'),
            block_refs=block_refs,
            file_metas=d.get('file_metas', {}),
            file_versions=d.get('file_versions', {}),
            total_blocks=d.get('total_blocks', 0),
            new_blocks=d.get('new_blocks', 0),
            total_bytes=d.get('total_bytes', 0),
            new_bytes=d.get('new_bytes', 0),
        )

    def close(self):
        try:
            self.db.close()
        except Exception:
            pass


class BlockDedupEngine:
    """
    块级去重引擎。
    将数据分割为固定大小的块，计算每块的指纹（xxhash），
    仅上传云端不存在的块，实现增量去重备份。
    """

    def __init__(self, cloud: CloudStorage, dedup_index: DedupIndex):
        self.cloud = cloud
        self.index = dedup_index

    def _compute_block_hash(self, data: bytes) -> str:
        return xxhash.xxh128(data).hexdigest()

    def split_into_blocks(self, data: bytes) -> List[Tuple[bytes, int, int]]:
        blocks = []
        offset = 0
        while offset < len(data):
            end = min(offset + BLOCK_SIZE, len(data))
            chunk = data[offset:end]
            blocks.append((chunk, offset, end - offset))
            offset = end
        return blocks

    def upload_block(self, block_data: bytes, block_hash: Optional[str] = None) -> Tuple[str, bool]:
        if block_hash is None:
            block_hash = self._compute_block_hash(block_data)

        if self.index.has_block(block_hash):
            self.index.add_block(block_hash, f"{BLOCK_PREFIX}{block_hash}", len(block_data))
            return block_hash, False

        cloud_key = f"{BLOCK_PREFIX}{block_hash}"
        self.cloud.put_object(cloud_key, block_data, metadata={
            'block_hash': block_hash,
            'size': str(len(block_data)),
        })
        self.index.add_block(block_hash, cloud_key, len(block_data))
        return block_hash, True

    def upload_data(self, data: bytes) -> Tuple[List[BlockRef], int, int]:
        blocks = self.split_into_blocks(data)
        refs = []
        new_blocks = 0
        new_bytes = 0

        for block_data, offset, size in blocks:
            block_hash = self._compute_block_hash(block_data)
            _, is_new = self.upload_block(block_data, block_hash)
            refs.append(BlockRef(
                block_hash=block_hash,
                offset=offset,
                size=size,
                is_new=is_new
            ))
            if is_new:
                new_blocks += 1
                new_bytes += size

        return refs, new_blocks, new_bytes

    def download_block(self, block_hash: str) -> Optional[bytes]:
        cloud_key = f"{BLOCK_PREFIX}{block_hash}"
        return self.cloud.get_object(cloud_key)

    def download_data(self, refs: List[BlockRef]) -> bytes:
        parts = []
        for ref in refs:
            block_data = self.download_block(ref.block_hash)
            if block_data is None:
                raise IOError(f"Block {ref.block_hash} not found in cloud")
            parts.append(block_data[:ref.size])
        return b''.join(parts)

    def compute_data_fingerprint(self, data: bytes) -> str:
        blocks = self.split_into_blocks(data)
        hashes = [self._compute_block_hash(chunk) for chunk, _, _ in blocks]
        combined = '|'.join(hashes)
        return xxhash.xxh64(combined.encode()).hexdigest()


class BackupEngine:
    """
    备份引擎。
    负责将本地存储的所有数据增量备份到云端，
    生成BackupManifest和CloudSnapshot。
    """

    def __init__(self, storage, cloud: CloudStorage,
                 dedup_index: DedupIndex):
        self.storage = storage
        self.cloud = cloud
        self.dedup_index = dedup_index
        self.dedup = BlockDedupEngine(cloud, dedup_index)

    def create_backup(self, message: str = '') -> CloudSnapshot:
        logger.info("Starting backup...")

        parent_snapshot = self.dedup_index.get_latest_snapshot()
        parent_manifest_id = parent_snapshot.manifest_id if parent_snapshot else None

        block_refs = {}
        file_metas = {}
        file_versions = {}
        total_blocks = 0
        new_blocks = 0
        total_bytes = 0
        new_bytes = 0

        for file_path in self.storage.list_all_files():
            meta = self.storage.get_file_meta(file_path)
            if meta is None:
                continue
            if meta.get('deleted'):
                file_metas[file_path] = meta
                file_versions[file_path] = self.storage.get_head(file_path)
                continue

            head_version = self.storage.get_head(file_path)
            if head_version <= 0:
                continue

            file_content = self.storage.read_file_content(
                meta.get('current_file_id', meta.get('file_id', ''))
            )
            if file_content is None:
                file_content = b''

            refs, nb, nby = self.dedup.upload_data(file_content)
            block_refs[file_path] = refs
            file_metas[file_path] = meta
            file_versions[file_path] = head_version
            total_blocks += len(refs)
            new_blocks += nb
            total_bytes += len(file_content)
            new_bytes += nby

        for dir_path in self.storage.list_all_dirs():
            dir_meta = self.storage.get_dir_meta(dir_path)
            if dir_meta:
                dir_key = f"__dir__{dir_path}"
                file_metas[dir_key] = dir_meta

        manifest_id = f"mf_{xxhash.xxh64(str(time.time()).encode()).hexdigest()[:16]}"
        manifest = BackupManifest(
            manifest_id=manifest_id,
            timestamp=time.time(),
            parent_manifest_id=parent_manifest_id,
            block_refs=block_refs,
            file_metas=file_metas,
            file_versions=file_versions,
            total_blocks=total_blocks,
            new_blocks=new_blocks,
            total_bytes=total_bytes,
            new_bytes=new_bytes,
        )

        manifest_data = msgpack.packb({
            'manifest_id': manifest.manifest_id,
            'timestamp': manifest.timestamp,
            'parent_manifest_id': manifest.parent_manifest_id,
            'block_refs': {
                path: [{'block_hash': b.block_hash, 'offset': b.offset,
                        'size': b.size, 'is_new': b.is_new}
                       for b in refs]
                for path, refs in manifest.block_refs.items()
            },
            'file_metas': manifest.file_metas,
            'file_versions': manifest.file_versions,
            'total_blocks': manifest.total_blocks,
            'new_blocks': manifest.new_blocks,
            'total_bytes': manifest.total_bytes,
            'new_bytes': manifest.new_bytes,
        }, use_bin_type=True)
        self.cloud.put_object(
            f"{MANIFEST_PREFIX}{manifest_id}",
            manifest_data,
            metadata={'manifest_id': manifest_id}
        )
        self.dedup_index.save_manifest(manifest)

        snapshot_id = f"snap_{xxhash.xxh64(str(time.time()).encode()).hexdigest()[:12]}"
        cloud_snapshot = CloudSnapshot(
            snapshot_id=snapshot_id,
            timestamp=time.time(),
            manifest_id=manifest_id,
            parent_snapshot_id=parent_snapshot.snapshot_id if parent_snapshot else None,
            message=message or f"Auto backup at {time.strftime('%Y-%m-%d %H:%M:%S')}",
            file_count=len(block_refs),
            total_size=total_bytes,
        )

        snapshot_data = msgpack.packb({
            'snapshot_id': cloud_snapshot.snapshot_id,
            'timestamp': cloud_snapshot.timestamp,
            'manifest_id': cloud_snapshot.manifest_id,
            'parent_snapshot_id': cloud_snapshot.parent_snapshot_id,
            'message': cloud_snapshot.message,
            'file_count': cloud_snapshot.file_count,
            'total_size': cloud_snapshot.total_size,
        }, use_bin_type=True)
        self.cloud.put_object(
            f"{SNAPSHOT_PREFIX}{snapshot_id}",
            snapshot_data,
            metadata={'snapshot_id': snapshot_id}
        )
        self.dedup_index.save_cloud_snapshot(cloud_snapshot)

        logger.info(
            f"Backup complete: {snapshot_id}, "
            f"{new_blocks}/{total_blocks} new blocks, "
            f"{new_bytes}/{total_bytes} new bytes"
        )
        return cloud_snapshot


class RestoreEngine:
    """
    恢复引擎。
    从云端恢复文件系统到任意历史版本。
    支持断点续传：恢复进度持久化，中断后可继续。
    """

    def __init__(self, storage, cloud: CloudStorage,
                 dedup_index: DedupIndex):
        self.storage = storage
        self.cloud = cloud
        self.dedup_index = dedup_index
        self.dedup = BlockDedupEngine(cloud, dedup_index)
        self._cancel_event = threading.Event()

    def cancel(self):
        self._cancel_event.set()

    def restore_snapshot(self, snapshot_id: str, target_db_path: str,
                         on_progress=None) -> RestoreProgress:
        """
        从云端快照恢复整个文件系统。

        Args:
            snapshot_id: 云端快照ID
            target_db_path: 恢复目标数据库路径
            on_progress: 进度回调函数
        """
        self._cancel_event.clear()

        progress_key = f"restore_{snapshot_id}"
        saved_progress = self.dedup_index.get_sync_state(progress_key)
        if saved_progress:
            progress = RestoreProgress.from_dict(msgpack.unpackb(saved_progress, raw=False))
            if progress.completed:
                logger.info("Restore already completed, clearing state for fresh restore")
                progress = RestoreProgress(started_at=time.time())
            elif progress.error is None:
                logger.info(f"Resuming restore from {progress.restored_files}/{progress.total_files} files")
        else:
            progress = RestoreProgress(started_at=time.time())

        cloud_snapshot = self._load_cloud_snapshot(snapshot_id)
        if cloud_snapshot is None:
            progress.error = f"Snapshot {snapshot_id} not found in cloud"
            self._save_progress(progress_key, progress)
            return progress

        manifest = self._load_manifest(cloud_snapshot.manifest_id)
        if manifest is None:
            progress.error = f"Manifest {cloud_snapshot.manifest_id} not found in cloud"
            self._save_progress(progress_key, progress)
            return progress

        if progress.total_files == 0:
            all_paths = set(manifest.block_refs.keys())
            all_paths.update(
                p for p in manifest.file_metas.keys()
                if not p.startswith('__dir__')
            )
            file_paths = [p for p in all_paths if not p.startswith('__dir__')]
            progress.total_files = len(file_paths)
            progress.total_bytes = manifest.total_bytes

        from .storage import create_storage
        target_storage = create_storage(target_db_path, backend='sqlite')
        target_vc = __import__('vfs.version_control', fromlist=['VersionController']).VersionController(target_storage)

        all_paths = sorted(
            set(manifest.block_refs.keys()) |
            {p for p in manifest.file_metas.keys() if not p.startswith('__dir__')}
        )
        start_idx = progress.restored_files

        for i in range(start_idx, len(all_paths)):
            if self._cancel_event.is_set():
                progress.error = "Cancelled by user"
                self._save_progress(progress_key, progress)
                return progress

            file_path = all_paths[i]
            if file_path.startswith('__dir__'):
                progress.restored_files += 1
                progress.last_update = time.time()
                self._save_progress(progress_key, progress)
                continue

            try:
                refs = manifest.block_refs.get(file_path, [])
                if not refs:
                    file_meta = manifest.file_metas.get(file_path, {})
                    if file_meta.get('deleted'):
                        progress.restored_files += 1
                        progress.last_update = time.time()
                        self._save_progress(progress_key, progress)
                        continue
                    target_vc.create_file_version(
                        file_path, b'',
                        message=f"Restored from cloud snapshot {snapshot_id}"
                    )
                    progress.restored_files += 1
                    progress.last_update = time.time()
                    self._save_progress(progress_key, progress)
                    continue

                content = self.dedup.download_data(refs)

                file_meta = manifest.file_metas.get(file_path, {})
                is_dir = file_meta.get('is_dir', False)

                if is_dir:
                    continue

                target_vc.create_file_version(
                    file_path, content,
                    message=f"Restored from cloud snapshot {snapshot_id}"
                )

                progress.restored_files += 1
                progress.restored_bytes += len(content)
                progress.current_file = file_path
                progress.last_update = time.time()

                if on_progress:
                    on_progress(progress)

                self._save_progress(progress_key, progress)

            except Exception as e:
                logger.error(f"Error restoring {file_path}: {e}")
                progress.error = f"Error restoring {file_path}: {e}"
                self._save_progress(progress_key, progress)
                return progress

        for dir_key, dir_meta in manifest.file_metas.items():
            if dir_key.startswith('__dir__'):
                dir_path = dir_key[len('__dir__'):]
                target_storage.save_dir_meta(dir_path, dir_meta)
                children = dir_meta.get('children', [])
                target_storage.save_dir_children(dir_path, children)

        progress.completed = True
        progress.last_update = time.time()
        self._save_progress(progress_key, progress)

        try:
            target_storage.close()
        except Exception:
            pass

        logger.info(f"Restore complete: {progress.restored_files} files, {progress.restored_bytes} bytes")
        return progress

    def _load_cloud_snapshot(self, snapshot_id: str) -> Optional[CloudSnapshot]:
        local_snap = self.dedup_index.get_cloud_snapshot(snapshot_id)
        if local_snap:
            return local_snap

        snapshot_data = self.cloud.get_object(f"{SNAPSHOT_PREFIX}{snapshot_id}")
        if snapshot_data is None:
            return None

        d = msgpack.unpackb(snapshot_data, raw=False)
        snap = CloudSnapshot(**d)
        self.dedup_index.save_cloud_snapshot(snap)
        return snap

    def _load_manifest(self, manifest_id: str) -> Optional[BackupManifest]:
        local_manifest = self.dedup_index.get_manifest(manifest_id)
        if local_manifest:
            return local_manifest

        manifest_data = self.cloud.get_object(f"{MANIFEST_PREFIX}{manifest_id}")
        if manifest_data is None:
            return None

        return self.dedup_index._decode_manifest(manifest_data)

    def _save_progress(self, key: str, progress: RestoreProgress):
        data = msgpack.packb(progress.to_dict(), use_bin_type=True)
        self.dedup_index.save_sync_state(key, data)

    def clear_restore_progress(self, snapshot_id: str):
        self.dedup_index.save_sync_state(f"restore_{snapshot_id}", b'')


class SyncScheduler:
    """
    增量同步调度器。
    每隔一小时自动将本地存储增量同步到云端。
    """

    def __init__(self, backup_engine: BackupEngine,
                 interval_seconds: int = 3600):
        self.backup_engine = backup_engine
        self.interval = interval_seconds
        self._timer = None
        self._running = False
        self._last_sync_time = 0.0
        self._sync_count = 0

    def start(self):
        self._running = True
        self._schedule_next()

    def stop(self):
        self._running = False
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def _schedule_next(self):
        if not self._running:
            return
        self._timer = threading.Timer(self.interval, self._do_sync)
        self._timer.daemon = True
        self._timer.start()

    def _do_sync(self):
        if not self._running:
            return
        try:
            logger.info("Starting scheduled sync...")
            snapshot = self.backup_engine.create_backup(
                message=f"Scheduled hourly backup #{self._sync_count + 1}"
            )
            self._last_sync_time = time.time()
            self._sync_count += 1
            logger.info(f"Scheduled sync complete: {snapshot.snapshot_id}")
        except Exception as e:
            logger.error(f"Scheduled sync failed: {e}")
        self._schedule_next()

    def trigger_sync(self) -> Optional[CloudSnapshot]:
        return self.backup_engine.create_backup(
            message="Manual sync triggered"
        )

    @property
    def last_sync_time(self) -> float:
        return self._last_sync_time

    @property
    def sync_count(self) -> int:
        return self._sync_count

    def get_status(self) -> Dict[str, Any]:
        return {
            'running': self._running,
            'interval_seconds': self.interval,
            'last_sync_time': self._last_sync_time,
            'sync_count': self._sync_count,
            'next_sync_in': (
                max(0, self.interval - (time.time() - self._last_sync_time))
                if self._running and self._last_sync_time > 0
                else self.interval
            ),
        }


class CloudBackupManager:
    """
    云备份管理器。
    整合所有云备份相关组件，提供统一的API。
    """

    def __init__(self, storage, s3_config: S3Config,
                 local_cache_dir: str = './.vfs_cloud_cache'):
        self.storage = storage
        self.config = s3_config
        self.local_cache_dir = local_cache_dir
        os.makedirs(local_cache_dir, exist_ok=True)

        self.cloud = CloudStorage(s3_config)
        self.dedup_index = DedupIndex(
            os.path.join(local_cache_dir, 'dedup_index.db')
        )
        self.backup_engine = BackupEngine(storage, self.cloud, self.dedup_index)
        self.restore_engine = RestoreEngine(storage, self.cloud, self.dedup_index)
        self.scheduler = SyncScheduler(self.backup_engine)

    def backup(self, message: str = '') -> CloudSnapshot:
        return self.backup_engine.create_backup(message)

    def restore(self, snapshot_id: str, target_db_path: str,
                on_progress=None) -> RestoreProgress:
        return self.restore_engine.restore_snapshot(
            snapshot_id, target_db_path, on_progress
        )

    def cancel_restore(self):
        self.restore_engine.cancel()

    def resume_restore(self, snapshot_id: str, target_db_path: str,
                       on_progress=None) -> RestoreProgress:
        return self.restore_engine.restore_snapshot(
            snapshot_id, target_db_path, on_progress
        )

    def clear_restore_progress(self, snapshot_id: str):
        self.restore_engine.clear_restore_progress(snapshot_id)

    def list_snapshots(self) -> List[CloudSnapshot]:
        return self.dedup_index.list_cloud_snapshots()

    def get_snapshot(self, snapshot_id: str) -> Optional[CloudSnapshot]:
        return self.dedup_index.get_cloud_snapshot(snapshot_id)

    def start_auto_sync(self, interval_seconds: int = 3600):
        self.scheduler.interval = interval_seconds
        self.scheduler.start()

    def stop_auto_sync(self):
        self.scheduler.stop()

    def trigger_sync(self) -> Optional[CloudSnapshot]:
        return self.scheduler.trigger_sync()

    def get_status(self) -> Dict[str, Any]:
        stats = self.dedup_index.get_stats()
        scheduler_status = self.scheduler.get_status()
        return {
            'cloud_backend': self.cloud.backend_type.value,
            'bucket': self.config.bucket,
            'dedup_stats': stats,
            'scheduler': scheduler_status,
        }

    def close(self):
        self.scheduler.stop()
        self.dedup_index.close()
