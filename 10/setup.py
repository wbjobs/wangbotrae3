from setuptools import setup, find_packages

setup(
    name='versioned-fs',
    version='1.0.0',
    description='A FUSE-based versioned file system with LSM Tree storage',
    author='VersionedFS Team',
    packages=find_packages(),
    install_requires=[
        'fusepy>=3.0.1',
        'python-rocksdb>=0.7.0',
        'msgpack>=1.0.5',
        'xxhash>=3.2.0',
    ],
    extras_require={
        'cloud': ['boto3>=1.26.0'],
    },
    entry_points={
        'console_scripts': [
            'versioned-fs=vfs.main:main',
            'vfs_ls=vfs.cli:vfs_ls',
            'vfs_checkout=vfs.cli:vfs_checkout',
            'vfs_log=vfs.cli:vfs_log',
            'vfs_snapshot=vfs.cli:vfs_snapshot',
            'vfs_backup=vfs.cli:vfs_backup',
            'vfs_restore=vfs.cli:vfs_restore',
            'vfs_cloud_status=vfs.cli:vfs_cloud_status',
        ],
    },
)
