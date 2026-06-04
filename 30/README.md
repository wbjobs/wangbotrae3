# 跨端剪切板历史中心

一个完整的剪贴板历史管理系统，包含本地守护服务、CLI工具和Web前端。

## 功能特性

### 本地守护服务
- 🔍 **剪贴板监听**：实时监听系统剪贴板变化
- 📝 **内容类型**：支持文本和图片(base64)
- 🚫 **智能去重**：与最近10条内容比较编辑距离，阈值0.8
- 📊 **来源检测**：自动获取复制来源的应用窗口标题
- 💾 **SQLite存储**：本地持久化存储，数据安全

### CLI工具
- `clip hist [limit]` - 列出最近的剪贴板历史记录（默认20条）
- `clip search <keyword>` - 全文搜索文本历史记录
- `clip replay <id>` - 将指定记录重新复制到剪贴板
- `clip stats [days]` - 显示每日复制量ASCII柱状图（默认7天）
- `clip start` - 启动后台守护服务

### Web前端
- 🖼️ **虚拟滚动**：支持上万条记录流畅浏览
- 🔍 **多条件筛选**：按类型、时间范围、关键词筛选
- 🖼️ **图片预览**：点击图片可放大预览
- ⭐ **固定功能**：拖拽排序固定重要项
- 📱 **响应式设计**：支持移动端访问

## 架构设计

```
┌─────────────────┐     HTTP API      ┌─────────────────┐
│   CLI 工具      │──────────────────▶│   本地守护服务  │
│ (yargs/chalk)   │                    │  (Node.js +     │
└─────────────────┘                    │   SQLite3)     │
                                        └─────────────────┘
                                                 ▲
                                                 │
┌─────────────────┐     HTTP API                │
│   Web 前端      │─────────────────────────────┘
│ (localhost:3000)│
└─────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 链接CLI命令

```bash
npm link
```

### 3. 启动服务

#### 方式一：使用启动脚本

Windows:
```bash
scripts\start.bat
```

Mac/Linux:
```bash
bash scripts/start.sh
```

#### 方式二：手动启动

启动守护服务（监听剪贴板 + API服务器）:
```bash
npm run daemon
```

启动Web前端（另开终端）:
```bash
npm run web
```

#### 方式三：同时启动

```bash
npm run dev
```

### 4. 使用CLI

```bash
# 启动守护服务
clip start

# 查看最近20条记录
clip hist

# 搜索包含"hello"的记录
clip search "hello"

# 将ID为5的记录复制到剪贴板
clip replay 5

# 查看最近30天的统计
clip stats 30
```

### 5. 访问Web界面

打开浏览器访问: http://localhost:3000

## API接口

守护服务运行在 `http://localhost:8765`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/history` | 获取历史记录列表 |
| GET | `/api/history/:id` | 获取单条记录详情 |
| GET | `/api/search?q=xxx` | 搜索文本记录 |
| POST | `/api/replay/:id` | 将记录复制到剪贴板 |
| GET | `/api/stats?days=7` | 获取统计数据 |
| PATCH | `/api/history/:id/pin` | 固定/取消固定 |
| POST | `/api/reorder` | 批量更新排序 |

## 项目结构

```
clipboard-hub/
├── src/
│   ├── daemon/              # 本地守护服务
│   │   ├── index.js         # 服务入口
│   │   ├── api.js           # Express API服务器
│   │   ├── db.js            # SQLite数据库层
│   │   ├── clipboardListener.js  # 剪贴板监听器
│   │   ├── deduper.js       # 去重逻辑
│   │   └── sourceDetector.js # 来源应用检测
│   ├── cli/                 # CLI工具
│   │   ├── index.js         # CLI入口
│   │   ├── apiClient.js     # API客户端
│   │   └── commands/        # 命令实现
│   │       ├── hist.js
│   │       ├── search.js
│   │       ├── replay.js
│   │       └── stats.js
│   ├── web/                 # Web前端
│   │   ├── server.js        # Web服务器
│   │   └── public/          # 前端静态资源
│   │       ├── index.html
│   │       ├── styles.css
│   │       └── app.js
│   └── config.js            # 配置文件
├── scripts/                 # 启动脚本
│   ├── start.bat
│   └── start.sh
├── package.json
└── README.md
```

## 配置说明

在 [src/config.js](file:///e:/solo3/30/src/config.js) 中可以修改：

- `PORT`: API服务器端口（默认8765）
- `WEB_PORT`: Web前端端口（默认3000）
- `DB_PATH`: SQLite数据库路径
- `IMAGE_DIR`: 图片存储目录
- `DEDUP_THRESHOLD`: 去重相似度阈值（默认0.8）
- `DEDUP_RECENT_COUNT`: 去重比较的最近记录数（默认10）
- `CLIPBOARD_POLL_INTERVAL`: 剪贴板轮询间隔（默认500ms）
- `DEBOUNCE_DELAY`: 防抖延迟（默认100ms）
- `MAX_TEXT_LENGTH`: 最大文本长度（默认100000）

## 技术栈

- **运行时**: Node.js 16+
- **数据库**: better-sqlite3 (高性能同步API)
- **Web框架**: Express
- **CLI框架**: Yargs
- **剪贴板操作**: clipboardy
- **文本相似度**: Levenshtein编辑距离
- **活动窗口**: PowerShell / osascript (无需C++编译)
- **终端样式**: chalk, cli-table3
- **前端虚拟滚动**: Intersection Observer API

## 数据存储位置

数据默认存储在用户主目录下的 `.clipboard-hub` 文件夹：
- Windows: `C:\Users\<用户名>\.clipboard-hub\`
- Mac/Linux: `~/.clipboard-hub/`

包含：
- `clipboard.db` - SQLite数据库
- `clip_images/` - 图片文件存储目录

## 许可证

MIT
