# Hilbert空间索引服务

基于Hilbert曲线的空间填充索引与多维范围查询服务。

## 项目结构

```
.
├── hilbert.py          # Hilbert曲线编解码算法实现
├── database.py         # 数据库模型和连接
├── index_manager.py    # 索引管理器，包含动态扩缩容
├── main.py             # FastAPI主应用，所有API路由
├── requirements.txt    # 依赖包
├── test_core.py        # 核心算法测试
├── test_api.py         # API完整测试
├── test_simple.py      # 简化版API测试
└── hilbert_index.db    # SQLite数据库文件（运行后生成）
```

## 核心功能

### 1. Hilbert编解码算法
- 自主实现，不依赖第三方库
- 支持N阶Hilbert曲线（默认N=8，最大N=12）
- 坐标范围0-1000映射到2^N × 2^N网格
- 编码：(x, y) → Hilbert码
- 解码：Hilbert码 → (x, y)

### 2. 动态扩缩容
- 初始阈值：10000个点
- 当点数超过阈值时，自动将N阶+1
- 重新计算所有点的Hilbert码
- 阈值自动调整为原来的1.5倍
- 最大支持N=12

### 3. REST API接口

#### POST /insert - 批量插入点集
请求体：
```json
{
  "points": [
    {"x": 100, "y": 200},
    {"x": 500, "y": 500}
  ]
}
```
响应：返回每个点对应的Hilbert码

#### POST /range - 矩形范围查询
请求体：
```json
{
  "x_min": 100,
  "x_max": 600,
  "y_min": 100,
  "y_max": 600,
  "use_index": true
}
```
- 通过矩形四个角点的Hilbert码确定查询范围
- 先通过Hilbert索引快速筛选候选点（超集）
- 再精确过滤，返回矩形内所有点

#### POST /neighbors - 最近邻查询
请求体：
```json
{
  "x": 500,
  "y": 500,
  "k": 10
}
```
- 返回Hilbert码相邻（前后K个码值）的最近N个点
- 同时显示码距离和欧氏距离

#### POST /benchmark - 性能对比
请求体：
```json
{
  "x_min": 200,
  "x_max": 800,
  "y_min": 200,
  "y_max": 800,
  "iterations": 10
}
```
- 对比线性扫描和Hilbert索引的查询耗时
- 返回平均耗时、最小/最大耗时、加速比

#### GET /stats - 获取索引状态
返回当前N阶、阈值、点数、最大Hilbert索引值

#### POST /generate_test_data - 生成测试数据
参数：count（生成点的数量）

## 快速开始

### 1. 安装依赖
```bash
pip install -r requirements.txt
```

### 2. 启动服务
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 3. 访问API文档
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### 4. 运行测试
```bash
# 测试核心算法
python test_core.py

# 测试API接口
python test_simple.py
```

## API调用示例

### 使用curl

```bash
# 插入点
curl -X POST "http://localhost:8000/insert" \
  -H "Content-Type: application/json" \
  -d '{"points": [{"x": 100, "y": 200}, {"x": 500, "y": 500}]}'

# 范围查询
curl -X POST "http://localhost:8000/range" \
  -H "Content-Type: application/json" \
  -d '{"x_min": 0, "x_max": 600, "y_min": 0, "y_max": 600, "use_index": true}'

# 最近邻查询
curl -X POST "http://localhost:8000/neighbors" \
  -H "Content-Type: application/json" \
  -d '{"x": 500, "y": 500, "k": 5}'

# 性能对比
curl -X POST "http://localhost:8000/benchmark" \
  -H "Content-Type: application/json" \
  -d '{"x_min": 200, "x_max": 800, "y_min": 200, "y_max": 800, "iterations": 5}'

# 生成测试数据
curl -X POST "http://localhost:8000/generate_test_data?count=1000"
```

### 使用Python

```python
import requests

# 插入点
response = requests.post("http://localhost:8000/insert", 
    json={"points": [{"x": 100, "y": 200}, {"x": 500, "y": 500}]})
print(response.json())

# 范围查询
response = requests.post("http://localhost:8000/range",
    json={"x_min": 0, "x_max": 600, "y_min": 0, "y_max": 600})
print(response.json())
```

## 技术实现

### Hilbert曲线算法
- 使用经典的Butz算法实现
- 通过位操作和旋转实现高效编解码
- 时间复杂度：O(N)，N为阶数

### 索引策略
- 使用SQLite数据库存储点数据
- Hilbert码建立B树索引
- 范围查询：通过四个角点确定Hilbert码范围，加10%边距扩大查询范围

### 动态扩缩容
- 插入数据后检查点数是否超过阈值
- 超过阈值则提高N阶，重建所有索引
- 阈值随N阶提升而动态调整

## 性能特点

1. **插入性能**：O(log N) 数据库索引开销
2. **范围查询**：比线性扫描快数倍到数十倍，取决于数据量和查询范围
3. **空间局部性**：Hilbert曲线保证空间相近的点编码也相近
4. **可扩展性**：支持动态调整阶数，适应不同数据量
