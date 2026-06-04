# 离线优先协作数据管理应用

一个类似 Airtable 的协作数据管理应用，强调离线能力和多人协作。

## 核心特性

- ✅ **离线优先**: 使用 IndexedDB 本地存储，断网时仍可正常操作
- ✅ **CRDT 同步**: 使用 Yjs 实现无冲突的双向数据同步
- ✅ **Lamport 时间戳**: Last-Write-Win 策略解决并发编辑冲突
- ✅ **变更日志**: 完整记录每行数据的修改历史（谁、什么时候、改了什么）
- ✅ **多人协作**: 实时同步多个用户的编辑操作
- ✅ **多种列类型**: 支持文本、数字、日期、单选、附件等
- ✅ **实时状态**: 显示在线/离线状态，自动重连同步

## 技术栈

### 前端
- React 18 + TypeScript
- Vite (构建工具)
- Dexie.js (IndexedDB 封装)
- Zustand (状态管理)
- Socket.io Client (实时通信)
- Yjs (CRDT 库)
- Tailwind CSS (样式)

### 后端
- Node.js + Express
- PostgreSQL (持久化存储)
- Socket.io (实时通信)
- Yjs (CRDT 服务端同步)

## 快速开始

### 前置要求

- Node.js 18+
- PostgreSQL 14+

### 1. 数据库配置

创建 PostgreSQL 数据库：

```sql
CREATE DATABASE offline_collab_db;
```

或使用环境变量配置数据库连接：

```bash
export DB_USER=postgres
export DB_HOST=localhost
export DB_NAME=offline_collab_db
export DB_PASSWORD=postgres
export DB_PORT=5432
```

### 2. 安装依赖

```bash
# 在根目录安装
npm install

# 或分别安装前后端
cd server && npm install
cd ../client && npm install
```

### 3. 启动应用

```bash
# 同时启动前后端（推荐）
npm run dev

# 或分别启动
# 后端 (端口 3001)
cd server && npm run dev

# 前端 (端口 3000)
cd client && npm run dev
```

应用启动后访问：http://localhost:3000

### 4. 初始化数据

首次启动时，数据库会自动创建表结构并插入 3 个测试用户：
- Alice (alice@example.com)
- Bob (bob@example.com)
- Charlie (charlie@example.com)

## 功能说明

### 创建数据表
1. 点击「创建新表格」按钮
2. 输入表格名称
3. 添加需要的列（支持文本、数字、日期、单选等类型）
4. 开始添加数据行

### 编辑数据
- **双击单元格**进入编辑模式
- 按 Enter 保存，按 Escape 取消
- 所有编辑会自动保存到本地 IndexedDB

### 离线模式测试
1. 打开浏览器开发者工具 → Network → 选择 Offline
2. 继续编辑数据，所有更改保存到本地
3. 取消 Offline 模式，数据会自动同步到服务器

### 查看变更历史
- 点击任意行 → 右侧面板显示该行的完整修改历史
- 包含：修改人、时间、修改前/后的值、Lamport 时间戳

## 核心架构

### 数据同步流程

```
用户编辑 → IndexedDB 本地保存 → Lamport 时钟递增
    ↓
在线? → 是 → Socket.io 发送到服务器 → 广播给其他用户
    ↓
否 → 存入本地变更队列 → 上线后自动同步
```

### 冲突解决 (Last-Write-Win)

每个单元格维护：
- `value`: 单元格值
- `lamportTimestamp`: Lamport 逻辑时钟
- `lastEditorId`: 最后编辑者

当收到并发更新时：
1. 比较 Lamport 时间戳
2. 时间戳大的胜出
3. 时间戳相同则比较用户 ID（确定性解决）

### 变更日志

每次编辑都会记录：
- 表 ID、行 ID、列 ID
- 用户 ID、操作类型
- 旧值、新值
- Lamport 时间戳
- 服务器时间

## 项目结构

```
.
├── client/                 # 前端应用
│   ├── src/
│   │   ├── components/     # React 组件
│   │   ├── db/             # IndexedDB 封装
│   │   ├── services/       # 数据服务
│   │   ├── store/          # Zustand 状态管理
│   │   ├── sync/           # Socket 同步管理
│   │   └── types.ts        # TypeScript 类型
│   └── package.json
├── server/                 # 后端服务
│   ├── src/
│   │   ├── db.js           # PostgreSQL 数据库
│   │   └── index.js        # Express + Socket.io 服务
│   └── package.json
└── package.json            # 根目录工作区配置
```

## API 接口

### 表格
- `GET /api/tables` - 获取所有表格
- `POST /api/tables` - 创建表格
- `GET /api/tables/:id` - 获取表格详情

### 列
- `GET /api/tables/:id/columns` - 获取表格列
- `POST /api/tables/:id/columns` - 添加列

### 行
- `GET /api/tables/:id/rows` - 获取表格行
- `POST /api/tables/:id/rows` - 添加行

### 变更日志
- `GET /api/tables/:id/changelog` - 获取表格变更历史
- `GET /api/tables/:id/changelog?rowId=xxx` - 获取行变更历史

## 开发说明

### 关键文件说明

- `client/src/db/indexedDB.ts` - IndexedDB 数据库定义和 Lamport 时钟
- `client/src/services/dataService.ts` - 数据操作和同步逻辑
- `client/src/sync/socket.ts` - WebSocket 连接管理
- `server/src/db.js` - PostgreSQL 表结构和初始化
- `server/src/index.js` - Express API 和 Socket.io 实时同步

### 扩展开发

添加新的列类型：
1. 在 `types.ts` 中扩展 Column 类型
2. 在 `EditableCell.tsx` 中添加对应编辑组件
3. 在后端 `db.js` 中确保支持该类型的值存储

## 许可证

MIT
