"""信号切片模块。

提供滑动窗口切片功能，将长信号切割成固定长度的片段，用于后续特征提取。

主要功能:
    - sliding_window: 滑动窗口切片，支持重叠切片
"""

from typing import Tuple

import numpy as np


def sliding_window(
    signal: np.ndarray,
    window_size: int = 10240,
    hop_size: int = 5120,
    dtype: type = np.float64,
) -> np.ndarray:
    """滑动窗口切片。

    将一维信号按滑动窗口方式切割成多个固定长度的片段，支持重叠。

    参数:
        signal: 输入一维信号数组
        window_size: 窗口大小，默认为10240个采样点
        hop_size: 步长，即相邻窗口的起始位置间隔，默认为5120
            当hop_size < window_size时为重叠切片
        dtype: 输出数组的数据类型，默认为np.float64

    返回:
        切片后的二维数组，形状为(N, window_size)
        N = floor((len(signal) - window_size) / hop_size) + 1

    异常:
        ValueError: 输入信号为空、维度不正确或参数无效时
        TypeError: 输入信号不是numpy数组时

    示例:
        >>> import numpy as np
        >>> from app.signal_processing import sliding_window
        >>> signal = np.random.randn(100000)
        >>> segments = sliding_window(signal, window_size=10240, hop_size=5120)
        >>> segments.shape
        (18, 10240)
    """
    if not isinstance(signal, np.ndarray):
        raise TypeError("输入信号必须是numpy数组")

    if signal.ndim != 1:
        raise ValueError(f"输入信号必须是一维数组，当前维度为{signal.ndim}")

    if len(signal) == 0:
        raise ValueError("输入信号不能为空")

    if window_size < 1:
        raise ValueError(f"窗口大小必须大于等于1，当前为{window_size}")

    if hop_size < 1:
        raise ValueError(f"步长必须大于等于1，当前为{hop_size}")

    if window_size > len(signal):
        raise ValueError(
            f"窗口大小({window_size})不能大于信号长度({len(signal)})"
        )

    signal_len = len(signal)
    num_segments = (signal_len - window_size) // hop_size + 1

    if num_segments <= 0:
        raise ValueError(
            f"参数设置无法生成任何片段，请减小window_size或增大hop_size"
        )

    segments = np.zeros((num_segments, window_size), dtype=dtype)

    for i in range(num_segments):
        start = i * hop_size
        end = start + window_size
        segments[i] = signal[start:end].astype(dtype)

    return segments
