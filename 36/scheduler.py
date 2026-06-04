import os
import json
import time
import threading
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from typing import Dict, List, Optional, Callable
from dataclasses import dataclass, asdict, field
import platform


@dataclass
class ScheduledTask:
    task_id: str
    device: str
    device_model: str
    scan_type: str
    schedule_type: str
    day_of_week: int
    hour: int
    minute: int
    enabled: bool
    email_notification: bool
    last_run: Optional[str] = None
    next_run: Optional[str] = None


@dataclass
class EmailConfig:
    smtp_server: str
    smtp_port: int
    use_tls: bool
    username: str
    password: str
    sender_email: str
    recipient_email: str
    enabled: bool = False


class EmailNotifier:
    def __init__(self, config: EmailConfig):
        self.config = config
    
    def send_scan_report(self, 
                         device: str,
                         device_model: str,
                         scan_summary: Dict,
                         bad_sectors: List[Dict],
                         prediction_result: Optional[Dict] = None,
                         attachment_path: Optional[str] = None) -> bool:
        if not self.config.enabled:
            return False
        
        try:
            msg = MIMEMultipart()
            msg['From'] = self.config.sender_email
            msg['To'] = self.config.recipient_email
            msg['Subject'] = f"磁盘扫描报告 - {device_model}"
            
            body = self._generate_email_body(device, device_model, scan_summary, bad_sectors, prediction_result)
            msg.attach(MIMEText(body, 'html', 'utf-8'))
            
            if attachment_path and os.path.exists(attachment_path):
                with open(attachment_path, 'rb') as f:
                    part = MIMEBase('application', 'octet-stream')
                    part.set_payload(f.read())
                encoders.encode_base64(part)
                filename = os.path.basename(attachment_path)
                part.add_header('Content-Disposition', f'attachment; filename="{filename}"')
                msg.attach(part)
            
            return self._send_email(msg)
        except Exception as e:
            print(f"Email send error: {e}")
            return False
    
    def _generate_email_body(self,
                             device: str,
                             device_model: str,
                             scan_summary: Dict,
                             bad_sectors: List[Dict],
                             prediction_result: Optional[Dict]) -> str:
        total_bad = scan_summary.get('bad', 0) + scan_summary.get('unreadable', 0)
        health_status = "健康" if total_bad == 0 else "警告" if total_bad < 10 else "危险"
        
        prediction_html = ""
        if prediction_result:
            prediction_html = f"""
            <div style="margin-top: 20px; padding: 15px; background: #f0f9ff; border-radius: 8px;">
                <h3 style="color: #0369a1; margin: 0 0 10px 0;">📈 坏道预测</h3>
                <p><strong>预测6个月后新增坏道：</strong>{prediction_result.get('predicted_new', 0)} 个</p>
                <p><strong>月增长率：</strong>{prediction_result.get('monthly_growth', 0)} 个/月</p>
                <p><strong>健康趋势：</strong>{prediction_result.get('health_trend', '未知')}</p>
                <p style="background: #fef3c7; padding: 10px; border-radius: 4px;">
                    <strong>建议：</strong>{prediction_result.get('recommendation', '')}
                </p>
            </div>
            """
        
        html = f"""
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .header {{ background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); color: white; padding: 20px; border-radius: 8px; }}
                .status {{ display: inline-block; padding: 5px 15px; border-radius: 20px; color: white; font-weight: bold; }}
                .status-good {{ background: #22c55e; }}
                .status-warning {{ background: #f59e0b; }}
                .status-danger {{ background: #ef4444; }}
                .stats {{ display: flex; gap: 20px; margin: 20px 0; }}
                .stat-box {{ flex: 1; padding: 15px; background: #f9fafb; border-radius: 8px; text-align: center; }}
                .stat-value {{ font-size: 24px; font-weight: bold; color: #3b82f6; }}
                .stat-label {{ font-size: 12px; color: #6b7280; }}
                .bad-sectors {{ margin-top: 20px; }}
                .bad-sector-item {{ padding: 8px; background: #fef2f2; border-left: 4px solid #ef4444; margin: 5px 0; }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1 style="margin: 0;">💾 磁盘扫描报告</h1>
                <p style="margin: 5px 0 0 0;">扫描时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            </div>
            
            <div style="margin-top: 20px;">
                <h2>设备信息</h2>
                <p><strong>设备：</strong>{device}</p>
                <p><strong>型号：</strong>{device_model}</p>
                <p><strong>健康状态：</strong><span class="status status-{health_status.lower()}">{health_status}</span></p>
            </div>
            
            <div class="stats">
                <div class="stat-box">
                    <div class="stat-value">{scan_summary.get('total_scanned', 0)}</div>
                    <div class="stat-label">已扫描</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value" style="color: #22c55e;">{scan_summary.get('good', 0)}</div>
                    <div class="stat-label">良好</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value" style="color: #ef4444;">{total_bad}</div>
                    <div class="stat-label">损坏</div>
                </div>
            </div>
            
            {prediction_html}
            
            <div class="bad-sectors">
                <h3>坏道列表 ({len(bad_sectors)} 个)</h3>
                {"".join(f'<div class="bad-sector-item">扇区 {bs.get("sector", "N/A")} - {bs.get("status", "BAD")}</div>' for bs in bad_sectors[:20])}
                {f'<p>... 还有 {len(bad_sectors) - 20} 个坏道</p>' if len(bad_sectors) > 20 else ''}
                {'' if bad_sectors else '<p style="color: #22c55e;">🎉 没有发现坏道</p>'}
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
                <p>此邮件由磁盘坏道扫描工具自动发送</p>
            </div>
        </body>
        </html>
        """
        return html
    
    def _send_email(self, msg: MIMEMultipart) -> bool:
        try:
            if self.config.use_tls:
                server = smtplib.SMTP(self.config.smtp_server, self.config.smtp_port)
                server.starttls()
            else:
                server = smtplib.SMTP_SSL(self.config.smtp_server, self.config.smtp_port)
            
            server.login(self.config.username, self.config.password)
            server.send_message(msg)
            server.quit()
            return True
        except Exception as e:
            print(f"SMTP error: {e}")
            return False
    
    def test_connection(self) -> bool:
        try:
            if self.config.use_tls:
                server = smtplib.SMTP(self.config.smtp_server, self.config.smtp_port)
                server.starttls()
            else:
                server = smtplib.SMTP_SSL(self.config.smtp_server, self.config.smtp_port)
            
            server.login(self.config.username, self.config.password)
            server.quit()
            return True
        except Exception as e:
            print(f"Connection test failed: {e}")
            return False


class TaskScheduler:
    def __init__(self, config_dir: str = None):
        if config_dir is None:
            config_dir = os.path.join(os.path.expanduser('~'), '.disk_scanner')
        
        self.config_dir = config_dir
        self.tasks_file = os.path.join(config_dir, 'scheduled_tasks.json')
        self.email_config_file = os.path.join(config_dir, 'email_config.json')
        
        self.tasks: Dict[str, ScheduledTask] = {}
        self.email_config = EmailConfig(
            smtp_server='smtp.gmail.com',
            smtp_port=587,
            use_tls=True,
            username='',
            password='',
            sender_email='',
            recipient_email=''
        )
        
        self._running = False
        self._scheduler_thread: Optional[threading.Thread] = None
        self._scan_callback: Optional[Callable] = None
        
        self._ensure_config_dir()
        self._load_tasks()
        self._load_email_config()
    
    def _ensure_config_dir(self):
        if not os.path.exists(self.config_dir):
            os.makedirs(self.config_dir, exist_ok=True)
    
    def _load_tasks(self):
        if not os.path.exists(self.tasks_file):
            return
        
        try:
            with open(self.tasks_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for task_data in data:
                    task = ScheduledTask(**task_data)
                    self.tasks[task.task_id] = task
        except Exception as e:
            print(f"Load tasks error: {e}")
    
    def _save_tasks(self):
        try:
            task_list = [asdict(task) for task in self.tasks.values()]
            with open(self.tasks_file, 'w', encoding='utf-8') as f:
                json.dump(task_list, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Save tasks error: {e}")
    
    def _load_email_config(self):
        if not os.path.exists(self.email_config_file):
            return
        
        try:
            with open(self.email_config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.email_config = EmailConfig(**data)
        except Exception as e:
            print(f"Load email config error: {e}")
    
    def save_email_config(self, config: EmailConfig):
        self.email_config = config
        try:
            with open(self.email_config_file, 'w', encoding='utf-8') as f:
                json.dump(asdict(config), f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"Save email config error: {e}")
            return False
    
    def add_task(self, task: ScheduledTask) -> str:
        self.tasks[task.task_id] = task
        self._save_tasks()
        return task.task_id
    
    def remove_task(self, task_id: str) -> bool:
        if task_id in self.tasks:
            del self.tasks[task_id]
            self._save_tasks()
            return True
        return False
    
    def update_task(self, task_id: str, **kwargs) -> bool:
        if task_id in self.tasks:
            task = self.tasks[task_id]
            for key, value in kwargs.items():
                if hasattr(task, key):
                    setattr(task, key, value)
            self._save_tasks()
            return True
        return False
    
    def get_tasks(self) -> List[ScheduledTask]:
        return list(self.tasks.values())
    
    def get_task(self, task_id: str) -> Optional[ScheduledTask]:
        return self.tasks.get(task_id)
    
    def calculate_next_run(self, task: ScheduledTask) -> str:
        now = datetime.now()
        days_ahead = (task.day_of_week - now.weekday() + 7) % 7
        
        if days_ahead == 0:
            if now.hour > task.hour or (now.hour == task.hour and now.minute >= task.minute):
                days_ahead = 7
        
        next_run = now + timedelta(days=days_ahead)
        next_run = next_run.replace(
            hour=task.hour,
            minute=task.minute,
            second=0,
            microsecond=0
        )
        
        return next_run.isoformat()
    
    def set_scan_callback(self, callback: Callable):
        self._scan_callback = callback
    
    def start(self):
        if self._running:
            return
        
        self._running = True
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()
    
    def stop(self):
        self._running = False
        if self._scheduler_thread:
            self._scheduler_thread.join(timeout=2)
    
    def _scheduler_loop(self):
        while self._running:
            try:
                now = datetime.now()
                
                for task in self.tasks.values():
                    if not task.enabled:
                        continue
                    
                    next_run_str = self.calculate_next_run(task)
                    task.next_run = next_run_str
                    
                    next_run = datetime.fromisoformat(next_run_str)
                    time_diff = (next_run - now).total_seconds()
                    
                    if 0 <= time_diff <= 60:
                        self._execute_task(task)
                
                time.sleep(30)
            except Exception as e:
                print(f"Scheduler loop error: {e}")
                time.sleep(30)
    
    def _execute_task(self, task: ScheduledTask):
        print(f"Executing scheduled task: {task.task_id}")
        task.last_run = datetime.now().isoformat()
        self._save_tasks()
        
        if self._scan_callback:
            self._scan_callback(task)
    
    def get_email_notifier(self) -> EmailNotifier:
        return EmailNotifier(self.email_config)
