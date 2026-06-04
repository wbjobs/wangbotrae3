from PyQt5.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QScrollArea, QFrame, QPushButton
from PyQt5.QtGui import QPainter, QColor, QPixmap, QImage, QLinearGradient, QBrush
from PyQt5.QtCore import Qt, QRect, pyqtSignal
from typing import List, Dict, Tuple


class DiskMapWidget(QWidget):
    sector_clicked = pyqtSignal(int, str)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.scan_results = []
        self.bad_sectors = []
        self.cell_size = 12
        self.total_blocks = 0
        self.setMinimumSize(600, 400)
        
        self._sector_map = {}
        self._cache_pixmap = None
        self._cache_valid = False
        self._dirty_cells = set()
        
        self._show_risk_overlay = False
        self._risk_zones = []
        self._total_sectors = 1000000
        
        self.color_map = {
            'GOOD': QColor(34, 197, 94),
            'SLOW': QColor(251, 191, 36),
            'PENDING': QColor(251, 146, 60),
            'BAD': QColor(239, 68, 68),
            'UNREADABLE': QColor(107, 114, 128),
            'UNSCANNED': QColor(229, 231, 235)
        }
        
        self._unscanned_color = QColor(229, 231, 235)
        self._risk_gradient = QLinearGradient(0, 0, 1, 0)
        self._risk_gradient.setColorAt(0, QColor(254, 240, 138))
        self._risk_gradient.setColorAt(0.5, QColor(251, 146, 60))
        self._risk_gradient.setColorAt(1, QColor(220, 38, 38))
        
    def set_scan_results(self, results: List[Dict], bad_sectors: List[Dict]):
        self.scan_results = results
        self.bad_sectors = bad_sectors
        self.total_blocks = results[0].get('total_blocks', len(results)) if results else 100
        self._rebuild_sector_map()
        self._cache_valid = False
        self._dirty_cells.clear()
        self.update()
    
    def clear_results(self):
        self.scan_results = []
        self.bad_sectors = []
        self._sector_map.clear()
        self._cache_pixmap = None
        self._cache_valid = False
        self._dirty_cells.clear()
        self.update()
    
    def apply_batch(self, batch: List[Dict], total_blocks: int):
        self.total_blocks = total_blocks
        for result in batch:
            block_idx = result['block_index']
            self._sector_map[block_idx] = result
            self._dirty_cells.add(block_idx)
        
        if not self._cache_valid or self._cache_pixmap is None:
            self._rebuild_full_cache()
        else:
            self._paint_dirty_cells()
        
        self.update()
    
    def _rebuild_sector_map(self):
        self._sector_map.clear()
        for result in self.scan_results:
            block_idx = result.get('block_index', 0)
            self._sector_map[block_idx] = result
    
    def _get_grid_dims(self):
        width = self.width()
        height = self.height()
        padding = 20
        cols = max(1, (width - 2 * padding) // self.cell_size)
        rows = max(1, (height - 2 * padding) // self.cell_size)
        return cols, rows, padding
    
    def _block_to_grid(self, block_idx: int, cols: int, total_blocks: int):
        if total_blocks <= 0 or cols <= 0:
            return 0, 0
        
        grid_rows = max(1, (total_blocks + cols - 1) // cols)
        
        row = block_idx // cols
        col = block_idx % cols
        
        return row, col
    
    def _grid_to_rect(self, row: int, col: int, padding: int):
        x = padding + col * self.cell_size
        y = padding + row * self.cell_size
        return QRect(x, y, self.cell_size - 1, self.cell_size - 1)
    
    def _rebuild_full_cache(self):
        cols, rows, padding = self._get_grid_dims()
        total_cells = cols * rows
        
        pixmap = QPixmap(self.size())
        pixmap.fill(self._unscanned_color)
        
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing, False)
        
        for block_idx, result in self._sector_map.items():
            row, col = self._block_to_grid(block_idx, cols, self.total_blocks)
            if row < 0 or col < 0 or col >= cols:
                continue
            
            status = result['status']
            status_name = status.name if hasattr(status, 'name') else str(status)
            color = self.color_map.get(status_name, self._unscanned_color)
            
            rect = self._grid_to_rect(row, col, padding)
            if rect.y() + rect.height() <= self.height() and rect.x() + rect.width() <= self.width():
                painter.fillRect(rect, color)
        
        self._paint_risk_zones(painter, cols, padding)
        
        painter.end()
        self._cache_pixmap = pixmap
        self._cache_valid = True
        self._dirty_cells.clear()
    
    def _paint_dirty_cells(self):
        if self._cache_pixmap is None:
            self._rebuild_full_cache()
            return
        
        cols, rows, padding = self._get_grid_dims()
        
        painter = QPainter(self._cache_pixmap)
        painter.setRenderHint(QPainter.Antialiasing, False)
        
        for block_idx in self._dirty_cells:
            if block_idx not in self._sector_map:
                continue
            
            result = self._sector_map[block_idx]
            row, col = self._block_to_grid(block_idx, cols, self.total_blocks)
            if row < 0 or col < 0 or col >= cols:
                continue
            
            status = result['status']
            status_name = status.name if hasattr(status, 'name') else str(status)
            color = self.color_map.get(status_name, self._unscanned_color)
            
            rect = self._grid_to_rect(row, col, padding)
            if rect.y() + rect.height() <= self.height() and rect.x() + rect.width() <= self.width():
                painter.fillRect(rect, color)
        
        painter.end()
        self._dirty_cells.clear()
    
    def paintEvent(self, event):
        if not self._cache_valid or self._cache_pixmap is None:
            self._rebuild_full_cache()
        
        painter = QPainter(self)
        
        if self._cache_pixmap:
            painter.drawPixmap(0, 0, self._cache_pixmap)
        else:
            painter.fillRect(self.rect(), self._unscanned_color)
    
    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._cache_valid = False
        self._cache_pixmap = None
        self.update()
    
    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            cols, rows, padding = self._get_grid_dims()
            
            x = event.x() - padding
            y = event.y() - padding
            
            if x >= 0 and y >= 0:
                col = x // self.cell_size
                row = y // self.cell_size
                
                block_idx = row * cols + col
                
                if block_idx in self._sector_map:
                    result = self._sector_map[block_idx]
                    sector = result['sector']
                    status = result['status'].name if hasattr(result['status'], 'name') else str(result['status'])
                    self.sector_clicked.emit(sector, status)
    
    def set_risk_zones(self, risk_zones: List[Tuple[int, int, float]], total_sectors: int = 1000000):
        self._risk_zones = risk_zones
        self._total_sectors = total_sectors
        self._cache_valid = False
        self.update()
    
    def toggle_risk_overlay(self, show: bool = None):
        if show is None:
            self._show_risk_overlay = not self._show_risk_overlay
        else:
            self._show_risk_overlay = show
        self._cache_valid = False
        self.update()
    
    def _get_risk_color(self, risk_score: float) -> QColor:
        if risk_score >= 0.8:
            return QColor(220, 38, 38)
        elif risk_score >= 0.5:
            return QColor(245, 158, 11)
        elif risk_score >= 0.2:
            return QColor(234, 179, 8)
        else:
            return QColor(34, 197, 94)
    
    def _sector_to_block(self, sector: int) -> int:
        if self._total_sectors <= 0 or self.total_blocks <= 0:
            return 0
        return int((sector / self._total_sectors) * self.total_blocks)
    
    def _paint_risk_zones(self, painter: QPainter, cols: int, padding: int):
        if not self._show_risk_overlay or not self._risk_zones:
            return
        
        painter.setOpacity(0.4)
        
        for zone_start, zone_end, risk_score in self._risk_zones:
            start_block = self._sector_to_block(zone_start)
            end_block = self._sector_to_block(zone_end)
            
            risk_color = self._get_risk_color(risk_score)
            
            for block_idx in range(start_block, min(end_block + 1, self.total_blocks)):
                row, col = self._block_to_grid(block_idx, cols, self.total_blocks)
                if row < 0 or col < 0 or col >= cols:
                    continue
                
                rect = self._grid_to_rect(row, col, padding)
                if rect.y() + rect.height() <= self.height() and rect.x() + rect.width() <= self.width():
                    painter.fillRect(rect, risk_color)
        
        painter.setOpacity(1.0)


class LegendWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(40)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(15)
        
        legend_items = [
            ('良好', QColor(34, 197, 94)),
            ('缓慢', QColor(251, 191, 36)),
            ('待处理', QColor(251, 146, 60)),
            ('损坏', QColor(239, 68, 68)),
            ('不可读', QColor(107, 114, 128)),
            ('未扫描', QColor(229, 231, 235))
        ]
        
        for label_text, color in legend_items:
            item_layout = QHBoxLayout()
            item_layout.setSpacing(5)
            
            color_box = QFrame()
            color_box.setFixedSize(16, 16)
            color_box.setStyleSheet(f"background-color: {color.name()}; border: 1px solid #ccc;")
            
            label = QLabel(label_text)
            label.setStyleSheet("font-size: 11px; color: #666;")
            
            item_layout.addWidget(color_box)
            item_layout.addWidget(label)
            layout.addLayout(item_layout)
        
        layout.addStretch()


class BadSectorListWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.bad_sectors = []
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        title = QLabel("坏道列表")
        title.setStyleSheet("font-weight: bold; font-size: 13px; margin-bottom: 5px;")
        layout.addWidget(title)
        
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setStyleSheet("""
            QScrollArea {
                border: 1px solid #e5e7eb;
                border-radius: 4px;
                background-color: #f9fafb;
            }
        """)
        
        self.content_widget = QWidget()
        self.list_layout = QVBoxLayout(self.content_widget)
        self.list_layout.setContentsMargins(10, 10, 10, 10)
        self.list_layout.setSpacing(5)
        
        self.scroll_area.setWidget(self.content_widget)
        layout.addWidget(self.scroll_area)
        
        self.empty_label = QLabel("暂无坏道")
        self.empty_label.setStyleSheet("color: #9ca3af; font-size: 12px; padding: 20px;")
        self.empty_label.setAlignment(Qt.AlignCenter)
        self.list_layout.addWidget(self.empty_label)
    
    def set_bad_sectors(self, bad_sectors: List[Dict]):
        self.bad_sectors = bad_sectors
        
        for i in reversed(range(self.list_layout.count())):
            widget = self.list_layout.itemAt(i).widget()
            if widget:
                widget.setParent(None)
        
        if not bad_sectors:
            self.list_layout.addWidget(self.empty_label)
        else:
            for i, sector in enumerate(bad_sectors[:50]):
                item = QFrame()
                item.setStyleSheet("""
                    QFrame {
                        background-color: white;
                        border: 1px solid #fee2e2;
                        border-radius: 4px;
                        padding: 8px;
                    }
                """)
                
                item_layout = QHBoxLayout(item)
                item_layout.setContentsMargins(5, 5, 5, 5)
                
                info_label = QLabel(f"#{i + 1} 扇区: {sector['sector']}")
                info_label.setStyleSheet("font-size: 11px; font-family: monospace;")
                
                status_label = QLabel(sector['status'])
                status_label.setStyleSheet("""
                    font-size: 10px;
                    padding: 2px 6px;
                    background-color: #fecaca;
                    color: #991b1b;
                    border-radius: 3px;
                """)
                
                item_layout.addWidget(info_label)
                item_layout.addStretch()
                item_layout.addWidget(status_label)
                
                self.list_layout.addWidget(item)
            
            if len(bad_sectors) > 50:
                more_label = QLabel(f"... 还有 {len(bad_sectors) - 50} 个坏道")
                more_label.setStyleSheet("color: #9ca3af; font-size: 11px; padding: 5px;")
                more_label.setAlignment(Qt.AlignCenter)
                self.list_layout.addWidget(more_label)
        
        self.list_layout.addStretch()
