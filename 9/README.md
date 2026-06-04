# Video Super-Resolution HTTP Service

视频超分辨率HTTP服务，使用深度学习模型（ESPCN/EDSR）进行2倍/4倍放大。

## 功能特性

- **多模型支持**: ESPCN (快速) 和 EDSR (高质量)
- **多精度推理**: FP32, FP16, INT8 自动选择
- **动态精度选择**: 根据视频复杂度和GPU负载自动选择最优精度
- **多推理后端**: ONNX Runtime (CPU回退) + TensorRT (GPU加速)
- **异步处理**: 任务队列 + task_id 轮询机制
- **音视频同步**: 保持原始帧率，自动提取/合并音频
- **硬件感知**: 自动检测GPU/CPU并选择最优后端

## 安装依赖

```bash
pip install -r requirements.txt
```

### 可选依赖

- **GPU支持**: 安装 CUDA, cuDNN, TensorRT
- **音频处理**: 安装 ffmpeg (用于音频提取/合并)

## 快速开始

1. **启动服务**:

```bash
python main.py
```

2. **访问API文档**: http://localhost:8000/docs

## API 使用

### 1. 上传视频并提交任务

```bash
curl -X POST "http://localhost:8000/upload?model=espcn&scale=2" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@input_video.mp4"
```

响应:
```json
{
  "task_id": "abc123-...",
  "message": "Video uploaded successfully, processing started"
}
```

### 2. 查询任务状态

```bash
curl "http://localhost:8000/status/{task_id}"
```

响应:
```json
{
  "task_id": "abc123-...",
  "status": "processing",
  "progress": 0.45,
  "message": "Processing frame 450/1000",
  "created_at": "2024-01-01T00:00:00",
  "started_at": "2024-01-01T00:00:05",
  "completed_at": null,
  "result": null,
  "error": null
}
```

### 3. 下载处理后的视频

```bash
curl -o output_video.mp4 "http://localhost:8000/download/{task_id}"
```

### 4. 查询队列状态

```bash
curl "http://localhost:8000/queue"
```

### 5. 取消任务

```bash
curl -X POST "http://localhost:8000/cancel/{task_id}"
```

## 配置

在 `config.py` 中可配置:

- 模型路径
- 上传/输出目录
- 队列大小和worker数量
- GPU内存阈值
- 视频复杂度阈值

## 项目结构

```
.
├── main.py              # 主入口
├── api.py               # FastAPI服务
├── config.py            # 配置文件
├── inference_engine.py  # 推理引擎 (ONNX/TensorRT)
├── precision_selector.py # 动态精度选择器
├── video_processor.py   # 视频处理模块
├── task_queue.py        # 任务队列系统
├── requirements.txt     # 依赖列表
├── models/              # 模型文件目录
├── uploads/             # 上传文件目录
├── outputs/             # 输出文件目录
└── temp/                # 临时文件目录
```

## 模型准备

将ONNX模型文件放入 `models/` 目录:
- `espcn_x2.onnx`, `espcn_x4.onnx`
- `edsr_x2.onnx`, `edsr_x4.onnx`

如果没有模型文件，服务会使用双三次插值（bicubic）作为降级方案。
