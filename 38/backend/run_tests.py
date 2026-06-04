"""运行信号处理模块的所有测试。"""

import sys
import os
sys.path.insert(0, '.')

import numpy as np
from app.signal_processing import (
    wavelet_denoise,
    moving_average_denoise,
    highpass_filter,
    sliding_window,
    standardize,
    min_max_normalize,
    SignalProcessor,
)

def main():
    print('=== 模块导入成功！')

    # 测试去噪模块
    print('\n=== 测试去噪模块 ===')
    np.random.seed(42)
    t = np.linspace(0, 1, 1000)
    clean = np.sin(2 * np.pi * 10 * t)
    noise = 0.5 * np.random.randn(len(t))
    noisy_signal = clean + noise

    # 测试小波去噪
    denoised_wavelet = wavelet_denoise(noisy_signal, wavelet='db4', level=3)
    print(f'小波去噪: 输入形状 {noisy_signal.shape}, 输出形状 {denoised_wavelet.shape}')
    assert denoised_wavelet.shape == noisy_signal.shape
    assert np.isfinite(denoised_wavelet).all()
    print('  [OK] 小波去噪测试通过')

    # 测试硬阈值
    denoised_hard = wavelet_denoise(noisy_signal, threshold_mode='hard')
    assert denoised_hard.shape == noisy_signal.shape
    print('  [OK] 小波去噪硬阈值测试通过')

    # 测试移动平均去噪
    denoised_ma = moving_average_denoise(noisy_signal, window_size=5)
    print(f'移动平均去噪: 输入形状 {noisy_signal.shape}, 输出形状 {denoised_ma.shape}')
    assert denoised_ma.shape == noisy_signal.shape
    assert np.isfinite(denoised_ma).all()
    print('  [OK] 移动平均去噪测试通过')

    # 测试valid模式
    denoised_valid = moving_average_denoise(noisy_signal, window_size=5, mode='valid')
    assert denoised_valid.shape == (len(noisy_signal) - 5 + 1,)
    print('  [OK] 移动平均去噪valid模式测试通过')

    # 测试高通滤波
    dc_signal = 2.0 + np.sin(2 * np.pi * 50 * t)
    filtered = highpass_filter(dc_signal, sample_rate=1000, cutoff_freq=1.0)
    print(f'高通滤波: 输入形状 {dc_signal.shape}, 输出形状 {filtered.shape}')
    assert filtered.shape == dc_signal.shape
    assert np.abs(np.mean(filtered)) < 0.1
    print('  [OK] 高通滤波测试通过')

    # 测试去除直流分量
    dc_signal2 = 5.0 + np.sin(2 * np.pi * 10 * np.linspace(0, 10, 10000))
    filtered2 = highpass_filter(dc_signal2, sample_rate=1000, cutoff_freq=0.5)
    assert np.abs(np.mean(filtered2)) < 0.01
    print('  [OK] 高通滤波去除直流测试通过')

    # 测试切片模块
    print('\n=== 测试切片模块 ===')
    long_signal = np.random.randn(100000)
    segments = sliding_window(long_signal, window_size=1024, hop_size=512)
    expected_num = (len(long_signal) - 1024) // 512 + 1
    print(f'滑动窗口: 输入长度 {len(long_signal)}, 输出形状 {segments.shape}')
    assert segments.shape == (expected_num, 1024)
    assert np.isfinite(segments).all()
    print('  [OK] 滑动窗口测试通过')

    # 测试无重叠
    segments_no_overlap = sliding_window(long_signal, window_size=1000, hop_size=1000)
    expected_num_no = len(long_signal) // 1000
    assert segments_no_overlap.shape == (expected_num_no, 1000)
    print('  [OK] 无重叠滑动窗口测试通过')

    # 测试重叠
    segments_overlap = sliding_window(long_signal, window_size=1000, hop_size=500)
    np.testing.assert_array_equal(segments_overlap[0][500:1000], segments_overlap[1][0:500])
    print('  [OK] 重叠滑动窗口测试通过')

    # 测试数据类型
    segments_float32 = sliding_window(long_signal, window_size=1024, hop_size=512, dtype=np.float32)
    assert segments_float32.dtype == np.float32
    print('  [OK] 滑动窗口数据类型测试通过')

    # 测试归一化模块
    print('\n=== 测试归一化模块 ===')
    test_signal = np.array([1.0, 2.0, 3.0, 4.0, 5.0])

    # 测试Z-score标准化
    standardized = standardize(test_signal)
    print(f'Z-score标准化: 均值={np.mean(standardized):.6f}, 标准差={np.std(standardized):.6f}')
    assert np.abs(np.mean(standardized)) < 1e-10
    assert np.abs(np.std(standardized) - 1.0) < 1e-10
    print('  [OK] Z-score标准化测试通过')

    # 测试2D标准化
    signal_2d = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    standardized_2d = standardize(signal_2d)
    assert np.abs(np.mean(standardized_2d)) < 1e-10
    assert np.abs(np.std(standardized_2d) - 1.0) < 1e-10
    print('  [OK] 2D Z-score标准化测试通过')

    # 测试按轴标准化
    signal_axis = np.array([[1.0, 100.0], [2.0, 200.0], [3.0, 300.0]])
    standardized_axis = standardize(signal_axis, axis=0)
    for i in range(signal_axis.shape[1]):
        assert np.abs(np.mean(standardized_axis[:, i])) < 1e-9
        assert np.abs(np.std(standardized_axis[:, i]) - 1.0) < 1e-9
    print('  [OK] 按轴Z-score标准化测试通过')

    # 测试恒定信号
    constant_signal = np.array([5.0, 5.0, 5.0])
    standardized_const = standardize(constant_signal)
    assert np.isfinite(standardized_const).all()
    assert np.all(standardized_const == 0.0)
    print('  [OK] 恒定信号Z-score标准化测试通过')

    # 测试最小最大归一化
    normalized = min_max_normalize(test_signal)
    print(f'最小最大归一化: 最小值={np.min(normalized)}, 最大值={np.max(normalized)}')
    assert np.abs(np.min(normalized)) < 1e-9
    assert np.abs(np.max(normalized) - 1.0) < 1e-9
    print('  [OK] 最小最大归一化测试通过')

    # 测试自定义范围
    normalized_range = min_max_normalize(test_signal, feature_range=(-1.0, 1.0))
    assert np.abs(np.min(normalized_range) + 1.0) < 1e-9
    assert np.abs(np.max(normalized_range) - 1.0) < 1e-9
    print('  [OK] 自定义范围最小最大归一化测试通过')

    # 测试2D按行归一化
    signal_2d_norm = np.array([[1.0, 2.0, 3.0], [10.0, 20.0, 30.0]])
    normalized_2d = min_max_normalize(signal_2d_norm, axis=1)
    for i in range(signal_2d_norm.shape[0]):
        assert np.abs(np.min(normalized_2d[i])) < 1e-9
        assert np.abs(np.max(normalized_2d[i]) - 1.0) < 1e-9
    print('  [OK] 按行最小最大归一化测试通过')

    # 测试恒定信号归一化
    normalized_const = min_max_normalize(constant_signal)
    assert np.isfinite(normalized_const).all()
    print('  [OK] 恒定信号最小最大归一化测试通过')

    # 测试流水线
    print('\n=== 测试预处理流水线 ===')
    vibration_signal = (
        np.sin(2 * np.pi * 10 * np.linspace(0, 10, 50000))
        + 0.5 * np.sin(2 * np.pi * 50 * np.linspace(0, 10, 50000))
        + 0.2 * np.random.randn(50000)
        + 1.0
    )

    # 测试小波去噪流水线
    processor = SignalProcessor(
        denoise_method='wavelet',
        apply_highpass=True,
        window_size=1024,
        hop_size=512,
        normalization_method='standardize',
    )
    print(f'SignalProcessor初始化成功')
    assert processor.denoise_method == 'wavelet'
    assert processor.window_size == 1024
    assert processor.hop_size == 512
    print('  [OK] SignalProcessor初始化测试通过')

    segments = processor.process(vibration_signal, sample_rate=5000)
    expected_num = (len(vibration_signal) - 1024) // 512 + 1
    print(f'流水线处理: 输入长度 {len(vibration_signal)}, 输出形状 {segments.shape}')
    assert segments.shape == (expected_num, 1024)
    assert np.isfinite(segments).all()
    assert np.abs(np.mean(segments)) < 1e-5
    print('  [OK] 小波去噪流水线测试通过')

    # 测试可调用接口
    segments2 = processor(vibration_signal, sample_rate=5000)
    np.testing.assert_array_equal(segments, segments2)
    print('  [OK] 可调用接口测试通过')

    # 测试移动平均流水线
    processor_ma = SignalProcessor(
        denoise_method='moving_average',
        moving_average_params={'window_size': 5, 'mode': 'same'},
        apply_highpass=True,
        window_size=1024,
        hop_size=512,
        normalization_method='min_max',
        normalization_params={'feature_range': (0.0, 1.0)},
    )
    segments_ma = processor_ma.process(vibration_signal, sample_rate=5000)
    print(f'移动平均流水线: 输出形状 {segments_ma.shape}')
    assert np.min(segments_ma) >= 0.0
    assert np.max(segments_ma) <= 1.0
    print('  [OK] 移动平均流水线测试通过')

    # 测试不去噪不归一化流水线
    processor_none = SignalProcessor(
        denoise_method=None,
        apply_highpass=False,
        window_size=1024,
        hop_size=512,
        normalization_method=None,
    )
    segments_none = processor_none.process(vibration_signal, sample_rate=5000)
    assert segments_none.shape[1] == 1024
    assert np.isfinite(segments_none).all()
    print('  [OK] 无处理流水线测试通过')

    # 测试可重复性
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
    print('  [OK] 可重复性测试通过')

    # 测试错误处理
    print('\n=== 测试错误处理 ===')

    # 小波去噪错误处理
    try:
        wavelet_denoise([1, 2, 3])
        print('  [FAIL] 类型错误测试失败')
    except TypeError:
        print('  [OK] wavelet_denoise TypeError测试通过')

    try:
        wavelet_denoise(np.array([]))
        print('  [FAIL] 空数组测试失败')
    except ValueError:
        print('  [OK] wavelet_denoise 空数组测试通过')

    try:
        wavelet_denoise(np.array([[1, 2], [3, 4]]))
        print('  [FAIL] 维度错误测试失败')
    except ValueError:
        print('  [OK] wavelet_denoise 维度错误测试通过')

    try:
        wavelet_denoise(np.array([1.0, 2.0, 3.0]), level=0)
        print('  [FAIL] level参数错误测试失败')
    except ValueError:
        print('  [OK] wavelet_denoise level参数错误测试通过')

    try:
        wavelet_denoise(np.array([1.0, 2.0, 3.0]), threshold_mode='invalid')
        print('  [FAIL] 阈值模式错误测试失败')
    except ValueError:
        print('  [OK] wavelet_denoise 阈值模式错误测试通过')

    # 移动平均去噪错误处理
    try:
        moving_average_denoise([1, 2, 3])
        print('  [FAIL] 类型错误测试失败')
    except TypeError:
        print('  [OK] moving_average_denoise TypeError测试通过')

    try:
        moving_average_denoise(np.array([1.0, 2.0, 3.0]), window_size=0)
        print('  [FAIL] 窗口大小错误测试失败')
    except ValueError:
        print('  [OK] moving_average_denoise 窗口大小错误测试通过')

    try:
        moving_average_denoise(np.array([1.0, 2.0, 3.0]), window_size=10)
        print('  [FAIL] 窗口过大错误测试失败')
    except ValueError:
        print('  [OK] moving_average_denoise 窗口过大测试通过')

    try:
        moving_average_denoise(np.array([1.0, 2.0, 3.0]), mode='invalid')
        print('  [FAIL] 模式错误测试失败')
    except ValueError:
        print('  [OK] moving_average_denoise 模式错误测试通过')

    # 高通滤波错误处理
    try:
        highpass_filter([1, 2, 3], sample_rate=100)
        print('  [FAIL] 类型错误测试失败')
    except TypeError:
        print('  [OK] highpass_filter TypeError测试通过')

    try:
        highpass_filter(np.array([1.0, 2.0, 3.0]), sample_rate=0)
        print('  [FAIL] 采样率错误测试失败')
    except ValueError:
        print('  [OK] highpass_filter 采样率错误测试通过')

    try:
        highpass_filter(np.array([1.0, 2.0, 3.0]), sample_rate=100, cutoff_freq=0)
        print('  [FAIL] 截止频率错误测试失败')
    except ValueError:
        print('  [OK] highpass_filter 截止频率错误测试通过')

    try:
        highpass_filter(np.array([1.0, 2.0, 3.0]), sample_rate=100, cutoff_freq=60)
        print('  [FAIL] 截止频率过大测试失败')
    except ValueError:
        print('  [OK] highpass_filter 截止频率过大测试通过')

    # 滑动窗口错误处理
    try:
        sliding_window([1, 2, 3])
        print('  [FAIL] 类型错误测试失败')
    except TypeError:
        print('  [OK] sliding_window TypeError测试通过')

    try:
        sliding_window(np.array([]))
        print('  [FAIL] 空数组测试失败')
    except ValueError:
        print('  [OK] sliding_window 空数组测试通过')

    try:
        sliding_window(np.array([1.0, 2.0, 3.0]), window_size=10)
        print('  [FAIL] 窗口过大测试失败')
    except ValueError:
        print('  [OK] sliding_window 窗口过大测试通过')

    # 归一化错误处理
    try:
        standardize([1, 2, 3])
        print('  [FAIL] 类型错误测试失败')
    except TypeError:
        print('  [OK] standardize TypeError测试通过')

    try:
        min_max_normalize(np.array([1.0, 2.0, 3.0]), feature_range=(1.0, 1.0))
        print('  [FAIL] 范围错误测试失败')
    except ValueError:
        print('  [OK] min_max_normalize 范围错误测试通过')

    try:
        min_max_normalize(np.array([1.0, 2.0, 3.0]), feature_range=(1.0,))
        print('  [FAIL] 范围元组长度错误测试失败')
    except ValueError:
        print('  [OK] min_max_normalize 范围元组长度错误测试通过')

    # SignalProcessor错误处理
    try:
        SignalProcessor(denoise_method='invalid')
        print('  [FAIL] 去噪方法错误测试失败')
    except ValueError:
        print('  [OK] SignalProcessor 去噪方法错误测试通过')

    try:
        SignalProcessor(normalization_method='invalid')
        print('  [FAIL] 归一化方法错误测试失败')
    except ValueError:
        print('  [OK] SignalProcessor 归一化方法错误测试通过')

    try:
        SignalProcessor(window_size=0)
        print('  [FAIL] 窗口大小错误测试失败')
    except ValueError:
        print('  [OK] SignalProcessor 窗口大小错误测试通过')

    try:
        processor = SignalProcessor(window_size=1024)
        processor.process([1, 2, 3], sample_rate=100)
        print('  [FAIL] process类型错误测试失败')
    except TypeError:
        print('  [OK] SignalProcessor process TypeError测试通过')

    try:
        processor = SignalProcessor(window_size=1024)
        processor.process(np.random.randn(100), sample_rate=100)
        print('  [FAIL] 信号过短测试失败')
    except ValueError:
        print('  [OK] SignalProcessor 信号过短测试通过')

    try:
        processor = SignalProcessor(window_size=1024)
        processor.process(np.random.randn(10000), sample_rate=0)
        print('  [FAIL] 采样率错误测试失败')
    except ValueError:
        print('  [OK] SignalProcessor 采样率错误测试通过')

    print('\n========================================')
    print('[PASS] 所有测试通过！功能验证完成！')
    print('========================================')

if __name__ == '__main__':
    main()
