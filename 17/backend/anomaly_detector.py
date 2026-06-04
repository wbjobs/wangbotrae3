import numpy as np
from collections import deque
from config import ANOMALY_CONFIG


class AdaptiveBaseline:
    def __init__(self, feature_name):
        self.feature_name = feature_name
        self.learning_seconds = ANOMALY_CONFIG['baseline_learning_seconds']
        self.ewma_alpha_mean = ANOMALY_CONFIG['ewma_alpha_mean']
        self.ewma_alpha_std = ANOMALY_CONFIG['ewma_alpha_std']
        self.update_interval = ANOMALY_CONFIG['update_interval_seconds']
        
        self.is_learning = True
        self.learning_buffer = []
        self.learning_start_time = None
        self.last_update_time = None
        
        self.ewma_mean = None
        self.ewma_std = None
        
    def reset(self):
        self.is_learning = True
        self.learning_buffer = []
        self.learning_start_time = None
        self.last_update_time = None
        self.ewma_mean = None
        self.ewma_std = None
        
    def get_learning_progress(self, current_time):
        if not self.is_learning:
            return 1.0
        if self.learning_start_time is None:
            return 0.0
        elapsed = current_time - self.learning_start_time
        return min(1.0, elapsed / self.learning_seconds)
    
    def update(self, value, current_time):
        if self.learning_start_time is None:
            self.learning_start_time = current_time
            self.last_update_time = current_time
        
        if self.is_learning:
            self.learning_buffer.append(value)
            elapsed = current_time - self.learning_start_time
            
            if elapsed >= self.learning_seconds:
                self._finalize_learning()
        else:
            if self.last_update_time is None:
                self.last_update_time = current_time
            
            time_since_update = current_time - self.last_update_time
            if time_since_update >= self.update_interval:
                self._update_ewma(value)
                self.last_update_time = current_time
    
    def _finalize_learning(self):
        if len(self.learning_buffer) > 0:
            arr = np.array(self.learning_buffer)
            self.ewma_mean = np.mean(arr)
            self.ewma_std = np.std(arr)
            if self.ewma_std == 0:
                self.ewma_std = 1e-8
        self.is_learning = False
        self.learning_buffer = []
    
    def _update_ewma(self, value):
        if self.ewma_mean is None:
            self.ewma_mean = value
        else:
            self.ewma_mean = self.ewma_alpha_mean * value + (1 - self.ewma_alpha_mean) * self.ewma_mean
        
        if self.ewma_std is None:
            self.ewma_std = 1e-8
        else:
            variance = (value - self.ewma_mean) ** 2
            current_std = np.sqrt(variance) if variance > 0 else 1e-8
            self.ewma_std = self.ewma_alpha_std * current_std + (1 - self.ewma_alpha_std) * self.ewma_std
            if self.ewma_std == 0:
                self.ewma_std = 1e-8
    
    def get_deviation_score(self, value):
        if self.is_learning or self.ewma_mean is None or self.ewma_std is None:
            return 0.0
        return abs((value - self.ewma_mean) / self.ewma_std)
    
    def get_baseline(self):
        return {
            'mean': float(self.ewma_mean) if self.ewma_mean is not None else None,
            'std': float(self.ewma_std) if self.ewma_std is not None else None,
            'is_learning': self.is_learning
        }


class AnomalyDetector:
    def __init__(self, channel_name):
        self.channel_name = channel_name
        self.threshold = ANOMALY_CONFIG['anomaly_std_threshold']
        self.history_size = ANOMALY_CONFIG['history_size']
        
        self.time_feature_names = ['mean', 'variance', 'peak', 'rms', 'zero_crossing_rate']
        self.freq_feature_names = ['delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power']
        
        self.time_baselines = {name: AdaptiveBaseline(name) for name in self.time_feature_names}
        self.freq_baselines = {name: AdaptiveBaseline(name) for name in self.freq_feature_names}
        
        self.time_feature_history = {name: deque(maxlen=self.history_size) for name in self.time_feature_names}
        self.freq_feature_history = {name: deque(maxlen=self.history_size) for name in self.freq_feature_names}
        
        self.anomaly_events = []
        self.min_anomaly_duration = ANOMALY_CONFIG['min_anomaly_duration']
        self.current_anomaly = None
        self.start_time = None
        
    def reset_baseline(self):
        for baseline in self.time_baselines.values():
            baseline.reset()
        for baseline in self.freq_baselines.values():
            baseline.reset()
        self.start_time = None
        
    def get_baseline_status(self, current_time):
        time_progress = {
            name: bl.get_learning_progress(current_time)
            for name, bl in self.time_baselines.items()
        }
        freq_progress = {
            name: bl.get_learning_progress(current_time)
            for name, bl in self.freq_baselines.items()
        }
        
        all_progress = list(time_progress.values()) + list(freq_progress.values())
        avg_progress = sum(all_progress) / len(all_progress) if all_progress else 0
        
        is_learning = any(bl.is_learning for bl in self.time_baselines.values()) or \
                      any(bl.is_learning for bl in self.freq_baselines.values())
        
        return {
            'channel': self.channel_name,
            'is_learning': is_learning,
            'learning_progress': avg_progress,
            'time_features': {name: bl.get_baseline() for name, bl in self.time_baselines.items()},
            'freq_features': {name: bl.get_baseline() for name, bl in self.freq_baselines.items()}
        }
        
    def update_history(self, time_features, freq_features):
        for feature, value in time_features.items():
            if feature in self.time_feature_history:
                self.time_feature_history[feature].append(value)
        
        for feature, value in freq_features.items():
            if feature in self.freq_feature_history:
                self.freq_feature_history[feature].append(value)
    
    def update_baselines(self, time_features, freq_features, timestamp):
        for feature, value in time_features.items():
            if feature in self.time_baselines:
                self.time_baselines[feature].update(value, timestamp)
        
        for feature, value in freq_features.items():
            if feature in self.freq_baselines:
                self.freq_baselines[feature].update(value, timestamp)
    
    def _calculate_deviation(self, value, baseline):
        return baseline.get_deviation_score(value)
    
    def detect_time_anomalies(self, time_features, timestamp):
        anomalies = {}
        
        for feature, value in time_features.items():
            if feature in self.time_baselines:
                deviation = self._calculate_deviation(value, self.time_baselines[feature])
                anomalies[feature] = {
                    'value': value,
                    'deviation': deviation,
                    'is_anomaly': deviation > self.threshold,
                    'baseline': self.time_baselines[feature].get_baseline()
                }
        
        return anomalies
    
    def detect_freq_anomalies(self, freq_features, timestamp):
        anomalies = {}
        
        for feature, value in freq_features.items():
            if feature in self.freq_baselines:
                deviation = self._calculate_deviation(value, self.freq_baselines[feature])
                anomalies[feature] = {
                    'value': value,
                    'deviation': deviation,
                    'is_anomaly': deviation > self.threshold,
                    'baseline': self.freq_baselines[feature].get_baseline()
                }
        
        return anomalies
    
    def detect_combined(self, time_features, freq_features, timestamp):
        if self.start_time is None:
            self.start_time = timestamp
        
        self.update_history(time_features, freq_features)
        self.update_baselines(time_features, freq_features, timestamp)
        
        time_anomalies = self.detect_time_anomalies(time_features, timestamp)
        freq_anomalies = self.detect_freq_anomalies(freq_features, timestamp)
        
        is_time_anomaly = any(a['is_anomaly'] for a in time_anomalies.values())
        is_freq_anomaly = any(a['is_anomaly'] for a in freq_anomalies.values())
        
        max_time_deviation = max((a['deviation'] for a in time_anomalies.values()), default=0)
        max_freq_deviation = max((a['deviation'] for a in freq_anomalies.values()), default=0)
        
        baseline_status = self.get_baseline_status(timestamp)
        is_learning = baseline_status['is_learning']
        
        is_combined_anomaly = (is_time_anomaly or is_freq_anomaly) and not is_learning
        
        anomaly_details = {
            'channel': self.channel_name,
            'timestamp': timestamp,
            'is_anomaly': is_combined_anomaly,
            'is_learning': is_learning,
            'learning_progress': baseline_status['learning_progress'],
            'time_anomalies': time_anomalies,
            'freq_anomalies': freq_anomalies,
            'max_time_deviation': max_time_deviation,
            'max_freq_deviation': max_freq_deviation,
            'combined_score': max(max_time_deviation, max_freq_deviation)
        }
        
        if is_combined_anomaly:
            if self.current_anomaly is None:
                self.current_anomaly = {
                    'start_time': timestamp,
                    'end_time': timestamp,
                    'max_score': anomaly_details['combined_score'],
                    'details': anomaly_details
                }
            else:
                self.current_anomaly['end_time'] = timestamp
                self.current_anomaly['max_score'] = max(
                    self.current_anomaly['max_score'],
                    anomaly_details['combined_score']
                )
        else:
            if self.current_anomaly is not None:
                duration = self.current_anomaly['end_time'] - self.current_anomaly['start_time']
                if duration >= self.min_anomaly_duration:
                    self.anomaly_events.append({
                        **self.current_anomaly,
                        'duration': duration,
                        'id': len(self.anomaly_events),
                        'status': 'detected',
                        'notes': ''
                    })
                self.current_anomaly = None
        
        return anomaly_details

    def get_anomaly_events(self):
        return self.anomaly_events

    def label_anomaly(self, anomaly_id, status, notes=''):
        for event in self.anomaly_events:
            if event['id'] == anomaly_id:
                event['status'] = status
                event['notes'] = notes
                return True
        return False
