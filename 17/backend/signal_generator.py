import numpy as np
import time
import json
import redis
from config import CHANNELS_CONFIG, REDIS_CONFIG


class PhysiologicalSignalGenerator:
    def __init__(self):
        self.channels = CHANNELS_CONFIG
        self.redis_client = redis.Redis(
            host=REDIS_CONFIG['host'],
            port=REDIS_CONFIG['port'],
            db=REDIS_CONFIG['db']
        )
        self.stream_name = REDIS_CONFIG['stream_name']
        self.time_index = 0
        self.anomaly_injections = {}

    def generate_ecg(self, t, fs):
        """模拟ECG信号 - 包含P波、QRS波、T波"""
        heart_rate = 70 + np.random.normal(0, 5)
        rr_interval = 60.0 / heart_rate
        
        signal = np.zeros_like(t)
        ecg_cycle = np.zeros(int(rr_interval * fs))
        qrs_pos = int(0.2 * len(ecg_cycle))
        
        p_wave = 0.1 * np.sin(np.linspace(0, np.pi, int(0.1*fs)))
        qrs = np.array([-0.2, -0.8, 1.2, -0.6, -0.1])
        t_wave = 0.2 * np.sin(np.linspace(0, np.pi, int(0.2*fs)))
        
        p_start = qrs_pos - int(0.15*fs)
        ecg_cycle[p_start:p_start+len(p_wave)] += p_wave
        ecg_cycle[qrs_pos:qrs_pos+len(qrs)] += qrs
        t_start = qrs_pos + int(0.1*fs)
        ecg_cycle[t_start:t_start+len(t_wave)] += t_wave
        
        for i in range(0, len(t), len(ecg_cycle)):
            n = min(len(ecg_cycle), len(t) - i)
            signal[i:i+n] += ecg_cycle[:n]
        
        signal += np.random.normal(0, 0.05, len(t))
        return signal

    def generate_eeg(self, t, fs):
        """模拟EEG信号 - 包含多种脑电波"""
        signal = np.zeros_like(t)
        
        delta = 30 * np.sin(2 * np.pi * 2 * t)
        theta = 20 * np.sin(2 * np.pi * 6 * t)
        alpha = 15 * np.sin(2 * np.pi * 10 * t)
        beta = 10 * np.sin(2 * np.pi * 20 * t)
        gamma = 5 * np.sin(2 * np.pi * 50 * t)
        
        signal = delta + theta + alpha + beta + gamma
        signal += np.random.normal(0, 10, len(t))
        return signal

    def generate_emg(self, t, fs):
        """模拟EMG信号 - 肌电信号"""
        signal = np.zeros_like(t)
        for i, ti in enumerate(t):
            if ti % 2 < 0.5:
                signal[i] = np.random.normal(2, 1)
            else:
                signal[i] = np.random.normal(0, 0.3)
        return signal

    def generate_ppg(self, t, fs):
        """模拟PPG信号 - 光电容积脉搏波"""
        heart_rate = 70 + np.random.normal(0, 3)
        signal = 0.3 + 0.4 * np.sin(2 * np.pi * heart_rate/60 * t) ** 2
        signal += 0.05 * np.sin(2 * np.pi * 0.2 * t)
        signal += np.random.normal(0, 0.02, len(t))
        return signal

    def generate_resp(self, t, fs):
        """模拟呼吸信号"""
        resp_rate = 12 + np.random.normal(0, 2)
        signal = 3 * np.sin(2 * np.pi * resp_rate/60 * t)
        signal += np.random.normal(0, 0.2, len(t))
        return signal

    def generate_temp(self, t, fs):
        """模拟体温信号 - 缓慢变化"""
        base_temp = 36.5 + 0.3 * np.sin(2 * np.pi * t[0]/3600)
        signal = np.full_like(t, base_temp)
        signal += np.random.normal(0, 0.05, len(t))
        return signal

    def generate_eda(self, t, fs):
        """模拟皮肤电活动"""
        signal = 5 + 2 * np.random.randn(len(t)).cumsum() * 0.01
        signal = np.clip(signal, 2, 15)
        signal += np.random.normal(0, 0.1, len(t))
        return signal

    def generate_spo2(self, t, fs):
        """模拟血氧饱和度"""
        signal = np.full_like(t, 97 + np.random.normal(0, 0.5))
        signal = np.clip(signal, 90, 100)
        return signal

    def inject_anomaly(self, channel, duration, amplitude):
        """注入异常信号"""
        self.anomaly_injections[channel] = {
            'start_time': self.time_index,
            'duration': duration,
            'amplitude': amplitude
        }

    def generate_channel_signal(self, channel, duration=1.0):
        """生成单个通道的信号"""
        config = self.channels[channel]
        fs = config['sampling_rate']
        n_samples = int(fs * duration)
        
        t = np.arange(self.time_index, self.time_index + n_samples) / fs
        
        generators = {
            'ecg': self.generate_ecg,
            'eeg': self.generate_eeg,
            'emg': self.generate_emg,
            'ppg': self.generate_ppg,
            'resp': self.generate_resp,
            'temp': self.generate_temp,
            'eda': self.generate_eda,
            'spo2': self.generate_spo2
        }
        
        signal = generators[channel](t, fs)
        
        if channel in self.anomaly_injections:
            anomaly = self.anomaly_injections[channel]
            if self.time_index < anomaly['start_time'] + anomaly['duration']:
                signal += anomaly['amplitude']
        
        return t, signal

    def start_streaming(self):
        """开始流式生成数据"""
        print("开始生理信号数据流...")
        try:
            while True:
                data_packet = {
                    'timestamp': time.time(),
                    'channels': {}
                }
                
                for channel in self.channels:
                    t, signal = self.generate_channel_signal(channel, duration=0.1)
                    data_packet['channels'][channel] = {
                        'values': signal.tolist(),
                        'timestamps': t.tolist(),
                        'sampling_rate': self.channels[channel]['sampling_rate']
                    }
                
                self.redis_client.xadd(
                    self.stream_name,
                    {'data': json.dumps(data_packet)}
                )
                
                self.time_index += int(max(c['sampling_rate'] for c in self.channels.values()) * 0.1)
                time.sleep(0.1)
                
        except KeyboardInterrupt:
            print("\n数据流停止")


if __name__ == '__main__':
    generator = PhysiologicalSignalGenerator()
    generator.start_streaming()
