#!/usr/bin/env python3
"""
VersionedFS - 带版本控制的用户态文件系统主入口。

功能特性：
- 自动版本控制：每次写入自动创建新版本
- LSM Tree存储：基于RocksDB的高性能底层存储
- 目录快照：一键保存和恢复目录状态
- 乐观冲突处理：checkout时检测并处理冲突
- 高性能：多层缓存，读写速度接近原生文件系统
"""

import os
import sys
import argparse
import logging
import signal
import atexit

from fuse import FUSE

from .fuse_operations import VersionedFUSE


def setup_logging(verbose: bool = False):
    """
    配置日志系统。
    """
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )


def parse_arguments():
    """
    解析命令行参数。
    """
    parser = argparse.ArgumentParser(
        description='VersionedFS - A FUSE-based versioned file system with LSM Tree storage',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Mount the file system
  versioned-fs /mnt/versioned --db ./data

  # Mount with verbose logging
  versioned-fs /mnt/versioned --db ./data -v

  # Unmount
  fusermount -u /mnt/versioned
        """
    )
    
    parser.add_argument(
        'mountpoint', type=str,
        help='Directory to mount the file system'
    )
    
    parser.add_argument(
        '--db', type=str, default='./.versionedfs_db',
        help='Path to the database directory (default: ./.versionedfs_db)'
    )
    
    parser.add_argument(
        '--backend', type=str, default='auto',
        choices=['auto', 'rocksdb', 'sqlite'],
        help='Storage backend to use (default: auto - tries rocksdb first, falls back to sqlite)'
    )
    
    parser.add_argument(
        '--allow-other', action='store_true',
        help='Allow other users to access the file system'
    )
    
    parser.add_argument(
        '--allow-root', action='store_true',
        help='Allow root to access the file system'
    )
    
    parser.add_argument(
        '--no-default-permissions', action='store_true',
        help='Disable default permission checking'
    )
    
    parser.add_argument(
        '--foreground', '-f', action='store_true',
        help='Run in foreground (not daemonized)'
    )
    
    parser.add_argument(
        '--verbose', '-v', action='store_true',
        help='Enable verbose logging'
    )
    
    parser.add_argument(
        '--stats', action='store_true',
        help='Show performance statistics periodically'
    )
    
    return parser.parse_args()


def validate_mountpoint(mountpoint: str):
    """
    验证挂载点是否有效。
    """
    if not os.path.exists(mountpoint):
        print(f"Error: Mount point '{mountpoint}' does not exist", file=sys.stderr)
        sys.exit(1)
    
    if not os.path.isdir(mountpoint):
        print(f"Error: Mount point '{mountpoint}' is not a directory", file=sys.stderr)
        sys.exit(1)
    
    if os.path.ismount(mountpoint):
        print(f"Error: Mount point '{mountpoint}' is already mounted", file=sys.stderr)
        sys.exit(1)


def ensure_db_directory(db_path: str):
    """
    确保数据库目录存在。
    """
    if not os.path.exists(db_path):
        os.makedirs(db_path, exist_ok=True)
        logging.info(f"Created database directory: {db_path}")


def show_banner():
    """
    显示启动横幅。
    """
    banner = """
╔═══════════════════════════════════════════════════════════════╗
║                    VersionedFS v1.0.0                         ║
║      A FUSE-based versioned file system with LSM Tree         ║
║                                                               ║
║  Auto-versioning  •  Directory Snapshots  •  Optimal Merge    ║
╚═══════════════════════════════════════════════════════════════╝
"""
    print(banner)


def handle_shutdown(signum, frame, fs: VersionedFUSE = None):
    """
    处理关闭信号。
    """
    logging.info(f"Received signal {signum}, shutting down gracefully...")
    if fs:
        fs.destroy('/')
    print("\nVersionedFS unmounted successfully.")
    sys.exit(0)


def print_stats_periodically(fs: VersionedFUSE):
    """
    定期打印统计信息。
    """
    import threading
    import time
    
    def stats_thread():
        while True:
            time.sleep(30)
            stats = fs.get_stats()
            total_ops = stats['total_reads'] + stats['total_writes']
            hit_rate = (stats['cache_hits'] / (stats['cache_hits'] + stats['cache_misses']) * 100) \
                if (stats['cache_hits'] + stats['cache_misses']) > 0 else 0
            
            logging.info(
                f"Stats: reads={stats['total_reads']}, writes={stats['total_writes']}, "
                f"total_ops={total_ops}, cache_hit_rate={hit_rate:.1f}%"
            )
    
    thread = threading.Thread(target=stats_thread, daemon=True)
    thread.start()


def main():
    """
    主函数。
    """
    args = parse_arguments()
    
    setup_logging(args.verbose)
    show_banner()
    
    validate_mountpoint(args.mountpoint)
    ensure_db_directory(args.db)
    
    abs_mountpoint = os.path.abspath(args.mountpoint)
    abs_db_path = os.path.abspath(args.db)
    
    logging.info(f"Mount point: {abs_mountpoint}")
    logging.info(f"Database:    {abs_db_path}")
    
    try:
        fs = VersionedFUSE(abs_db_path, backend=args.backend)
        logging.info("VersionedFUSE initialized successfully")
        
        backend_type = type(fs.storage).__name__
        logging.info(f"Storage backend: {backend_type}")
        
        signal.signal(signal.SIGINT, lambda sig, frame: handle_shutdown(sig, frame, fs))
        signal.signal(signal.SIGTERM, lambda sig, frame: handle_shutdown(sig, frame, fs))
        atexit.register(lambda: fs.destroy('/'))
        
        if args.stats:
            print_stats_periodically(fs)
        
        fuse_options = {
            'nothreads': False,
            'ro': False,
            'allow_other': args.allow_other,
            'allow_root': args.allow_root,
            'default_permissions': not args.no_default_permissions,
            'fsname': 'versionedfs',
            'subtype': 'versionedfs',
        }
        
        logging.info("Mounting file system...")
        print(f"✅ VersionedFS mounted at {abs_mountpoint}")
        print(f"   Database: {abs_db_path}")
        print(f"   Backend:  {backend_type}")
        print()
        print("Available commands:")
        print("  vfs_ls <path>              - List with version info")
        print("  vfs_log <file>             - Show version history")
        print("  vfs_checkout <version>     - Switch to version/snapshot")
        print("  vfs_snapshot <dir> [msg]   - Create directory snapshot")
        print()
        print("Press Ctrl+C to unmount")
        print()
        
        FUSE(
            fs,
            abs_mountpoint,
            foreground=args.foreground or True,
            **fuse_options
        )
        
    except RuntimeError as e:
        print(f"Error: Failed to mount file system: {e}", file=sys.stderr)
        print("\nTroubleshooting:", file=sys.stderr)
        print("  1. Make sure FUSE is installed (fuse3 or fuse)", file=sys.stderr)
        print("  2. Make sure you have permission to mount:", file=sys.stderr)
        print("     - Check /etc/fuse.conf allows user_allow_other", file=sys.stderr)
        print("     - You may need to run with sudo", file=sys.stderr)
        print("  3. Check if the mount point is already in use", file=sys.stderr)
        sys.exit(1)
        
    except KeyboardInterrupt:
        print("\nReceived interrupt, unmounting...")
        
    except Exception as e:
        logging.exception(f"Unexpected error: {e}")
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    
    finally:
        print("\nVersionedFS unmounted successfully.")


if __name__ == '__main__':
    main()
