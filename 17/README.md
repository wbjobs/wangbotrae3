# 多患者生理信号实时监测与群体分析系统

## 系统架构

本系统支持**最多4名患者同时监控**，提供实时监测、群体对比和异常分析功能：

1. **多患者数据源模拟** - Python模拟4名患者的8通道生理信号
2. **后端处理** - FastAPI + Redis Streams 实时处理 + 异常聚类
3. **前端看板** - Vue3 + ECharts 多视图可视化

## ✨ 核心功能

### 🧑‍⚕️ 多患者同时监控（最多4人）
- 2x2网格布局，同时展示4名患者的关键指标
- 每位患者独立显示ECG、EEG、PPG等核心通道波形
- 实时显示每位患者的异常计数
- 患者颜色编码，便于快速识别

### 🔥 群体异常热力图
- 所有患者异常事件按时间聚合
- 热力图展示高频异常时段（蓝色→深蓝色）
- X轴：时间，Y轴：通道类型
- 快速发现群体异常模式

### 📊 患者对比功能
- 选择2-3名患者进行波形叠加对比
- **差异区域高亮**：显示患者间波形差值（红色/蓝色填充）
- 支持任意通道对比
- 统一坐标轴，便于直观比较

### 🔍 异常模式聚类
- 自动将相似异常事件归类
- 预设8种临床模式：
  - ECG早搏模式
  - EEG爆发抑制
  - 血氧下降
  - 呼吸频率异常
  - EMG高活动
  - 体温异常
  - 皮肤电突变
  - 脉搏波减弱
- 显示聚类统计：发生次数、涉及患者、平均分数

### 📄 对比报告导出
- 导出HTML格式对比报告
- 包含：异常统计、模式分析、事件列表
- 支持选择患者和通道
- 可打印或另存为PDF

### 🎯 自适应基线学习（已有功能）
- 每位患者前5分钟学习个性化基线
- EWMA动态更新基线参数
- 3个动态标准差阈值报警
- 支持手动重置基线

## 🚀 安装与运行

### 环境要求
- Python 3.8+
- Node.js 16+
- Redis 6.0+

### 启动顺序

#### 1. 启动Redis
```bash
redis-server
# 或 Docker: docker run -p 6379:6379 redis
```

#### 2. 后端设置
```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 启动多患者信号生成器（新终端）
python multi_patient_generator.py

# 启动FastAPI服务（新终端）
python main.py
```

后端API文档：http://localhost:8000/docs

#### 3. 前端设置
```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端访问：http://localhost:3000

## 📁 项目结构

```
.
├── backend/
│   ├── requirements.txt           # Python依赖
│   ├── config.py                  # 配置文件
│   ├── multi_patient_generator.py # 多患者信号生成
│   ├── feature_extractor.py       # 特征提取
│   ├── anomaly_detector.py        # 自适应基线异常检测
│   ├── anomaly_clustering.py      # 异常模式聚类
│   ├── report_generator.py        # 报告生成
│   ├── main.py                    # FastAPI主程序
│   └── test_baseline.py           # 测试脚本
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── App.vue                # 主界面（4种视图模式）
│       └── components/
│           ├── PatientCard.vue        # 患者卡片
│           ├── PatientCompare.vue     # 患者对比
│           ├── GroupHeatmap.vue       # 群体热力图
│           └── AnomalyClusters.vue    # 异常聚类
└── README.md
```

## 🔌 API接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/patients | 获取患者列表 |
| GET | /api/channels | 获取通道配置 |
| GET | /api/anomalies | 获取异常事件 |
| POST | /api/anomalies/label | 标注异常 |
| GET | /api/baseline/status | 获取基线状态 |
| POST | /api/baseline/reset | 重置基线 |
| GET | /api/heatmap | 获取群体热力图数据 |
| GET | /api/clusters | 获取异常聚类结果 |
| POST | /api/report/generate | 导出对比报告 |
| WS | /ws/stream | 实时数据流WebSocket |

## 🖥️ 使用说明

### 视图模式切换

1. **多患者看板**
   - 2x2网格显示最多4名患者
   - 每位患者显示ECG、EEG、PPG波形
   - 右上角显示该患者异常计数

2. **患者对比**
   - 选择2-3名患者对比同一通道
   - 点击"显示差异区域"高亮波形差值
   - 底部图例区分不同患者

3. **群体热力图**
   - 查看所有患者的异常分布
   - 颜色越深表示异常越频繁
   - 鼠标悬停显示详细信息

4. **异常聚类**
   - 查看自动识别的异常模式
   - 统计每种模式的发生情况
   - 帮助发现群体共性问题

### 操作说明

1. **选择患者**：左侧面板勾选要监控的患者
2. **选择通道**：在对比模式下选择对比的通道
3. **导出报告**：点击右上角"导出报告"按钮
4. **重置基线**：患者状态变化时可重置基线
5. **标注异常**：右侧列表点击异常进行确认/驳回

## 🛠️ 技术栈

- **后端**：FastAPI, Redis, NumPy, SciPy, scikit-learn
- **前端**：Vue3, ECharts, Element Plus, Vite
- **算法**：EWMA自适应基线、特征向量聚类
- **通信**：WebSocket, REST API

## 配置说明

在 `backend/config.py` 中可调整：

```python
MULTI_PATIENT_CONFIG = {
    'max_patients': 4,              # 最大同时监控患者数
    'heatmap_time_bins': 60,        # 热力图时间格数
    'clustering_threshold': 0.7,    # 聚类相似度阈值
}
```

## 注意事项

1. 系统启动后前5分钟为基线学习期，不报警
2. 每位患者独立学习基线，互不影响
3. 异常聚类结果每10秒自动更新
4. 报告导出为HTML格式，可在浏览器打印为PDF
