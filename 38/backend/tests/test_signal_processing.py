"""信号处理模块单元测试。"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np
import pytest

from app.signal_processing import (
    wavelet_denoise,
    moving_average_denoise,
    highpass_filter,
    sliding_window,
    standardize,
    min_max_normalize,
    SignalProcessor,
)


class TestDenoise:
    """去噪模块测试类。"""

    @pytest.fixture
    def noisy_signal(self) -> np.ndarray:
        """生成含噪声的测试信号。"""
        np.random.seed(42)
        t = np.linspace(0, 1, 1000)
        clean = np.sin(2 * np.pi * 10 * t)
        noise = 0.5 * np.random.randn(len(t))
        return clean + noise

    def test_wavelet_denoise_basic(self, noisy_signal: np.ndarray) -> None:
        """测试小波去噪基本功能。"""
        denoised = wavelet_denoise(noisy_signal, wavelet='db4', level=3)

        assert denoised.shape == noisy_signal.shape
        assert np.isfinite(denoised).all()

        noise_var_before = np.var(noisy_signal - np.sin(2 * np.pi * 10 * np.linspace(0, 1, 1000)))
        noise_var_after = np.var(denoised - np.sin(2 * np.pi * 10 * np.linspace(0, 1, 1000)))
        assert noise_var_after < noise_var_before

    def test_wavelet_denoise_hard_threshold(self, noisy_signal: np.ndarray) -> None:
        """测试小波去噪硬阈值模式。"""
        denoised = wavelet_denoise(noisy_signal, threshold_mode='hard')
        assert denoised.shape == noisy_signal.shape
        assert np.isfinite(denoised).all()

    def test_wavelet_denoise_invalid_input(self) -> None:
        """测试小波去噪无效输入处理。"""
        with pytest.raises(TypeError):
            wavelet_denoise([1, 2, 3])

        with pytest.raises(ValueError):
            wavelet_denoise(np.array([]))

        with pytest.raises(ValueError):
            wavelet_denoise(np.array([[1, 2], [3, 4]]))

        with pytest.raises(ValueError):
            wavelet_denoise(np.array([1.0, 2.0, 3.0]), level=0)

        with pytest.raises(ValueError):
            wavelet_denoise(np.array([1.0, 2.0, 3.0]), threshold_mode='invalid')

        with pytest.raises(ValueError):
            wavelet_denoise(np.array([1.0, 2.0, 3.0]), wavelet='invalid_wavelet')

    def test_moving_average_denoise_basic(self, noisy_signal: np.ndarray) -> None:
        """测试移动平均滤波基本功能。"""
        denoised = moving_average_denoise(noisy_signal, window_size=5)

        assert denoised.shape == noisy_signal.shape
        assert np.isfinite(denoised).all()

        assert np.std(denoised) < np.std(noisy_signal)

    def test_moving_average_denoise_valid_mode(self, noisy_signal: np.ndarray) -> None:
        """测试移动平均滤波valid模式。"""
        window_size = 5
        denoised = moving_average_denoise(noisy_signal, window_size=window_size, mode='valid')

        expected_len = len(noisy_signal) - window_size + 1
        assert denoised.shape == (expected_len,)
        assert np.isfinite(denoised).all()

    def test_moving_average_denoise_invalid_input(self) -> None:
        """测试移动平均滤波无效输入处理。"""
        with pytest.raises(TypeError):
            moving_average_denoise([1, 2, 3])

        with pytest.raises(ValueError):
            moving_average_denoise(np.array([]))

        with pytest.raises(ValueError):
            moving_average_denoise(np.array([[1, 2], [3, 4]]))

        with pytest.raises(ValueError):
            moving_average_denoise(np.array([1.0, 2.0, 3.0]), window_size=0)

        with pytest.raises(ValueError):
            moving_average_denoise(np.array([1.0, 2.0, 3.0]), window_size=10)

        with pytest.raises(ValueError):
            moving_average_denoise(np.array([1.0, 2.0, 3.0]), mode='invalid')

    def test_highpass_filter_basic(self) -> None:
        """测试高通滤波基本功能。"""
        t = np.linspace(0, 1, 1000)
        signal = 2.0 + np.sin(2 * np.pi * 50 * t)

        filtered = highpass_filter(signal, sample_rate=1000, cutoff_freq=1.0)

        assert filtered.shape == signal.shape
        assert np.isfinite(filtered).all()

        assert np.abs(np.mean(filtered)) < 0.1

    def test_highpass_filter_remove_dc(self) -> None:
        """测试高通滤波去除直流分量。"""
        t = np.linspace(0, 1, 10000)
        signal = 5.0 + np.sin(2 * np.pi * 10 * t)

        filtered = highpass_filter(signal, sample_rate=1000, cutoff_freq=0.5)

        assert np.abs(np.mean(filtered)) < 0.01
        assert np.max(np.abs(filtered)) > 0.5

    def test_highpass_filter_invalid_input(self) -> None:
        """测试高通滤波无效输入处理。"""
        with pytest.raises(TypeError):
            highpass_filter([1, 2, 3], sample_rate=100)

        with pytest.raises(ValueError):
            highpass_filter(np.array([]), sample_rate=100)

        with pytest.raises(ValueError):
            highpass_filter(np.array([[1, 2], [3, 4]]), sample_rate=100)

        with pytest.raises(ValueError):
            highpass_filter(np.array([1.0, 2.0, 3.0]), sample_rate=0)

        with pytest.raises(ValueError):
            highpass_filter(np.array([1.0, 2.0, 3.0]), sample_rate=100, cutoff_freq=0)

        with pytest.raises(ValueError):
            highpass_filter(np.array([1.0, 2.0, 3.0]), sample_rate=100, cutoff_freq=60)

        with pytest.raises(ValueError):
            highpass_filter(np.array([1.0, 2.0, 3.0]), sample_rate=100, order=0)


class TestSlicing:
    """切片模块测试类。"""

    @pytest.fixture
    def long_signal(self) -> np.ndarray:
        """生成较长的测试信号。"""
        np.random.seed(42)
        return np.random.randn(100000)

    def test_sliding_window_basic(self, long_signal: np.ndarray) -> None:
        """测试滑动窗口基本功能。"""
        window_size = 1024
        hop_size = 512
        segments = sliding_window(long_signal, window_size=window_size, hop_size=hop_size)

        expected_num = (len(long_signal) - window_size) // hop_size + 1
        assert segments.shape == (expected_num, window_size)
        assert np.isfinite(segments).all()

    def test_sliding_window_no_overlap(self, long_signal: np.ndarray) -> None:
        """测试无重叠滑动窗口。"""
        window_size = 1000
        hop_size = 1000
        segments = sliding_window(long_signal, window_size=window_size, hop_size=hop_size)

        expected_num = len(long_signal) // window_size
        assert segments.shape == (expected_num, window_size)

        for i in range(expected_num):
            start = i * window_size
            end = start + window_size
            np.testing.assert_array_equal(segments[i], long_signal[start:end])

    def test_sliding_window_overlap(self, long_signal: np.ndarray) -> None:
        """测试重叠滑动窗口。"""
        window_size = 1000
        hop_size = 500
        segments = sliding_window(long_signal, window_size=window_size, hop_size=hop_size)

        np.testing.assert_array_equal(segments[0][500:1000], segments[1][0:500])

    def test_sliding_window_dtype(self, long_signal: np.ndarray) -> None:
        """测试滑动窗口输出数据类型。"""
        segments = sliding_window(long_signal, window_size=1024, hop_size=512, dtype=np.float32)
        assert segments.dtype == np.float32

    def test_sliding_window_invalid_input(self, long_signal: np.ndarray) -> None:
        """测试滑动窗口无效输入处理。"""
        with pytest.raises(TypeError):
            sliding_window([1, 2, 3])

        with pytest.raises(ValueError):
            sliding_window(np.array([]))

        with pytest.raises(ValueError):
            sliding_window(np.array([[1, 2], [3, 4]]))

        with pytest.raises(ValueError):
            sliding_window(long_signal, window_size=0)

        with pytest.raises(ValueError):
            sliding_window(long_signal, hop_size=0)

        with pytest.raises(ValueError):
            sliding_window(np.array([1, 2, 3]), window_size=10)


class TestNormalization:
    """归一化模块测试类。"""

    @pytest.fixture
    def test_signal(self) -> np.ndarray:
        """生成测试信号。"""
        return np.array([1.0, 2.0, 3.0, 4.0, 5.0])

    def test_standardize_basic(self, test_signal: np.ndarray) -> None:
        """测试Z-score标准化基本功能。"""
        standardized = standardize(test_signal)

        assert np.abs(np.mean(standardized)) < 1e-10
        assert np.abs(np.std(standardized) - 1.0) < 1e-10

    def test_standardize_2d(self) -> None:
        """测试二维信号标准化。"""
        signal = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
        standardized = standardize(signal)

        assert np.abs(np.mean(standardized)) < 1e-10
        assert np.abs(np.std(standardized) - 1.0) < 1e-10

    def test_standardize_axis(self) -> None:
        """测试按轴标准化。"""
        signal = np.array([[1.0, 100.0], [2.0, 200.0], [3.0, 300.0]])
        standardized = standardize(signal, axis=0)

        assert standardized.shape == signal.shape
        for i in range(signal.shape[1]):
            assert np.abs(np.mean(standardized[:, i])) < 1e-10
            assert np.abs(np.std(standardized[:, i]) - 1.0) < 1e-10

    def test_standardize_constant_signal(self) -> None:
        """测试恒定信号标准化（避免除零）。"""
        signal = np.array([5.0, 5.0, 5.0])
        standardized = standardize(signal)

        assert np.isfinite(standardized).all()
        assert np.all(standardized == 0.0)

    def test_standardize_invalid_input(self) -> None:
        """测试标准化无效输入处理。"""
        with pytest.raises(TypeError):
            standardize([1, 2, 3])

        with pytest.raises(ValueError):
            standardize(np.array([]))

        with pytest.raises(ValueError):
            standardize(np.array([[[1, 2], [3, 4]]]))

    def test_min_max_normalize_basic(self, test_signal: np.ndarray) -> None:
        """测试最小最大归一化基本功能。"""
        normalized = min_max_normalize(test_signal)

        assert np.abs(np.min(normalized)) < 1e-9
        assert np.abs(np.max(normalized) - 1.0) < 1e-9

    def test_min_max_normalize_custom_range(self, test_signal: np.ndarray) -> None:
        """测试自定义范围归一化。"""
        normalized = min_max_normalize(test_signal, feature_range=(-1.0, 1.0))

        assert np.abs(np.min(normalized) + 1.0) < 1e-9
        assert np.abs(np.max(normalized) - 1.0) < 1e-9

    def test_min_max_normalize_2d_axis(self) -> None:
        """测试二维信号按行归一化。"""
        signal = np.array([[1.0, 2.0, 3.0], [10.0, 20.0, 30.0]])
        normalized = min_max_normalize(signal, axis=1)

        assert normalized.shape == signal.shape
        for i in range(signal.shape[0]):
            assert np.abs(np.min(normalized[i])) < 1e-9
            assert np.abs(np.max(normalized[i]) - 1.0) < 1e-9

    def test_min_max_normalize_constant_signal(self) -> None:
        """测试恒定信号归一化（避免除零）。"""
        signal = np.array([5.0, 5.0, 5.0])
        normalized = min_max_normalize(signal)

        assert np.isfinite(normalized).all()

    def test_min_max_normalize_invalid_input(self) -> None:
        """测试最小最大归一化无效输入处理。"""
        with pytest.raises(TypeError):
            min_max_normalize([1, 2, 3])

        with pytest.raises(ValueError):
            min_max_normalize(np.array([]))

        with pytest.raises(ValueError):
            min_max_normalize(np.array([[[1, 2], [3, 4]]]))

        with pytest.raises(ValueError):
            min_max_normalize(np.array([1.0, 2.0, 3.0]), feature_range=(1.0, 1.0))

        with pytest.raises(ValueError):
            min_max_normalize(np.array([1.0, 2.0, 3.0]), feature_range=(1.0,))


class TestPipeline:
    """预处理流水线测试类。"""

    @pytest.fixture
    def vibration_signal(self) -> np.ndarray:
        """生成模拟振动信号。"""
        np.random.seed(42)
        t = np.linspace(0, 10, 50000)
        signal = (
            np.sin(2 * np.pi * 10 * t)
            + 0.5 * np.sin(2 * np.pi * 50 * t)
            + 0.2 * np.random.randn(len(t))
            + 1.0
        )
        return signal

    def test_signal_processor_init(self) -> None:
        """测试SignalProcessor初始化。"""
        processor = SignalProcessor(
            denoise_method='wavelet',
            window_size=1024,
            hop_size=512,
            normalization_method='standardize',
        )
        assert processor.denoise_method == 'wavelet'
        assert processor.window_size == 1024
        assert processor.hop_size == 512

    def test_signal_processor_invalid_init(self) -> None:
        """测试SignalProcessor无效初始化。"""
        with pytest.raises(ValueError):
            SignalProcessor(denoise_method='invalid')

        with pytest.raises(ValueError):
            SignalProcessor(normalization_method='invalid')

        with pytest.raises(ValueError):
            SignalProcessor(window_size=0)

        with pytest.raises(ValueError):
            SignalProcessor(hop_size=0)

    def test_signal_processor_process_wavelet(
        self, vibration_signal: np.ndarray
    ) -> None:
        """测试小波去噪模式的完整处理流程。"""
        processor = SignalProcessor(
            denoise_method='wavelet',
            apply_highpass=True,
            window_size=1024,
            hop_size=512,
            normalization_method='standardize',
        )

        segments = processor.process(vibration_signal, sample_rate=5000)

        expected_num = (len(vibration_signal) - 1024) // 512 + 1
        assert segments.shape == (expected_num, 1024)
        assert np.isfinite(segments).all()

        assert np.abs(np.mean(segments)) < 1e-5

    def test_signal_processor_process_moving_average(
        self, vibration_signal: np.ndarray
    ) -> None:
        """测试移动平均滤波模式的完整处理流程。"""
        processor = SignalProcessor(
            denoise_method='moving_average',
            moving_average_params={'window_size': 5, 'mode': 'same'},
            apply_highpass=True,
            window_size=1024,
            hop_size=512,
            normalization_method='min_max',
            normalization_params={'feature_range': (0.0, 1.0)},
        )

        segments = processor.process(vibration_signal, sample_rate=5000)

        assert segments.shape[1] == 1024
        assert np.isfinite(segments).all()
        assert np.min(segments) >= 0.0
        assert np.max(segments) <= 1.0

    def test_signal_processor_process_no_denoise(
        self, vibration_signal: np.ndarray
    ) -> None:
        """测试不进行去噪的处理流程。"""
        processor = SignalProcessor(
            denoise_method=None,
            apply_highpass=False,
            window_size=1024,
            hop_size=512,
            normalization_method=None,
        )

        segments = processor.process(vibration_signal, sample_rate=5000)

        assert segments.shape[1] == 1024
        assert np.isfinite(segments).all()

    def test_signal_processor_callable(
        self, vibration_signal: np.ndarray
    ) -> None:
        """测试SignalProcessor可调用接口。"""
        processor = SignalProcessor(
            denoise_method='wavelet',
            window_size=1024,
            hop_size=512,
            normalization_method='standardize',
        )

        segments1 = processor.process(vibration_signal, sample_rate=5000)
        segments2 = processor(vibration_signal, sample_rate=5000)

        np.testing.assert_array_equal(segments1, segments2)

    def test_signal_processor_invalid_signal(
        self, vibration_signal: np.ndarray
    ) -> None:
        """测试无效输入信号处理。"""
        processor = SignalProcessor(
            window_size=1024,
            hop_size=512,
        )

        with pytest.raises(TypeError):
            processor.process([1, 2, 3], sample_rate=100)

        with pytest.raises(ValueError):
            processor.process(np.array([]), sample_rate=100)

        with pytest.raises(ValueError):
            processor.process(np.array([[1, 2], [3, 4]]), sample_rate=100)

        with pytest.raises(ValueError):
            processor.process(vibration_signal, sample_rate=0)

        short_signal = np.random.randn(100)
        with pytest.raises(ValueError):
            processor.process(short_signal, sample_rate=100)

    def test_signal_processor_reproducibility(
        self, vibration_signal: np.ndarray
    ) -> None:
        """测试处理结果可重复性。"""
        processor1 = SignalProcessor(
            denoise_method='wavelet',
            window_size=1024,
            hop_size=512,
            normalization_method='standardize',
        )

        processor2 = SignalProcessor(
            denoise_method='wavelet',
            window_size=1024,
            hop_size=512,
            normalization_method='standardize',
        )

        segments1 = processor1.process(vibration_signal, sample_rate=5000)
        segments2 = processor2.process(vibration_signal, sample_rate=5000)

        np.testing.assert_array_equal(segments1, segments2)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
