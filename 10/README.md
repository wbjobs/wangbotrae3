# VersionedFS - 带版本控制的用户态文件系统

一个基于 FUSE (Filesystem in Userspace) 的版本控制文件系统，底层使用 RocksDB (LSM Tree) 作为存储引擎。每次文件写入都会自动创建新版本，支持目录级快照、一键回溯和乐观冲突处理。

## ✨ 核心特性

- **🔄 自动版本控制**：每次文件写入自动创建新版本，无需手动提交
- **🌳 LSM Tree 存储**：基于 RocksDB 的高性能底层存储
- **📸 目录级快照**：一键保存目录状态，随时回溯到任意历史时间点
- **⚡ 乐观冲突处理**：`vfs_checkout` 时检测冲突，支持覆盖、保留、合并三种策略
- **🚀 高性能**：多层缓存架构，读写速度可达原生文件系统的 60%+
- **🛠️ 丰富的命令集**：`vfs_ls`、`vfs_checkout`、`vfs_log`、`vfs_snapshot`

## 🏗️ 系统架构

```
┌───────────────────────────────────────────────────────────┐
│                    用户应用程序                              │
└────────────────────┬──────────────────────────────────────┘
                     │ POSIX 文件操作
┌────────────────────▼──────────────────────────────────────┐
│              FUSE 内核模块                                 │
└────────────────────┬──────────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────────────┐
│            VersionedFUSE 操作层                             │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ 内容缓存(1GB)│  │ 元数据缓存   │  │ 目录列表缓存    │   │
│  └──────────────┘  └──────────────┘  └────────────────┘   │
└────────────────────┬──────────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────────────┐
│           版本控制器 (VersionController)                   │
│  • 版本管理    • 快照管理    • 冲突检测    • Checkout     │
└────────────────────┬──────────────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────────────┐
│         RocksDB 存储引擎 (LSM Tree)                        │
│  • 文件内容块  • 元数据  • 版本信息  • 快照数据            │
└───────────────────────────────────────────────────────────┘
```

## 📦 安装依赖

### 系统依赖

```bash
# Ubuntu/Debian
sudo apt-get install fuse3 libfuse3-dev librocksdb-dev

# CentOS/RHEL
sudo yum install fuse3 fuse3-devel rocksdb-devel

# macOS
brew install --cask macfuse
brew install rocksdb
```

### Python 依赖

```bash
pip install -r requirements.txt
```

或使用 setup.py 安装：

```bash
pip install -e .
```

## 🚀 快速开始

### 1. 创建挂载点

```bash
mkdir -p /mnt/versioned
```

### 2. 挂载文件系统

```bash
versioned-fs /mnt/versioned --db ./data

# 或带详细日志
versioned-fs /mnt/versioned --db ./data -v
```

### 3. 使用文件系统

```bash
# 进入挂载点
cd /mnt/versioned

# 创建文件（自动版本控制）
echo "version 1" > test.txt
echo "version 2" > test.txt
echo "version 3" > test.txt

# 查看文件版本历史
vfs_log test.txt

# 查看带版本信息的目录列表
vfs_ls -l

# 创建目录快照
vfs_snapshot / "Initial state"

# 切换到旧版本
vfs_checkout --file test.txt 1

# 切换到快照
vfs_checkout --snapshot <snapshot_id> --force
```

### 4. 卸载文件系统

```bash
# Linux
fusermount -u /mnt/versioned

# macOS
umount /mnt/versioned
```

## 📖 命令详解

### vfs_ls - 列出目录内容（含版本信息）

```bash
vfs_ls [options] [path]

选项:
  --db PATH       指定数据库路径 (默认: ./.versionedfs_db)
  -l, --long      显示详细信息
  -a, --all       包含已删除的条目
```

**示例输出:**
```
Contents of /:
--------------------------------------------------------------------------------
Type   Name                           Version    Size         Modified            
--------------------------------------------------------------------------------
DIR    docs/                          DIR        -            2024-01-15 10:30:00
FILE   test.txt                       3          10 B         2024-01-15 10:35:00
FILE   data.csv                       1          1.2 MB       2024-01-15 10:20:00
--------------------------------------------------------------------------------
Total: 3 items
```

### vfs_log - 查看文件版本历史

```bash
vfs_log [options] <filename>

选项:
  --db PATH       指定数据库路径
  -n, --limit N   显示最近 N 个版本 (默认: 20)
  --oneline       单行简洁格式
```

**示例输出:**
```
Version history for test.txt:
--------------------------------------------------------------------------------
Version:     v3
Date:        2024-01-15 10:35:00
Author:      user
Size:        10 B
Content Hash: a1b2c3d4e5f6...
Parent:      v2
Message:     File update via write

Version:     v2
Date:        2024-01-15 10:34:00
...
```

### vfs_checkout - 切换版本或快照

```bash
vfs_checkout [options] <version|snapshot_id>

选项:
  --db PATH       指定数据库路径
  --file PATH     指定要切换的文件路径
  --snapshot      目标是快照 ID
  -f, --force     强制覆盖本地修改
  -m, --merge     与本地修改合并
  -k, --keep      保留本地修改
```

**冲突处理示例:**

当本地有未提交的修改时，checkout 会检测冲突：

```bash
# 先修改文件但不关闭
echo "local changes" >> test.txt &

# 尝试切换版本
vfs_checkout --file test.txt 1

# 输出:
⚠️  Conflicts detected!
The following files have uncommitted changes that conflict:
--------------------------------------------------------------------------------
  📄 /test.txt
     Conflict type: modified_modified
     Local version: 3
     Target version: 1
--------------------------------------------------------------------------------

# 选择解决策略
vfs_checkout --file test.txt 1 --force    # 覆盖本地
vfs_checkout --file test.txt 1 --merge    # 合并（创建新版本）
vfs_checkout --file test.txt 1 --keep     # 保留本地
```

### vfs_snapshot - 目录快照管理

```bash
vfs_snapshot [options] <dir> [message]

选项:
  --db PATH       指定数据库路径
  -l, --list      列出所有快照
```

**创建快照:**
```bash
vfs_snapshot /projects "Before major refactor"

✅ Snapshot created successfully!
--------------------------------------------------------------------------------
Snapshot ID:  snap_a1b2c3d4e5f6
Directory:    /projects
Created:      2024-01-15 11:00:00
Files:        156 files
Message:      Before major refactor
--------------------------------------------------------------------------------

To restore this snapshot, run:
  vfs_checkout --snapshot snap_a1b2c3d4e5f6
```

**列出快照:**
```bash
vfs_snapshot --list /projects

Snapshots for /projects:
----------------------------------------------------------------------------------------------------
ID               Created              Files    Message
----------------------------------------------------------------------------------------------------
snap_a1b2c3d4e5f6 2024-01-15 11:00:00  156      Before major refactor
snap_xyz789abc123 2024-01-14 16:30:00  142      Release v2.0
snap_def456ghi789 2024-01-13 09:15:00  138      Initial import
----------------------------------------------------------------------------------------------------
Total: 3 snapshots
```

## 🔧 性能优化

### 缓存架构

为了达到原生文件系统 60% 以上的性能，系统采用了多层缓存：

1. **内容缓存 (LRU, 1GB)**: 缓存完整的文件内容，避免重复读取 RocksDB
2. **元数据缓存 (LRU, 64MB)**: 缓存文件属性，减少元数据查询
3. **目录列表缓存 (LRU, 16MB)**: 缓存目录列表，加速 `readdir` 操作

### 写入优化

- **延迟写入**: 写入先到内存缓冲区，`flush` 或 `release` 时才创建新版本
- **分块存储**: 文件按 64KB 分块存储，支持高效的部分读取
- **批量操作**: 使用 RocksDB WriteBatch 进行原子提交

### RocksDB 配置优化

```python
- 写缓冲区: 64MB × 3 个
- 块大小: 32KB
- 块缓存: 2GB LRU
- 布隆过滤器: 10 bits/key
- 动态层级压缩
```

## 📊 数据存储格式

### Key 空间设计

| Key 前缀 | 用途 | 示例 |
|---------|------|------|
| `f:content:<file_id>:<block>` | 文件内容块 | `f:content:file_abc:0` |
| `f:meta:<path>` | 文件元数据 | `f:meta:/docs/test.txt` |
| `f:version:<file_id>:<ver>` | 文件版本信息 | `f:version:file_abc:0000000003` |
| `d:meta:<path>` | 目录元数据 | `d:meta:/docs` |
| `d:children:<path>` | 目录子项列表 | `d:children:/docs` |
| `d:snapshot:<id>` | 目录快照 | `d:snapshot:snap_abc123` |
| `HEAD:<path>` | 当前 HEAD 版本 | `HEAD:/docs/test.txt` |
| `pending:<path>` | 未提交修改标记 | `pending:/docs/test.txt` |

## ⚠️ 注意事项

1. **FUSE 权限**: 确保 `/etc/fuse.conf` 中包含 `user_allow_other`
2. **数据库备份**: 定期备份 RocksDB 数据目录
3. **大文件处理**: 建议单文件不超过 10GB，超大文件性能会下降
4. **并发写入**: 支持多进程并发写入，每个写入独立创建版本
5. **磁盘空间**: 历史版本会占用额外空间，定期清理不需要的版本

## 🛠️ 故障排除

### 问题: 挂载失败，提示 "Permission denied"

**解决:**
```bash
# 检查 fuse 组
groups | grep fuse
# 添加当前用户到 fuse 组
sudo usermod -aG fuse $USER
# 重新登录
```

### 问题: 挂载点繁忙，无法卸载

**解决:**
```bash
# 查找使用挂载点的进程
lsof /mnt/versioned
# 强制卸载
fusermount -u -z /mnt/versioned
```

### 问题: RocksDB 损坏

**解决:**
```bash
# 使用 rocksdb 自带的修复工具
rocksdb_repair ./data
```

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
