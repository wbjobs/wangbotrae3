import numpy as np
from collections import defaultdict
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
from config import MULTI_PATIENT_CONFIG


class AnomalyCluster:
    def __init__(self, cluster_id, pattern_type, features):
        self.cluster_id = cluster_id
        self.pattern_type = pattern_type
        self.features = features
        self.events = []
        self.count = 0
        
    def add_event(self, event):
        self.events.append(event)
        self.count += 1
        
    def get_summary(self):
        return {
            'cluster_id': self.cluster_id,
            'pattern_type': self.pattern_type,
            'count': self.count,
            'patients': list(set(e['patient_id'] for e in self.events)),
            'channels': list(set(e['channel'] for e in self.events)),
            'avg_score': np.mean([e.get('score', 0) for e in self.events]),
            'representative_event': self.events[0] if self.events else None
        }


class AnomalyPatternRecognizer:
    def __init__(self):
        self.clusters = {}
        self.cluster_counter = 0
        self.threshold = MULTI_PATIENT_CONFIG['clustering_threshold']
        self.max_clusters = MULTI_PATIENT_CONFIG['max_clusters']
        self.event_history = []
        
        self.pattern_definitions = {
            'eeg_burst_suppression': {
                'channels': ['eeg'],
                'features': ['variance', 'peak'],
                'description': 'EEG爆发抑制'
            },
            'ecg_premature_beat': {
                'channels': ['ecg'],
                'features': ['peak', 'zero_crossing_rate'],
                'description': 'ECG早搏模式'
            },
            'emg_high_activity': {
                'channels': ['emg'],
                'features': ['rms', 'peak'],
                'description': 'EMG高活动'
            },
            'resp_abnormal_rate': {
                'channels': ['resp'],
                'features': ['zero_crossing_rate', 'variance'],
                'description': '呼吸频率异常'
            },
            'temp_spike': {
                'channels': ['temp'],
                'features': ['mean', 'variance'],
                'description': '体温异常'
            },
            'eda_sudden_change': {
                'channels': ['eda'],
                'features': ['variance', 'peak'],
                'description': '皮肤电突变'
            },
            'spo2_drop': {
                'channels': ['spo2'],
                'features': ['mean', 'variance'],
                'description': '血氧下降'
            },
            'ppg_weak_pulse': {
                'channels': ['ppg'],
                'features': ['peak', 'rms'],
                'description': '脉搏波减弱'
            }
        }
    
    def _extract_feature_vector(self, event):
        features = []
        channel = event.get('channel', '')
        
        time_anomalies = event.get('details', {}).get('time_anomalies', {})
        for feat_name in ['mean', 'variance', 'peak', 'rms', 'zero_crossing_rate']:
            if feat_name in time_anomalies:
                features.append(time_anomalies[feat_name].get('deviation', 0))
        
        freq_anomalies = event.get('details', {}).get('freq_anomalies', {})
        for feat_name in ['delta_power', 'theta_power', 'alpha_power', 'beta_power', 'gamma_power']:
            if feat_name in freq_anomalies:
                features.append(freq_anomalies[feat_name].get('deviation', 0))
        
        return np.array(features)
    
    def _recognize_pattern(self, event):
        channel = event.get('channel', '')
        score = event.get('score', 0)
        
        for pattern_name, pattern_def in self.pattern_definitions.items():
            if channel in pattern_def['channels'] and score > 2:
                return pattern_name, pattern_def['description']
        
        return 'unknown', '未知模式'
    
    def add_event(self, patient_id, event):
        event['patient_id'] = patient_id
        self.event_history.append(event)
        
        pattern_type, description = self._recognize_pattern(event)
        event['pattern_type'] = pattern_type
        event['pattern_description'] = description
        
        feature_vec = self._extract_feature_vector(event)
        
        assigned_cluster = None
        
        for cluster_id, cluster in self.clusters.items():
            if cluster.pattern_type == pattern_type:
                cluster_features = np.array([self._extract_feature_vector(e) for e in cluster.events])
                if len(cluster_features) > 0:
                    centroid = np.mean(cluster_features, axis=0)
                    similarity = np.dot(feature_vec, centroid) / (
                        np.linalg.norm(feature_vec) * np.linalg.norm(centroid) + 1e-8
                    )
                    if similarity > self.threshold:
                        assigned_cluster = cluster_id
                        break
        
        if assigned_cluster is None and len(self.clusters) < self.max_clusters:
            self.cluster_counter += 1
            new_cluster = AnomalyCluster(self.cluster_counter, pattern_type, feature_vec)
            new_cluster.add_event(event)
            self.clusters[self.cluster_counter] = new_cluster
            assigned_cluster = self.cluster_counter
        elif assigned_cluster is not None:
            self.clusters[assigned_cluster].add_event(event)
        
        event['cluster_id'] = assigned_cluster
        return event
    
    def get_clusters_summary(self):
        summaries = []
        for cluster_id, cluster in self.clusters.items():
            summary = cluster.get_summary()
            if summary['pattern_type'] in self.pattern_definitions:
                summary['description'] = self.pattern_definitions[summary['pattern_type']]['description']
            else:
                summary['description'] = '未知模式'
            summaries.append(summary)
        
        summaries.sort(key=lambda x: x['count'], reverse=True)
        return summaries
    
    def get_pattern_statistics(self):
        stats = defaultdict(lambda: {'count': 0, 'patients': set(), 'channels': set()})
        
        for event in self.event_history:
            pattern = event.get('pattern_type', 'unknown')
            stats[pattern]['count'] += 1
            stats[pattern]['patients'].add(event.get('patient_id', ''))
            stats[pattern]['channels'].add(event.get('channel', ''))
        
        result = {}
        for pattern, data in stats.items():
            result[pattern] = {
                'count': data['count'],
                'patient_count': len(data['patients']),
                'patients': list(data['patients']),
                'channels': list(data['channels'])
            }
        
        return result
    
    def clear_history(self):
        self.clusters = {}
        self.cluster_counter = 0
        self.event_history = []
