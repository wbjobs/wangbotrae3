from typing import List, Dict, Tuple, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass
import math
from history_storage import HistoryStorage, ScanHistoryRecord


@dataclass
class PredictionResult:
    device: str
    device_model: str
    current_bad_sectors: int
    predicted_bad_sectors_6months: int
    predicted_new_bad_sectors: int
    monthly_growth_rate: float
    confidence_level: str
    high_risk_zones: List[Tuple[int, int, float]]
    recommendation: str
    health_trend: str
    prediction_date: str


class BadSectorPredictor:
    def __init__(self, history_storage: HistoryStorage):
        self.history = history_storage
    
    def predict(self, device: str) -> Optional[PredictionResult]:
        device_history = self.history.get_device_history(device)
        
        if len(device_history) < 2:
            return None
        
        device_history.sort(key=lambda x: x.timestamp)
        
        current_scan = device_history[-1]
        prev_scan = device_history[0]
        
        days_between = self._days_between(prev_scan.timestamp, current_scan.timestamp)
        
        if days_between < 1:
            days_between = 1
        
        bad_sector_increase = current_scan.bad_sectors + current_scan.unreadable_sectors - \
                              (prev_scan.bad_sectors + prev_scan.unreadable_sectors)
        
        daily_growth_rate = bad_sector_increase / days_between
        monthly_growth_rate = daily_growth_rate * 30
        
        predicted_new_6months = int(round(monthly_growth_rate * 6))
        predicted_new_6months = max(0, predicted_new_6months)
        
        current_bad = current_scan.bad_sectors + current_scan.unreadable_sectors
        predicted_total_6months = current_bad + predicted_new_6months
        
        confidence = self._calculate_confidence(len(device_history), days_between, bad_sector_increase)
        high_risk_zones = self._identify_high_risk_zones(device_history)
        recommendation = self._generate_recommendation(predicted_new_6months, monthly_growth_rate, current_bad)
        health_trend = self._determine_health_trend(device_history)
        
        return PredictionResult(
            device=device,
            device_model=current_scan.device_model,
            current_bad_sectors=current_bad,
            predicted_bad_sectors_6months=predicted_total_6months,
            predicted_new_bad_sectors=predicted_new_6months,
            monthly_growth_rate=round(monthly_growth_rate, 2),
            confidence_level=confidence,
            high_risk_zones=high_risk_zones,
            recommendation=recommendation,
            health_trend=health_trend,
            prediction_date=datetime.now().isoformat()
        )
    
    def _linear_regression(self, history: List[ScanHistoryRecord]) -> Tuple[float, float]:
        if len(history) < 2:
            return 0.0, 0.0
        
        base_time = datetime.fromisoformat(history[0].timestamp)
        x = []
        y = []
        
        for record in history:
            t = datetime.fromisoformat(record.timestamp)
            days = (t - base_time).total_seconds() / 86400.0
            x.append(days)
            y.append(record.bad_sectors + record.unreadable_sectors)
        
        n = len(x)
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(xi * yi for xi, yi in zip(x, y))
        sum_x2 = sum(xi * xi for xi in x)
        
        denominator = n * sum_x2 - sum_x * sum_x
        if abs(denominator) < 1e-10:
            return 0.0, sum_y / n if n > 0 else 0.0
        
        slope = (n * sum_xy - sum_x * sum_y) / denominator
        intercept = (sum_y - slope * sum_x) / n
        
        return slope, intercept
    
    def _days_between(self, timestamp1: str, timestamp2: str) -> float:
        t1 = datetime.fromisoformat(timestamp1)
        t2 = datetime.fromisoformat(timestamp2)
        delta = t2 - t1
        return delta.total_seconds() / 86400.0
    
    def _calculate_confidence(self, num_records: int, days_span: float, total_increase: int) -> str:
        score = 0
        
        if num_records >= 10:
            score += 3
        elif num_records >= 5:
            score += 2
        elif num_records >= 3:
            score += 1
        
        if days_span >= 30:
            score += 3
        elif days_span >= 14:
            score += 2
        elif days_span >= 7:
            score += 1
        
        if abs(total_increase) > 0:
            score += 1
        
        if score >= 6:
            return "高"
        elif score >= 3:
            return "中"
        else:
            return "低"
    
    def _identify_high_risk_zones(self, history: List[ScanHistoryRecord]) -> List[Tuple[int, int, float]]:
        zones = []
        
        if not history:
            return zones
        
        recent_scans = history[-3:]
        all_bad_positions = []
        
        for scan in recent_scans:
            all_bad_positions.extend(scan.bad_sector_positions)
        
        if not all_bad_positions:
            return zones
        
        min_sector = min(all_bad_positions)
        max_sector = max(all_bad_positions)
        
        if max_sector == min_sector:
            return zones
        
        num_zones = 10
        zone_size = (max_sector - min_sector) // num_zones + 1
        
        for i in range(num_zones):
            zone_start = min_sector + i * zone_size
            zone_end = min_sector + (i + 1) * zone_size
            
            bad_count = sum(
                1 for pos in all_bad_positions
                if zone_start <= pos < zone_end
            )
            
            if bad_count > 0:
                risk_score = min(1.0, bad_count / len(recent_scans) * 2)
                zones.append((zone_start, zone_end, risk_score))
        
        zones.sort(key=lambda x: x[2], reverse=True)
        return zones[:5]
    
    def _generate_recommendation(self, 
                                 predicted_new: int, 
                                 monthly_growth: float, 
                                 current_bad: int) -> str:
        if current_bad == 0 and predicted_new == 0:
            return "磁盘状态良好，建议继续保持定期监控。"
        elif predicted_new > 20 or monthly_growth > 5:
            return "⚠️ 高风险！坏道增长速度过快，建议立即备份数据并考虑更换硬盘。"
        elif predicted_new > 10 or monthly_growth > 2:
            return "⚠️ 中高风险！坏道有明显增长趋势，建议增加扫描频率并重要数据备份。"
        elif predicted_new > 5:
            return "⚠️ 中等风险！坏道有轻微增长趋势，建议继续监控并准备备用方案。"
        elif predicted_new > 0:
            return "低风险。建议保持定期监控，确保重要数据已备份。"
        else:
            return "状态稳定。继续保持定期扫描和监控即可。"
    
    def _determine_health_trend(self, history: List[ScanHistoryRecord]) -> str:
        if len(history) < 2:
            return "未知"
        
        early_avg = sum(
            (r.bad_sectors + r.unreadable_sectors) 
            for r in history[:len(history)//2]
        ) / (len(history)//2)
        
        recent_avg = sum(
            (r.bad_sectors + r.unreadable_sectors) 
            for r in history[-(len(history)//2):]
        ) / (len(history)//2)
        
        change_percent = ((recent_avg - early_avg) / max(early_avg, 1)) * 100
        
        if change_percent > 50:
            return "快速恶化"
        elif change_percent > 20:
            return "缓慢恶化"
        elif change_percent > -5:
            return "基本稳定"
        else:
            return "波动中"
    
    def generate_prediction_chart_data(self, device: str) -> Dict:
        device_history = self.history.get_device_history(device)
        
        if len(device_history) < 2:
            return {}
        
        device_history.sort(key=lambda x: x.timestamp)
        
        slope, intercept = self._linear_regression(device_history)
        
        base_time = datetime.fromisoformat(device_history[0].timestamp)
        
        actual_data = []
        for record in device_history:
            t = datetime.fromisoformat(record.timestamp)
            days = (t - base_time).total_seconds() / 86400.0
            actual_data.append({
                'date': record.timestamp,
                'days': round(days, 1),
                'bad_sectors': record.bad_sectors + record.unreadable_sectors
            })
        
        prediction_data = []
        last_actual_days = actual_data[-1]['days']
        last_actual_bad = actual_data[-1]['bad_sectors']
        
        for month in range(1, 7):
            future_days = last_actual_days + month * 30
            predicted_bad = intercept + slope * future_days
            predicted_bad = max(last_actual_bad, predicted_bad)
            
            prediction_data.append({
                'month': month,
                'predicted_bad_sectors': int(round(predicted_bad)),
                'new_bad_sectors': int(round(predicted_bad - last_actual_bad))
            })
        
        return {
            'actual_data': actual_data,
            'prediction_data': prediction_data,
            'slope': round(slope, 4),
            'intercept': round(intercept, 2)
        }
    
    def get_risk_color(self, risk_score: float) -> str:
        if risk_score >= 0.8:
            return "#dc2626"
        elif risk_score >= 0.5:
            return "#f59e0b"
        elif risk_score >= 0.2:
            return "#eab308"
        else:
            return "#22c55e"
