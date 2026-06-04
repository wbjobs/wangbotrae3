import io
import time
from datetime import datetime
from typing import List, Dict


class ReportGenerator:
    def __init__(self):
        self.patient_colors = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c']
    
    def generate_html_report(self, report_data):
        patient_names = report_data.get('patient_names', {})
        selected_patients = report_data.get('selected_patients', [])
        channel_name = report_data.get('channel_name', 'ECG')
        anomalies = report_data.get('anomalies', [])
        clusters = report_data.get('clusters', [])
        statistics = report_data.get('statistics', {})
        
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>多患者生理信号对比报告</title>
    <style>
        body {{
            font-family: 'Microsoft YaHei', Arial, sans-serif;
            margin: 40px;
            color: #333;
        }}
        h1 {{
            color: #409eff;
            border-bottom: 2px solid #409eff;
            padding-bottom: 10px;
        }}
        h2 {{
            color: #67c23a;
            margin-top: 30px;
        }}
        .header-info {{
            background: #f5f7fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }}
        .patient-card {{
            display: inline-block;
            padding: 10px 20px;
            margin: 5px;
            border-radius: 5px;
            color: white;
            font-weight: bold;
        }}
        .stat-card {{
            background: white;
            border: 1px solid #e4e7ed;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
        }}
        .stat-value {{
            font-size: 24px;
            font-weight: bold;
            color: #409eff;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }}
        th, td {{
            border: 1px solid #e4e7ed;
            padding: 10px;
            text-align: left;
        }}
        th {{
            background: #f5f7fa;
            font-weight: bold;
        }}
        .cluster-box {{
            background: #f0f9eb;
            border-left: 4px solid #67c23a;
            padding: 15px;
            margin: 10px 0;
            border-radius: 0 8px 8px 0;
        }}
        .anomaly-tag {{
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 12px;
            margin: 2px;
        }}
        .tag-detected {{ background: #ecf5ff; color: #409eff; }}
        .tag-confirmed {{ background: #f0f9eb; color: #67c23a; }}
        .tag-false {{ background: #fdf6ec; color: #e6a23c; }}
        .tag-missed {{ background: #fef0f0; color: #f56c6c; }}
    </style>
</head>
<body>
    <h1>多患者生理信号对比分析报告</h1>
    
    <div class="header-info">
        <p><strong>生成时间:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
        <p><strong>对比通道:</strong> {channel_name}</p>
        <p><strong>参与患者:</strong></p>
"""
        
        for i, pid in enumerate(selected_patients):
            pname = patient_names.get(pid, pid)
            color = self.patient_colors[i % len(self.patient_colors)]
            html_content += f'        <div class="patient-card" style="background: {color};">{pname}</div>\n'
        
        html_content += """
    </div>
    
    <h2>一、异常统计概览</h2>
    <table>
        <tr>
            <th>指标</th>
            <th>数值</th>
        </tr>
"""
        
        html_content += f"""
        <tr><td>总异常事件数</td><td class="stat-value">{statistics.get('total_anomalies', 0)}</td></tr>
        <tr><td>已确认异常</td><td class="stat-value">{statistics.get('confirmed', 0)}</td></tr>
        <tr><td>假阳性</td><td class="stat-value">{statistics.get('false_positive', 0)}</td></tr>
        <tr><td>异常聚类数</td><td class="stat-value">{statistics.get('cluster_count', 0)}</td></tr>
"""
        
        html_content += """
    </table>
    
    <h2>二、异常模式聚类分析</h2>
"""
        
        for cluster in clusters[:5]:
            html_content += f"""
    <div class="cluster-box">
        <h3>{cluster.get('description', cluster.get('pattern_type', '未知'))}</h3>
        <p><strong>发生次数:</strong> {cluster.get('count', 0)}</p>
        <p><strong>涉及患者:</strong> {', '.join(cluster.get('patients', []))}</p>
        <p><strong>涉及通道:</strong> {', '.join(cluster.get('channels', []))}</p>
        <p><strong>平均异常分数:</strong> {cluster.get('avg_score', 0):.2f}</p>
    </div>
"""
        
        html_content += """
    <h2>三、异常事件列表</h2>
    <table>
        <tr>
            <th>时间</th>
            <th>患者</th>
            <th>通道</th>
            <th>异常分数</th>
            <th>模式</th>
            <th>状态</th>
        </tr>
"""
        
        for anomaly in anomalies[:50]:
            status = anomaly.get('status', 'detected')
            status_class = {
                'detected': 'tag-detected',
                'confirmed': 'tag-confirmed',
                'false_positive': 'tag-false',
                'missed': 'tag-missed'
            }.get(status, 'tag-detected')
            
            status_text = {
                'detected': '已检测',
                'confirmed': '已确认',
                'false_positive': '假阳性',
                'missed': '漏报'
            }.get(status, status)
            
            html_content += f"""
        <tr>
            <td>{datetime.fromtimestamp(anomaly.get('timestamp', 0)).strftime('%H:%M:%S')}</td>
            <td>{patient_names.get(anomaly.get('patient_id', ''), anomaly.get('patient_id', ''))}</td>
            <td>{anomaly.get('channel', '')}</td>
            <td>{anomaly.get('score', 0):.2f}</td>
            <td>{anomaly.get('pattern_description', anomaly.get('pattern_type', ''))}</td>
            <td><span class="anomaly-tag {status_class}">{status_text}</span></td>
        </tr>
"""
        
        html_content += """
    </table>
    
    <div style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #e4e7ed; text-align: center; color: #909399;">
        <p>本报告由多通道生理信号实时监测系统自动生成</p>
    </div>
</body>
</html>
"""
        
        return html_content
    
    def generate_comparison_report(self, patients_data, channel, time_range):
        report_data = {
            'patient_names': {pid: data.get('name', pid) for pid, data in patients_data.items()},
            'selected_patients': list(patients_data.keys()),
            'channel_name': channel,
            'anomalies': [],
            'clusters': [],
            'statistics': {}
        }
        
        all_anomalies = []
        for pid, data in patients_data.items():
            for anomaly in data.get('anomalies', []):
                anomaly['patient_id'] = pid
                all_anomalies.append(anomaly)
        
        all_anomalies.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
        report_data['anomalies'] = all_anomalies
        
        status_counts = {'detected': 0, 'confirmed': 0, 'false_positive': 0, 'missed': 0}
        for a in all_anomalies:
            status_counts[a.get('status', 'detected')] += 1
        
        report_data['statistics'] = {
            'total_anomalies': len(all_anomalies),
            'confirmed': status_counts['confirmed'],
            'false_positive': status_counts['false_positive'],
            'cluster_count': 0
        }
        
        return self.generate_html_report(report_data)
