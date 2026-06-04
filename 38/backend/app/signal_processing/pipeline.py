"""预处理流水线模块。

提供可配置的信号预处理流水线，整合去噪、切片和归一化功能。

主要功能:
    - SignalProcessor: 信号处理器类，支持完整预处理流程
"""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Union

import numpy as np

from .denoise import wavelet_denoise, moving_average_denoise, highpass_filter
from .slicing import sliding_window
from .normalization import standardize, min_max_normalize


@dataclass
class SignalProcessor:
    """信号预处理流水线。

    整合去噪、高通滤波、滑动窗口切片和归一化的完整预处理流程。

    参数:
        denoise_method: 去噪方法，可选值:
            - 'wavelet': 小波去噪
            - 'moving_average': 移动平均滤波
            - None: 不去噪
        wavelet_params: 小波去噪参数字典
            示例: {'wavelet': 'db4', 'level': 3, 'threshold_mode': 'soft'}
        moving_average_params: 移动平均滤波参数字典
            示例: {'window_size': 5, 'mode': 'same'}
        apply_highpass: 是否应用高通滤波去除基线漂移，默认为True
        highpass_params: 高通滤波参数字典
            示例: {'cutoff_freq': 0.5, 'order': 4}
        window_size: 滑动窗口大小，默认为10240
        hop_size: 滑动窗口步长，默认为5120
        normalization_method: 归一化方法，可选值:
            - 'standardize': Z-score标准化
            - 'min_max': 最小最大归一化
            - None: 不归一化
        normalization_params: 归一化参数字典
            对于'standardize': {'axis': None, 'eps': 1e-10}
            对于'min_max': {'axis': None, 'feature_range': (0.0, 1.0), 'eps': 1e-10}

    示例:
        >>> import numpy as np
        >>> from app.signal_processing import SignalProcessor
        >>> processor = SignalProcessor(
        ...     denoise_method='wavelet',
        ...     window_size=1024,
        ...     hop_size=512,
        ...     normalization_method='standardize'
        ... )
        >>> signal = np.random.randn(10000)
        >>> segments = processor.process(signal, sample_rate=1000)
        >>> segments.shape
        (18, 1024)
    """

    denoise_method: Optional[str] = 'wavelet'
    wavelet_params: Dict[str, Any] = field(default_factory=lambda: {
        'wavelet': 'db4',
        'level': 3,
        'threshold_mode': 'soft',
    })
    moving_average_params: Dict[str, Any] = field(default_factory=lambda: {
        'window_size': 5,
        'mode': 'same',
    })
    apply_highpass: bool = True
    highpass_params: Dict[str, Any] = field(default_factory=lambda: {
        'cutoff_freq': 0.5,
        'order': 4,
    })
    window_size: int = 10240
    hop_size: int = 5120
    normalization_method: Optional[str] = 'standardize'
    normalization_params: Dict[str, Any] = field(default_factory=lambda: {
        'axis': None,
        'eps': 1e-10,
    })

    def __post_init__(self) -> None:
        """初始化后验证参数。"""
        valid_denoise_methods = {'wavelet', 'moving_average', None}
        if self.denoise_method not in valid_denoise_methods:
            raise ValueError(
                f"无效的去噪方法: {self.denoise_method}. "
                f"可选值: {valid_denoise_methods}"
            )

        valid_norm_methods = {'standardize', 'min_max', None}
        if self.normalization_method not in valid_norm_methods:
            raise ValueError(
                f"无效的归一化方法: {self.normalization_method}. "
                f"可选值: {valid_norm_methods}"
            )

        if self.window_size < 1:
            raise ValueError(f"窗口大小必须大于等于1，当前为{self.window_size}")

        if self.hop_size < 1:
            raise ValueError(f"步长必须大于等于1，当前为{self.hop_size}")

    def _validate_signal(self, signal: np.ndarray) -> None:
        """验证输入信号。"""
        if not isinstance(signal, np.ndarray):
            raise TypeError("输入信号必须是numpy数组")

        if signal.ndim != 1:
            raise ValueError(
                f"输入信号必须是一维数组，当前维度为{signal.ndim}"
            )

        if len(signal) == 0:
            raise ValueError("输入信号不能为空")

        if self.window_size > len(signal):
            raise ValueError(
                f"窗口大小({self.window_size})不能大于信号长度({len(signal)})"
            )

    def _denoise(self, signal: np.ndarray) -> np.ndarray:
        """对信号进行去噪。"""
        if self.denoise_method == 'wavelet':
            return wavelet_denoise(signal, **self.wavelet_params)
        elif self.denoise_method == 'moving_average':
            return moving_average_denoise(signal, **self.moving_average_params)
        else:
            return signal

    def _highpass_filter(self, signal: np.ndarray, sample_rate: float) -> np.ndarray:
        """应用高通滤波。"""
        if self.apply_highpass:
            return highpass_filter(
                signal,
                sample_rate=sample_rate,
                **self.highpass_params,
            )
        else:
            return signal

    def _normalize(self, segments: np.ndarray) -> np.ndarray:
        """对切片后的信号进行归一化。"""
        if self.normalization_method == 'standardize':
            return standardize(segments, **self.normalization_params)
        elif self.normalization_method == 'min_max':
            return min_max_normalize(segments, **self.normalization_params)
        else:
            return segments

    def process(
        self,
        signal: np.ndarray,
        sample_rate: float,
    ) -> np.ndarray:
        """执行完整的信号预处理流程。

        处理步骤:
            1. 验证输入信号
            2. 高通滤波（可选）
            3. 去噪（可选）
            4. 滑动窗口切片
            5. 归一化（可选）

        参数:
            signal: 输入一维振动信号
            sample_rate: 信号采样率，单位Hz

        返回:
            预处理后的信号片段，形状为(N, window_size)

        异常:
            ValueError: 输入信号无效或参数配置错误时
            TypeError: 输入信号类型错误时
        """
        self._validate_signal(signal)

        if sample_rate <= 0:
            raise ValueError(f"采样率必须大于0，当前为{sample_rate}")

        processed = signal

        processed = self._highpass_filter(processed, sample_rate)

        processed = self._denoise(processed)

        segments = sliding_window(
            processed,
            window_size=self.window_size,
            hop_size=self.hop_size,
        )

        segments = self._normalize(segments)

        return segments

    def __call__(
        self,
        signal: np.ndarray,
        sample_rate: float,
    ) -> np.ndarray:
        """使类实例可调用，与process方法相同。"""
        return self.process(signal, sample_rate)
