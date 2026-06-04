
CHANNELS_CONFIG = {
    'ecg': {'name': '心电图', 'sampling_rate': 1000, 'unit': 'mV', 'range': (-1.5, 1.5)},
    'eeg': {'name': '脑电图', 'sampling_rate': 500, 'unit': 'μV', 'range': (-100, 100)},
    'emg': {'name': '肌电图', 'sampling_rate': 2000, 'unit': 'mV', 'range': (-5, 5)},
    'ppg': {'name': '光电容积脉搏波', 'sampling_rate': 125, 'unit': 'AU', 'range': (0, 1)},
    'resp': {'name': '呼吸', 'sampling_rate': 125, 'unit': 'L/min', 'range': (-5, 5)},
    'temp': {'name': '体温', 'sampling_rate': 1, 'unit': '°C', 'range': (35, 42)},
    'eda': {'name': '皮肤电活动', 'sampling_rate': 125, 'unit': 'μS', 'range': (0, 20)},
    'spo2': {'name': '血氧饱和度', 'sampling_rate': 1, 'unit': '%', 'range': (90, 100)}
}

REDIS_CONFIG = {
    'host': 'localhost',
    'port': 6379,
    'db': 0,
    'stream_name': 'physio_signals',
    'group_name': 'processing_group'
}

ANOMALY_CONFIG = {
    'zscore_threshold': 3.0,
    'window_size': 500,
    'history_size': 10000,
    'min_anomaly_duration': 0.1,
    'baseline_learning_seconds': 300,
    'ewma_alpha_mean': 0.01,
    'ewma_alpha_std': 0.005,
    'anomaly_std_threshold': 3.0,
    'update_interval_seconds': 1
}

BANDS_CONFIG = {
    'delta': (0.5, 4),
    'theta': (4, 8),
    'alpha': (8, 13),
    'beta': (13, 30),
    'gamma': (30, 100)
}

MULTI_PATIENT_CONFIG = {
    'max_patients': 4,
    'default_patients': ['patient_1', 'patient_2', 'patient_3', 'patient_4'],
    'patient_colors': ['#409eff', '#67c23a', '#e6a23c', '#f56c6c'],
    'heatmap_time_bins': 60,
    'clustering_threshold': 0.7,
    'max_clusters': 10
}

PATIENT_PROFILES = {
    'patient_1': {'name': '患者A', 'age': 45, 'gender': '男', 'baseline_offset': 0.0, 'anomaly_rate': 0.02},
    'patient_2': {'name': '患者B', 'age': 62, 'gender': '女', 'baseline_offset': 0.3, 'anomaly_rate': 0.05},
    'patient_3': {'name': '患者C', 'age': 33, 'gender': '男', 'baseline_offset': -0.2, 'anomaly_rate': 0.01},
    'patient_4': {'name': '患者D', 'age': 71, 'gender': '女', 'baseline_offset': 0.5, 'anomaly_rate': 0.08}
}

