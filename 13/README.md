# 边缘设备时序数据混沌测试平台

一个针对边缘设备时序数据的混沌测试平台，用于验证物联网系统在各种异常场景下的稳定性和可靠性。

## 🎯 项目特性

### 后端服务 (FastAPI + InfluxDB + PostgreSQL)
- **设备数据模拟**：模拟多个边缘设备实时上报温度、湿度、电压、电流、压力等时序数据
- **异常注入引擎**：支持8种异常类型的注入
  - 丢包 (Packet Loss)：随机丢弃数据包
  - 乱序 (Out-of-Order)：数据包乱序到达
  - 延迟 (Delay)：数据包延迟到达
  - 数值突变 (Value Spike)：数值突然大幅变化
  - 时间戳漂移 (Timestamp Drift)：时间戳偏移
  - 数值漂移 (Value Drift)：数值渐进式变化
  - 数据停滞 (Data Stagnation)：数值保持不变
  - 噪声注入 (Noise Injection)：添加随机噪声

- **时间旅行回放**：将历史某段时间的异常模式重放到当前数据流
- **WebSocket实时推送**：实时推送设备数据和异常事件

### 前端界面 (React + TypeScript)
- **实时监控**：多维度实时时序图表，对比展示原始数据和注入后数据
- **拖拽式异常编排**：可视化工作流编辑器，拖拽构建异常注入流程
- **异常事件时间轴**：实时展示异常事件发生顺序和详情
- **设备管理**：创建设备、配置参数、启动/停止模拟
- **测试用例管理**：保存、执行、导出测试用例
- **时间旅行**：查询历史数据，按指定速度回放

### 数据库架构
- **InfluxDB**：高性能时序数据库，存储原始和异常注入后的时序数据
- **PostgreSQL**：关系型数据库，存储测试用例、工作流配置、注入记录

## 🚀 快速开始

### 环境要求
- Docker Desktop 4.0+
- 4GB+ 可用内存
- 10GB+ 可用磁盘空间

### 一键启动 (Windows)
```bash
start.bat
```

### 一键启动 (Linux/Mac)
```bash
chmod +x start.sh
./start.sh
```

### 手动启动
```bash
# 启动所有服务
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 访问地址
| 服务 | 地址 | 说明 |
|------|------|------|
| 前端界面 | http://localhost:3000 | 主操作界面 |
| 后端API | http://localhost:8000 | API服务 |
| API文档 | http://localhost:8000/docs | Swagger UI |
| InfluxDB | http://localhost:8086 | 时序数据库管理 |

### InfluxDB 默认登录
- 用户名: `admin`
- 密码: `admin123456`
- Token: `chaos-test-token`
- 组织: `chaos-org`
- Bucket: `iot-data`

## 📖 使用指南

### 1. 创建设备
1. 进入"设备管理"页面
2. 点击"创建设备"按钮
3. 配置设备ID、上报间隔、选择指标（温度、湿度、电压等）
4. 设置各指标的基准值和波动范围
5. 点击"创建"完成设备创建

### 2. 启动设备模拟
- 在设备卡片上点击"启动"按钮启动单个设备
- 或在"实时监控"页面点击"全部启动"

### 3. 实时监控数据
1. 进入"实时监控"页面
2. 选择要查看的设备
3. 查看各指标的实时图表
   - 蓝色线条：原始数据
   - 红色线条：异常注入后的数据
4. 右侧时间轴实时展示异常事件

### 4. 创建异常注入工作流
1. 进入"异常编排"页面
2. 从左侧组件库拖拽设备节点到画布
3. 拖拽异常节点（如丢包、延迟、数值突变等）
4. 拖拽输出节点
5. 连接节点形成数据处理流程
6. 点击异常节点，在右侧面板配置参数
7. 选择目标设备
8. 点击"保存"或"立即执行"

### 5. 时间旅行回放
1. 进入"时间旅行"页面
2. 选择设备和历史时间范围
3. 点击"预览数据"查看该时间段的数据量
4. 设置回放速度（1x 表示实时，2x 表示2倍速）
5. 点击"开始回放"将历史数据重新注入当前数据流

### 6. 管理测试用例
1. 在"异常编排"页面配置好工作流后
2. 点击"存为测试用例"保存
3. 进入"测试用例"页面查看和管理所有测试用例
4. 可以执行、导出、删除测试用例
5. 查看异常注入历史记录

## 🏗️ 项目结构

```
chaos-test-platform/
├── backend/                    # 后端服务 (FastAPI)
│   ├── main.py                # 主入口，API路由
│   ├── config.py              # 配置管理
│   ├── models.py              # 数据模型
│   ├── device_simulator.py    # 设备数据模拟引擎
│   ├── anomaly_engine.py      # 异常注入引擎
│   ├── time_travel.py         # 时间旅行回放引擎
│   ├── database.py            # 数据库管理
│   ├── websocket_manager.py   # WebSocket连接管理
│   ├── requirements.txt       # Python依赖
│   ├── Dockerfile             # Docker镜像构建
│   └── .env                   # 环境变量
├── frontend/                   # 前端应用 (React)
│   ├── src/
│   │   ├── main.tsx           # 入口文件
│   │   ├── App.tsx            # 主应用组件
│   │   ├── types/             # TypeScript类型定义
│   │   ├── services/          # API和WebSocket服务
│   │   ├── store/             # 状态管理 (Zustand)
│   │   ├── components/        # 可复用组件
│   │   │   ├── RealTimeChart.tsx     # 实时图表
│   │   │   ├── AnomalyTimeline.tsx   # 异常时间轴
│   │   │   ├── DeviceCard.tsx        # 设备卡片
│   │   │   └── WorkflowNodes.tsx     # 工作流节点
│   │   └── pages/             # 页面组件
│   │       ├── Dashboard.tsx         # 实时监控
│   │       ├── WorkflowEditor.tsx    # 异常编排
│   │       ├── DeviceManager.tsx     # 设备管理
│   │       ├── TimeTravel.tsx        # 时间旅行
│   │       └── TestCases.tsx         # 测试用例
│   ├── package.json           # NPM依赖
│   ├── tsconfig.json          # TypeScript配置
│   ├── vite.config.ts         # Vite配置
│   ├── tailwind.config.js     # Tailwind配置
│   └── Dockerfile             # Docker镜像构建
├── docker-compose.yml         # Docker Compose配置
├── start.bat                  # Windows启动脚本
├── start.sh                   # Linux/Mac启动脚本
├── stop.bat                   # Windows停止脚本
├── stop.sh                    # Linux/Mac停止脚本
└── README.md                  # 项目说明
```

## 🔌 API 接口

### 设备管理
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/devices` | 创建设备 |
| GET | `/devices` | 获取所有设备 |
| GET | `/devices/{id}` | 获取单个设备 |
| DELETE | `/devices/{id}` | 删除设备 |
| POST | `/devices/{id}/start` | 启动设备模拟 |
| POST | `/devices/{id}/stop` | 停止设备模拟 |
| GET | `/devices/{id}/status` | 获取设备状态 |
| POST | `/devices/start-all` | 启动所有设备 |
| POST | `/devices/stop-all` | 停止所有设备 |

### 异常注入
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/anomaly-types` | 获取可用异常类型 |
| POST | `/devices/{id}/anomalies` | 添加异常 |
| DELETE | `/devices/{id}/anomalies/{type}` | 移除异常 |
| DELETE | `/devices/{id}/anomalies` | 清除所有异常 |
| GET | `/devices/{id}/anomalies` | 获取设备异常 |
| GET | `/anomalies` | 获取所有异常 |
| GET | `/anomaly-events` | 获取异常事件 |

### 工作流管理
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/workflows` | 创建工作流 |
| GET | `/workflows` | 获取所有工作流 |
| GET | `/workflows/{id}` | 获取单个工作流 |
| DELETE | `/workflows/{id}` | 删除工作流 |
| POST | `/workflows/{id}/start` | 启动工作流 |
| POST | `/workflows/{id}/stop` | 停止工作流 |
| GET | `/workflows/{id}/status` | 获取工作流状态 |

### 时间旅行
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/time-travel/start` | 开始回放 |
| POST | `/time-travel/{id}/stop` | 停止回放 |
| GET | `/time-travel/{id}` | 获取回放状态 |
| GET | `/time-travel` | 获取所有回放 |

### 数据查询
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/data/query` | 查询历史数据 |
| GET | `/data/recent` | 获取最近数据 |

### WebSocket
- `/ws` - 接收实时数据和异常事件

## 🧪 异常类型详解

### 1. 丢包 (packet_loss)
- **描述**：按照指定概率随机丢弃数据包
- **参数**：
  - `loss_rate`: 丢包概率 (0.0 - 1.0)，默认 0.1

### 2. 乱序 (out_of_order)
- **描述**：数据包到达顺序被打乱
- **参数**：
  - `window_size`: 乱序窗口大小，默认 5
  - `reorder_probability`: 重排概率，默认 0.3

### 3. 延迟 (delay)
- **描述**：数据包延迟指定时间后到达
- **参数**：
  - `min_delay`: 最小延迟秒数，默认 0.5
  - `max_delay`: 最大延迟秒数，默认 2.0

### 4. 数值突变 (value_spike)
- **描述**：数值突然大幅变化
- **参数**：
  - `spike_factor`: 突变倍数，默认 3.0
  - `spike_probability`: 突变概率，默认 0.05
  - `affected_metrics`: 受影响的指标列表

### 5. 时间戳漂移 (timestamp_drift)
- **描述**：数据包时间戳发生偏移
- **参数**：
  - `drift_seconds`: 漂移秒数（正向后，负向前），默认 5.0
  - `gradual`: 是否渐进式漂移，默认 true

### 6. 数值漂移 (value_drift)
- **描述**：数值按固定速率渐进变化
- **参数**：
  - `drift_rate`: 每个数据包的漂移量，默认 0.1
  - `affected_metrics`: 受影响的指标列表

### 7. 数据停滞 (data_stagnation)
- **描述**：数值在一段时间内保持不变
- **参数**：
  - `stagnation_probability`: 停滞触发概率，默认 0.1
  - `stagnation_duration`: 停滞持续数据包数量，默认 5

### 8. 噪声注入 (noise_injection)
- **描述**：在正常数据中添加随机噪声
- **参数**：
  - `noise_level`: 噪声强度，默认 0.5
  - `affected_metrics`: 受影响的指标列表

## 🔧 开发指南

### 后端开发
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

### 前端开发
```bash
cd frontend
npm install
npm run dev
```

### 数据库连接
- **InfluxDB**: `http://localhost:8086`
- **PostgreSQL**: `postgresql://postgres:chaos-test-pass@localhost:5432/chaos_test`

## 📝 注意事项

1. 首次启动需要拉取Docker镜像，可能需要较长时间
2. 确保端口 3000、8000、8086、5432 未被占用
3. 数据会持久化到Docker卷中，删除容器不会丢失数据
4. 如果遇到连接问题，检查防火墙设置
5. 建议使用Chrome或Edge浏览器以获得最佳体验

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📄 许可证

MIT License
