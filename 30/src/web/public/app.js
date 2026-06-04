class ClipboardApp {
  constructor() {
    this.daemonUrl = 'http://localhost:8765';
    this.allItems = [];
    this.filteredItems = [];
    this.pinnedItems = [];
    this.ITEM_HEIGHT = 88;
    this.BUFFER_SIZE = 10;
    this.pageSize = 100;
    this.loadedCount = 0;
    this.totalCount = 0;
    this.isLoading = false;
    this.isLoadingMore = false;
    this.draggedItem = null;
    this.scrollTimeout = null;
    this.observer = null;
    this.sentinelElement = null;

    this.init();
  }

  async init() {
    this.initElements();
    this.initFilters();
    this.initVirtualScroll();
    this.initDragAndDrop();
    this.initModal();
    await this.checkConnection();
    await this.loadData();
    this.startAutoRefresh();
  }

  initElements() {
    this.$statusDot = document.getElementById('statusDot');
    this.$statusText = document.getElementById('statusText');
    this.$countBadge = document.getElementById('countBadge');
    this.$typeFilter = document.getElementById('typeFilter');
    this.$categoryFilter = document.getElementById('categoryFilter');
    this.$startDate = document.getElementById('startDate');
    this.$endDate = document.getElementById('endDate');
    this.$searchInput = document.getElementById('searchInput');
    this.$refreshBtn = document.getElementById('refreshBtn');
    this.$pinnedSection = document.getElementById('pinnedSection');
    this.$pinnedList = document.getElementById('pinnedList');
    this.$container = document.getElementById('virtualScrollContainer');
    this.$padding = document.getElementById('virtualScrollPadding');
    this.$content = document.getElementById('virtualScrollContent');
    this.$modal = document.getElementById('imageModal');
    this.$modalImage = document.getElementById('modalImage');
    this.$modalClose = document.getElementById('modalClose');
    this.$toast = document.getElementById('toast');
  }

  initFilters() {
    this.$typeFilter.addEventListener('change', () => {
      this.resetPagination();
      this.applyFilters();
    });
    this.$categoryFilter.addEventListener('change', () => {
      this.resetPagination();
      this.applyFilters();
    });
    this.$startDate.addEventListener('change', () => {
      this.resetPagination();
      this.applyFilters();
    });
    this.$endDate.addEventListener('change', () => {
      this.resetPagination();
      this.applyFilters();
    });

    let searchTimeout;
    this.$searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.resetPagination();
        this.applyFilters();
      }, 300);
    });

    this.$refreshBtn.addEventListener('click', () => {
      this.resetPagination();
      this.loadData();
    });
  }

  initVirtualScroll() {
    this.$container.addEventListener('scroll', () => this._debouncedScroll());
    this._initIntersectionObserver();
  }

  _initIntersectionObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.isLoadingMore && this.hasMoreData()) {
            this._loadMoreData();
          }
        });
      },
      {
        root: this.$container,
        rootMargin: '200px',
        threshold: 0.1,
      }
    );
  }

  _createSentinel() {
    if (this.sentinelElement) {
      this.sentinelElement.remove();
    }

    this.sentinelElement = document.createElement('div');
    this.sentinelElement.className = 'scroll-sentinel';
    this.sentinelElement.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 1px;
      pointer-events: none;
    `;
    this.$content.appendChild(this.sentinelElement);
    this.observer.observe(this.sentinelElement);
  }

  _debouncedScroll() {
    if (this.scrollTimeout) {
      cancelAnimationFrame(this.scrollTimeout);
    }
    this.scrollTimeout = requestAnimationFrame(() => {
      this.onScroll();
    });
  }

  resetPagination() {
    this.allItems = [];
    this.filteredItems = [];
    this.loadedCount = 0;
    this.isLoadingMore = false;
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  hasMoreData() {
    return this.loadedCount < this.totalCount && this.filteredItems.length === this.loadedCount;
  }

  async _loadMoreData() {
    if (this.isLoadingMore || !this.hasMoreData()) return;

    this.isLoadingMore = true;
    console.log(`加载更多数据: ${this.loadedCount} / ${this.totalCount}`);

    try {
      const type = this.$typeFilter.value;
      const category = this.$categoryFilter.value;
      const startDate = this.$startDate.value ? new Date(this.$startDate.value).getTime() : null;
      const endDate = this.$endDate.value ? new Date(this.$endDate.value).getTime() + 86400000 : null;

      const params = new URLSearchParams({
        limit: this.pageSize,
        offset: this.loadedCount,
      });
      if (type) params.append('type', type);
      if (category) params.append('category', category);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`${this.daemonUrl}/api/history?${params.toString()}`);
      const data = await response.json();

      const newItems = data.items || [];
      const search = this.$searchInput.value.toLowerCase().trim();

      let filteredNewItems = newItems;
      if (search) {
        filteredNewItems = newItems.filter(item =>
          (item.type === 'text' && item.content.toLowerCase().includes(search)) ||
          (item.ocr_text && item.ocr_text.toLowerCase().includes(search))
        );
      }

      this.allItems = [...this.allItems, ...newItems];
      this.filteredItems = [...this.filteredItems, ...filteredNewItems.filter(i => !i.isPinned)];
      this.pinnedItems = [...this.pinnedItems, ...filteredNewItems.filter(i => i.isPinned)];
      this.loadedCount += newItems.length;

      this.renderPinnedItems();
      this.updateVirtualScroll();

      console.log(`已加载 ${this.loadedCount} / ${this.totalCount} 条`);
    } catch (err) {
      console.error('加载更多数据失败:', err);
    } finally {
      this.isLoadingMore = false;
    }
  }

  initDragAndDrop() {
    this.$pinnedList.addEventListener('dragstart', (e) => {
      if (e.target.closest('.pinned-item')) {
        this.draggedItem = e.target.closest('.pinned-item');
        this.draggedItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    this.$pinnedList.addEventListener('dragend', (e) => {
      if (this.draggedItem) {
        this.draggedItem.classList.remove('dragging');
        document.querySelectorAll('.pinned-item').forEach(item => {
          item.classList.remove('drag-over');
        });
        this.draggedItem = null;
        this.savePinnedOrder();
      }
    });

    this.$pinnedList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const afterElement = this.getDragAfterElement(this.$pinnedList, e.clientX, e.clientY);
      if (afterElement == null) {
        this.$pinnedList.appendChild(this.draggedItem);
      } else {
        this.$pinnedList.insertBefore(this.draggedItem, afterElement);
      }
    });
  }

  getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.pinned-item:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      child.classList.remove('drag-over');

      if (offset < 0 && offset > closest.offset) {
        child.classList.add('drag-over');
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  async savePinnedOrder() {
    const items = [...this.$pinnedList.querySelectorAll('.pinned-item')].map((el, index) => ({
      id: parseInt(el.dataset.id),
      sortOrder: index,
    }));

    try {
      await fetch(`${this.daemonUrl}/api/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      this.showToast('排序已保存', 'success');
    } catch (err) {
      console.error('保存排序失败:', err);
    }
  }

  initModal() {
    this.$modalClose.addEventListener('click', () => this.closeModal());
    this.$modal.addEventListener('click', (e) => {
      if (e.target === this.$modal) this.closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
    });
  }

  openModal(imageSrc) {
    this.$modalImage.src = imageSrc;
    this.$modal.classList.add('show');
  }

  closeModal() {
    this.$modal.classList.remove('show');
    this.$modalImage.src = '';
  }

  async checkConnection() {
    try {
      const response = await fetch(`${this.daemonUrl}/api/health`);
      if (response.ok) {
        this.setStatus(true);
        return true;
      }
    } catch (err) {
      // Connection failed
    }
    this.setStatus(false);
    return false;
  }

  setStatus(online) {
    if (online) {
      this.$statusDot.className = 'status-dot online';
      this.$statusText.textContent = '已连接';
    } else {
      this.$statusDot.className = 'status-dot offline';
      this.$statusText.textContent = '未连接';
    }
  }

  async loadCategories() {
    try {
      const response = await fetch(`${this.daemonUrl}/api/categories`);
      if (response.ok) {
        const data = await response.json();
        const categories = data.categories || [];
        
        const currentValue = this.$categoryFilter.value;
        this.$categoryFilter.innerHTML = '<option value="">全部标签</option>';
        
        categories.forEach(cat => {
          const option = document.createElement('option');
          option.value = cat;
          option.textContent = cat;
          this.$categoryFilter.appendChild(option);
        });
        
        this.$categoryFilter.value = currentValue;
      }
    } catch (err) {
      console.error('加载分类失败:', err);
    }
  }

  async loadData() {
    if (this.isLoading) return;

    this.isLoading = true;
    this.setLoading(true);

    try {
      const isOnline = await this.checkConnection();
      if (!isOnline) {
        this.showEmptyState('无法连接到守护服务，请确保服务已启动');
        this.isLoading = false;
        this.setLoading(false);
        return;
      }

      await this.loadCategories();

      const type = this.$typeFilter.value;
      const category = this.$categoryFilter.value;
      const startDate = this.$startDate.value ? new Date(this.$startDate.value).getTime() : null;
      const endDate = this.$endDate.value ? new Date(this.$endDate.value).getTime() + 86400000 : null;

      const params = new URLSearchParams({
        limit: this.pageSize,
        offset: 0,
      });
      if (type) params.append('type', type);
      if (category) params.append('category', category);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`${this.daemonUrl}/api/history?${params.toString()}`);
      const data = await response.json();

      this.allItems = data.items || [];
      this.totalCount = data.total;
      this.loadedCount = this.allItems.length;

      this.applyFilters(true);
      this.$countBadge.textContent = `共 ${this.totalCount} 条`;

      this._initIntersectionObserver();
    } catch (err) {
      console.error('加载数据失败:', err);
      this.showEmptyState('加载数据失败');
    } finally {
      this.isLoading = false;
      this.setLoading(false);
    }
  }

  applyFilters(isInitialLoad = false) {
    const type = this.$typeFilter.value;
    const startDate = this.$startDate.value ? new Date(this.$startDate.value).getTime() : null;
    const endDate = this.$endDate.value ? new Date(this.$endDate.value).getTime() + 86400000 : null;
    const search = this.$searchInput.value.toLowerCase().trim();

    let filtered = [...this.allItems];

    if (type) {
      filtered = filtered.filter(item => item.type === type);
    }

    if (startDate) {
      filtered = filtered.filter(item => item.timestamp >= startDate);
    }

    if (endDate) {
      filtered = filtered.filter(item => item.timestamp <= endDate);
    }

    if (search) {
      filtered = filtered.filter(item =>
        item.type === 'text' && item.content.toLowerCase().includes(search)
      );
    }

    this.pinnedItems = filtered.filter(item => item.isPinned);
    this.filteredItems = filtered.filter(item => !item.isPinned);

    this.renderPinnedItems();
    this.updateVirtualScroll();

    if (!isInitialLoad && this.hasMoreData()) {
      this._createSentinel();
    }
  }

  renderPinnedItems() {
    if (this.pinnedItems.length === 0) {
      this.$pinnedSection.style.display = 'none';
      return;
    }

    this.$pinnedSection.style.display = 'block';
    this.$pinnedList.innerHTML = this.pinnedItems.map(item => {
      const contentPreview = item.type === 'text'
        ? item.content.replace(/\n/g, ' ').substring(0, 50)
        : '🖼️ 图片';

      return `
        <div class="pinned-item" draggable="true" data-id="${item.id}">
          <div class="pinned-item-header">
            <span class="pinned-item-type">${item.type === 'text' ? '📝 文本' : '🖼️ 图片'}</span>
            <button class="btn-icon action-btn pin" onclick="app.togglePin(${item.id}, false)" title="取消固定">
              ⭐
            </button>
          </div>
          <div class="pinned-item-content" onclick="app.replay(${item.id})" title="点击复制">
            ${this.escapeHtml(contentPreview)}
          </div>
        </div>
      `;
    }).join('');
  }

  updateVirtualScroll() {
    this.$padding.style.height = `${this.filteredItems.length * this.ITEM_HEIGHT}px`;
    this.$content.style.minHeight = `${Math.min(this.filteredItems.length, 20) * this.ITEM_HEIGHT}px`;
    this.onScroll();

    if (this.hasMoreData()) {
      requestAnimationFrame(() => this._createSentinel());
    }
  }

  onScroll() {
    const scrollTop = this.$container.scrollTop;
    const viewportHeight = this.$container.clientHeight;
    const scrollHeight = this.$container.scrollHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / this.ITEM_HEIGHT) - this.BUFFER_SIZE);
    const endIndex = Math.min(
      this.filteredItems.length,
      Math.ceil((scrollTop + viewportHeight) / this.ITEM_HEIGHT) + this.BUFFER_SIZE
    );

    const offsetY = startIndex * this.ITEM_HEIGHT;
    this.$content.style.transform = `translateY(${offsetY}px)`;

    const visibleItems = this.filteredItems.slice(startIndex, endIndex);
    this.renderVisibleItems(visibleItems, startIndex);

    if (scrollTop + viewportHeight >= scrollHeight - 100 && this.hasMoreData() && !this.isLoadingMore) {
      this._loadMoreData();
    }
  }

  renderVisibleItems(items, startIndex) {
    if (items.length === 0) {
      if (this.filteredItems.length === 0) {
        if (this.isLoadingMore) {
          this.$content.innerHTML = `
            <div class="loading" style="position: absolute; top: 0; width: 100%;">
              <div class="spinner"></div>
            </div>
          `;
        } else {
          this.showEmptyState('暂无符合条件的记录');
        }
      } else {
        this.$content.innerHTML = '';
      }
      return;
    }

    const itemsHtml = items.map((item, index) => {
      const actualIndex = startIndex + index;
      return this.renderHistoryItem(item, actualIndex);
    }).join('');

    let loadingHtml = '';
    if (this.isLoadingMore) {
      loadingHtml = `
        <div style="position: absolute; top: ${this.filteredItems.length * this.ITEM_HEIGHT}px; width: 100%; padding: 20px; text-align: center;">
          <div class="spinner" style="margin: 0 auto; width: 24px; height: 24px;"></div>
          <div style="margin-top: 8px; color: #999; font-size: 13px;">加载中...</div>
        </div>
      `;
    }

    this.$content.innerHTML = itemsHtml + loadingHtml;
  }

  renderHistoryItem(item, index) {
    const date = new Date(item.timestamp);
    const timeStr = this.formatDate(date);
    const icon = item.type === 'text' ? '📝' : '🖼️';

    let contentHtml = '';
    if (item.type === 'text') {
      contentHtml = `<div class="item-content text-content">${this.escapeHtml(item.content)}</div>`;
    } else {
      const imgSrc = item.content;
      contentHtml = `
        <div class="item-content image-content" onclick="app.openModal('${imgSrc}'); event.stopPropagation();">
          <img src="${imgSrc}" alt="图片预览" loading="lazy">
        </div>
      `;
    }

    return `
      <div class="history-item" 
           style="position: absolute; top: ${index * this.ITEM_HEIGHT}px; width: 100%;"
           onclick="app.replay(${item.id})"
           data-id="${item.id}">
        <div class="item-icon">${icon}</div>
        <div class="item-body">
          <div class="item-header">
            <div class="item-meta">
              <span class="item-type ${item.type}">${item.type}</span>
              ${item.category ? `<span class="item-category" onclick="event.stopPropagation(); app.filterByCategory('${item.category}')" title="点击筛选此分类">${this.escapeHtml(item.category)}</span>` : `<span class="item-category editable" onclick="event.stopPropagation(); app.editCategory(${item.id})" title="点击添加标签">+ 标签</span>`}
              <span class="item-source">${this.escapeHtml(item.sourceApp || '未知')}</span>
              <span class="item-time">${timeStr}</span>
            </div>
          </div>
          ${contentHtml}
        </div>
        <div class="item-actions" onclick="event.stopPropagation();">
          <button class="action-btn pin" onclick="app.togglePin(${item.id}, true)" title="固定">
            ⭐
          </button>
          <button class="action-btn copy" onclick="app.replay(${item.id})" title="复制">
            📋
          </button>
        </div>
      </div>
    `;
  }

  filterByCategory(category) {
    this.$categoryFilter.value = category;
    this.resetPagination();
    this.applyFilters();
  }

  async editCategory(id) {
    const newCategory = prompt('输入分类标签:');
    if (newCategory !== null) {
      try {
        const response = await fetch(`${this.daemonUrl}/api/history/${id}/category`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: newCategory.trim() || null }),
        });

        if (response.ok) {
          this.showToast('标签已更新', 'success');
          this.resetPagination();
          await this.loadData();
          await this.loadCategories();
        }
      } catch (err) {
        console.error('更新标签失败:', err);
        this.showToast('更新失败', 'error');
      }
    }
  }

  async togglePin(id, isPinned) {
    try {
      const response = await fetch(`${this.daemonUrl}/api/history/${id}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: !isPinned }),
      });

      if (response.ok) {
        this.showToast(isPinned ? '已固定' : '已取消固定', 'success');
        this.resetPagination();
        await this.loadData();
      }
    } catch (err) {
      console.error('固定失败:', err);
      this.showToast('操作失败', 'error');
    }
  }

  async replay(id) {
    try {
      const response = await fetch(`${this.daemonUrl}/api/replay/${id}`, {
        method: 'POST',
      });

      if (response.ok) {
        this.showToast('已复制到剪贴板', 'success');
      } else {
        this.showToast('复制失败', 'error');
      }
    } catch (err) {
      console.error('复制失败:', err);
      this.showToast('复制失败', 'error');
    }
  }

  showEmptyState(message) {
    this.$content.innerHTML = `
      <div class="empty-state" style="position: absolute; top: 0; width: 100%;">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">${message}</div>
      </div>
    `;
  }

  setLoading(loading) {
    if (loading) {
      this.$refreshBtn.disabled = true;
      this.$refreshBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> 加载中...';
    } else {
      this.$refreshBtn.disabled = false;
      this.$refreshBtn.innerHTML = '🔄 刷新';
    }
  }

  showToast(message, type = 'success') {
    this.$toast.textContent = message;
    this.$toast.className = `toast show ${type}`;
    setTimeout(() => {
      this.$toast.classList.remove('show');
    }, 2000);
  }

  formatDate(date) {
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  startAutoRefresh() {
    setInterval(() => {
      this.checkConnection();
    }, 5000);
  }
}

const app = new ClipboardApp();
