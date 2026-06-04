# 多端音轨同步校对系统

基于音频指纹技术的跨设备音轨同步解决方案，支持主播上传参考音轨，观众录制环境音进行实时同步校对。

## 系统架构

### 后端服务
- **技术栈**: Node.js + Express
- **核心功能**: 房间管理、音轨指纹库存储、偏移量计算API

### 前端页面
- **技术栈**: Vue3 + Element Plus
- **主播端**: 创建房间、上传参考音轨、管理同步会话
- **观众端**: 加入房间、录制环境音、同步校对、结果展示

### 核心算法模块
- **音频指纹提取**: 使用简化版Chromaprint算法提取音频特征
- **偏移量计算**: 滑动窗口匹配算法，毫秒级时间偏移检测

### 数据库
- **PostgreSQL**: 存储房间信息、音轨特征向量、校对历史记录

## 项目结构

```
audio-sync-system/
├── backend/                 # 后端服务
│   ├── src/
│   │   ├── config/         # 配置文件
│   │   ├── controllers/    # 控制器
│   │   ├── routes/         # 路由定义
│   │   ├── utils/          # 工具函数
│   │   └── app.js          # 应用入口
│   ├── sql/                # 数据库初始化脚本
│   ├── uploads/            # 音频文件上传目录
│   ├── package.json
│   └── Dockerfile
├── frontend/               # 前端项目
│   ├── public/
│   │   └── resampler-processor.js  # AudioWorklet重采样处理器
│   ├── src/
│   │   ├── api/            # API接口
│   │   ├── views/          # 页面组件
│   │   ├── router/         # 路由配置
│   │   ├── utils/          # 工具函数
│   │   └── main.js         # 应用入口
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
├── docker-compose.yml      # Docker编排配置
└── README.md
```

## 采样率一致性修复

### 问题描述
前端录音默认采样率(44100Hz)与后端指纹提取要求(16000Hz)不一致，导致指纹长度不同，比对时报错。

### 解决方案

#### 1. 前端AudioWorklet实时重采样
- **文件**: `frontend/public/resampler-processor.js`
- 使用Web Audio API的AudioWorklet进行实时线性插值重采样
- 支持降级到ScriptProcessor以兼容旧浏览器
- 输出标准16位PCM WAV格式(16000Hz, 单声道)

#### 2. 后端统一采样率处理
- **文件**: `backend/src/utils/audioFingerprint.js`
- 所有音频统一使用FFmpeg转换为16000Hz
- 添加详细的WAV文件头解析和验证
- 输出采样率校验日志

#### 3. 采样率校验日志
**前端控制台日志**:
```
[AudioRecorder] 初始化 - 目标配置: 16000Hz, 1声道, 16位
[AudioRecorder] 实际输入采样率: 44100Hz
[AudioRecorder] 重采样比率: 2.7563
========== 采样率信息 ==========
输入采样率: 44100 Hz
目标采样率: 16000 Hz
重采样比率: 2.7563
录制样本数: 160000
录制时长: 10.000 秒
================================
```

**后端控制台日志**:
```
========== 采样率校验 ==========
[采样率校验] 期望采样率: 16000Hz
[采样率校验] 实际采样率: 16000Hz
[采样率校验] ✓ 通过 - 采样率匹配
================================
[SyncCalculator] 参考音轨 - 采样率:16000Hz, 帧数:308, 帧时长:128.00ms
[SyncCalculator] 录制音轨 - 采样率:16000Hz, 帧数:308, 帧时长:128.00ms
```

#### 4. 前端UI采样率信息展示
在观众端录制完成后，显示采样率信息卡片：
- 输入采样率 / 目标采样率
- 重采样比率
- 录制样本数
- 录制时长

## 快速启动

### 方式一：Docker Compose（推荐）

```bash
docker-compose up -d
```

访问地址:
- 前端: http://localhost:5173
- 后端API: http://localhost:3000
- 数据库: localhost:5432

### 方式二：本地开发

#### 前置要求
- Node.js 18+
- PostgreSQL 15+
- FFmpeg（用于音频处理）

#### 1. 启动数据库

```bash
# 使用Docker启动PostgreSQL
docker run --name audio-sync-db \
  -e POSTGRES_USER=audio_sync \
  -e POSTGRES_PASSWORD=audio_sync123 \
  -e POSTGRES_DB=audio_sync \
  -p 5432:5432 \
  -d postgres:15-alpine
```

#### 2. 初始化数据库

```bash
psql -h localhost -U audio_sync -d audio_sync -f backend/sql/001_init.sql
```

#### 3. 启动后端服务

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

#### 4. 启动前端服务

```bash
cd frontend
npm install
npm run dev
```

## API接口文档

### 房间管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/rooms` | 创建房间 |
| GET | `/api/rooms` | 获取房间列表 |
| GET | `/api/rooms/:id` | 获取房间详情 |
| PUT | `/api/rooms/:id` | 更新房间信息 |
| DELETE | `/api/rooms/:id` | 删除房间 |

### 音轨管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/audio/upload` | 上传音频文件 |
| GET | `/api/audio/:id` | 获取音轨信息 |
| GET | `/api/audio/room/:roomId` | 获取房间音轨列表 |
| GET | `/api/audio/:id/download` | 下载音频文件 |
| DELETE | `/api/audio/:id` | 删除音轨 |

### 同步计算

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/sync` | 计算音轨时间偏移量 |
| POST | `/api/sync/quick` | 快速同步计算 |
| GET | `/api/sync/:id` | 获取同步会话详情 |
| GET | `/api/sync/room/:roomId` | 获取房间同步历史 |

## 使用说明

### 主播端流程

1. 进入主播端页面，点击"创建房间"
2. 输入房间名称和昵称，创建房间
3. 在房间内上传参考音轨（支持wav、mp3、ogg等格式）
4. 系统自动提取音频指纹并存储
5. 将房间ID分享给观众

### 观众端流程

1. 进入观众端页面，输入房间ID或选择房间加入
2. 授权麦克风权限
3. 点击"开始录制"录制环境音
4. 录制完成后点击"开始同步校对"
5. 查看同步结果和时间偏移量

## 核心算法说明

### 音频指纹提取

1. **音频预处理**: 将音频转换为单声道、44.1kHz采样率的WAV格式
2. **分帧处理**: 使用汉宁窗进行分帧，帧大小4096，帧移1024
3. **频谱分析**: 对每一帧进行FFT变换获取频谱
4. **色度特征**: 将频谱映射到12个半音音阶，生成色度图
5. **指纹生成**: 通过比较相邻帧的色度变化生成二进制指纹

### 偏移量计算

1. **滑动窗口匹配**: 在参考音轨上滑动窗口匹配录制音轨
2. **汉明距离计算**: 计算指纹序列之间的相似度
3. **置信度评估**: 根据最佳匹配与次佳匹配的差值计算置信度
4. **时间转换**: 将帧偏移转换为实际时间偏移（秒）

## 技术栈

### 后端
- Node.js 18
- Express 4.x
- PostgreSQL 15
- FFmpeg
- Multer（文件上传）

### 前端
- Vue 3
- Vue Router 4
- Element Plus
- Axios
- Vite

## 开发计划

- [ ] 支持实时流式音频同步
- [ ] 集成官方Chromaprint库
- [ ] 添加WebSocket支持
- [ ] 支持更多音频格式
- [ ] 添加用户认证系统
- [ ] 优化算法性能

## 许可证

MIT License
