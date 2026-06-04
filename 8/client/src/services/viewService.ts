import { View, ViewUpdate } from '../types';
import { socketManager } from '../sync/socket';

class ViewService {
  private subscribedViews: Map<string, {
    data: Record<string, any>[];
    callbacks: Set<(update: ViewUpdate) => void>;
  }> = new Map();

  constructor() {
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    socketManager.on('view-update', (update: ViewUpdate) => {
      this.handleViewUpdate(update);
    });
  }

  private handleViewUpdate(update: ViewUpdate) {
    const viewState = this.subscribedViews.get(update.viewId);
    if (!viewState) return;

    if (update.type === 'incremental' && update.updated && update.removed) {
      const currentIds = new Set(viewState.data.map((d: any) => d._id));
      
      for (const id of update.removed) {
        currentIds.delete(id);
      }

      const newData = viewState.data.filter((d: any) => currentIds.has(d._id));
      
      const updatedIds = new Set(update.updated.map((u: any) => u._id));
      const merged = newData.filter((d: any) => !updatedIds.has(d._id));
      merged.push(...update.updated);
      
      viewState.data = merged;
    } else {
      viewState.data = update.data;
    }

    for (const callback of viewState.callbacks) {
      callback(update);
    }
  }

  async fetchViews(tableId: string): Promise<View[]> {
    const response = await fetch(`/api/tables/${tableId}/views`);
    return response.json();
  }

  async createView(tableId: string, name: string, query: string): Promise<View> {
    const response = await fetch(`/api/tables/${tableId}/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, query }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create view');
    }

    return response.json();
  }

  async deleteView(viewId: string): Promise<void> {
    await fetch(`/api/views/${viewId}`, { method: 'DELETE' });
  }

  async refreshView(viewId: string): Promise<{ success: boolean; data: Record<string, any>[] }> {
    const response = await fetch(`/api/views/${viewId}/refresh`, { method: 'POST' });
    return response.json();
  }

  async getViewData(viewId: string): Promise<View & { data: Record<string, any>[] }> {
    const response = await fetch(`/api/views/${viewId}`);
    return response.json();
  }

  subscribe(viewId: string, userId: string, callback: (update: ViewUpdate) => void): () => void {
    if (!this.subscribedViews.has(viewId)) {
      this.subscribedViews.set(viewId, { data: [], callbacks: new Set() });
    }

    const state = this.subscribedViews.get(viewId)!;
    state.callbacks.add(callback);

    socketManager.send('subscribe-view', { viewId, userId });

    return () => {
      state.callbacks.delete(callback);
      if (state.callbacks.size === 0) {
        this.subscribedViews.delete(viewId);
        socketManager.send('unsubscribe-view', { viewId, userId });
      }
    };
  }

  getViewCurrentData(viewId: string): Record<string, any>[] {
    return this.subscribedViews.get(viewId)?.data || [];
  }
}

export const viewService = new ViewService();
