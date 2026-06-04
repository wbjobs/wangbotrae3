import numpy as np
from scipy.fft import fft, fftfreq
from config import BANDS_CONFIG


class FeatureExtractor:
    def __init__(self, sampling_rate):
        self.sampling_rate = sampling_rate

    def extract_time_domain(self, signal):
        """提取时域特征"""
        features = {}
        
        features['mean'] = np.mean(signal)
        features['variance'] = np.var(signal)
        features['std'] = np.std(signal)
        features['peak'] = np.max(np.abs(signal))
        features['rms'] = np.sqrt(np.mean(np.square(signal)))
        features['zero_crossing_rate'] = self._zero_crossing_rate(signal)
        features['peak_to_peak'] = np.max(signal) - np.min(signal)
        features['skewness'] = self._skewness(signal)
        features['kurtosis'] = self._kurtosis(signal)
        
        return features

    def _zero_crossing_rate(self, signal):
        """计算过零率"""
        zero_crossings = np.where(np.diff(np.signbit(signal)))[0]
        return len(zero_crossings) / len(signal)

    def _skewness(self, signal):
        """计算偏度"""
        mean = np.mean(signal)
        std = np.std(signal)
        if std == 0:
            return 0
        return np.mean(((signal - mean) / std) ** 3)

    def _kurtosis(self, signal):
        """计算峰度"""
        mean = np.mean(signal)
        std = np.std(signal)
        if std == 0:
            return 0
        return np.mean(((signal - mean) / std) ** 4) - 3

    def extract_frequency_domain(self, signal):
        """提取频域特征"""
        features = {}
        
        n = len(signal)
        fft_vals = fft(signal)
        fft_freq = fftfreq(n, 1/self.sampling_rate)
        
        power_spectrum = np.abs(fft_vals) ** 2
        total_power = np.sum(power_spectrum)
        
        for band, (low, high) in BANDS_CONFIG.items():
            band_mask = (fft_freq >= low) & (fft_freq <= high)
            band_power = np.sum(power_spectrum[band_mask])
            features[f'{band}_power'] = band_power
            features[f'{band}_relative'] = band_power / total_power if total_power > 0 else 0
        
        features['total_power'] = total_power
        features['dominant_freq'] = fft_freq[np.argmax(power_spectrum)]
        features['spectral_centroid'] = np.sum(fft_freq * power_spectrum) / total_power if total_power > 0 else 0
        
        return features

    def extract_spectrogram(self, signal, window_size=256, overlap=128):
        """计算频谱图数据"""
        n = len(signal)
        hop_size = window_size - overlap
        n_frames = (n - window_size) // hop_size + 1
        
        spectrogram = []
        for i in range(n_frames):
            start = i * hop_size
            end = start + window_size
            frame = signal[start:end] * np.hanning(window_size)
            
            fft_vals = fft(frame)
            power_spectrum = np.abs(fft_vals[:window_size//2]) ** 2
            spectrogram.append(power_spectrum)
        
        frequencies = fftfreq(window_size, 1/self.sampling_rate)[:window_size//2]
        return np.array(spectrogram), frequencies

    def extract_all(self, signal):
        """提取所有特征"""
        time_features = self.extract_time_domain(signal)
        freq_features = self.extract_frequency_domain(signal)
        
        return {**time_features, **freq_features}
