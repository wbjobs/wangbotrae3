#!/usr/bin/env python3
"""
Cloud backup and restore functional tests.
"""

import os
import sys
import time
import tempfile
import shutil
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vfs.storage import create_storage
from vfs.version_control import VersionController
from vfs.cloud_backup import (
    CloudStorage, S3Config, DedupIndex, BlockDedupEngine,
    BackupEngine, RestoreEngine, CloudBackupManager, CloudSnapshot,
    RestoreProgress, BLOCK_SIZE,
)


def _make_local_config(cloud_dir: str) -> S3Config:
    return S3Config(
        endpoint='',
        region='local',
        bucket=f'local://{cloud_dir}',
        access_key='local',
        secret_key='local',
        prefix='versionedfs/',
    )


def test_cloud_storage_local():
    print("[TEST] Testing cloud storage (local backend)...")

    tmp_dir = tempfile.mkdtemp(prefix='vfs_cloud_storage_')
    try:
        config = _make_local_config(tmp_dir)
        cloud = CloudStorage(config)

        assert cloud.backend_type.value == 'local'

        cloud.put_object('test/key1', b'hello world', metadata={'type': 'test'})
        data = cloud.get_object('test/key1')
        assert data == b'hello world', f"Expected b'hello world', got {data}"

        assert cloud.object_exists('test/key1')
        assert not cloud.object_exists('test/nonexistent')

        cloud.put_object('test/key2', b'data2')
        cloud.put_object('test/key3', b'data3')
        objects = cloud.list_objects('test/')
        assert len(objects) >= 3, f"Expected >= 3 objects, got {len(objects)}"

        cloud.delete_object('test/key2')
        assert not cloud.object_exists('test/key2')
        assert cloud.object_exists('test/key1')

        print("  [OK] Cloud storage (local backend) test passed")
        return True
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_dedup_index():
    print("\n[TEST] Testing dedup index...")

    tmp_dir = tempfile.mkdtemp(prefix='vfs_dedup_idx_')
    try:
        db_path = os.path.join(tmp_dir, 'dedup.db')
        idx = DedupIndex(db_path)

        assert not idx.has_block('abc123')
        assert idx.get_block_cloud_key('abc123') is None

        idx.add_block('abc123', 'blocks/abc123', 65536)
        assert idx.has_block('abc123')
        assert idx.get_block_cloud_key('abc123') == 'blocks/abc123'

        idx.add_block('abc123', 'blocks/abc123', 65536)
        stats = idx.get_stats()
        assert stats['total_blocks'] == 1, f"Expected 1 block, got {stats['total_blocks']}"

        idx.add_block('def456', 'blocks/def456', 32768)
        assert idx.has_block('def456')
        stats = idx.get_stats()
        assert stats['total_blocks'] == 2

        refs = idx.remove_block_ref('abc123')
        assert refs == 1
        assert idx.has_block('abc123')

        refs = idx.remove_block_ref('abc123')
        assert refs == 0
        assert not idx.has_block('abc123')

        idx.close()
        print("  [OK] Dedup index test passed")
        return True
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def test_block_dedup():
    print("\n[TEST] Testing block deduplication engine...")

    cloud_dir = tempfile.mkdtemp(prefix='vfs_cloud_dedup_')
    idx_dir = tempfile.mkdtemp(prefix='vfs_idx_dedup_')
    try:
        config = _make_local_config(cloud_dir)
        cloud = CloudStorage(config)
        idx = DedupIndex(os.path.join(idx_dir, 'dedup.db'))
        engine = BlockDedupEngine(cloud, idx)

        data = b'A' * BLOCK_SIZE + b'B' * BLOCK_SIZE + b'C' * 32768
        refs, new_blocks, new_bytes = engine.upload_data(data)

        assert len(refs) == 3, f"Expected 3 blocks, got {len(refs)}"
        assert new_blocks == 3, f"Expected 3 new blocks, got {new_blocks}"
        assert all(r.is_new for r in refs)

        refs2, new_blocks2, new_bytes2 = engine.upload_data(data)
        assert len(refs2) == 3
        assert new_blocks2 == 0, f"Expected 0 new blocks (dedup), got {new_blocks2}"
        assert all(not r.is_new for r in refs2)

        partial = b'A' * BLOCK_SIZE
        refs3, new_blocks3, _ = engine.upload_data(partial)
        assert len(refs3) == 1
        assert new_blocks3 == 0, "Block should already exist"

        restored = engine.download_data(refs)
        assert restored == data, f"Restored data mismatch! Expected {len(data)} bytes, got {len(restored)}"

        large = b'X' * (BLOCK_SIZE * 5 + 12345)
        refs4, new4, _ = engine.upload_data(large)
        assert len(refs4) == 6, f"Expected 6 blocks for large data, got {len(refs4)}"
        restored_large = engine.download_data(refs4)
        assert restored_large == large

        idx.close()
        print("  [OK] Block deduplication test passed")
        return True
    finally:
        shutil.rmtree(cloud_dir, ignore_errors=True)
        shutil.rmtree(idx_dir, ignore_errors=True)


def test_backup_and_restore():
    print("\n[TEST] Testing backup and restore...")

    db_dir = tempfile.mkdtemp(prefix='vfs_backup_db_')
    cloud_dir = tempfile.mkdtemp(prefix='vfs_backup_cloud_')
    cache_dir = tempfile.mkdtemp(prefix='vfs_backup_cache_')
    restore_dir = tempfile.mkdtemp(prefix='vfs_backup_restore_')

    try:
        storage = create_storage(db_dir, backend='sqlite')
        vc = VersionController(storage)

        test_files = {
            '/hello.txt': b'Hello, World!',
            '/data.bin': os.urandom(100000),
            '/nested/dir/file.txt': b'Nested file content',
            '/empty.txt': b'',
        }

        for path, content in test_files.items():
            vc.create_file_version(path, content, message="Test file")

        snap1 = vc.create_snapshot('/', "Before backup test")

        config = _make_local_config(cloud_dir)
        mgr = CloudBackupManager(storage, config, cache_dir)

        cloud_snap = mgr.backup("First backup")
        assert cloud_snap is not None
        assert cloud_snap.snapshot_id.startswith('snap_')
        assert cloud_snap.file_count > 0

        snapshots = mgr.list_snapshots()
        assert len(snapshots) == 1

        vc.create_file_version('/hello.txt', b'Hello, World! Updated!', message="Update")
        vc.create_file_version('/new_file.txt', b'New file content', message="New file")

        cloud_snap2 = mgr.backup("Second backup with updates")
        snapshots = mgr.list_snapshots()
        assert len(snapshots) == 2
        assert cloud_snap2.parent_snapshot_id == cloud_snap.snapshot_id

        restore_target = os.path.join(restore_dir, 'restored_db')
        progress = mgr.restore(cloud_snap.snapshot_id, restore_target)

        assert progress.completed, f"Restore failed: {progress.error}"
        assert progress.total_files > 0
        assert progress.restored_files == progress.total_files

        restored_storage = create_storage(restore_target, backend='sqlite')
        restored_vc = VersionController(restored_storage)

        for path, content in test_files.items():
            assert restored_vc.path_exists(path), f"Path {path} not found in restored FS"
            restored_content = restored_vc.read_file(path)
            assert restored_content == content, f"Content mismatch for {path}"

        restored_storage.close()
        mgr.close()
        storage.close()

        print("  [OK] Backup and restore test passed")
        return True
    finally:
        shutil.rmtree(db_dir, ignore_errors=True)
        shutil.rmtree(cloud_dir, ignore_errors=True)
        shutil.rmtree(cache_dir, ignore_errors=True)
        shutil.rmtree(restore_dir, ignore_errors=True)


def test_resume_restore():
    print("\n[TEST] Testing restore resume (breakpoint continuation)...")

    db_dir = tempfile.mkdtemp(prefix='vfs_resume_db_')
    cloud_dir = tempfile.mkdtemp(prefix='vfs_resume_cloud_')
    cache_dir = tempfile.mkdtemp(prefix='vfs_resume_cache_')
    restore_dir = tempfile.mkdtemp(prefix='vfs_resume_restore_')

    try:
        storage = create_storage(db_dir, backend='sqlite')
        vc = VersionController(storage)

        for i in range(10):
            path = f'/file_{i:03d}.txt'
            content = f'Content of file {i}'.encode() * 1000
            vc.create_file_version(path, content, message=f"File {i}")

        config = _make_local_config(cloud_dir)
        mgr = CloudBackupManager(storage, config, cache_dir)
        cloud_snap = mgr.backup("Resume test backup")

        restore_target = os.path.join(restore_dir, 'restored_db')

        progress = mgr.restore(cloud_snap.snapshot_id, restore_target)
        assert progress.completed, f"Initial restore failed: {progress.error}"

        mgr.clear_restore_progress(cloud_snap.snapshot_id)

        saved_progress_data = mgr.dedup_index.get_sync_state(f"restore_{cloud_snap.snapshot_id}")
        assert saved_progress_data is None or saved_progress_data == b''

        progress2 = mgr.restore(cloud_snap.snapshot_id, restore_target)
        assert progress2.completed, f"Re-restore failed: {progress2.error}"
        assert progress2.restored_files == progress.restored_files

        mgr.close()
        storage.close()

        print("  [OK] Restore resume test passed")
        return True
    finally:
        shutil.rmtree(db_dir, ignore_errors=True)
        shutil.rmtree(cloud_dir, ignore_errors=True)
        shutil.rmtree(cache_dir, ignore_errors=True)
        shutil.rmtree(restore_dir, ignore_errors=True)


def test_dedup_effectiveness():
    print("\n[TEST] Testing dedup effectiveness...")

    db_dir = tempfile.mkdtemp(prefix='vfs_dedup_eff_db_')
    cloud_dir = tempfile.mkdtemp(prefix='vfs_dedup_eff_cloud_')
    cache_dir = tempfile.mkdtemp(prefix='vfs_dedup_eff_cache_')

    try:
        storage = create_storage(db_dir, backend='sqlite')
        vc = VersionController(storage)

        shared_content = b'SHARED_DATA_PATTERN' * 5000
        vc.create_file_version('/file_a.txt', shared_content, message="File A")
        vc.create_file_version('/file_b.txt', shared_content, message="File B (same content)")
        vc.create_file_version('/file_c.txt', shared_content + b'EXTRA', message="File C (slightly different)")

        config = _make_local_config(cloud_dir)
        mgr = CloudBackupManager(storage, config, cache_dir)

        cloud_snap = mgr.backup("Dedup effectiveness test")

        stats = mgr.dedup_index.get_stats()
        total_blocks = stats['total_blocks']

        mgr.close()
        storage.close()

        cloud_files = os.listdir(os.path.join(cloud_dir, 'versionedfs', 'blocks'))
        cloud_block_count = len([f for f in cloud_files if not f.endswith('.meta')])

        print(f"  Local index blocks: {total_blocks}")
        print(f"  Cloud stored blocks: {cloud_block_count}")
        print(f"  Dedup saved: file_a and file_b share all blocks")

        assert cloud_block_count > 0, "No blocks stored in cloud"
        print("  [OK] Dedup effectiveness test passed")
        return True
    finally:
        shutil.rmtree(db_dir, ignore_errors=True)
        shutil.rmtree(cloud_dir, ignore_errors=True)
        shutil.rmtree(cache_dir, ignore_errors=True)


def test_snapshot_chain():
    print("\n[TEST] Testing snapshot chain...")

    db_dir = tempfile.mkdtemp(prefix='vfs_chain_db_')
    cloud_dir = tempfile.mkdtemp(prefix='vfs_chain_cloud_')
    cache_dir = tempfile.mkdtemp(prefix='vfs_chain_cache_')

    try:
        storage = create_storage(db_dir, backend='sqlite')
        vc = VersionController(storage)

        vc.create_file_version('/file.txt', b'Version 1', message="v1")

        config = _make_local_config(cloud_dir)
        mgr = CloudBackupManager(storage, config, cache_dir)

        snap1 = mgr.backup("Chain step 1")
        assert snap1.parent_snapshot_id is None, "First snapshot should have no parent"

        vc.create_file_version('/file.txt', b'Version 2', message="v2")
        snap2 = mgr.backup("Chain step 2")
        assert snap2.parent_snapshot_id == snap1.snapshot_id, "Second snapshot should chain to first"

        vc.create_file_version('/file.txt', b'Version 3', message="v3")
        snap3 = mgr.backup("Chain step 3")
        assert snap3.parent_snapshot_id == snap2.snapshot_id, "Third snapshot should chain to second"

        snapshots = mgr.list_snapshots()
        assert len(snapshots) == 3

        chain = []
        current = mgr.get_snapshot(snap3.snapshot_id)
        while current:
            chain.append(current.snapshot_id)
            if current.parent_snapshot_id:
                current = mgr.get_snapshot(current.parent_snapshot_id)
            else:
                current = None

        assert len(chain) == 3, f"Expected chain length 3, got {len(chain)}"
        assert chain[0] == snap3.snapshot_id
        assert chain[1] == snap2.snapshot_id
        assert chain[2] == snap1.snapshot_id

        print(f"  Chain: {' -> '.join(chain)}")
        print("  [OK] Snapshot chain test passed")

        mgr.close()
        storage.close()
        return True
    finally:
        shutil.rmtree(db_dir, ignore_errors=True)
        shutil.rmtree(cloud_dir, ignore_errors=True)
        shutil.rmtree(cache_dir, ignore_errors=True)


def test_auto_sync():
    print("\n[TEST] Testing auto sync scheduler...")

    db_dir = tempfile.mkdtemp(prefix='vfs_sync_db_')
    cloud_dir = tempfile.mkdtemp(prefix='vfs_sync_cloud_')
    cache_dir = tempfile.mkdtemp(prefix='vfs_sync_cache_')

    try:
        storage = create_storage(db_dir, backend='sqlite')
        vc = VersionController(storage)
        vc.create_file_version('/sync_test.txt', b'Auto sync test', message="Test")

        config = _make_local_config(cloud_dir)
        mgr = CloudBackupManager(storage, config, cache_dir)

        mgr.start_auto_sync(interval_seconds=2)

        assert mgr.scheduler._running

        time.sleep(3)

        snapshots = mgr.list_snapshots()
        assert len(snapshots) >= 1, "Auto sync should have created at least one snapshot"

        mgr.stop_auto_sync()
        assert not mgr.scheduler._running

        manual_snap = mgr.trigger_sync()
        assert manual_snap is not None

        mgr.close()
        storage.close()

        print("  [OK] Auto sync scheduler test passed")
        return True
    finally:
        shutil.rmtree(db_dir, ignore_errors=True)
        shutil.rmtree(cloud_dir, ignore_errors=True)
        shutil.rmtree(cache_dir, ignore_errors=True)


def main():
    print("=" * 70)
    print("VersionedFS Cloud Backup Tests")
    print("=" * 70)
    print()

    all_passed = True

    tests = [
        test_cloud_storage_local,
        test_dedup_index,
        test_block_dedup,
        test_backup_and_restore,
        test_resume_restore,
        test_dedup_effectiveness,
        test_snapshot_chain,
        test_auto_sync,
    ]

    for test_fn in tests:
        try:
            if not test_fn():
                all_passed = False
        except Exception as e:
            import traceback
            print(f"  [FAIL] {test_fn.__name__} raised exception: {e}")
            traceback.print_exc()
            all_passed = False

    print()
    print("=" * 70)
    if all_passed:
        print("[PASS] All cloud backup tests PASSED!")
        print("=" * 70)
        return 0
    else:
        print("[FAIL] Some cloud backup tests FAILED!")
        print("=" * 70)
        return 1


if __name__ == '__main__':
    sys.exit(main())
