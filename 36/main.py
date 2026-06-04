import sys
import os
import uuid
from datetime import datetime, timedelta
from typing import Dict, List
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                            QPushButton, QLabel, QComboBox, QProgressBar, QTextEdit, 
                            QTabWidget, QFrame, QSplitter, QFileDialog, QMessageBox,
                            QTableWidget, QTableWidgetItem, QHeaderView, QCheckBox,
                            QSpinBox, QLineEdit, QGroupBox, QListWidget, QListWidgetItem)
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QFont, QColor

from smart_reader import SmartReader
from disk_scanner import DiskScanner, ScanType
from disk_visualizer import DiskMapWidget, LegendWidget, BadSectorListWidget
from disk_repair import DiskRepair, RepairStatus
from report_exporter import ReportExporter
from history_storage import HistoryStorage
from bad_sector_predictor import BadSectorPredictor
from scheduler import TaskScheduler, ScheduledTask, EmailConfig


class DiskScannerApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("多格式硬盘坏道扫描与修复工具")
        self.setMinimumSize(1200, 800)
        
        self.smart_reader = SmartReader()
        self.disk_scanner = DiskScanner()
        self.disk_scanner.signals.progress.connect(self.on_scan_progress)
        self.disk_scanner.signals.bad_sector.connect(self.on_bad_sector_found)
        self.disk_scanner.signals.complete.connect(self.on_scan_complete)
        self.disk_scanner.signals.batch_ready.connect(self.on_batch_ready)
        self.disk_repair = DiskRepair()
        self.disk_repair.signals.progress.connect(self.on_repair_progress)
        self.disk_repair.signals.complete.connect(self.on_repair_complete)
        self.report_exporter = ReportExporter()
        
        self.history_storage = HistoryStorage()
        self.predictor = BadSectorPredictor(self.history_storage)
        self.scheduler = TaskScheduler()
        self.scheduler.set_scan_callback(self.on_scheduled_scan)
        self.scheduler.start()
        
        self.current_disk = None
        self.smart_data = None
        self.scan_results = []
        self.bad_sectors = []
        self.repair_results = []
        self.scan_start_time = None
        self.current_prediction = None
        
        self.init_ui()
        self.load_disks()
        self.start_update_timer()
        self.refresh_task_list()
    
    def init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(20, 20, 20, 20)
        main_layout.setSpacing(15)
        
        main_layout.addWidget(self.create_header())
        main_layout.addWidget(self.create_control_panel())
        
        self.tab_widget = QTabWidget()
        self.tab_widget.setStyleSheet("""
            QTabWidget::pane {
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                background: white;
            }
            QTabBar::tab {
                background: #f3f4f6;
                padding: 10px 20px;
                margin-right: 5px;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                font-size: 13px;
            }
            QTabBar::tab:selected {
                background: #3b82f6;
                color: white;
            }
        """)
        
        self.tab_widget.addTab(self.create_scan_tab(), "🔍 扫描")
        self.tab_widget.addTab(self.create_smart_tab(), "📊 S.M.A.R.T.")
        self.tab_widget.addTab(self.create_repair_tab(), "🔧 修复")
        self.tab_widget.addTab(self.create_prediction_tab(), "📈 预测")
        self.tab_widget.addTab(self.create_schedule_tab(), "📅 计划任务")
        self.tab_widget.addTab(self.create_report_tab(), "📋 报告")
        
        main_layout.addWidget(self.tab_widget)
        
        main_layout.addWidget(self.create_status_bar())
    
    def create_header(self):
        header = QFrame()
        header.setStyleSheet("""
            QFrame {
                background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
                border-radius: 12px;
                padding: 20px;
            }
        """)
        
        layout = QHBoxLayout(header)
        layout.setContentsMargins(30, 15, 30, 15)
        
        title_layout = QVBoxLayout()
        title = QLabel("💾 多格式硬盘坏道扫描与修复工具")
        title.setStyleSheet("color: white; font-size: 22px; font-weight: bold;")
        subtitle = QLabel("支持 NTFS / EXT4 / APFS 等多种文件系统")
        subtitle.setStyleSheet("color: rgba(255,255,255,0.8); font-size: 13px;")
        title_layout.addWidget(title)
        title_layout.addWidget(subtitle)
        
        self.health_status_label = QLabel("状态: 等待选择磁盘")
        self.health_status_label.setStyleSheet("""
            QLabel {
                background: rgba(255,255,255,0.2);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 13px;
            }
        """)
        self.health_status_label.setAlignment(Qt.AlignCenter)
        
        layout.addLayout(title_layout)
        layout.addStretch()
        layout.addWidget(self.health_status_label)
        
        return header
    
    def create_control_panel(self):
        panel = QFrame()
        panel.setStyleSheet("""
            QFrame {
                background: white;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                padding: 15px;
            }
        """)
        
        layout = QHBoxLayout(panel)
        layout.setContentsMargins(15, 10, 15, 10)
        layout.setSpacing(15)
        
        disk_label = QLabel("选择磁盘:")
        disk_label.setStyleSheet("font-size: 13px; font-weight: 500;")
        
        self.disk_combo = QComboBox()
        self.disk_combo.setMinimumWidth(300)
        self.disk_combo.setStyleSheet("""
            QComboBox {
                padding: 8px 12px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 13px;
                min-height: 20px;
            }
        """)
        self.disk_combo.currentIndexChanged.connect(self.on_disk_selected)
        
        refresh_btn = QPushButton("🔄 刷新")
        refresh_btn.setStyleSheet(self.get_button_style("#6b7280"))
        refresh_btn.clicked.connect(self.load_disks)
        
        layout.addWidget(disk_label)
        layout.addWidget(self.disk_combo)
        layout.addWidget(refresh_btn)
        layout.addStretch()
        
        return panel
    
    def get_button_style(self, color, hover_color=None):
        if hover_color is None:
            hover_color = color
        return f"""
            QPushButton {{
                background-color: {color};
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
            }}
            QPushButton:hover {{
                background-color: {hover_color};
            }}
            QPushButton:pressed {{
                background-color: {hover_color};
            }}
            QPushButton:disabled {{
                background-color: #9ca3af;
            }}
        """
    
    def create_scan_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        scan_control = QFrame()
        scan_control.setStyleSheet("background: #f9fafb; border-radius: 8px; padding: 15px;")
        scan_layout = QHBoxLayout(scan_control)
        scan_layout.setContentsMargins(10, 10, 10, 10)
        
        scan_type_label = QLabel("扫描类型:")
        self.scan_type_combo = QComboBox()
        self.scan_type_combo.addItems(["快速扫描", "深度扫描"])
        self.scan_type_combo.setStyleSheet("""
            QComboBox {
                padding: 6px 10px;
                border: 1px solid #d1d5db;
                border-radius: 4px;
            }
        """)
        
        self.start_scan_btn = QPushButton("▶ 开始扫描")
        self.start_scan_btn.setStyleSheet(self.get_button_style("#22c55e", "#16a34a"))
        self.start_scan_btn.clicked.connect(self.start_scan)
        
        self.stop_scan_btn = QPushButton("⏹ 停止扫描")
        self.stop_scan_btn.setStyleSheet(self.get_button_style("#ef4444", "#dc2626"))
        self.stop_scan_btn.clicked.connect(self.stop_scan)
        self.stop_scan_btn.setEnabled(False)
        
        scan_layout.addWidget(scan_type_label)
        scan_layout.addWidget(self.scan_type_combo)
        scan_layout.addStretch()
        scan_layout.addWidget(self.start_scan_btn)
        scan_layout.addWidget(self.stop_scan_btn)
        
        layout.addWidget(scan_control)
        
        progress_frame = QFrame()
        progress_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        progress_layout = QVBoxLayout(progress_frame)
        progress_layout.setContentsMargins(15, 15, 15, 15)
        
        progress_label = QLabel("扫描进度")
        progress_label.setStyleSheet("font-weight: bold; font-size: 14px;")
        
        self.scan_progress = QProgressBar()
        self.scan_progress.setStyleSheet("""
            QProgressBar {
                border: 1px solid #e5e7eb;
                border-radius: 4px;
                text-align: center;
                height: 24px;
            }
            QProgressBar::chunk {
                background: linear-gradient(90deg, #3b82f6, #60a5fa);
                border-radius: 3px;
            }
        """)
        
        self.scan_status = QLabel("就绪")
        self.scan_status.setStyleSheet("color: #6b7280; font-size: 12px;")
        
        progress_layout.addWidget(progress_label)
        progress_layout.addWidget(self.scan_progress)
        progress_layout.addWidget(self.scan_status)
        
        layout.addWidget(progress_frame)
        
        splitter = QSplitter(Qt.Horizontal)
        
        visualizer_frame = QFrame()
        visualizer_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        visualizer_layout = QVBoxLayout(visualizer_frame)
        visualizer_layout.setContentsMargins(15, 15, 15, 15)
        
        visualizer_title = QLabel("磁盘映射图")
        visualizer_title.setStyleSheet("font-weight: bold; font-size: 14px; margin-bottom: 10px;")
        
        self.disk_map = DiskMapWidget()
        self.disk_map.sector_clicked.connect(self.on_sector_clicked)
        
        self.legend = LegendWidget()
        
        visualizer_layout.addWidget(visualizer_title)
        visualizer_layout.addWidget(self.disk_map)
        visualizer_layout.addWidget(self.legend)
        
        self.bad_sector_list = BadSectorListWidget()
        self.bad_sector_list.setMinimumWidth(280)
        
        splitter.addWidget(visualizer_frame)
        splitter.addWidget(self.bad_sector_list)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 1)
        
        layout.addWidget(splitter, 1)
        
        stats_frame = QFrame()
        stats_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        stats_layout = QHBoxLayout(stats_frame)
        stats_layout.setContentsMargins(20, 15, 20, 15)
        
        self.stats_labels = {}
        stats_config = [
            ("已扫描", "0", "#3b82f6"),
            ("良好", "0", "#22c55e"),
            ("缓慢", "0", "#eab308"),
            ("损坏", "0", "#ef4444"),
        ]
        
        for label_text, initial_value, color in stats_config:
            stat_layout = QVBoxLayout()
            value_label = QLabel(initial_value)
            value_label.setStyleSheet(f"font-size: 24px; font-weight: bold; color: {color};")
            text_label = QLabel(label_text)
            text_label.setStyleSheet("font-size: 12px; color: #6b7280;")
            
            stat_layout.addWidget(value_label)
            stat_layout.addWidget(text_label)
            stats_layout.addLayout(stat_layout)
            
            self.stats_labels[label_text] = value_label
        
        layout.addWidget(stats_frame)
        
        return widget
    
    def create_smart_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        info_frame = QFrame()
        info_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        info_layout = QVBoxLayout(info_frame)
        info_layout.setContentsMargins(20, 15, 20, 15)
        
        info_title = QLabel("S.M.A.R.T. 信息")
        info_title.setStyleSheet("font-weight: bold; font-size: 14px; margin-bottom: 10px;")
        
        self.smart_table = QTableWidget()
        self.smart_table.setColumnCount(5)
        self.smart_table.setHorizontalHeaderLabels(["ID", "属性名称", "当前值", "最差值", "阈值", "原始值"])
        self.smart_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.smart_table.setStyleSheet("""
            QTableWidget {
                border: 1px solid #e5e7eb;
                gridline-color: #f3f4f6;
            }
            QTableWidget::item {
                padding: 8px;
            }
            QHeaderView::section {
                background: #f9fafb;
                padding: 10px;
                font-weight: bold;
                border: none;
                border-bottom: 2px solid #e5e7eb;
            }
        """)
        
        refresh_smart_btn = QPushButton("🔄 刷新 SMART 信息")
        refresh_smart_btn.setStyleSheet(self.get_button_style("#3b82f6", "#2563eb"))
        refresh_smart_btn.clicked.connect(self.refresh_smart_info)
        
        info_layout.addWidget(info_title)
        info_layout.addWidget(self.smart_table)
        info_layout.addWidget(refresh_smart_btn)
        
        layout.addWidget(info_frame)
        
        self.smart_raw = QTextEdit()
        self.smart_raw.setReadOnly(True)
        self.smart_raw.setMaximumHeight(200)
        self.smart_raw.setStyleSheet("""
            QTextEdit {
                background: #1f2937;
                color: #e5e7eb;
                border: 1px solid #374151;
                border-radius: 8px;
                padding: 10px;
                font-family: Consolas, monospace;
                font-size: 11px;
            }
        """)
        
        layout.addWidget(self.smart_raw)
        
        return widget
    
    def create_repair_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        fs_info = QFrame()
        fs_info.setStyleSheet("background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 15px;")
        fs_layout = QVBoxLayout(fs_info)
        
        fs_title = QLabel("📁 支持的文件系统")
        fs_title.setStyleSheet("font-weight: bold; font-size: 14px; color: #166534;")
        
        fs_list = QLabel("• NTFS (Windows)  • EXT4 (Linux)  • APFS (macOS)  • FAT32  • XFS  • BTRFS")
        fs_list.setStyleSheet("color: #15803d; font-size: 13px;")
        
        fs_layout.addWidget(fs_title)
        fs_layout.addWidget(fs_list)
        
        layout.addWidget(fs_info)
        
        repair_control = QFrame()
        repair_control.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        repair_layout = QVBoxLayout(repair_control)
        repair_layout.setContentsMargins(15, 15, 15, 15)
        
        repair_title = QLabel("坏道修复")
        repair_title.setStyleSheet("font-weight: bold; font-size: 14px; margin-bottom: 10px;")
        
        repair_desc = QLabel("注意：修复功能会尝试重写有问题的扇区。逻辑坏道通常可以修复，但物理坏道无法修复。")
        repair_desc.setStyleSheet("color: #6b7280; font-size: 12px; margin-bottom: 15px;")
        
        btn_layout = QHBoxLayout()
        self.start_repair_btn = QPushButton("🔧 开始修复")
        self.start_repair_btn.setStyleSheet(self.get_button_style("#f59e0b", "#d97706"))
        self.start_repair_btn.clicked.connect(self.start_repair)
        
        self.stop_repair_btn = QPushButton("⏹ 停止修复")
        self.stop_repair_btn.setStyleSheet(self.get_button_style("#ef4444", "#dc2626"))
        self.stop_repair_btn.clicked.connect(self.stop_repair)
        self.stop_repair_btn.setEnabled(False)
        
        btn_layout.addWidget(self.start_repair_btn)
        btn_layout.addWidget(self.stop_repair_btn)
        btn_layout.addStretch()
        
        repair_layout.addWidget(repair_title)
        repair_layout.addWidget(repair_desc)
        repair_layout.addLayout(btn_layout)
        
        layout.addWidget(repair_control)
        
        repair_progress_frame = QFrame()
        repair_progress_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        repair_progress_layout = QVBoxLayout(repair_progress_frame)
        repair_progress_layout.setContentsMargins(15, 15, 15, 15)
        
        self.repair_progress_label = QLabel("修复进度")
        self.repair_progress_label.setStyleSheet("font-weight: bold; font-size: 14px;")
        
        self.repair_progress = QProgressBar()
        self.repair_progress.setStyleSheet("""
            QProgressBar {
                border: 1px solid #e5e7eb;
                border-radius: 4px;
                text-align: center;
                height: 24px;
            }
            QProgressBar::chunk {
                background: linear-gradient(90deg, #f59e0b, #fbbf24);
                border-radius: 3px;
            }
        """)
        
        self.repair_status = QLabel("就绪")
        self.repair_status.setStyleSheet("color: #6b7280; font-size: 12px;")
        
        repair_progress_layout.addWidget(self.repair_progress_label)
        repair_progress_layout.addWidget(self.repair_progress)
        repair_progress_layout.addWidget(self.repair_status)
        
        layout.addWidget(repair_progress_frame)
        
        repair_results_frame = QFrame()
        repair_results_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        repair_results_layout = QVBoxLayout(repair_results_frame)
        repair_results_layout.setContentsMargins(15, 15, 15, 15)
        
        repair_results_title = QLabel("修复结果")
        repair_results_title.setStyleSheet("font-weight: bold; font-size: 14px; margin-bottom: 10px;")
        
        self.repair_results_text = QTextEdit()
        self.repair_results_text.setReadOnly(True)
        self.repair_results_text.setStyleSheet("""
            QTextEdit {
                border: 1px solid #e5e7eb;
                border-radius: 4px;
                padding: 10px;
                font-family: Consolas, monospace;
                font-size: 12px;
            }
        """)
        
        repair_results_layout.addWidget(repair_results_title)
        repair_results_layout.addWidget(self.repair_results_text)
        
        layout.addWidget(repair_results_frame, 1)
        
        return widget
    
    def create_prediction_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        pred_control = QFrame()
        pred_control.setStyleSheet("background: #f0f9ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px;")
        pred_layout = QHBoxLayout(pred_control)
        
        pred_title = QLabel("📈 坏道预测")
        pred_title.setStyleSheet("font-weight: bold; font-size: 14px; color: #1e40af;")
        
        self.run_prediction_btn = QPushButton("运行预测分析")
        self.run_prediction_btn.setStyleSheet(self.get_button_style("#3b82f6", "#2563eb"))
        self.run_prediction_btn.clicked.connect(self.run_prediction)
        
        self.toggle_risk_btn = QPushButton("显示风险区域")
        self.toggle_risk_btn.setStyleSheet(self.get_button_style("#f59e0b", "#d97706"))
        self.toggle_risk_btn.clicked.connect(self.toggle_risk_overlay)
        
        pred_layout.addWidget(pred_title)
        pred_layout.addStretch()
        pred_layout.addWidget(self.toggle_risk_btn)
        pred_layout.addWidget(self.run_prediction_btn)
        
        layout.addWidget(pred_control)
        
        self.prediction_result_frame = QFrame()
        self.prediction_result_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        self.prediction_result_layout = QVBoxLayout(self.prediction_result_frame)
        self.prediction_result_layout.setContentsMargins(20, 20, 20, 20)
        
        self.prediction_result_text = QLabel("请先进行至少2次扫描，然后运行预测分析")
        self.prediction_result_text.setStyleSheet("color: #9ca3af; font-size: 13px;")
        self.prediction_result_text.setAlignment(Qt.AlignCenter)
        self.prediction_result_text.setMinimumHeight(200)
        self.prediction_result_layout.addWidget(self.prediction_result_text)
        
        layout.addWidget(self.prediction_result_frame)
        
        history_frame = QFrame()
        history_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        history_layout = QVBoxLayout(history_frame)
        history_layout.setContentsMargins(15, 15, 15, 15)
        
        history_title = QLabel("📋 扫描历史记录")
        history_title.setStyleSheet("font-weight: bold; font-size: 14px; margin-bottom: 10px;")
        
        self.history_table = QTableWidget()
        self.history_table.setColumnCount(5)
        self.history_table.setHorizontalHeaderLabels(["扫描时间", "扫描类型", "已扫描", "坏道数", "耗时(秒)"])
        self.history_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.history_table.setStyleSheet("""
            QTableWidget { border: 1px solid #e5e7eb; gridline-color: #f3f4f6; }
            QTableWidget::item { padding: 8px; }
            QHeaderView::section { background: #f9fafb; padding: 10px; font-weight: bold; border: none; border-bottom: 2px solid #e5e7eb; }
        """)
        
        history_layout.addWidget(history_title)
        history_layout.addWidget(self.history_table)
        
        layout.addWidget(history_frame, 1)
        
        return widget
    
    def create_schedule_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        email_group = QGroupBox("📧 邮件通知设置")
        email_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                margin-top: 10px;
                padding: 15px;
            }
            QGroupBox::title { subcontrol-origin: margin; left: 15px; padding: 0 5px; }
        """)
        email_layout = QVBoxLayout(email_group)
        
        email_config_layout = QHBoxLayout()
        left_col = QVBoxLayout()
        right_col = QVBoxLayout()
        
        self.email_enable_check = QCheckBox("启用邮件通知")
        self.email_enable_check.stateChanged.connect(self.on_email_enable_changed)
        
        self.smtp_server_input = QLineEdit()
        self.smtp_server_input.setPlaceholderText("SMTP服务器 (如: smtp.gmail.com)")
        self.smtp_port_input = QSpinBox()
        self.smtp_port_input.setRange(1, 65535)
        self.smtp_port_input.setValue(587)
        
        self.email_user_input = QLineEdit()
        self.email_user_input.setPlaceholderText("邮箱账号")
        self.email_pass_input = QLineEdit()
        self.email_pass_input.setPlaceholderText("邮箱密码/授权码")
        self.email_pass_input.setEchoMode(QLineEdit.Password)
        
        self.sender_email_input = QLineEdit()
        self.sender_email_input.setPlaceholderText("发件人邮箱")
        self.recipient_email_input = QLineEdit()
        self.recipient_email_input.setPlaceholderText("收件人邮箱")
        
        self.email_tls_check = QCheckBox("使用TLS加密")
        self.email_tls_check.setChecked(True)
        
        left_col.addWidget(self.email_enable_check)
        left_col.addWidget(QLabel("SMTP服务器:"))
        left_col.addWidget(self.smtp_server_input)
        left_col.addWidget(QLabel("SMTP端口:"))
        left_col.addWidget(self.smtp_port_input)
        left_col.addWidget(self.email_tls_check)
        
        right_col.addWidget(QLabel("邮箱账号:"))
        right_col.addWidget(self.email_user_input)
        right_col.addWidget(QLabel("邮箱密码:"))
        right_col.addWidget(self.email_pass_input)
        right_col.addWidget(QLabel("发件人邮箱:"))
        right_col.addWidget(self.sender_email_input)
        right_col.addWidget(QLabel("收件人邮箱:"))
        right_col.addWidget(self.recipient_email_input)
        
        email_config_layout.addLayout(left_col)
        email_config_layout.addLayout(right_col)
        email_layout.addLayout(email_config_layout)
        
        email_btn_layout = QHBoxLayout()
        self.test_email_btn = QPushButton("测试连接")
        self.test_email_btn.setStyleSheet(self.get_button_style("#6b7280", "#4b5563"))
        self.test_email_btn.clicked.connect(self.test_email_connection)
        
        self.save_email_btn = QPushButton("保存设置")
        self.save_email_btn.setStyleSheet(self.get_button_style("#3b82f6", "#2563eb"))
        self.save_email_btn.clicked.connect(self.save_email_settings)
        
        email_btn_layout.addStretch()
        email_btn_layout.addWidget(self.test_email_btn)
        email_btn_layout.addWidget(self.save_email_btn)
        email_layout.addLayout(email_btn_layout)
        
        layout.addWidget(email_group)
        
        task_group = QGroupBox("📅 计划任务")
        task_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                margin-top: 10px;
                padding: 15px;
            }
            QGroupBox::title { subcontrol-origin: margin; left: 15px; padding: 0 5px; }
        """)
        task_layout = QVBoxLayout(task_group)
        
        add_task_layout = QHBoxLayout()
        
        self.task_disk_combo = QComboBox()
        self.task_disk_combo.setMinimumWidth(200)
        
        self.task_scan_type_combo = QComboBox()
        self.task_scan_type_combo.addItems(["快速扫描", "深度扫描"])
        
        self.task_day_combo = QComboBox()
        self.task_day_combo.addItems(["周一", "周二", "周三", "周四", "周五", "周六", "周日"])
        
        self.task_hour_spin = QSpinBox()
        self.task_hour_spin.setRange(0, 23)
        self.task_hour_spin.setValue(2)
        
        self.task_minute_spin = QSpinBox()
        self.task_minute_spin.setRange(0, 59)
        self.task_minute_spin.setValue(0)
        
        self.add_task_btn = QPushButton("添加计划任务")
        self.add_task_btn.setStyleSheet(self.get_button_style("#22c55e", "#16a34a"))
        self.add_task_btn.clicked.connect(self.add_scheduled_task)
        
        add_task_layout.addWidget(QLabel("磁盘:"))
        add_task_layout.addWidget(self.task_disk_combo)
        add_task_layout.addWidget(QLabel("扫描:"))
        add_task_layout.addWidget(self.task_scan_type_combo)
        add_task_layout.addWidget(QLabel("每周:"))
        add_task_layout.addWidget(self.task_day_combo)
        add_task_layout.addWidget(self.task_hour_spin)
        add_task_layout.addWidget(QLabel(":"))
        add_task_layout.addWidget(self.task_minute_spin)
        add_task_layout.addStretch()
        add_task_layout.addWidget(self.add_task_btn)
        
        task_layout.addLayout(add_task_layout)
        
        self.task_list = QListWidget()
        self.task_list.setStyleSheet("""
            QListWidget {
                border: 1px solid #e5e7eb;
                border-radius: 4px;
                background: #fafafa;
            }
            QListWidget::item { padding: 10px; border-bottom: 1px solid #e5e7eb; }
            QListWidget::item:selected { background: #eff6ff; color: #1e40af; }
        """)
        
        task_btn_layout = QHBoxLayout()
        self.delete_task_btn = QPushButton("删除选中任务")
        self.delete_task_btn.setStyleSheet(self.get_button_style("#ef4444", "#dc2626"))
        self.delete_task_btn.clicked.connect(self.delete_selected_task)
        
        self.toggle_task_btn = QPushButton("启用/禁用任务")
        self.toggle_task_btn.setStyleSheet(self.get_button_style("#f59e0b", "#d97706"))
        self.toggle_task_btn.clicked.connect(self.toggle_selected_task)
        
        task_btn_layout.addWidget(self.toggle_task_btn)
        task_btn_layout.addWidget(self.delete_task_btn)
        task_btn_layout.addStretch()
        
        task_layout.addWidget(self.task_list)
        task_layout.addLayout(task_btn_layout)
        
        layout.addWidget(task_group, 1)
        
        return widget
    
    def create_report_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        report_info = QFrame()
        report_info.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        report_layout = QVBoxLayout(report_info)
        report_layout.setContentsMargins(20, 15, 20, 15)
        
        report_title = QLabel("📋 导出扫描报告")
        report_title.setStyleSheet("font-weight: bold; font-size: 14px; margin-bottom: 10px;")
        
        report_desc = QLabel("将扫描结果导出为多种格式的报告文件")
        report_desc.setStyleSheet("color: #6b7280; font-size: 12px; margin-bottom: 15px;")
        
        export_layout = QHBoxLayout()
        
        self.export_html_btn = QPushButton("🌐 导出 HTML 报告")
        self.export_html_btn.setStyleSheet(self.get_button_style("#8b5cf6", "#7c3aed"))
        self.export_html_btn.clicked.connect(lambda: self.export_report("html"))
        
        self.export_json_btn = QPushButton("📄 导出 JSON")
        self.export_json_btn.setStyleSheet(self.get_button_style("#0ea5e9", "#0284c7"))
        self.export_json_btn.clicked.connect(lambda: self.export_report("json"))
        
        self.export_csv_btn = QPushButton("📊 导出 CSV")
        self.export_csv_btn.setStyleSheet(self.get_button_style("#10b981", "#059669"))
        self.export_csv_btn.clicked.connect(lambda: self.export_report("csv"))
        
        self.export_txt_btn = QPushButton("📝 导出文本")
        self.export_txt_btn.setStyleSheet(self.get_button_style("#64748b", "#4b5563"))
        self.export_txt_btn.clicked.connect(lambda: self.export_report("txt"))
        
        export_layout.addWidget(self.export_html_btn)
        export_layout.addWidget(self.export_json_btn)
        export_layout.addWidget(self.export_csv_btn)
        export_layout.addWidget(self.export_txt_btn)
        export_layout.addStretch()
        
        report_layout.addWidget(report_title)
        report_layout.addWidget(report_desc)
        report_layout.addLayout(export_layout)
        
        layout.addWidget(report_info)
        
        preview_frame = QFrame()
        preview_frame.setStyleSheet("background: white; border: 1px solid #e5e7eb; border-radius: 8px;")
        preview_layout = QVBoxLayout(preview_frame)
        preview_layout.setContentsMargins(15, 15, 15, 15)
        
        preview_title = QLabel("报告预览")
        preview_title.setStyleSheet("font-weight: bold; font-size: 14px; margin-bottom: 10px;")
        
        self.report_preview = QTextEdit()
        self.report_preview.setReadOnly(True)
        self.report_preview.setStyleSheet("""
            QTextEdit {
                border: 1px solid #e5e7eb;
                border-radius: 4px;
                padding: 15px;
                font-family: Consolas, monospace;
                font-size: 12px;
                background: #fafafa;
            }
        """)
        
        preview_layout.addWidget(preview_title)
        preview_layout.addWidget(self.report_preview)
        
        layout.addWidget(preview_frame, 1)
        
        return widget
    
    def create_status_bar(self):
        status = QFrame()
        status.setStyleSheet("""
            QFrame {
                background: #f9fafb;
                border-top: 1px solid #e5e7eb;
                border-radius: 6px;
                padding: 8px 15px;
            }
        """)
        
        layout = QHBoxLayout(status)
        layout.setContentsMargins(10, 5, 10, 5)
        
        self.status_label = QLabel("就绪")
        self.status_label.setStyleSheet("color: #6b7280; font-size: 12px;")
        
        self.time_label = QLabel("")
        self.time_label.setStyleSheet("color: #9ca3af; font-size: 11px;")
        
        layout.addWidget(self.status_label)
        layout.addStretch()
        layout.addWidget(self.time_label)
        
        return status
    
    def load_disks(self):
        self.disk_combo.clear()
        disks = self.smart_reader.get_available_disks()
        
        if not disks:
            disks = [
                {'device': 'PhysicalDrive0', 'model': 'Sample SSD 500GB', 'size': 500 * 1024**3, 'size_gb': 500.0, 'type': 'SSD', 'is_ssd': True},
                {'device': 'PhysicalDrive1', 'model': 'Sample HDD 1TB', 'size': 1000 * 1024**3, 'size_gb': 1000.0, 'type': 'HDD', 'is_ssd': False}
            ]
        
        for disk in disks:
            display_text = f"{disk['device']} - {disk.get('model', 'Unknown')} ({disk.get('size_gb', 0)} GB {'SSD' if disk.get('is_ssd') else 'HDD'})"
            self.disk_combo.addItem(display_text, disk)
        
        if disks:
            self.current_disk = disks[0]
            self.on_disk_selected(0)
    
    def on_disk_selected(self, index):
        if index >= 0:
            self.current_disk = self.disk_combo.itemData(index)
            self.refresh_smart_info()
            self.disk_map.clear_results()
            self.update_report_preview()
    
    def refresh_smart_info(self):
        if not self.current_disk:
            return
        
        device = self.current_disk['device']
        self.smart_data = self.smart_reader.read_smart_info(device)
        
        self.smart_table.setRowCount(0)
        
        for attr in self.smart_data.get('attributes', []):
            row = self.smart_table.rowCount()
            self.smart_table.insertRow(row)
            
            self.smart_table.setItem(row, 0, QTableWidgetItem(str(attr.get('id', ''))))
            self.smart_table.setItem(row, 1, QTableWidgetItem(attr.get('name', '')))
            self.smart_table.setItem(row, 2, QTableWidgetItem(str(attr.get('value', ''))))
            self.smart_table.setItem(row, 3, QTableWidgetItem(str(attr.get('worst', ''))))
            self.smart_table.setItem(row, 4, QTableWidgetItem(str(attr.get('threshold', ''))))
            self.smart_table.setItem(row, 5, QTableWidgetItem(str(attr.get('raw', ''))))
        
        self.smart_raw.setText(self.smart_data.get('raw_output', 'No SMART data available'))
        
        health_status = self.smart_reader.get_disk_health_status(self.smart_data)
        color_map = {
            'GOOD': '#22c55e',
            'WARNING': '#f59e0b',
            'UNKNOWN': '#6b7280'
        }
        color = color_map.get(health_status, '#6b7280')
        self.health_status_label.setText(f"状态: {health_status}")
        self.health_status_label.setStyleSheet(f"""
            QLabel {{
                background: {color};
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 13px;
            }}
        """)
    
    def start_scan(self):
        if not self.current_disk:
            QMessageBox.warning(self, "警告", "请先选择一个磁盘")
            return
        
        scan_type = ScanType.QUICK if self.scan_type_combo.currentIndex() == 0 else ScanType.DEEP
        
        self.start_scan_btn.setEnabled(False)
        self.stop_scan_btn.setEnabled(True)
        self.scan_progress.setValue(0)
        self.disk_map.clear_results()
        self.bad_sector_list.set_bad_sectors([])
        self.scan_results = []
        self.bad_sectors = []
        self.scan_start_time = datetime.now()
        
        device = self.current_disk['device']
        
        self.disk_scanner.scan_disk(device, scan_type)
        
        self.status_label.setText("扫描中...")
    
    def on_scan_progress(self, progress, current, total, sector):
        self.scan_progress.setValue(int(progress))
        self.scan_status.setText(f"扫描中... {current}/{total} 扇区 (当前: {sector})")
        
        summary = self.disk_scanner.get_scan_summary()
        self.stats_labels["已扫描"].setText(str(summary['total_scanned']))
        self.stats_labels["良好"].setText(str(summary['good']))
        self.stats_labels["缓慢"].setText(str(summary['slow']))
        self.stats_labels["损坏"].setText(str(summary['bad'] + summary['unreadable']))
    
    def on_batch_ready(self, total_blocks):
        with self.disk_scanner._lock:
            results = list(self.disk_scanner.scan_results)
        self.disk_map.apply_batch(results, total_blocks)
    
    def on_bad_sector_found(self, sector, status):
        pass

    def on_scan_complete(self):
        with self.disk_scanner._lock:
            self.scan_results = list(self.disk_scanner.scan_results)
            self.bad_sectors = list(self.disk_scanner.bad_sectors)
        
        self.start_scan_btn.setEnabled(True)
        self.stop_scan_btn.setEnabled(False)
        self.scan_status.setText(f"扫描完成! 发现 {len(self.bad_sectors)} 个坏道")
        self.status_label.setText("扫描完成")
        
        self.disk_map.set_scan_results(self.scan_results, self.bad_sectors)
        self.bad_sector_list.set_bad_sectors(self.bad_sectors)
        
        summary = self.disk_scanner.get_scan_summary()
        self.stats_labels["已扫描"].setText(str(summary['total_scanned']))
        self.stats_labels["良好"].setText(str(summary['good']))
        self.stats_labels["缓慢"].setText(str(summary['slow']))
        self.stats_labels["损坏"].setText(str(summary['bad'] + summary['unreadable']))
        
        self.save_scan_history(summary)
        self.update_report_preview()
    
    def stop_scan(self):
        self.disk_scanner.stop_scan()
        self.start_scan_btn.setEnabled(True)
        self.stop_scan_btn.setEnabled(False)
        self.scan_status.setText("扫描已停止")
        self.status_label.setText("已停止")
    
    def on_sector_clicked(self, sector, status):
        QMessageBox.information(self, "扇区信息", f"扇区: {sector}\n状态: {status}")
    
    def start_repair(self):
        if not self.bad_sectors:
            QMessageBox.warning(self, "警告", "没有发现需要修复的坏道，请先进行扫描")
            return
        
        self.start_repair_btn.setEnabled(False)
        self.stop_repair_btn.setEnabled(True)
        self.repair_progress.setValue(0)
        self.repair_results_text.clear()
        
        device = self.current_disk['device']
        
        self.disk_repair.repair_bad_sectors(device, self.bad_sectors)
        
        self.status_label.setText("修复中...")
    
    def on_repair_progress(self, progress, current, total, sector, status):
        self.repair_progress.setValue(int(progress))
        self.repair_status.setText(f"修复中... {current}/{total} 扇区")
        
        status_text = f"扇区 {sector}: {status}\n"
        self.repair_results_text.insertPlainText(status_text)
    
    def on_repair_complete(self, results):
        self.repair_results = results
        self.start_repair_btn.setEnabled(True)
        self.stop_repair_btn.setEnabled(False)
        
        summary = self.disk_repair.get_repair_summary()
        self.repair_status.setText(f"修复完成! 成功: {summary['success']}, 失败: {summary['failed']}")
        self.status_label.setText("修复完成")
        
        self.update_report_preview()
    
    def stop_repair(self):
        self.disk_repair.stop_repair()
        self.start_repair_btn.setEnabled(True)
        self.stop_repair_btn.setEnabled(False)
        self.repair_status.setText("修复已停止")
        self.status_label.setText("已停止")
    
    def export_report(self, format_type):
        if not self.scan_results:
            QMessageBox.warning(self, "警告", "没有可导出的扫描结果")
            return
        
        default_name = f"disk_scan_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        file_filter_map = {
            'html': 'HTML 文件 (*.html)',
            'json': 'JSON 文件 (*.json)',
            'csv': 'CSV 文件 (*.csv)',
            'txt': '文本文件 (*.txt)'
        }
        
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            f"导出报告",
            f"{default_name}.{format_type}",
            file_filter_map[format_type]
        )
        
        if file_path:
            report = self.report_exporter.generate_report(
                self.current_disk,
                self.smart_data or {},
                self.disk_scanner.get_scan_summary(),
                self.bad_sectors,
                self.repair_results
            )
            
            success = False
            if format_type == 'html':
                success = self.report_exporter.export_to_html(report, file_path)
            elif format_type == 'json':
                success = self.report_exporter.export_to_json(report, file_path)
            elif format_type == 'csv':
                success = self.report_exporter.export_to_csv(report, file_path)
            elif format_type == 'txt':
                success = self.report_exporter.export_to_text(report, file_path)
            
            if success:
                QMessageBox.information(self, "成功", f"报告已成功导出到:\n{file_path}")
            else:
                QMessageBox.critical(self, "错误", "导出报告失败")
    
    def update_report_preview(self):
        if not self.scan_results:
            self.report_preview.setText("暂无扫描数据，请先进行磁盘扫描。")
            return
        
        report = self.report_exporter.generate_report(
            self.current_disk or {},
            self.smart_data or {},
            self.disk_scanner.get_scan_summary(),
            self.bad_sectors,
            self.repair_results
        )
        
        assessment = report.get('overall_assessment', {})
        scan_summary = report.get('scan_summary', {})
        
        preview_text = f"""
=== 硬盘健康检测报告预览 ===

健康状态: {assessment.get('health_status', 'UNKNOWN')}
坏道比例: {assessment.get('bad_sector_percentage', 0)}%

--- 扫描概览 ---
扫描总数: {scan_summary.get('total_scanned', 0)}
良好扇区: {scan_summary.get('good', 0)}
缓慢扇区: {scan_summary.get('slow', 0)}
待处理扇区: {scan_summary.get('pending', 0)}
损坏扇区: {scan_summary.get('bad', 0)}
不可读扇区: {scan_summary.get('unreadable', 0)}

--- 建议 ---
"""
        for rec in assessment.get('recommendations', []):
            preview_text += f"  - {rec}\n"
        
        self.report_preview.setText(preview_text)
    
    def start_update_timer(self):
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_time)
        self.timer.start(1000)
        self.update_time()
    
    def update_time(self):
        self.time_label.setText(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    
    def save_scan_history(self, summary: Dict):
        if not self.current_disk or self.scan_start_time is None:
            return
        
        scan_duration = (datetime.now() - self.scan_start_time).total_seconds()
        scan_type_name = "快速扫描" if self.scan_type_combo.currentIndex() == 0 else "深度扫描"
        
        record = self.history_storage.create_record_from_scan(
            device=self.current_disk['device'],
            device_model=self.current_disk.get('model', 'Unknown'),
            scan_type=scan_type_name,
            scan_summary=summary,
            bad_sectors=self.bad_sectors,
            scan_duration=scan_duration
        )
        
        self.history_storage.save_scan_record(record)
        self.refresh_history_table()
    
    def refresh_history_table(self):
        if not self.current_disk:
            return
        
        device = self.current_disk['device']
        history = self.history_storage.get_device_history(device)
        history.sort(key=lambda x: x.timestamp, reverse=True)
        
        self.history_table.setRowCount(0)
        
        for record in history[:20]:
            row = self.history_table.rowCount()
            self.history_table.insertRow(row)
            
            timestamp = datetime.fromisoformat(record.timestamp).strftime('%Y-%m-%d %H:%M:%S')
            
            self.history_table.setItem(row, 0, QTableWidgetItem(timestamp))
            self.history_table.setItem(row, 1, QTableWidgetItem(record.scan_type))
            self.history_table.setItem(row, 2, QTableWidgetItem(str(record.total_scanned)))
            self.history_table.setItem(row, 3, QTableWidgetItem(str(record.bad_sectors + record.unreadable_sectors)))
            self.history_table.setItem(row, 4, QTableWidgetItem(f"{record.scan_duration_seconds:.1f}"))
    
    def run_prediction(self):
        if not self.current_disk:
            QMessageBox.warning(self, "警告", "请先选择一个磁盘")
            return
        
        device = self.current_disk['device']
        prediction = self.predictor.predict(device)
        
        self.current_prediction = prediction
        
        if prediction is None:
            QMessageBox.information(self, "提示", "需要至少2次历史扫描记录才能运行预测。请继续进行定期扫描以积累数据。")
            return
        
        self.update_prediction_display(prediction)
        
        if prediction.high_risk_zones:
            geometry = self.disk_scanner.get_disk_geometry(device)
            self.disk_map.set_risk_zones(prediction.high_risk_zones, geometry.get('total_sectors', 1000000))
    
    def update_prediction_display(self, prediction):
        for i in reversed(range(self.prediction_result_layout.count())):
            widget = self.prediction_result_layout.itemAt(i).widget()
            if widget:
                widget.setParent(None)
        
        trend_color_map = {
            "快速恶化": "#ef4444",
            "缓慢恶化": "#f59e0b",
            "基本稳定": "#22c55e",
            "波动中": "#3b82f6"
        }
        trend_color = trend_color_map.get(prediction.health_trend, "#6b7280")
        
        confidence_color_map = {"高": "#22c55e", "中": "#f59e0b", "低": "#ef4444"}
        conf_color = confidence_color_map.get(prediction.confidence_level, "#6b7280")
        
        stats_layout = QHBoxLayout()
        
        stat_items = [
            ("当前坏道数", str(prediction.current_bad_sectors), "#3b82f6"),
            ("预测6个月后新增", str(prediction.predicted_new_bad_sectors), "#ef4444"),
            ("月增长率", f"{prediction.monthly_growth_rate}个", "#f59e0b"),
            ("健康趋势", prediction.health_trend, trend_color),
            ("置信度", prediction.confidence_level, conf_color)
        ]
        
        for label_text, value, color in stat_items:
            stat_layout = QHBoxLayout() if 'stat_layout' not in dir() else stat_layout
            stat_box = QVBoxLayout()
            value_label = QLabel(str(value))
            value_label.setStyleSheet(f"font-size: 28px; font-weight: bold; color: {color};")
            text_label = QLabel(label_text)
            text_label.setStyleSheet("font-size: 12px; color: #6b7280;")
            stat_box.addWidget(value_label)
            stat_box.addWidget(text_label)
            stats_layout.addLayout(stat_box)
        
        self.prediction_result_layout.addLayout(stats_layout)
        
        if prediction.high_risk_zones:
            risk_title = QLabel("⚠️ 高风险区域")
            risk_title.setStyleSheet("font-weight: bold; font-size: 13px; margin-top: 20px; color: #dc2626;")
            self.prediction_result_layout.addWidget(risk_title)
            
            for i, (zone_start, zone_end, risk_score) in enumerate(prediction.high_risk_zones[:3]):
                risk_color = self.predictor.get_risk_color(risk_score)
                zone_label = QLabel(f"区域 #{i+1}: 扇区 {zone_start:,} - {zone_end:,} (风险: {risk_score*100:.0f}%)")
                zone_label.setStyleSheet(f"background: {risk_color}20; color: {risk_color}; padding: 8px; border-radius: 4px; border-left: 4px solid {risk_color};")
                self.prediction_result_layout.addWidget(zone_label)
        
        rec_title = QLabel("💡 建议")
        rec_title.setStyleSheet("font-weight: bold; font-size: 13px; margin-top: 20px;")
        self.prediction_result_layout.addWidget(rec_title)
        
        rec_label = QLabel(prediction.recommendation)
        rec_label.setStyleSheet("background: #fef3c7; color: #92400e; padding: 15px; border-radius: 8px;")
        rec_label.setWordWrap(True)
        self.prediction_result_layout.addWidget(rec_label)
    
    def toggle_risk_overlay(self):
        self.disk_map.toggle_risk_overlay()
        if self.disk_map._show_risk_overlay:
            self.toggle_risk_btn.setText("隐藏风险区域")
        else:
            self.toggle_risk_btn.setText("显示风险区域")
    
    def on_disk_selected(self, index):
        if index >= 0:
            self.current_disk = self.disk_combo.itemData(index)
            self.refresh_smart_info()
            self.disk_map.clear_results()
            self.update_report_preview()
            self.refresh_history_table()
            
            self.task_disk_combo.clear()
            disks = self.smart_reader.get_available_disks()
            if not disks:
                disks = [
                    {'device': 'PhysicalDrive0', 'model': 'Sample SSD 500GB', 'size': 500 * 1024**3, 'size_gb': 500.0, 'type': 'SSD', 'is_ssd': True},
                    {'device': 'PhysicalDrive1', 'model': 'Sample HDD 1TB', 'size': 1000 * 1024**3, 'size_gb': 1000.0, 'type': 'HDD', 'is_ssd': False}
                ]
            for disk in disks:
                display_text = f"{disk['device']} - {disk.get('model', 'Unknown')}"
                self.task_disk_combo.addItem(display_text, disk)
    
    def on_email_enable_changed(self, state):
        enabled = state == Qt.Checked
        self.smtp_server_input.setEnabled(enabled)
        self.smtp_port_input.setEnabled(enabled)
        self.email_user_input.setEnabled(enabled)
        self.email_pass_input.setEnabled(enabled)
        self.sender_email_input.setEnabled(enabled)
        self.recipient_email_input.setEnabled(enabled)
        self.email_tls_check.setEnabled(enabled)
        self.test_email_btn.setEnabled(enabled)
        self.save_email_btn.setEnabled(enabled)
    
    def test_email_connection(self):
        config = EmailConfig(
            smtp_server=self.smtp_server_input.text(),
            smtp_port=self.smtp_port_input.value(),
            use_tls=self.email_tls_check.isChecked(),
            username=self.email_user_input.text(),
            password=self.email_pass_input.text(),
            sender_email=self.sender_email_input.text(),
            recipient_email=self.recipient_email_input.text(),
            enabled=True
        )
        
        notifier = self.scheduler.get_email_notifier()
        notifier.config = config
        
        if notifier.test_connection():
            QMessageBox.information(self, "成功", "邮件服务器连接测试成功！")
        else:
            QMessageBox.warning(self, "失败", "邮件服务器连接测试失败，请检查配置。")
    
    def save_email_settings(self):
        config = EmailConfig(
            smtp_server=self.smtp_server_input.text(),
            smtp_port=self.smtp_port_input.value(),
            use_tls=self.email_tls_check.isChecked(),
            username=self.email_user_input.text(),
            password=self.email_pass_input.text(),
            sender_email=self.sender_email_input.text(),
            recipient_email=self.recipient_email_input.text(),
            enabled=self.email_enable_check.isChecked()
        )
        
        if self.scheduler.save_email_config(config):
            QMessageBox.information(self, "成功", "邮件设置已保存！")
        else:
            QMessageBox.warning(self, "失败", "保存邮件设置失败。")
    
    def add_scheduled_task(self):
        disk_data = self.task_disk_combo.currentData()
        if not disk_data:
            QMessageBox.warning(self, "警告", "请选择一个磁盘")
            return
        
        task_id = str(uuid.uuid4())
        task = ScheduledTask(
            task_id=task_id,
            device=disk_data['device'],
            device_model=disk_data.get('model', 'Unknown'),
            scan_type=self.task_scan_type_combo.currentText(),
            schedule_type="weekly",
            day_of_week=self.task_day_combo.currentIndex(),
            hour=self.task_hour_spin.value(),
            minute=self.task_minute_spin.value(),
            enabled=True,
            email_notification=self.scheduler.email_config.enabled
        )
        
        self.scheduler.add_task(task)
        self.refresh_task_list()
        QMessageBox.information(self, "成功", "计划任务已添加！")
    
    def refresh_task_list(self):
        self.task_list.clear()
        tasks = self.scheduler.get_tasks()
        
        day_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        
        for task in tasks:
            status_icon = "✅" if task.enabled else "❌"
            next_run = ""
            if task.enabled:
                try:
                    next_run_iso = self.scheduler.calculate_next_run(task)
                    next_run_dt = datetime.fromisoformat(next_run_iso)
                    next_run = f"下次: {next_run_dt.strftime('%m-%d %H:%M')}"
                except:
                    pass
            
            item_text = f"{status_icon} {task.device_model}\n    {task.scan_type} - 每周{day_names[task.day_of_week]} {task.hour:02d}:{task.minute:02d}  {next_run}"
            item = QListWidgetItem(item_text)
            item.setData(Qt.UserRole, task.task_id)
            self.task_list.addItem(item)
    
    def delete_selected_task(self):
        current_item = self.task_list.currentItem()
        if not current_item:
            QMessageBox.warning(self, "警告", "请选择要删除的任务")
            return
        
        task_id = current_item.data(Qt.UserRole)
        if self.scheduler.remove_task(task_id):
            self.refresh_task_list()
            QMessageBox.information(self, "成功", "任务已删除")
    
    def toggle_selected_task(self):
        current_item = self.task_list.currentItem()
        if not current_item:
            QMessageBox.warning(self, "警告", "请选择要操作的任务")
            return
        
        task_id = current_item.data(Qt.UserRole)
        task = self.scheduler.get_task(task_id)
        if task:
            self.scheduler.update_task(task_id, enabled=not task.enabled)
            self.refresh_task_list()
    
    def on_scheduled_scan(self, task):
        print(f"Running scheduled scan for: {task.device}")
        if self.disk_scanner.is_scanning:
            return
        
        scan_type = ScanType.QUICK if task.scan_type == "快速扫描" else ScanType.DEEP
        self.disk_scanner.scan_disk(task.device, scan_type)


def main():
    app = QApplication(sys.argv)
    app.setStyle('Fusion')
    
    window = DiskScannerApp()
    window.show()
    
    sys.exit(app.exec_())


if __name__ == '__main__':
    main()
