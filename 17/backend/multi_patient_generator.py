import numpy as np
import time
import json
import redis
from config import CHANNELS_CONFIG, REDIS_CONFIG, PATIENT_PROFILES


class MultiPatientSignalGenerator:
    def __init__(self):
        self.channels = CHANNELS_CONFIG
        self.patients = PATIENT_PROFILES
        self.redis_client = redis.Redis(
            host=REDIS_CONFIG['host'],
            port=REDIS_CONFIG['port'],
            db=REDIS_CONFIG['db']
        )
        self.stream_name = REDIS_CONFIG['stream_name']
        self.patient_time_indices = {p_id: 0 for p_id in self.patients.keys()}
        self.patient_anomaly_injections = {p_id: {} for p_id in self.patients.keys()}

    def generate_ecg(self, t, fs, baseline_offset=0):
        heart_rate = 70 + np.random.normal(0, 5) + baseline_offset * 10
        rr_interval = 60.0 / heart_rate
        
        signal = np.zeros_like(t)
        ecg_cycle = np.zeros(int(rr_interval * fs))
        qrs_pos = int(0.2 * len(ecg_cycle))
        
        p_wave = 0.1 * np.sin(np.linspace(0, np.pi, int(0.1*fs)))
        qrs = np.array([-0.2, -0.8, 1.2, -0.6, -0.1])
        t_wave = 0.2 * np.sin(np.linspace(0, np.pi, int(0.2*fs)))
        
        p_start = qrs_pos - int(0.15*fs)
        if p_start >= 0:
            ecg_cycle[p_start:p_start+len(p_wave)] += p_wave
        ecg_cycle[qrs_pos:qrs_pos+len(qrs)] += qrs
        t_start = qrs_pos + int(0.1*fs)
        if t_start + len(t_wave) < len(ecg_cycle):
            ecg_cycle[t_start:t_start+len(t_wave)] += t_wave
        
        for i in range(0, len(t), len(ecg_cycle)):
            n = min(len(ecg_cycle), len(t) - i)
            signal[i:i+n] += ecg_cycle[:n]
        
        signal += np.random.normal(0, 0.05, len(t)) + baseline_offset * 0.1
        return signal

    def generate_eeg(self, t, fs, baseline_offset=0):
        signal = np.zeros_like(t)
        
        delta = 30 * np.sin(2 * np.pi * (2 + baseline_offset) * t)
        theta = 20 * np.sin(2 * np.pi * (6 + baseline_offset) * t)
        alpha = 15 * np.sin(2 * np.pi * (10 + baseline_offset * 2) * t)
        beta = 10 * np.sin(2 * np.pi * (20 + baseline_offset * 3) * t)
        gamma = 5 * np.sin(2 * np.pi * (50 + baseline_offset * 5) * t)
        
        signal = delta + theta + alpha + beta + gamma
        signal += np.random.normal(0, 10 + abs(baseline_offset) * 5, len(t))
        return signal

    def generate_emg(self, t, fs, baseline_offset=0):
        signal = np.zeros_like(t)
        for i, ti in enumerate(t):
            if ti % 2 < 0.5 + baseline_offset * 0.2:
                signal[i] = np.random.normal(2 + baseline_offset, 1)
            else:
                signal[i] = np.random.normal(0, 0.3)
        return signal

    def generate_ppg(self, t, fs, baseline_offset=0):
        heart_rate = 70 + np.random.normal(0, 3) + baseline_offset * 15
        signal = 0.3 + 0.4 * np.sin(2 * np.pi * heart_rate/60 * t) ** 2
        signal += 0.05 * np.sin(2 * np.pi * 0.2 * t)
        signal += np.random.normal(0, 0.02, len(t)) + baseline_offset * 0.1
        return signal

    def generate_resp(self, t, fs, baseline_offset=0):
        resp_rate = 12 + np.random.normal(0, 2) + baseline_offset * 5
        signal = 3 * np.sin(2 * np.pi * resp_rate/60 * t)
        signal += np.random.normal(0, 0.2, len(t)) + baseline_offset * 0.5
        return signal

    def generate_temp(self, t, fs, baseline_offset=0):
        base_temp = 36.5 + baseline_offset * 0.5 + 0.3 * np.sin(2 * np.pi * t[0]/3600)
        signal = np.full_like(t, base_temp)
        signal += np.random.normal(0, 0.05, len(t))
        return signal

    def generate_eda(self, t, fs, baseline_offset=0):
        signal = 5 + baseline_offset * 3 + 2 * np.random.randn(len(t)).cumsum() * 0.01
        signal = np.clip(signal, 2, 15)
        signal += np.random.normal(0, 0.1, len(t))
        return signal

    def generate_spo2(self, t, fs, baseline_offset=0):
        base_spo2 = 97 - abs(baseline_offset) * 3
        signal = np.full_like(t, base_spo2 + np.random.normal(0, 0.5, len(t)))
        signal = np.clip(signal, 90, 100)
        return signal

    def inject_patient_anomaly(self, patient_id, channel, duration, amplitude):
        self.patient_anomaly_injections[patient_id][channel] = {
            'start_time': self.patient_time_indices[patient_id],
            'duration': duration,
            'amplitude': amplitude
        }

    def generate_channel_signal(self, patient_id, channel, duration=1.0):
        config = self.channels[channel]
        fs = config['sampling_rate']
        n_samples = int(fs * duration)
        
        t = np.arange(self.patient_time_indices[patient_id], 
                     self.patient_time_indices[patient_id] + n_samples) / fs
        
        baseline_offset = self.patients[patient_id]['baseline_offset']
        
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
        
        signal = generators[channel](t, fs, baseline_offset)
        
        if np.random.random() < self.patients[patient_id]['anomaly_rate']:
            signal += np.random.choice([-1, 1]) * np.random.uniform(2, 5) * np.std(signal)
        
        if channel in self.patient_anomaly_injections[patient_id]:
            anomaly = self.patient_anomaly_injections[patient_id][channel]
            if self.patient_time_indices[patient_id] < anomaly['start_time'] + anomaly['duration']:
                signal += anomaly['amplitude']
        
        return t, signal

    def start_streaming(self):
        print("开始多患者生理信号数据流...")
        print(f"患者数量: {len(self.patients)}")
        for p_id, profile in self.patients.items():
            print(f"  - {p_id}: {profile['name']} ({profile['age']}岁 {profile['gender']})")
        
        try:
            while True:
                all_patients_data = {
                    'timestamp': time.time(),
                    'patients': {}
                }
                
                for patient_id in self.patients.keys():
                    patient_data = {'channels': {}}
                    
                    for channel in self.channels:
                        t, signal = self.generate_channel_signal(patient_id, channel, duration=0.1)
                        patient_data['channels'][channel] = {
                            'values': signal.tolist(),
                            'timestamps': t.tolist(),
                            'sampling_rate': self.channels[channel]['sampling_rate']
                        }
                    
                    all_patients_data['patients'][patient_id] = patient_data
                    self.patient_time_indices[patient_id] += int(max(c['sampling_rate'] for c in self.channels.values()) * 0.1)
                
                self.redis_client.xadd(
                    self.stream_name,
                    {'data': json.dumps(all_patients_data)}
                )
                
                time.sleep(0.1)
                
        except KeyboardInterrupt:
            print("\n数据流停止")


if __name__ == '__main__':
    generator = MultiPatientSignalGenerator()
    generator.start_streaming()
