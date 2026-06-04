# 基于WebRTC与MQTT的分布式实时协作乐谱编辑与同步演奏系统

## 项目简介

这是一个基于WebRTC和MQTT技术的分布式实时协作音乐教育平台，支持音乐教师与学生之间的实时乐谱编辑和远程合奏功能。

## 技术架构

### 核心技术栈
- **后端**: Node.js + Express
- **数据库**: PostgreSQL
- **实时通信**: 
  - WebRTC DataChannel: 乐谱编辑实时同步
  - MQTT (Aedes broker): MIDI演奏事件传输
  - WebSocket: 信令服务器和消息传递
- **前端**: 原生HTML/CSS/JavaScript
- **协作算法**: OT (Operational Transformation)

### 系统架构
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   教师浏览器    │     │   学生浏览器    │     │   学生浏览器    │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ├───────────────────────┼───────────────────────┤
         │  WebRTC DataChannel   │  WebRTC DataChannel   │
         │     (乐谱编辑同步)    │     (乐谱编辑同步)    │
         │                       │                       │
         ├───────────────────────┼───────────────────────┤
         │      MQTT/WebSocket   │      MQTT/WebSocket   │
         │      (MIDI演奏)       │      (MIDI演奏)       │
         └───────────────┬───────┴───────────┬───────────┘
                         │                   │
         ┌───────────────▼───────────────────▼───────────┐
         │             Node.js 服务端                    │
         │  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
         │  │ Express  │  │  Aedes   │  │  WebSocket  │ │
         │  │   API    │  │  MQTT    │  │  Signaling  │ │
         │  └────┬─────┘  │  Broker  │  │   Server    │ │
         │       │        └─────┬─────┘  └──────┬──────┘ │
         │       │              │                 │        │
         │  ┌────▼──────────────▼─────────────────▼──────┐ │
         │  │              PostgreSQL                    │ │
         │  │  (乐谱、会话、版本历史、MIDI事件存储)     │ │
         │  └────────────────────────────────────────────┘ │
         └─────────────────────────────────────────────────┘
```

## 功能特性

### 1. 乐谱编辑 (教师端)
- 创建和编辑MusicXML格式的乐谱
- 支持添加/删除音符、休止符
- 支持修改拍号、调号
- 实时预览乐谱
- 版本历史记录和回溯

### 2. 实时协作 (WebRTC DataChannel)
- 教师端编辑通过WebRTC实时同步到所有学生端
- OT算法处理并发编辑冲突
- 光标位置同步
- 聊天功能

### 3. 远程合奏 (MQTT)
- 学生端连接MIDI键盘进行演奏
- MIDI事件通过MQTT协议上传到服务端
- 服务端进行时间戳对齐后广播
- 支持演奏开始/停止控制
- 本地声音回放

### 4. 会话管理
- 教师创建会话，生成8位邀请码
- 学生通过邀请码加入会话
- 参与者列表实时更新
- 会话状态持久化

### 5. 数据持久化
- PostgreSQL存储所有数据
- 乐谱版本历史记录
- MIDI演奏事件记录
- 支持OT操作审计

## 快速开始

### 环境要求
- Node.js >= 16.x
- PostgreSQL >= 12.x
- 现代浏览器 (Chrome/Firefox/Safari)
- MIDI键盘 (可选，用于学生端演奏)

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd music-collab
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
```
编辑 `.env` 文件，配置数据库连接信息。

4. **初始化数据库**
```bash
# 确保PostgreSQL服务已启动
# 创建数据库
createdb music_collab

# 执行初始化脚本
npm run init-db
```

5. **启动服务**
```bash
npm start
```

或者使用开发模式：
```bash
npm run dev
```

6. **访问应用**
打开浏览器访问 `http://localhost:3000`

### 端口说明
- HTTP服务: 3000
- WebSocket信令: 3000 (共享HTTP端口)
- MQTT (TCP): 1883
- MQTT (WebSocket): 9001

## 使用指南

### 教师端操作流程

1. **登录系统**
   - 输入姓名
   - 选择"教师"身份
   - 点击"进入系统"

2. **创建乐谱**
   - 输入乐谱标题
   - 点击"创建乐谱"按钮

3. **开始协作**
   - 系统自动创建会话并生成邀请码
   - 将邀请码分享给学生

4. **编辑乐谱**
   - 使用工具栏选择拍号、调号
   - 选择音符时值
   - 点击"添加音符"或"添加休止符"
   - 点击音符后可删除

5. **开始演奏**
   - 所有学生加入后，点击"开始演奏"按钮
   - 学生端可以开始弹奏MIDI键盘
   - 所有参与者可以听到合奏效果

### 学生端操作流程

1. **登录系统**
   - 输入姓名
   - 选择"学生"身份
   - 点击"进入系统"

2. **加入会话**
   - 输入教师提供的8位邀请码
   - 点击"加入会话"

3. **连接MIDI键盘**
   - 系统自动检测MIDI设备
   - 从下拉菜单选择MIDI输入设备
   - 确保"启用MIDI"已勾选

4. **参与合奏**
   - 等待教师开始演奏
   - 跟随乐谱弹奏MIDI键盘
   - 可以听到自己和其他人的演奏

## API接口文档

### 用户管理
- `POST /api/users` - 创建用户
- `GET /api/users/:id` - 获取用户信息

### 乐谱管理
- `POST /api/scores` - 创建乐谱
- `GET /api/scores/:id` - 获取乐谱
- `GET /api/scores/user/:userId` - 获取用户的乐谱列表
- `PUT /api/scores/:id` - 更新乐谱
- `GET /api/scores/:id/versions` - 获取乐谱版本历史
- `POST /api/scores/parse` - 解析MusicXML

### 会话管理
- `POST /api/sessions` - 创建会话
- `GET /api/sessions/:id` - 获取会话信息
- `GET /api/sessions/invite/:inviteCode` - 通过邀请码获取会话
- `GET /api/sessions/teacher/:teacherId/active` - 获取教师的活跃会话
- `GET /api/sessions/:id/participants` - 获取参与者列表
- `POST /api/sessions/:id/participants` - 添加参与者
- `PUT /api/sessions/:id/end` - 结束会话
- `GET /api/sessions/:id/midi-events` - 获取MIDI事件

### WebSocket信令消息

#### 客户端 -> 服务端
```json
// 加入会话
{
  "type": "join",
  "inviteCode": "ABC12345",
  "userId": "uuid",
  "name": "张三",
  "role": "teacher"
}

// 乐谱编辑操作
{
  "type": "score-operation",
  "operation": { ... },
  "scoreId": "uuid",
  "version": 1
}

// WebRTC信令
{
  "type": "offer",
  "from": "userId1",
  "to": "userId2",
  "offer": { ... }
}

// 聊天
{
  "type": "chat",
  "message": "你好！"
}
```

#### 服务端 -> 客户端
```json
// 加入成功
{
  "type": "joined",
  "sessionId": "uuid",
  "score": "<musicxml>...</musicxml>",
  "scoreId": "uuid",
  "scoreTitle": "小星星",
  "currentVersion": 1,
  "participants": [...],
  "isTeacher": true,
  "iceServers": [...]
}

// 乐谱操作
{
  "type": "score-operation",
  "version": 2,
  "operation": { ... },
  "musicxml": "<musicxml>...</musicxml>",
  "userId": "uuid"
}
```

### MQTT主题

- `session/{sessionId}/midi` - MIDI事件广播
- `session/{sessionId}/sync` - 同步消息（开始/停止）
- `session/{sessionId}/control` - 控制消息
- `session/{sessionId}/chat` - 聊天消息

### MIDI事件格式
```json
{
  "type": "note-on",
  "note": 60,
  "velocity": 100,
  "channel": 0,
  "timestamp": 1234,
  "userId": "uuid",
  "sessionId": "uuid"
}
```

## OT算法说明

### 操作类型
1. **insert**: 插入音符/休止符
2. **delete**: 删除音符
3. **update**: 更新音符属性
4. **metadata**: 更新元数据（拍号、调号等）

### 变换规则
- 插入操作会使后续操作的索引偏移
- 删除操作会使后续操作的索引偏移或失效
- 同一位置的冲突操作优先服务器版本
- 元数据冲突优先先到的操作

## 数据库结构

### users
- id (UUID, PK)
- name (VARCHAR)
- role (ENUM: teacher/student)
- created_at (TIMESTAMP)

### scores
- id (UUID, PK)
- title (VARCHAR)
- musicxml (TEXT)
- created_by (UUID, FK)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

### sessions
- id (UUID, PK)
- score_id (UUID, FK)
- teacher_id (UUID, FK)
- invite_code (VARCHAR(8), UNIQUE)
- status (ENUM: active/ended)
- created_at (TIMESTAMP)
- ended_at (TIMESTAMP)

### session_participants
- id (UUID, PK)
- session_id (UUID, FK)
- user_id (UUID, FK)
- joined_at (TIMESTAMP)
- left_at (TIMESTAMP)

### score_versions
- id (UUID, PK)
- score_id (UUID, FK)
- version_number (INTEGER)
- musicxml (TEXT)
- operation (JSONB)
- user_id (UUID, FK)
- created_at (TIMESTAMP)

### midi_events
- id (UUID, PK)
- session_id (UUID, FK)
- user_id (UUID, FK)
- event_type (VARCHAR)
- note_number (INTEGER)
- velocity (INTEGER)
- timestamp (BIGINT)
- server_timestamp (BIGINT)
- created_at (TIMESTAMP)

## 部署建议

### 生产环境部署
1. 使用Nginx作为反向代理
2. 配置HTTPS (WebRTC需要HTTPS)
3. 配置TURN服务器以支持NAT穿透
4. 使用PM2管理Node.js进程
5. 配置PostgreSQL连接池和备份

### Nginx配置示例
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /mqtt {
        proxy_pass http://localhost:9001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

### TURN服务器配置
推荐使用Coturn作为TURN服务器：
```bash
apt install coturn
```

配置 `/etc/turnserver.conf`:
```
listening-port=3478
tls-listening-port=5349
listening-ip=your-server-ip
realm=your-domain.com
server-name=your-domain.com
user=username:password
cli-password=your-password
cert=/path/to/cert.pem
pkey=/path/to/key.pem
```

## 常见问题

### Q: WebRTC连接失败怎么办？
A: 检查是否在HTTPS环境下运行，检查防火墙设置，配置TURN服务器。

### Q: MIDI设备检测不到？
A: 确保浏览器支持Web MIDI API，确保MIDI设备已连接，检查浏览器权限设置。

### Q: 延迟很高怎么办？
A: 确保网络连接稳定，优先使用有线网络，服务器部署在接近用户的地理位置。

### Q: 如何支持更多乐器？
A: 可以扩展MusicXML支持的乐器类型，在前端添加更多MIDI程序选择。

## 开发计划

- [ ] 支持更多MusicXML元素（反复、装饰音等）
- [ ] 添加乐谱渲染引擎（使用VexFlow/OpenSheetMusicDisplay）
- [ ] 支持乐谱导出为PDF/MIDI
- [ ] 添加演奏录制和回放功能
- [ ] 添加练习模式（节拍器、速度调整）
- [ ] 支持多轨合奏
- [ ] 添加移动端支持
- [ ] 实现房间锁和权限管理
- [ ] 添加白板功能

## 许可证

MIT License

## 联系方式

如有问题或建议，请提交Issue或Pull Request。
