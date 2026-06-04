#!/usr/bin/env python3
"""
功能测试脚本：验证 VersionedFS 的核心功能。
"""

import os
import sys
import tempfile
import shutil
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vfs.storage import create_storage
from vfs.version_control import VersionController, ConflictResolution
from vfs.version_control import ConflictType


def test_storage_engine():
    """测试存储引擎基本功能。"""
    print("[TEST] Testing storage engine...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_storage_test_')
    
    try:
        storage = create_storage(tmp_dir)
        print(f"  Using backend: {type(storage).__name__}")
        
        storage.begin_batch()
        
        file_id = 'test_file_001'
        test_data = b'Hello, VersionedFS! This is a test file.'
        
        content_info = storage.write_file_content(file_id, test_data)
        assert content_info['size'] == len(test_data)
        assert content_info['block_count'] == 1
        
        read_back = storage.read_file_content(file_id)
        assert read_back == test_data
        
        read_partial = storage.read_file_content(file_id, 7, 10)
        assert read_partial == b'VersionedF'
        
        storage.save_file_meta('/test.txt', {
            'file_id': file_id,
            'size': len(test_data),
            'is_dir': False
        })
        
        meta = storage.get_file_meta('/test.txt')
        assert meta['file_id'] == file_id
        assert meta['size'] == len(test_data)
        
        storage.set_head('/test.txt', 1)
        assert storage.get_head('/test.txt') == 1
        
        storage.save_file_version(file_id, 1, {
            'version': 1,
            'content_hash': 'test_hash'
        })
        
        versions = storage.list_file_versions(file_id)
        assert versions == [1]
        
        storage.commit_batch()
        
        storage.save_dir_children('/', [{'name': 'test.txt', 'is_dir': False}])
        children = storage.get_dir_children('/')
        assert len(children) == 1
        assert children[0]['name'] == 'test.txt'
        
        print("  [OK] Storage engine tests passed")
        
    finally:
        if 'storage' in locals():
            storage.close()
        shutil.rmtree(tmp_dir)


def test_version_controller():
    """测试版本控制器。"""
    print("\n[TEST] Testing version controller...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_vc_test_')
    
    try:
        storage = create_storage(tmp_dir)
        vc = VersionController(storage)
        
        print("  Testing file versioning...")
        for i in range(3):
            content = f"Version {i + 1} content".encode()
            version = vc.create_file_version('/test.txt', content, 
                                            message=f"Commit {i + 1}")
            assert version.version == i + 1
        
        versions = vc.list_file_versions('/test.txt')
        assert len(versions) == 3
        
        v2_content = vc.read_file('/test.txt', version=2)
        assert v2_content == b"Version 2 content"
        
        v3_content = vc.read_file('/test.txt')
        assert v3_content == b"Version 3 content"
        
        print("  [OK] File versioning tests passed")
        
        print("  Testing directory operations...")
        vc.create_directory('/docs')
        vc.create_file_version('/docs/file1.txt', b'Doc 1')
        vc.create_file_version('/docs/file2.txt', b'Doc 2')
        
        assert vc.is_directory('/docs')
        assert not vc.is_directory('/test.txt')
        assert vc.path_exists('/docs')
        assert vc.path_exists('/test.txt')
        
        children = vc.list_directory('/')
        assert len(children) == 2
        
        children = vc.list_directory('/docs')
        assert len(children) == 2
        
        print("  [OK] Directory operations tests passed")
        
        print("  Testing snapshots...")
        snapshot = vc.create_snapshot('/', message='Test snapshot')
        assert snapshot.snapshot_id.startswith('snap_')
        assert len(snapshot.file_versions) == 3
        
        snapshots = vc.list_snapshots('/')
        assert len(snapshots) == 1
        assert snapshots[0].snapshot_id == snapshot.snapshot_id
        
        print("  [OK] Snapshot tests passed")
        
        print("  Testing checkout...")
        vc.create_file_version('/test.txt', b'Version 4 content')
        
        pending = {'content_hash': 'dirty_hash', 'size': 100, 'timestamp': 0}
        storage.set_pending('/test.txt', pending)
        
        success, conflicts = vc.checkout_version('/test.txt', 2)
        assert not success
        assert len(conflicts) == 1
        
        success, conflicts = vc.checkout_version(
            '/test.txt', 2, resolution=ConflictResolution.OVERWRITE_LOCAL
        )
        assert success
        
        current_head = storage.get_head('/test.txt')
        assert current_head == 2
        
        print("  [OK] Checkout tests passed")
        
        print("  Testing file log...")
        log = vc.get_file_log('/test.txt', limit=2)
        assert len(log) == 2
        
        print("  [OK] File log tests passed")
        
    finally:
        if 'storage' in locals():
            storage.close()
        shutil.rmtree(tmp_dir)


def test_snapshot_checkout():
    """测试快照 checkout 功能。"""
    print("\n[TEST] Testing snapshot checkout...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_snapshot_test_')
    
    try:
        storage = create_storage(tmp_dir)
        vc = VersionController(storage)
        
        vc.create_file_version('/file1.txt', b'Initial v1')
        vc.create_file_version('/file2.txt', b'Initial v1')
        vc.create_directory('/subdir')
        vc.create_file_version('/subdir/file3.txt', b'Initial v1')
        
        snapshot = vc.create_snapshot('/', 'Initial state')
        
        vc.create_file_version('/file1.txt', b'Updated v2')
        vc.create_file_version('/file2.txt', b'Updated v2')
        vc.create_file_version('/subdir/file3.txt', b'Updated v2')
        
        assert vc.read_file('/file1.txt') == b'Updated v2'
        assert vc.read_file('/file2.txt') == b'Updated v2'
        
        success, conflicts = vc.checkout_snapshot(snapshot.snapshot_id, 
                                                  ConflictResolution.OVERWRITE_LOCAL)
        assert success
        assert len(conflicts) == 0
        
        assert vc.read_file('/file1.txt') == b'Initial v1'
        assert vc.read_file('/file2.txt') == b'Initial v1'
        assert vc.read_file('/subdir/file3.txt') == b'Initial v1'
        
        print("  [OK] Snapshot checkout tests passed")
        
    finally:
        if 'storage' in locals():
            storage.close()
        shutil.rmtree(tmp_dir)


def test_delete_operations():
    """测试删除操作。"""
    print("\n[TEST] Testing delete operations...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_delete_test_')
    
    try:
        storage = create_storage(tmp_dir)
        vc = VersionController(storage)
        
        vc.create_file_version('/to_delete.txt', b'Delete me')
        vc.create_directory('/to_delete_dir')
        vc.create_file_version('/to_delete_dir/file.txt', b'In dir')
        
        assert vc.path_exists('/to_delete.txt')
        assert vc.path_exists('/to_delete_dir')
        
        vc.delete_file('/to_delete.txt')
        
        assert not vc.path_exists('/to_delete.txt')
        
        meta = storage.get_file_meta('/to_delete.txt')
        assert meta is not None
        assert meta.get('deleted') == True
        
        versions = vc.list_file_versions('/to_delete.txt')
        assert len(versions) == 1
        
        vc.delete_file('/to_delete_dir/file.txt')
        vc.delete_directory('/to_delete_dir')
        
        assert not vc.path_exists('/to_delete_dir')
        
        all_children = vc.list_directory('/', include_deleted=True)
        deleted_names = [c['name'] for c in all_children if c['meta'].get('deleted')]
        assert 'to_delete.txt' in deleted_names
        
        print("  [OK] Delete operations tests passed")
        
    finally:
        if 'storage' in locals():
            storage.close()
        shutil.rmtree(tmp_dir)


def test_conflict_detection():
    """测试冲突检测。"""
    print("\n[TEST] Testing conflict detection...")
    
    tmp_dir = tempfile.mkdtemp(prefix='vfs_conflict_test_')
    
    try:
        storage = create_storage(tmp_dir)
        vc = VersionController(storage)
        
        vc.create_file_version('/conflict.txt', b'Version 1')
        vc.create_file_version('/conflict.txt', b'Version 2')
        
        from vfs.version_control import ConflictType
        
        pending = {'content_hash': 'different_hash', 'size': 20, 'timestamp': 0}
        storage.set_pending('/conflict.txt', pending)
        
        conflicts = vc.check_conflicts('/conflict.txt', 1)
        assert len(conflicts) == 1
        assert conflicts[0].conflict_type == ConflictType.MODIFIED_MODIFIED
        assert conflicts[0].local_version == 2
        assert conflicts[0].target_version == 1
        
        print("  [OK] Conflict detection tests passed")
        
    finally:
        if 'storage' in locals():
            storage.close()
        shutil.rmtree(tmp_dir)


def main():
    print("=" * 60)
    print("VersionedFS Functional Tests")
    print("=" * 60)
    print()
    
    try:
        test_storage_engine()
        test_version_controller()
        test_snapshot_checkout()
        test_delete_operations()
        test_conflict_detection()
        
        print("\n" + "=" * 60)
        print("[PASS] All functional tests PASSED!")
        print("=" * 60)
        
    except AssertionError as e:
        print(f"\n[FAIL] Test FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\n[FAIL] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
