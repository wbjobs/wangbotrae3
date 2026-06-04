"""信号归一化模块。

提供多种信号归一化方法，用于将信号缩放到标准范围，便于后续特征提取和模型训练。

主要功能:
    - standardize: Z-score标准化（减均值除标准差）
    - min_max_normalize: 最小最大归一化到[0,1]范围
"""

from typing import Optional, Tuple

import numpy as np


def standardize(
    signal: np.ndarray,
    axis: Optional[int] = None,
    eps: float = 1e-10,
) -> np.ndarray:
    """Z-score标准化。

    对信号进行标准化处理，使其均值为0，标准差为1。
    公式: normalized = (signal - mean) / (std + eps)

    参数:
        signal: 输入信号数组，可以是一维或二维
        axis: 计算均值和标准差的轴
            None: 对整个数组进行标准化
            0: 按列标准化（每列独立）
            1: 按行标准化（每行独立）
        eps: 防止除零的小常数，默认为1e-10

    返回:
        标准化后的信号数组，形状与输入相同

    异常:
        ValueError: 输入信号为空或维度不正确时
        TypeError: 输入信号不是numpy数组时

    示例:
        >>> import numpy as np
        >>> from app.signal_processing import standardize
        >>> signal = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        >>> standardized = standardize(signal)
        >>> np.mean(standardized)
        np.float64(0.0)
        >>> np.std(standardized)
        np.float64(1.0)
    """
    if not isinstance(signal, np.ndarray):
        raise TypeError("输入信号必须是numpy数组")

    if signal.size == 0:
        raise ValueError("输入信号不能为空")

    if signal.ndim not in (1, 2):
        raise ValueError(f"输入信号必须是一维或二维数组，当前维度为{signal.ndim}")

    mean = np.mean(signal, axis=axis, keepdims=True)
    std = np.std(signal, axis=axis, keepdims=True)

    normalized = (signal - mean) / (std + eps)

    return normalized


def min_max_normalize(
    signal: np.ndarray,
    axis: Optional[int] = None,
    feature_range: Tuple[float, float] = (0.0, 1.0),
    eps: float = 1e-10,
) -> np.ndarray:
    """最小最大归一化。

    将信号线性缩放到指定范围，默认为[0, 1]。
    公式: normalized = (signal - min) / (max - min + eps) * (high - low) + low

    参数:
        signal: 输入信号数组，可以是一维或二维
        axis: 计算最小和最大值的轴
            None: 对整个数组进行归一化
            0: 按列归一化（每列独立）
            1: 按行归一化（每行独立）
        feature_range: 归一化后的范围，默认为(0.0, 1.0)
        eps: 防止除零的小常数，默认为1e-10

    返回:
        归一化后的信号数组，形状与输入相同

    异常:
        ValueError: 输入信号为空、维度不正确或feature_range无效时
        TypeError: 输入信号不是numpy数组时

    示例:
        >>> import numpy as np
        >>> from app.signal_processing import min_max_normalize
        >>> signal = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        >>> normalized = min_max_normalize(signal)
        >>> np.min(normalized)
        np.float64(0.0)
        >>> np.max(normalized)
        np.float64(1.0)
    """
    if not isinstance(signal, np.ndarray):
        raise TypeError("输入信号必须是numpy数组")

    if signal.size == 0:
        raise ValueError("输入信号不能为空")

    if signal.ndim not in (1, 2):
        raise ValueError(f"输入信号必须是一维或二维数组，当前维度为{signal.ndim}")

    if len(feature_range) != 2:
        raise ValueError(f"feature_range必须是包含两个元素的元组，当前为{feature_range}")

    low, high = feature_range
    if low >= high:
        raise ValueError(f"feature_range的下界({low})必须小于上界({high})")

    min_val = np.min(signal, axis=axis, keepdims=True)
    max_val = np.max(signal, axis=axis, keepdims=True)

    normalized = (signal - min_val) / (max_val - min_val + eps)
    normalized = normalized * (high - low) + low

    return normalized
