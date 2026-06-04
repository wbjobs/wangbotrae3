# 多格式硬盘坏道扫描与修复工具

一个功能强大的硬盘健康检测工具，支持扫描和修复多种文件系统的硬盘坏道。

## 功能特性

### 核心功能
- **S.M.A.R.T. 信息读取**: 实时监控硬盘的健康状态参数
- **坏道扫描**: 支持快速扫描和深度扫描两种模式
- **可视化映射**: 将扫描结果以色块网格图形式展示
- **坏道修复**: 尝试修复逻辑坏道（重写扇区）
- **报告导出**: 支持导出 HTML、JSON、CSV、TXT 格式报告

### 支持的文件系统
- **NTFS** (Windows)
- **EXT4** (Linux)
- **APFS** (macOS)
- **FAT32**
- **XFS**
- **BTRFS**

## 安装

```bash
pip install -r requirements.txt
```

## 使用方法

```bash
python main.py
```

## 模块说明

| 文件 | 说明 |
|------|------|
| [main.py](file:///e:/solo3/36/main.py) | 主程序入口，GUI 界面 |
| [smart_reader.py](file:///e:/solo3/36/smart_reader.py) | SMART 信息读取模块 |
| [disk_scanner.py](file:///e:/solo3/36/disk_scanner.py) | 坏道扫描引擎 |
| [disk_visualizer.py](file:///e:/solo3/36/disk_visualizer.py) | 可视化色块网格组件 |
| [disk_repair.py](file:///e:/solo3/36/disk_repair.py) | 坏道修复模块 |
| [report_exporter.py](file:///e:/solo3/36/report_exporter.py) | 报告导出模块 |

## 界面功能

### 🔍 扫描标签页
- 选择扫描类型（快速/深度）
- 实时进度显示
- 磁盘映射色块图
- 坏道列表
- 统计信息

### 📊 S.M.A.R.T. 标签页
- SMART 属性表格
- 原始数据显示
- 健康状态评估

### 🔧 修复标签页
- 文件系统支持说明
- 坏道修复功能
- 修复进度显示
- 修复结果记录

### 📋 报告标签页
- 报告预览
- 多种格式导出（HTML/JSON/CSV/TXT）
- 健康建议

## 注意事项

1. **管理员权限**: 访问原始磁盘设备需要管理员/root 权限
2. **数据备份**: 修复坏道前建议备份重要数据
3. **物理坏道**: 物理坏道无法软件修复，建议更换硬盘
4. **smartmontools**: 完整的 SMART 功能需要安装 smartmontools

## 技术栈

- **GUI 框架**: PyQt5
- **系统监控**: psutil
- **硬盘检测**: smartmontools (可选)

## 许可证

MIT License
