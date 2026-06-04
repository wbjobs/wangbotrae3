from .storage import BaseStorage, RocksDBStorage, SQLiteStorage, create_storage
from .version_control import VersionController

__version__ = '1.0.0'
__all__ = [
    'BaseStorage',
    'RocksDBStorage',
    'SQLiteStorage',
    'create_storage',
    'VersionController',
    'VersionedFUSE',
    'CloudBackupManager',
    'S3Config',
]

VersionedFUSE = None
FileLockManager = None
FileContentCoordinator = None
FileHandleCache = None
LRUCache = None

try:
    from .fuse_operations import (
        VersionedFUSE, 
        FileLockManager, 
        FileContentCoordinator, 
        FileHandleCache, 
        LRUCache
    )
except (ImportError, OSError, EnvironmentError):
    pass

from .cloud_backup import CloudBackupManager, S3Config
