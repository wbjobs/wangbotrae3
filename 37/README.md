# 供应链碳排放分析系统

企业级供应链碳足迹全生命周期分析平台，支持BOM上传、递归碳排放计算、Sankey可视化、假设分析和PDF报告导出。

## 技术栈

### 后端
- **FastAPI**: 高性能Web框架
- **Pandas**: 数据处理与计算引擎
- **SQLAlchemy**: ORM框架
- **PostgreSQL**: 存储BOM树结构
- **Celery**: 异步任务队列
- **Redis**: 消息代理
- **ReportLab**: PDF报告生成

### 前端
- **React 18**: 用户界面
- **ECharts**: Sankey图可视化
- **Ant Design**: UI组件库
- **Axios**: HTTP客户端

## 功能特性

1. **BOM管理**: 上传产品物料清单，支持多级嵌套结构
2. **供应商数据**: 维护各级供应商生产碳排放数据
3. **碳排放计算**: 递归计算每个零部件的三阶段碳排放
   - 原材料获取阶段
   - 生产制造阶段
   - 运输配送阶段
4. **Sankey可视化**: 碳足迹流向图展示
5. **数据校验**: BOM结构完整性校验
6. **假设分析**: 更换材料后的碳排放对比分析
7. **PDF报告**: 导出完整的碳足迹分析报告

## 快速开始

### 使用Docker Compose

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 访问前端
http://localhost:3000

# 访问API文档
http://localhost:8000/docs
```

### 本地开发

#### 后端
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

#### 前端
```bash
cd frontend
npm install
npm start
```

## API接口

- `POST /api/bom/upload` - 上传BOM文件
- `POST /api/supplier/upload` - 上传供应商数据
- `GET /api/bom/{bom_id}/calculate` - 触发碳排放计算
- `GET /api/bom/{bom_id}/sankey` - 获取Sankey图数据
- `POST /api/analysis/compare` - 假设分析对比
- `GET /api/bom/{bom_id}/report` - 导出PDF报告

## 项目结构

```
.
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI主入口
│   │   ├── models.py        # 数据库模型
│   │   ├── schemas.py       # Pydantic模式
│   │   ├── calculator.py    # 碳排放计算引擎
│   │   ├── celery_app.py    # Celery配置
│   │   ├── tasks.py         # 异步任务
│   │   └── report.py        # PDF报告生成
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── App.js
│   └── package.json
└── docker-compose.yml
```
