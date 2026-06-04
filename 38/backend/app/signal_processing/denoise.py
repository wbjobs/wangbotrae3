"""信号去噪模块。

提供多种信号去噪方法，适用于工业振动信号预处理。

主要功能:
    - wavelet_denoise: 基于PyWavelets的软阈值小波去噪
    - moving_average_denoise: 移动平均滤波
    - highpass_filter: 高通滤波，用于去除基线漂移
"""

from typing import Optional

import numpy as np
import pywt
from scipy import signal as scipy_signal


def wavelet_denoise(
    signal: np.ndarray,
    wavelet: str = 'db4',
    level: int = 3,
    threshold_mode: str = 'soft',
) -> np.ndarray:
    """使用小波变换对信号进行去噪。

    采用离散小波变换(DWT)分解信号，对高频系数进行软阈值处理后重构信号，
    可有效去除高斯噪声等随机噪声。

    参数:
        signal: 输入一维信号数组
        wavelet: 小波基函数名称，默认为'db4'
            常用小波: 'db1'-'db20'(Daubechies), 'sym1'-'sym20'(Symlets),
            'coif1'-'coif5'(Coiflets), 'haar'
        level: 小波分解层数，默认为3
            层数越大，去噪效果越强，但可能损失细节
        threshold_mode: 阈值模式，'soft'(软阈值)或'hard'(硬阈值)，默认为'soft'

    返回:
        去噪后的信号数组，形状与输入相同

    异常:
        ValueError: 输入信号为空、维度不正确或参数无效时
        TypeError: 输入信号不是numpy数组时

    示例:
        >>> import numpy as np
        >>> from app.signal_processing import wavelet_denoise
        >>> signal = np.sin(np.linspace(0, 10, 1000)) + 0.5 * np.random.randn(1000)
        >>> denoised = wavelet_denoise(signal, wavelet='db4', level=3)
        >>> denoised.shape
        (1000,)
    """
    if not isinstance(signal, np.ndarray):
        raise TypeError("输入信号必须是numpy数组")

    if signal.ndim != 1:
        raise ValueError(f"输入信号必须是一维数组，当前维度为{signal.ndim}")

    if len(signal) == 0:
        raise ValueError("输入信号不能为空")

    if level < 1:
        raise ValueError(f"分解层数必须大于等于1，当前为{level}")

    if threshold_mode not in ('soft', 'hard'):
        raise ValueError(f"阈值模式必须是'soft'或'hard'，当前为{threshold_mode}")

    try:
        coeffs = pywt.wavedec(signal, wavelet, level=level)
    except ValueError as e:
        raise ValueError(f"无效的小波基函数'{wavelet}': {e}") from e

    sigma = np.median(np.abs(coeffs[-1])) / 0.6745
    threshold = sigma * np.sqrt(2 * np.log(len(signal)))

    new_coeffs = list(coeffs)
    for i in range(1, len(new_coeffs)):
        new_coeffs[i] = pywt.threshold(
            new_coeffs[i], threshold, mode=threshold_mode
        )

    denoised = pywt.waverec(new_coeffs, wavelet)

    if len(denoised) > len(signal):
        denoised = denoised[:len(signal)]

    return denoised


def moving_average_denoise(
    signal: np.ndarray,
    window_size: int = 5,
    mode: str = 'same',
) -> np.ndarray:
    """移动平均滤波去噪。

    通过滑动窗口计算平均值来平滑信号，可有效去除高频噪声。

    参数:
        signal: 输入一维信号数组
        window_size: 滑动窗口大小，默认为5
            窗口越大，平滑效果越强，但可能模糊信号特征
        mode: 边界处理模式，默认为'same'
            'same': 输出与输入长度相同
            'valid': 仅输出完全重叠部分，长度为len(signal)-window_size+1

    返回:
        去噪后的信号数组

    异常:
        ValueError: 输入信号为空、维度不正确或参数无效时
        TypeError: 输入信号不是numpy数组时

    示例:
        >>> import numpy as np
        >>> from app.signal_processing import moving_average_denoise
        >>> signal = np.sin(np.linspace(0, 10, 1000)) + 0.5 * np.random.randn(1000)
        >>> denoised = moving_average_denoise(signal, window_size=5)
        >>> denoised.shape
        (1000,)
    """
    if not isinstance(signal, np.ndarray):
        raise TypeError("输入信号必须是numpy数组")

    if signal.ndim != 1:
        raise ValueError(f"输入信号必须是一维数组，当前维度为{signal.ndim}")

    if len(signal) == 0:
        raise ValueError("输入信号不能为空")

    if window_size < 1:
        raise ValueError(f"窗口大小必须大于等于1，当前为{window_size}")

    if window_size > len(signal):
        raise ValueError(
            f"窗口大小({window_size})不能大于信号长度({len(signal)})"
        )

    if mode not in ('same', 'valid'):
        raise ValueError(f"模式必须是'same'或'valid'，当前为{mode}")

    kernel = np.ones(window_size) / window_size
    denoised = np.convolve(signal, kernel, mode=mode)

    return denoised


def highpass_filter(
    signal: np.ndarray,
    sample_rate: float,
    cutoff_freq: float = 0.5,
    order: int = 4,
) -> np.ndarray:
    """高通滤波，用于去除信号的基线漂移和低频干扰。

    基于Butterworth滤波器设计，可有效去除振动信号中的直流分量和低频漂移。

    参数:
        signal: 输入一维信号数组
        sample_rate: 信号采样率，单位Hz
        cutoff_freq: 截止频率，单位Hz，默认为0.5Hz
        order: 滤波器阶数，默认为4
            阶数越高，截止特性越陡峭，但相位失真越大

    返回:
        滤波后的信号数组，形状与输入相同

    异常:
        ValueError: 输入信号为空、维度不正确或参数无效时
        TypeError: 输入信号不是numpy数组时

    示例:
        >>> import numpy as np
        >>> from app.signal_processing import highpass_filter
        >>> signal = np.sin(np.linspace(0, 10, 1000)) + 2  # 含直流分量
        >>> filtered = highpass_filter(signal, sample_rate=100, cutoff_freq=0.5)
        >>> filtered.shape
        (1000,)
    """
    if not isinstance(signal, np.ndarray):
        raise TypeError("输入信号必须是numpy数组")

    if signal.ndim != 1:
        raise ValueError(f"输入信号必须是一维数组，当前维度为{signal.ndim}")

    if len(signal) == 0:
        raise ValueError("输入信号不能为空")

    if sample_rate <= 0:
        raise ValueError(f"采样率必须大于0，当前为{sample_rate}")

    if cutoff_freq <= 0:
        raise ValueError(f"截止频率必须大于0，当前为{cutoff_freq}")

    if cutoff_freq >= sample_rate / 2:
        raise ValueError(
            f"截止频率({cutoff_freq}Hz)必须小于奈奎斯特频率({sample_rate/2}Hz)"
        )

    if order < 1:
        raise ValueError(f"滤波器阶数必须大于等于1，当前为{order}")

    nyquist = sample_rate / 2
    normal_cutoff = cutoff_freq / nyquist

    b, a = scipy_signal.butter(order, normal_cutoff, btype='high', analog=False)
    filtered = scipy_signal.filtfilt(b, a, signal)

    return filtered
