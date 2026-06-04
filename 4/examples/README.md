# 关键帧配置示例

本目录包含风格强度插值的配置示例。

## 配置文件格式

```json
{
  "interpolation": "linear" | "bezier",
  "keyframes": [
    { "frame": 0, "strength": 0.0 },
    { "frame": 100, "strength": 1.0 },
    { "frame": 200, "strength": 0.5 }
  ]
}
```

### 字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `interpolation` | 字符串 | 插值类型: `linear` (线性) 或 `bezier` (贝塞尔) |
| `keyframes` | 数组 | 关键帧列表 |
| `frame` | 整数 | 帧号 |
| `strength` | 浮点数 | 风格强度 (0.0 - 1.0) |

## 使用方法：

```bash
# 使用关键帧配置
cargo run --release -- \
  --input input.mp4 \
  --style style.jpg \
  --output output.mp4 \
  --keyframes examples/keyframes_fade_in.json
```

## 示例文件

### `keyframes_fade_in.json`
- 简单的淡入效果
- 第0帧: 0% 风格
- 第100帧: 100% 风格
- 线性插值

### `keyframes_fade_in_out.json`
- 淡入淡出效果
- 使用贝塞尔插值（更平滑的曲线
- 第0帧: 0%
- 第300帧: 100%
- 第600帧: 0%

### `keyframes_pulse.json`
- 脉冲效果
- 0.3 <-> 0.9 循环
- 每100帧变化一次
