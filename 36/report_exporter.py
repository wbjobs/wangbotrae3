import json
import csv
from datetime import datetime
from typing import Dict, List
import os


class ReportExporter:
    def __init__(self):
        pass
    
    def generate_report(self, disk_info: Dict, smart_data: Dict,
                        scan_summary: Dict, bad_sectors: List[Dict],
                        repair_results: List[Dict] = None) -> Dict:
        report = {
            'report_info': {
                'generated_at': datetime.now().isoformat(),
                'version': '1.0.0'
            },
            'disk_info': disk_info,
            'smart_data': smart_data,
            'scan_summary': scan_summary,
            'bad_sectors': bad_sectors,
            'repair_results': repair_results or [],
            'overall_assessment': self._generate_assessment(scan_summary, smart_data)
        }
        return report
    
    def _generate_assessment(self, scan_summary: Dict, smart_data: Dict) -> Dict:
        bad_count = scan_summary.get('bad', 0) + scan_summary.get('unreadable', 0)
        total = scan_summary.get('total_scanned', 1)
        bad_percentage = (bad_count / total * 100) if total > 0 else 0
        
        health = 'EXCELLENT'
        recommendations = []
        
        if bad_percentage > 5:
            health = 'CRITICAL'
            recommendations.append('强烈建议立即更换硬盘，数据丢失风险极高！')
            recommendations.append('请立即备份所有重要数据')
        elif bad_percentage > 1:
            health = 'WARNING'
            recommendations.append('建议备份重要数据')
            recommendations.append('考虑对坏道进行修复或标记')
            recommendations.append('定期监控硬盘健康状态')
        elif bad_percentage > 0:
            health = 'FAIR'
            recommendations.append('建议定期监控硬盘状态')
            recommendations.append('可尝试修复逻辑坏道')
        else:
            health = 'GOOD'
            recommendations.append('硬盘状态良好')
            recommendations.append('建议定期进行健康检查')
        
        temp = smart_data.get('temperature', 0)
        if temp > 60:
            recommendations.append(f'硬盘温度过高 ({temp}°C)，请检查散热')
        
        return {
            'health_status': health,
            'bad_sector_percentage': round(bad_percentage, 2),
            'recommendations': recommendations
        }
    
    def export_to_json(self, report: Dict, file_path: str) -> bool:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"JSON export error: {e}")
            return False
    
    def export_to_csv(self, report: Dict, file_path: str) -> bool:
        try:
            base_dir = os.path.dirname(file_path)
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            
            bad_sectors_file = os.path.join(base_dir, f'{base_name}_bad_sectors.csv')
            with open(bad_sectors_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['序号', '扇区号', '状态', '块索引'])
                for i, sector in enumerate(report.get('bad_sectors', []), 1):
                    writer.writerow([i, sector.get('sector'), sector.get('status'), sector.get('block_index')])
            
            summary_file = os.path.join(base_dir, f'{base_name}_summary.csv')
            with open(summary_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['项目', '值'])
                
                scan_summary = report.get('scan_summary', {})
                writer.writerow(['扫描总数', scan_summary.get('total_scanned', 0)])
                writer.writerow(['良好扇区', scan_summary.get('good', 0)])
                writer.writerow(['缓慢扇区', scan_summary.get('slow', 0)])
                writer.writerow(['待处理扇区', scan_summary.get('pending', 0)])
                writer.writerow(['损坏扇区', scan_summary.get('bad', 0)])
                writer.writerow(['不可读扇区', scan_summary.get('unreadable', 0)])
                
                assessment = report.get('overall_assessment', {})
                writer.writerow([])
                writer.writerow(['健康状态', assessment.get('health_status', 'UNKNOWN')])
                writer.writerow(['坏道百分比', f"{assessment.get('bad_sector_percentage', 0)}%"])
            
            if report.get('repair_results'):
                repair_file = os.path.join(base_dir, f'{base_name}_repair.csv')
                with open(repair_file, 'w', newline='', encoding='utf-8') as f:
                    writer = csv.writer(f)
                    writer.writerow(['扇区号', '状态', '消息'])
                    for result in report.get('repair_results', []):
                        writer.writerow([result.get('sector'), result.get('status'), result.get('message')])
            
            return True
        except Exception as e:
            print(f"CSV export error: {e}")
            return False
    
    def export_to_html(self, report: Dict, file_path: str) -> bool:
        try:
            html_content = self._generate_html_report(report)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            return True
        except Exception as e:
            print(f"HTML export error: {e}")
            return False
    
    def _generate_html_report(self, report: Dict) -> str:
        disk_info = report.get('disk_info', {})
        scan_summary = report.get('scan_summary', {})
        assessment = report.get('overall_assessment', {})
        bad_sectors = report.get('bad_sectors', [])
        
        health_colors = {
            'EXCELLENT': '#22c55e',
            'GOOD': '#22c55e',
            'FAIR': '#f59e0b',
            'WARNING': '#f97316',
            'CRITICAL': '#ef4444'
        }
        
        health_color = health_colors.get(assessment.get('health_status', 'UNKNOWN'), '#6b7280')
        
        html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>硬盘健康检测报告</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: 'Microsoft YaHei', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px 20px;
            min-height: 100vh;
        }}
        .container {{
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }}
        .header {{
            background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
            color: white;
            padding: 30px 40px;
        }}
        .header h1 {{
            font-size: 28px;
            margin-bottom: 10px;
        }}
        .header .date {{
            opacity: 0.8;
            font-size: 14px;
        }}
        .content {{
            padding: 40px;
        }}
        .section {{
            margin-bottom: 35px;
        }}
        .section-title {{
            font-size: 18px;
            font-weight: bold;
            color: #1e3a5f;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e5e7eb;
        }}
        .health-card {{
            background: linear-gradient(135deg, {health_color} 0%, {self._adjust_color(health_color, -20)} 100%);
            color: white;
            padding: 30px;
            border-radius: 12px;
            text-align: center;
            margin-bottom: 20px;
        }}
        .health-card .status {{
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 10px;
        }}
        .health-card .subtitle {{
            font-size: 14px;
            opacity: 0.9;
        }}
        .grid-2 {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }}
        .info-card {{
            background: #f8fafc;
            border-radius: 8px;
            padding: 20px;
        }}
        .info-card h3 {{
            font-size: 14px;
            color: #64748b;
            margin-bottom: 10px;
        }}
        .info-card .value {{
            font-size: 24px;
            font-weight: bold;
            color: #1e293b;
        }}
        .disk-info-grid {{
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
        }}
        .info-item {{
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #f1f5f9;
        }}
        .info-item .label {{
            color: #64748b;
            font-size: 14px;
        }}
        .info-item .data {{
            color: #1e293b;
            font-weight: 500;
        }}
        .progress-bar {{
            height: 8px;
            background: #e2e8f0;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 5px;
        }}
        .progress-fill {{
            height: 100%;
            border-radius: 4px;
        }}
        .bad-sectors-list {{
            max-height: 300px;
            overflow-y: auto;
        }}
        .sector-item {{
            display: flex;
            justify-content: space-between;
            padding: 12px 15px;
            background: #fef2f2;
            border-radius: 6px;
            margin-bottom: 8px;
            border-left: 4px solid #ef4444;
        }}
        .recommendations {{
            background: #f0f9ff;
            border-left: 4px solid #3b82f6;
            padding: 20px;
            border-radius: 0 8px 8px 0;
        }}
        .recommendations h4 {{
            color: #1e40af;
            margin-bottom: 10px;
        }}
        .recommendations ul {{
            padding-left: 20px;
        }}
        .recommendations li {{
            color: #1e3a8a;
            margin-bottom: 5px;
        }}
        .footer {{
            text-align: center;
            padding: 20px;
            color: #94a3b8;
            font-size: 12px;
            border-top: 1px solid #e2e8f0;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>💾 硬盘健康检测报告</h1>
            <div class="date">生成时间: {report.get('report_info', {}).get('generated_at', '')}</div>
        </div>
        <div class="content">
            <div class="health-card">
                <div class="status">{self._translate_health(assessment.get('health_status', 'UNKNOWN'))}</div>
                <div class="subtitle">坏道比例: {assessment.get('bad_sector_percentage', 0)}%</div>
            </div>
            
            <div class="section">
                <div class="section-title">📊 扫描概览</div>
                <div class="grid-2">
                    <div class="info-card">
                        <h3>扫描总块数</h3>
                        <div class="value">{scan_summary.get('total_scanned', 0):,}</div>
                    </div>
                    <div class="info-card">
                        <h3>坏道数量</h3>
                        <div class="value" style="color: #ef4444;">{len(bad_sectors):,}</div>
                    </div>
                </div>
                <div style="margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span style="font-size: 13px; color: #64748b;">良好</span>
                        <span style="font-size: 13px;">{scan_summary.get('good', 0):,}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: {self._calc_percent(scan_summary.get('good', 0), scan_summary.get('total_scanned', 1))}%; background: #22c55e;"></div>
                    </div>
                </div>
                <div style="margin-top: 15px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span style="font-size: 13px; color: #64748b;">损坏/不可读</span>
                        <span style="font-size: 13px;">{scan_summary.get('bad', 0) + scan_summary.get('unreadable', 0):,}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: {self._calc_percent(scan_summary.get('bad', 0) + scan_summary.get('unreadable', 0), scan_summary.get('total_scanned', 1))}%; background: #ef4444;"></div>
                    </div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">💿 硬盘信息</div>
                <div class="disk-info-grid">
                    <div class="info-item">
                        <span class="label">设备</span>
                        <span class="data">{disk_info.get('device', 'N/A')}</span>
                    </div>
                    <div class="info-item">
                        <span class="label">型号</span>
                        <span class="data">{disk_info.get('model', 'N/A')}</span>
                    </div>
                    <div class="info-item">
                        <span class="label">容量</span>
                        <span class="data">{disk_info.get('size_gb', 'N/A')} GB</span>
                    </div>
                    <div class="info-item">
                        <span class="label">类型</span>
                        <span class="data">{'SSD' if disk_info.get('is_ssd') else 'HDD'}</span>
                    </div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">⚠️ 坏道列表 ({len(bad_sectors)} 个)</div>
                {"<div class='bad-sectors-list'>" + "".join([f'''
                    <div class="sector-item">
                        <span>#{i+1} 扇区: {sector.get('sector')}</span>
                        <span style="color: #dc2626; font-weight: 500;">{sector.get('status')}</span>
                    </div>
                ''' for i, sector in enumerate(bad_sectors[:20])]) + "</div>" if bad_sectors else "<p style='color: #9ca3af; text-align: center; padding: 30px;'>未发现坏道</p>"}
                {f"<p style='color: #9ca3af; text-align: center; padding: 10px; font-size: 12px;'>... 还有 {len(bad_sectors) - 20} 个坏道未显示</p>" if len(bad_sectors) > 20 else ""}
            </div>
            
            <div class="section">
                <div class="section-title">💡 建议</div>
                <div class="recommendations">
                    <h4>检测结果分析与建议</h4>
                    <ul>
                        {"".join([f"<li>{rec}</li>" for rec in assessment.get('recommendations', [])])}
                    </ul>
                </div>
            </div>
        </div>
        <div class="footer">
            多格式硬盘坏道扫描与修复工具 v{report.get('report_info', {}).get('version', '1.0.0')}
        </div>
    </div>
</body>
</html>"""
        return html
    
    def _adjust_color(self, hex_color: str, amount: int) -> str:
        hex_color = hex_color.lstrip('#')
        r = max(0, min(255, int(hex_color[0:2], 16) + amount))
        g = max(0, min(255, int(hex_color[2:4], 16) + amount))
        b = max(0, min(255, int(hex_color[4:6], 16) + amount))
        return f'#{r:02x}{g:02x}{b:02x}'
    
    def _translate_health(self, status: str) -> str:
        translations = {
            'EXCELLENT': '🌟 优秀',
            'GOOD': '✅ 良好',
            'FAIR': '⚠️ 一般',
            'WARNING': '🔶 警告',
            'CRITICAL': '🔴 危险',
            'UNKNOWN': '❓ 未知'
        }
        return translations.get(status, status)
    
    def _calc_percent(self, part: int, total: int) -> float:
        if total == 0:
            return 0
        return min(100, (part / total) * 100)
    
    def export_to_text(self, report: Dict, file_path: str) -> bool:
        try:
            disk_info = report.get('disk_info', {})
            scan_summary = report.get('scan_summary', {})
            assessment = report.get('overall_assessment', {})
            bad_sectors = report.get('bad_sectors', [])
            
            lines = []
            lines.append("=" * 60)
            lines.append("           硬盘健康检测报告")
            lines.append("=" * 60)
            lines.append(f"生成时间: {report.get('report_info', {}).get('generated_at', '')}")
            lines.append("")
            
            lines.append("-" * 60)
            lines.append("【整体评估】")
            lines.append("-" * 60)
            lines.append(f"健康状态: {assessment.get('health_status', 'UNKNOWN')}")
            lines.append(f"坏道比例: {assessment.get('bad_sector_percentage', 0)}%")
            lines.append("")
            lines.append("建议:")
            for rec in assessment.get('recommendations', []):
                lines.append(f"  - {rec}")
            lines.append("")
            
            lines.append("-" * 60)
            lines.append("【扫描概览】")
            lines.append("-" * 60)
            lines.append(f"扫描总数:   {scan_summary.get('total_scanned', 0):,}")
            lines.append(f"良好扇区:   {scan_summary.get('good', 0):,}")
            lines.append(f"缓慢扇区:   {scan_summary.get('slow', 0):,}")
            lines.append(f"待处理扇区: {scan_summary.get('pending', 0):,}")
            lines.append(f"损坏扇区:   {scan_summary.get('bad', 0):,}")
            lines.append(f"不可读扇区: {scan_summary.get('unreadable', 0):,}")
            lines.append("")
            
            lines.append("-" * 60)
            lines.append("【硬盘信息】")
            lines.append("-" * 60)
            lines.append(f"设备:   {disk_info.get('device', 'N/A')}")
            lines.append(f"型号:   {disk_info.get('model', 'N/A')}")
            lines.append(f"容量:   {disk_info.get('size_gb', 'N/A')} GB")
            lines.append(f"类型:   {'SSD' if disk_info.get('is_ssd') else 'HDD'}")
            lines.append("")
            
            if bad_sectors:
                lines.append("-" * 60)
                lines.append(f"【坏道列表】共 {len(bad_sectors)} 个")
                lines.append("-" * 60)
                for i, sector in enumerate(bad_sectors[:50], 1):
                    lines.append(f"{i:3d}. 扇区 {sector.get('sector'):<10} 状态: {sector.get('status')}")
                if len(bad_sectors) > 50:
                    lines.append(f"... 还有 {len(bad_sectors) - 50} 个坏道")
                lines.append("")
            
            lines.append("=" * 60)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(lines))
            
            return True
        except Exception as e:
            print(f"Text export error: {e}")
            return False
