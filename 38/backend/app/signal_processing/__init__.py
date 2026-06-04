"""工业振动信号特征预处理模块。

该模块提供完整的振动信号预处理功能，包括去噪、切片、归一化和完整的预处理流水线。

主要功能:
    - 去噪: 小波去噪、移动平均滤波、高通滤波
    - 切片: 滑动窗口切片，支持重叠
    - 归一化: Z-score标准化、最小最大归一化
    - 流水线: 可配置的完整预处理流程

示例:
    >>> from app.signal_processing import SignalProcessor
    >>> processor = SignalProcessor(
    ...     denoise_method='wavelet',
    ...     window_size=10240,
    ...     hop_size=5120,
    ...     normalization_method='standardize'
    ... )
    >>> processed_segments = processor.process(signal, sample_rate=1000)
"""

from .denoise import wavelet_denoise, moving_average_denoise, highpass_filter
from .slicing import sliding_window
from .normalization import standardize, min_max_normalize
from .pipeline import SignalProcessor

__all__ = [
    'wavelet_denoise',
    'moving_average_denoise',
    'highpass_filter',
    'sliding_window',
    'standardize',
    'min_max_normalize',
    'SignalProcessor',
]

__version__ = '0.1.0'
