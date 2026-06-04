import time
import numpy as np
from anomaly_detector import AnomalyDetector

def test_adaptive_baseline():
    print("=== 测试自适应基线异常检测 ===")
    
    detector = AnomalyDetector('ecg')
    current_time = time.time()
    
    print(f"\n1. 初始状态:")
    status = detector.get_baseline_status(current_time)
    print(f"   是否学习中: {status['is_learning']}")
    print(f"   学习进度: {status['learning_progress']:.2%}")
    
    print(f"\n2. 模拟学习阶段（前5分钟）- 生成正常信号:")
    for i in range(60):
        timestamp = current_time + i * 0.1
        time_features = {
            'mean': 0.5 + np.random.normal(0, 0.05),
            'variance': 0.1 + np.random.normal(0, 0.01),
            'peak': 1.0 + np.random.normal(0, 0.1),
            'rms': 0.3 + np.random.normal(0, 0.03),
            'zero_crossing_rate': 0.2 + np.random.normal(0, 0.02)
        }
        freq_features = {
            'delta_power': 100 + np.random.normal(0, 10),
            'theta_power': 80 + np.random.normal(0, 8),
            'alpha_power': 60 + np.random.normal(0, 6),
            'beta_power': 40 + np.random.normal(0, 4),
            'gamma_power': 20 + np.random.normal(0, 2)
        }
        
        result = detector.detect_combined(time_features, freq_features, timestamp)
        
        if i % 20 == 0:
            status = detector.get_baseline_status(timestamp)
            print(f"   步骤 {i}: 学习中={status['is_learning']}, 进度={status['learning_progress']:.2%}, 异常={result['is_anomaly']}")
    
    print(f"\n3. 快速模拟5分钟后（跳过学习阶段）:")
    future_time = current_time + 400
    for i in range(10):
        timestamp = future_time + i * 0.1
        time_features = {
            'mean': 0.5 + np.random.normal(0, 0.05),
            'variance': 0.1 + np.random.normal(0, 0.01),
            'peak': 1.0 + np.random.normal(0, 0.1),
            'rms': 0.3 + np.random.normal(0, 0.03),
            'zero_crossing_rate': 0.2 + np.random.normal(0, 0.02)
        }
        freq_features = {
            'delta_power': 100 + np.random.normal(0, 10),
            'theta_power': 80 + np.random.normal(0, 8),
            'alpha_power': 60 + np.random.normal(0, 6),
            'beta_power': 40 + np.random.normal(0, 4),
            'gamma_power': 20 + np.random.normal(0, 2)
        }
        
        result = detector.detect_combined(time_features, freq_features, timestamp)
        
        status = detector.get_baseline_status(timestamp)
        print(f"   步骤 {i}: 学习中={status['is_learning']}, 进度={status['learning_progress']:.2%}, 异常={result['is_anomaly']}")
    
    print(f"\n4. 测试正常信号（不应报警）:")
    normal_count = 0
    for i in range(20):
        timestamp = future_time + 10 + i
        time_features = {
            'mean': 0.5 + np.random.normal(0, 0.05),
            'variance': 0.1 + np.random.normal(0, 0.01),
            'peak': 1.0 + np.random.normal(0, 0.1),
            'rms': 0.3 + np.random.normal(0, 0.03),
            'zero_crossing_rate': 0.2 + np.random.normal(0, 0.02)
        }
        freq_features = {
            'delta_power': 100 + np.random.normal(0, 10),
            'theta_power': 80 + np.random.normal(0, 8),
            'alpha_power': 60 + np.random.normal(0, 6),
            'beta_power': 40 + np.random.normal(0, 4),
            'gamma_power': 20 + np.random.normal(0, 2)
        }
        
        result = detector.detect_combined(time_features, freq_features, timestamp)
        if not result['is_anomaly']:
            normal_count += 1
    
    print(f"   正常信号测试: {normal_count}/20 次未报警")
    
    print(f"\n5. 测试异常信号（应报警）:")
    anomaly_count = 0
    for i in range(20):
        timestamp = future_time + 30 + i
        time_features = {
            'mean': 0.5 + 2.0,
            'variance': 0.1 + np.random.normal(0, 0.01),
            'peak': 1.0 + np.random.normal(0, 0.1),
            'rms': 0.3 + np.random.normal(0, 0.03),
            'zero_crossing_rate': 0.2 + np.random.normal(0, 0.02)
        }
        freq_features = {
            'delta_power': 100 + np.random.normal(0, 10),
            'theta_power': 80 + np.random.normal(0, 8),
            'alpha_power': 60 + np.random.normal(0, 6),
            'beta_power': 40 + np.random.normal(0, 4),
            'gamma_power': 20 + np.random.normal(0, 2)
        }
        
        result = detector.detect_combined(time_features, freq_features, timestamp)
        if result['is_anomaly']:
            anomaly_count += 1
            print(f"   检测到异常! 分数={result['combined_score']:.2f}")
    
    print(f"   异常信号测试: {anomaly_count}/20 次报警")
    
    print(f"\n6. 测试基线重置功能:")
    detector.reset_baseline()
    status = detector.get_baseline_status(time.time())
    print(f"   重置后状态: 学习中={status['is_learning']}, 进度={status['learning_progress']:.2%}")
    
    print(f"\n=== 测试完成 ===")

if __name__ == '__main__':
    test_adaptive_baseline()
