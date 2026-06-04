#!/usr/bin/env python3
"""
VersionedFS 自定义命令工具集。

命令列表：
    vfs_ls <path>              - 列出文件及其版本信息
    vfs_log <filename>         - 查看文件的版本历史
    vfs_checkout <version>     - 切换文件或目录到指定版本/快照
    vfs_snapshot <dir> [msg]   - 创建目录快照
    vfs_backup [msg]           - 手动触发云备份
    vfs_restore <snapshot>     - 从云端快照恢复文件系统
    vfs_cloud_status           - 查看云备份状态
"""

import os
import sys
import argparse
import time
from typing import Optional

from .storage import create_storage
from .version_control import (
    VersionController, ConflictInfo, ConflictResolution,
    FileVersion, Snapshot
)


def _find_mount_point(path: str) -> Optional[str]:
    """
    尝试从路径推断挂载点。
    """
    path = os.path.abspath(path)
    while path != '/':
        if os.path.ismount(path):
            return path
        path = os.path.dirname(path)
    return None


def _get_vc(db_path: str) -> VersionController:
    """
    获取版本控制器实例。
    """
    storage = create_storage(db_path)
    return VersionController(storage)


def _format_timestamp(ts: float) -> str:
    """
    格式化时间戳。
    """
    return time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts))


def _format_size(size: int) -> str:
    """
    格式化文件大小。
    """
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f'{size:.1f} {unit}'
        size /= 1024
    return f'{size:.1f} TB'


def vfs_ls():
    """
    列出目录内容，包含版本信息。
    用法: vfs_ls [--db PATH] [path]
    """
    parser = argparse.ArgumentParser(
        description='List directory contents with version information'
    )
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the RocksDB database directory'
    )
    parser.add_argument(
        'path', type=str, nargs='?', default='/',
        help='Directory path to list'
    )
    parser.add_argument(
        '-l', '--long', action='store_true',
        help='Show detailed information'
    )
    parser.add_argument(
        '-a', '--all', action='store_true',
        help='Include deleted entries'
    )
    
    args = parser.parse_args()
    
    try:
        vc = _get_vc(args.db)
        
        if not vc.path_exists(args.path):
            print(f"Error: Path '{args.path}' does not exist", file=sys.stderr)
            sys.exit(1)
        
        if not vc.is_directory(args.path):
            _print_file_info(vc, args.path, args.long)
            return
        
        children = vc.list_directory(args.path, include_deleted=args.all)
        
        print(f"Contents of {args.path}:")
        print("-" * 80)
        
        if args.long:
            print(f"{'Type':<6} {'Name':<30} {'Version':<10} {'Size':<12} {'Modified':<20}")
            print("-" * 80)
        
        for child in sorted(children, key=lambda c: (not c['is_dir'], c['name'])):
            name = child['name']
            if child['is_dir']:
                name += '/'
            
            if args.long:
                meta = child['meta']
                if child['is_dir']:
                    current_version = 'DIR'
                    size = '-'
                else:
                    current_version = vc.storage.get_head(child['path'])
                    file_version = vc.get_file_version(child['path'], current_version)
                    size = _format_size(file_version.size) if file_version else '0 B'
                
                modified = _format_timestamp(meta.get('modified_at', time.time()))
                deleted = ' [DELETED]' if meta.get('deleted') else ''
                
                type_str = 'DIR' if child['is_dir'] else 'FILE'
                print(f"{type_str:<6} {name:<29}{deleted} {str(current_version):<10} {size:<12} {modified:<20}")
            else:
                print(f"  {name}")
        
        print("-" * 80)
        print(f"Total: {len(children)} items")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _print_file_info(vc: VersionController, path: str, long_format: bool):
    """
    打印单个文件的信息。
    """
    print(f"File: {path}")
    print("-" * 80)
    
    if long_format:
        current_version = vc.storage.get_head(path)
        file_version = vc.get_file_version(path, current_version)
        
        if file_version:
            print(f"Type:         FILE")
            print(f"Version:      {current_version}")
            print(f"Size:         {_format_size(file_version.size)}")
            print(f"Content Hash: {file_version.content_hash}")
            print(f"Modified:     {_format_timestamp(file_version.timestamp)}")
            print(f"Author:       {file_version.author}")
            print(f"Message:      {file_version.message}")
            if file_version.parent_version:
                print(f"Parent:       v{file_version.parent_version}")
            
            pending = vc.storage.get_pending(path)
            if pending:
                print("\n  ⚠️  Pending changes not committed")
                print(f"     Pending size: {_format_size(pending['size'])}")
                print(f"     Pending time: {_format_timestamp(pending['timestamp'])}")
        else:
            print("No version information available")
    else:
        current_version = vc.storage.get_head(path)
        print(f"  Current version: {current_version}")
        pending = vc.storage.has_pending(path)
        if pending:
            print(f"  ⚠️  Has pending changes")
    
    print("-" * 80)


def vfs_log():
    """
    查看文件的版本历史日志。
    用法: vfs_log [--db PATH] [--limit N] <filename>
    """
    parser = argparse.ArgumentParser(
        description='Show version history of a file'
    )
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the RocksDB database directory'
    )
    parser.add_argument(
        '--limit', '-n', type=int, default=20,
        help='Maximum number of versions to show'
    )
    parser.add_argument(
        '--oneline', action='store_true',
        help='Show compact one-line format'
    )
    parser.add_argument(
        'filename', type=str,
        help='File path to show history for'
    )
    
    args = parser.parse_args()
    
    try:
        vc = _get_vc(args.db)
        
        if not vc.path_exists(args.filename):
            print(f"Error: File '{args.filename}' does not exist", file=sys.stderr)
            sys.exit(1)
        
        if vc.is_directory(args.filename):
            print(f"Error: '{args.filename}' is a directory, not a file", file=sys.stderr)
            sys.exit(1)
        
        versions = vc.get_file_log(args.filename, limit=args.limit)
        
        if not versions:
            print(f"No version history found for '{args.filename}'")
            return
        
        print(f"Version history for {args.filename}:")
        print("-" * 80)
        
        if args.oneline:
            for v in reversed(versions):
                print(f"  v{v.version:<6} {_format_timestamp(v.timestamp)}  {v.message[:60]}")
        else:
            for i, v in enumerate(reversed(versions)):
                if i > 0:
                    print("-" * 80)
                print(f"Version:     v{v.version}")
                print(f"Date:        {_format_timestamp(v.timestamp)}")
                print(f"Author:      {v.author}")
                print(f"Size:        {_format_size(v.size)}")
                print(f"Content Hash:{v.content_hash}")
                if v.parent_version:
                    print(f"Parent:      v{v.parent_version}")
                print(f"Message:     {v.message}")
        
        print("-" * 80)
        print(f"Total: {len(versions)} versions")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def vfs_checkout():
    """
    切换文件或目录到指定版本或快照。
    用法: vfs_checkout [--db PATH] [--file PATH] <version|snapshot_id>
    """
    parser = argparse.ArgumentParser(
        description='Checkout a specific version or snapshot'
    )
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the RocksDB database directory'
    )
    parser.add_argument(
        '--file', type=str, default=None,
        help='Specific file path to checkout (if not set, assumes snapshot ID)'
    )
    parser.add_argument(
        '--snapshot', action='store_true',
        help='Target is a snapshot ID'
    )
    parser.add_argument(
        '--force', '-f', action='store_true',
        help='Force overwrite local changes'
    )
    parser.add_argument(
        '--merge', '-m', action='store_true',
        help='Merge with local changes'
    )
    parser.add_argument(
        '--keep', '-k', action='store_true',
        help='Keep local changes, do not overwrite'
    )
    parser.add_argument(
        'target', type=str,
        help='Version number or snapshot ID to checkout'
    )
    
    args = parser.parse_args()
    
    try:
        vc = _get_vc(args.db)
        
        resolution = None
        if args.force:
            resolution = ConflictResolution.OVERWRITE_LOCAL
        elif args.merge:
            resolution = ConflictResolution.MERGE
        elif args.keep:
            resolution = ConflictResolution.KEEP_LOCAL
        
        if args.file:
            success, conflicts = _checkout_file(vc, args.file, args.target, resolution)
        elif args.snapshot:
            success, conflicts = _checkout_snapshot(vc, args.target, resolution)
        else:
            if args.target.startswith('snap_'):
                success, conflicts = _checkout_snapshot(vc, args.target, resolution)
            else:
                print("Error: Must specify --file for file checkout or --snapshot for snapshot checkout")
                sys.exit(1)
        
        if success:
            if args.file:
                print(f"✅ Successfully checked out {args.file} to version {args.target}")
            else:
                print(f"✅ Successfully checked out snapshot {args.target}")
            
            if conflicts and resolution == ConflictResolution.KEEP_LOCAL:
                print(f"\nℹ️  Kept {len(conflicts)} file(s) with local changes")
        else:
            print("⚠️  Conflicts detected!")
            print("\nThe following files have uncommitted changes that conflict:")
            print("-" * 80)
            for conflict in conflicts:
                print(f"  📄 {conflict.path}")
                print(f"     Conflict type: {conflict.conflict_type.value}")
                print(f"     Local version: {conflict.local_version}")
                print(f"     Target version: {conflict.target_version}")
            print("-" * 80)
            print("\nResolve by using one of these options:")
            print("  --force   Overwrite local changes with target version")
            print("  --merge   Merge by creating new version from target")
            print("  --keep    Keep local changes (skip conflicting files)")
            
            sys.exit(2)
        
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _checkout_file(vc: VersionController, path: str, version_str: str,
                   resolution: Optional[ConflictResolution]) -> tuple[bool, list[ConflictInfo]]:
    """
    Checkout单个文件。
    """
    try:
        version = int(version_str)
    except ValueError:
        raise ValueError(f"Invalid version number: {version_str}")
    
    if not vc.path_exists(path):
        raise ValueError(f"File '{path}' does not exist")
    
    if vc.is_directory(path):
        raise ValueError(f"'{path}' is a directory, use --snapshot for directory checkout")
    
    file_versions = vc.list_file_versions(path)
    available_versions = [v.version for v in file_versions]
    
    if version not in available_versions:
        raise ValueError(
            f"Version {version} not found. Available versions: {available_versions}"
        )
    
    return vc.checkout_version(path, version, resolution)


def _checkout_snapshot(vc: VersionController, snapshot_id: str,
                        resolution: Optional[ConflictResolution]) -> tuple[bool, list[ConflictInfo]]:
    """
    Checkout快照。
    """
    snapshot = vc.storage.get_snapshot(snapshot_id)
    if not snapshot:
        raise ValueError(f"Snapshot '{snapshot_id}' not found")
    
    return vc.checkout_snapshot(snapshot_id, resolution)


def vfs_snapshot():
    """
    创建目录快照。
    用法: vfs_snapshot [--db PATH] <dir> [message]
    """
    parser = argparse.ArgumentParser(
        description='Create a snapshot of a directory'
    )
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the RocksDB database directory'
    )
    parser.add_argument(
        '--list', '-l', action='store_true',
        help='List all snapshots instead of creating one'
    )
    parser.add_argument(
        'dir', type=str, nargs='?', default='/',
        help='Directory path to snapshot'
    )
    parser.add_argument(
        'message', type=str, nargs='?', default='',
        help='Snapshot description message'
    )
    
    args = parser.parse_args()
    
    try:
        vc = _get_vc(args.db)
        
        if args.list:
            _list_snapshots(vc, args.dir)
            return
        
        if not vc.path_exists(args.dir):
            print(f"Error: Directory '{args.dir}' does not exist", file=sys.stderr)
            sys.exit(1)
        
        if not vc.is_directory(args.dir):
            print(f"Error: '{args.dir}' is not a directory", file=sys.stderr)
            sys.exit(1)
        
        print(f"Creating snapshot of {args.dir}...")
        
        snapshot = vc.create_snapshot(args.dir, args.message)
        
        print("✅ Snapshot created successfully!")
        print("-" * 80)
        print(f"Snapshot ID:  {snapshot.snapshot_id}")
        print(f"Directory:    {snapshot.dir_path}")
        print(f"Created:      {_format_timestamp(snapshot.timestamp)}")
        print(f"Files:        {len(snapshot.file_versions)} files")
        if snapshot.message:
            print(f"Message:      {snapshot.message}")
        print("-" * 80)
        print(f"\nTo restore this snapshot, run:")
        print(f"  vfs_checkout --snapshot {snapshot.snapshot_id}")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _list_snapshots(vc: VersionController, dir_path: str):
    """
    列出目录的所有快照。
    """
    snapshots = vc.list_snapshots(dir_path)
    
    if not snapshots:
        print(f"No snapshots found for '{dir_path}'")
        return
    
    print(f"Snapshots for {dir_path}:")
    print("-" * 100)
    print(f"{'ID':<16} {'Created':<20} {'Files':<8} {'Message'}")
    print("-" * 100)
    
    for snap in snapshots:
        msg = snap.message if snap.message else '(no message)'
        if len(msg) > 50:
            msg = msg[:47] + '...'
        print(f"{snap.snapshot_id:<16} {_format_timestamp(snap.timestamp):<20} "
              f"{len(snap.file_versions):<8} {msg}")
    
    print("-" * 100)
    print(f"Total: {len(snapshots)} snapshots")


if __name__ == '__main__':
    print("Use the specific commands: vfs_ls, vfs_log, vfs_checkout, vfs_snapshot, vfs_backup, vfs_restore, vfs_cloud_status")
    sys.exit(1)


def _load_cloud_config(config_path: str) -> Optional[Any]:
    if not os.path.exists(config_path):
        return None
    try:
        import json
        with open(config_path, 'r') as f:
            config_data = json.load(f)
        from .cloud_backup import S3Config
        return S3Config.from_dict(config_data)
    except Exception as e:
        print(f"Error loading cloud config: {e}", file=sys.stderr)
        return None


def _get_cloud_manager(db_path: str, config_path: str):
    from .storage import create_storage
    from .cloud_backup import CloudBackupManager, S3Config

    config = _load_cloud_config(config_path)
    if config is None:
        print(f"Error: Cloud config not found at {config_path}", file=sys.stderr)
        print("Create a config file with:", file=sys.stderr)
        print(json.dumps({
            "endpoint": "",
            "region": "us-east-1",
            "bucket": "local://./cloud_storage",
            "access_key": "local",
            "secret_key": "local",
            "prefix": "versionedfs/"
        }, indent=2), file=sys.stderr)
        sys.exit(1)

    errors = config.validate()
    local_mode = config.bucket.startswith('local://')
    if errors and not local_mode:
        for err in errors:
            print(f"Config error: {err}", file=sys.stderr)
        sys.exit(1)

    storage = create_storage(db_path)
    cache_dir = os.path.join(os.path.dirname(db_path), '.vfs_cloud_cache')
    return CloudBackupManager(storage, config, cache_dir)


def vfs_backup():
    """
    手动触发云备份。
    用法: vfs_backup [--db PATH] [--config PATH] [message]
    """
    parser = argparse.ArgumentParser(
        description='Trigger a cloud backup'
    )
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the local database directory'
    )
    parser.add_argument(
        '--config', type=str, default='./vfs_cloud.json',
        help='Path to the cloud configuration file'
    )
    parser.add_argument(
        'message', type=str, nargs='?', default='',
        help='Backup description message'
    )

    args = parser.parse_args()

    try:
        mgr = _get_cloud_manager(args.db, args.config)

        print("Starting cloud backup...")
        snapshot = mgr.backup(args.message)

        print("Backup completed successfully!")
        print("-" * 80)
        print(f"Snapshot ID:   {snapshot.snapshot_id}")
        print(f"Created:       {_format_timestamp(snapshot.timestamp)}")
        print(f"Message:       {snapshot.message}")
        print(f"Files:         {snapshot.file_count}")
        print(f"Total size:    {_format_size(snapshot.total_size)}")
        if snapshot.parent_snapshot_id:
            print(f"Parent:        {snapshot.parent_snapshot_id}")
        print("-" * 80)
        print(f"\nTo restore this snapshot, run:")
        print(f"  vfs_restore --db {args.db} --config {args.config} {snapshot.snapshot_id}")

        mgr.close()

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def vfs_restore():
    """
    从云端快照恢复文件系统（支持断点续传）。
    用法: vfs_restore [--db PATH] [--config PATH] [--target PATH] [--reset] <snapshot_id>
    """
    parser = argparse.ArgumentParser(
        description='Restore filesystem from a cloud snapshot'
    )
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the source database directory'
    )
    parser.add_argument(
        '--config', type=str, default='./vfs_cloud.json',
        help='Path to the cloud configuration file'
    )
    parser.add_argument(
        '--target', type=str, default='./.versionedfs_restored',
        help='Target directory for restored database'
    )
    parser.add_argument(
        '--reset', action='store_true',
        help='Clear previous restore progress and start fresh'
    )
    parser.add_argument(
        'snapshot_id', type=str,
        help='Cloud snapshot ID to restore from'
    )

    args = parser.parse_args()

    try:
        mgr = _get_cloud_manager(args.db, args.config)

        if args.reset:
            mgr.clear_restore_progress(args.snapshot_id)
            print("Cleared previous restore progress.")

        def progress_callback(progress):
            pct = (
                f"{progress.restored_files}/{progress.total_files} files, "
                f"{_format_size(progress.restored_bytes)}/{_format_size(progress.total_bytes)}"
            )
            if progress.current_file:
                print(f"  Restoring: {progress.current_file} ({pct})", end='\r')
            else:
                print(f"  Progress: {pct}", end='\r')

        print(f"Restoring from snapshot {args.snapshot_id}...")
        print(f"Target: {args.target}")

        result = mgr.restore(args.snapshot_id, args.target, progress_callback)

        print()

        if result.completed:
            print("Restore completed successfully!")
            print("-" * 80)
            print(f"Files restored:  {result.restored_files}/{result.total_files}")
            print(f"Bytes restored:  {_format_size(result.restored_bytes)}")
            elapsed = time.time() - result.started_at
            print(f"Time elapsed:    {elapsed:.1f}s")
            if elapsed > 0:
                speed = result.restored_bytes / elapsed
                print(f"Throughput:      {_format_size(speed)}/s")
            print("-" * 80)
            print(f"\nRestored database at: {args.target}")
            print(f"To mount, run: versioned-fs <mount_point> --db {args.target}")
        elif result.error:
            print(f"Restore failed: {result.error}")
            print(f"\nProgress was saved. To resume, run the same command again.")
            print(f"To start fresh, add --reset flag.")
            sys.exit(1)

        mgr.close()

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


def vfs_cloud_status():
    """
    查看云备份状态。
    用法: vfs_cloud_status [--db PATH] [--config PATH] [--list-snapshots]
    """
    parser = argparse.ArgumentParser(
        description='Show cloud backup status'
    )
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the local database directory'
    )
    parser.add_argument(
        '--config', type=str, default='./vfs_cloud.json',
        help='Path to the cloud configuration file'
    )
    parser.add_argument(
        '--list-snapshots', '-l', action='store_true',
        help='List all cloud snapshots'
    )

    args = parser.parse_args()

    try:
        mgr = _get_cloud_manager(args.db, args.config)

        status = mgr.get_status()

        print("Cloud Backup Status")
        print("=" * 80)
        print(f"Backend:        {status['cloud_backend']}")
        print(f"Bucket:         {status['bucket']}")

        dedup = status['dedup_stats']
        print(f"\nDeduplication Index:")
        print(f"  Total blocks:    {dedup['total_blocks']}")
        print(f"  Total block bytes: {_format_size(dedup['total_block_bytes'])}")
        print(f"  Total manifests: {dedup['total_manifests']}")
        print(f"  Total snapshots: {dedup['total_snapshots']}")

        scheduler = status['scheduler']
        print(f"\nAuto Sync:")
        print(f"  Running:         {scheduler['running']}")
        print(f"  Interval:        {scheduler['interval_seconds']}s")
        if scheduler['last_sync_time'] > 0:
            print(f"  Last sync:       {_format_timestamp(scheduler['last_sync_time'])}")
        else:
            print(f"  Last sync:       Never")
        print(f"  Sync count:      {scheduler['sync_count']}")
        if scheduler['running']:
            next_in = scheduler['next_sync_in']
            print(f"  Next sync in:    {next_in:.0f}s")

        if args.list_snapshots:
            snapshots = mgr.list_snapshots()
            print(f"\nCloud Snapshots ({len(snapshots)}):")
            print("-" * 100)
            print(f"{'ID':<20} {'Created':<20} {'Files':<8} {'Size':<12} {'Message'}")
            print("-" * 100)

            for snap in snapshots:
                msg = snap.message if snap.message else '(no message)'
                if len(msg) > 40:
                    msg = msg[:37] + '...'
                print(
                    f"{snap.snapshot_id:<20} "
                    f"{_format_timestamp(snap.timestamp):<20} "
                    f"{snap.file_count:<8} "
                    f"{_format_size(snap.total_size):<12} "
                    f"{msg}"
                )

            print("-" * 100)
            print(f"Total: {len(snapshots)} snapshots")

        mgr.close()

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
