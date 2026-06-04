#!/usr/bin/env python3
"""
性能测试脚本：对比 VersionedFS 与原生文件系统的读写速度。

运行方式:
    python tests/performance_test.py --mount /mnt/versioned --native /tmp/native_test
"""

import os
import sys
import time
import argparse
import tempfile
import statistics
from typing import Tuple, List


def run_write_test(test_dir: str, file_size: int, iterations: int) -> Tuple[float, List[float]]:
    """
    写性能测试。
    """
    times = []
    test_data = os.urandom(file_size)
    
    for i in range(iterations):
        file_path = os.path.join(test_dir, f'test_write_{i}.bin')
        start = time.perf_counter()
        
        with open(file_path, 'wb') as f:
            f.write(test_data)
            f.flush()
            os.fsync(f.fileno())
        
        elapsed = time.perf_counter() - start
        times.append(elapsed)
        
        os.remove(file_path)
    
    avg_time = statistics.mean(times)
    throughput = file_size / avg_time / (1024 * 1024)  # MB/s
    
    return throughput, times


def run_read_test(test_dir: str, file_size: int, iterations: int) -> Tuple[float, List[float]]:
    """
    读性能测试。
    """
    times = []
    test_data = os.urandom(file_size)
    file_path = os.path.join(test_dir, 'test_read.bin')
    
    with open(file_path, 'wb') as f:
        f.write(test_data)
        f.flush()
        os.fsync(f.fileno())
    
    for i in range(iterations):
        start = time.perf_counter()
        
        with open(file_path, 'rb') as f:
            data = f.read()
        
        elapsed = time.perf_counter() - start
        times.append(elapsed)
        
        assert len(data) == file_size, "Read data size mismatch"
    
    os.remove(file_path)
    
    avg_time = statistics.mean(times)
    throughput = file_size / avg_time / (1024 * 1024)  # MB/s
    
    return throughput, times


def run_random_io_test(test_dir: str, file_size: int, block_size: int, 
                       num_ops: int) -> Tuple[float, float]:
    """
    随机读写测试。
    """
    file_path = os.path.join(test_dir, 'test_random.bin')
    data = bytearray(os.urandom(file_size))
    
    with open(file_path, 'wb') as f:
        f.write(data)
        f.flush()
    
    write_times = []
    read_times = []
    
    for i in range(num_ops):
        offset = (i * 7 * block_size) % (file_size - block_size)
        block_data = os.urandom(block_size)
        
        start = time.perf_counter()
        with open(file_path, 'r+b') as f:
            f.seek(offset)
            f.write(block_data)
            f.flush()
        write_times.append(time.perf_counter() - start)
        
        start = time.perf_counter()
        with open(file_path, 'rb') as f:
            f.seek(offset)
            read_back = f.read(block_size)
        read_times.append(time.perf_counter() - start)
        
        assert read_back == block_data, "Data mismatch"
    
    os.remove(file_path)
    
    avg_write = statistics.mean(write_times)
    avg_read = statistics.mean(read_times)
    write_iops = 1.0 / avg_write
    read_iops = 1.0 / avg_read
    
    return write_iops, read_iops


def main():
    parser = argparse.ArgumentParser(description='Performance test for VersionedFS')
    parser.add_argument('--mount', type=str, required=True,
                        help='Mount point of VersionedFS')
    parser.add_argument('--native', type=str, default='/tmp/native_fs_test',
                        help='Directory for native FS testing')
    parser.add_argument('--file-size', type=int, default=10,
                        help='Test file size in MB (default: 10)')
    parser.add_argument('--iterations', type=int, default=5,
                        help='Number of iterations (default: 5)')
    
    args = parser.parse_args()
    
    file_size_bytes = args.file_size * 1024 * 1024
    
    os.makedirs(args.mount, exist_ok=True)
    os.makedirs(args.native, exist_ok=True)
    
    vfs_test_dir = tempfile.mkdtemp(prefix='vfs_test_', dir=args.mount)
    native_test_dir = tempfile.mkdtemp(prefix='native_test_', dir=args.native)
    
    print("=" * 80)
    print("VersionedFS Performance Test")
    print("=" * 80)
    print(f"Test file size: {args.file_size} MB")
    print(f"Iterations: {args.iterations}")
    print(f"VersionedFS test dir: {vfs_test_dir}")
    print(f"Native FS test dir: {native_test_dir}")
    print("=" * 80)
    print()
    
    print("📝 Sequential Write Test")
    print("-" * 80)
    
    vfs_write_tp, vfs_write_times = run_write_test(
        vfs_test_dir, file_size_bytes, args.iterations
    )
    native_write_tp, native_write_times = run_write_test(
        native_test_dir, file_size_bytes, args.iterations
    )
    
    write_ratio = (vfs_write_tp / native_write_tp) * 100
    
    print(f"  VersionedFS: {vfs_write_tp:.2f} MB/s")
    print(f"  Native FS:   {native_write_tp:.2f} MB/s")
    print(f"  Ratio:       {write_ratio:.1f}% {'✅ PASS' if write_ratio >= 60 else '❌ FAIL'}")
    print()
    
    print("📖 Sequential Read Test")
    print("-" * 80)
    
    vfs_read_tp, vfs_read_times = run_read_test(
        vfs_test_dir, file_size_bytes, args.iterations
    )
    native_read_tp, native_read_times = run_read_test(
        native_test_dir, file_size_bytes, args.iterations
    )
    
    read_ratio = (vfs_read_tp / native_read_tp) * 100
    
    print(f"  VersionedFS: {vfs_read_tp:.2f} MB/s")
    print(f"  Native FS:   {native_read_tp:.2f} MB/s")
    print(f"  Ratio:       {read_ratio:.1f}% {'✅ PASS' if read_ratio >= 60 else '❌ FAIL'}")
    print()
    
    print("🎲 Random I/O Test (4KB blocks, 1000 ops)")
    print("-" * 80)
    
    vfs_write_iops, vfs_read_iops = run_random_io_test(
        vfs_test_dir, 10 * 1024 * 1024, 4096, 1000
    )
    native_write_iops, native_read_iops = run_random_io_test(
        native_test_dir, 10 * 1024 * 1024, 4096, 1000
    )
    
    write_iops_ratio = (vfs_write_iops / native_write_iops) * 100
    read_iops_ratio = (vfs_read_iops / native_read_iops) * 100
    
    print(f"  Write IOPS:")
    print(f"    VersionedFS: {vfs_write_iops:.0f}")
    print(f"    Native FS:   {native_write_iops:.0f}")
    print(f"    Ratio:       {write_iops_ratio:.1f}%")
    print()
    print(f"  Read IOPS:")
    print(f"    VersionedFS: {vfs_read_iops:.0f}")
    print(f"    Native FS:   {native_read_iops:.0f}")
    print(f"    Ratio:       {read_iops_ratio:.1f}%")
    print()
    
    print("=" * 80)
    print("📊 Summary")
    print("=" * 80)
    print(f"{'Metric':<30} {'VersionedFS':<15} {'Native':<15} {'Ratio':<10} {'Status'}")
    print("-" * 80)
    print(f"{'Sequential Write (MB/s)':<30} {vfs_write_tp:<15.2f} {native_write_tp:<15.2f} "
          f"{write_ratio:<10.1f} {'✅' if write_ratio >= 60 else '❌'}")
    print(f"{'Sequential Read (MB/s)':<30} {vfs_read_tp:<15.2f} {native_read_tp:<15.2f} "
          f"{read_ratio:<10.1f} {'✅' if read_ratio >= 60 else '❌'}")
    print(f"{'Random Write (IOPS)':<30} {vfs_write_iops:<15.0f} {native_write_iops:<15.0f} "
          f"{write_iops_ratio:<10.1f}")
    print(f"{'Random Read (IOPS)':<30} {vfs_read_iops:<15.0f} {native_read_iops:<15.0f} "
          f"{read_iops_ratio:<10.1f}")
    print("=" * 80)
    
    all_pass = write_ratio >= 60 and read_ratio >= 60
    
    if all_pass:
        print("\n🎉 Performance test PASSED! All metrics meet the 60% threshold.")
        sys.exit(0)
    else:
        print("\n⚠️  Performance test FAILED! Some metrics are below the 60% threshold.")
        sys.exit(1)


if __name__ == '__main__':
    main()
