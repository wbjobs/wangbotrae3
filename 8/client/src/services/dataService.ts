import { db } from '../db/indexedDB';
import { socketManager } from '../sync/socket';
import { Table, Column, Row, CellData, ChangeLog, LocalChange, TombstoneCleanupResult } from '../types';

class DataService {
  private currentUserId: string = '11111111-1111-1111-1111-111111111111';

  setUserId(userId: string) {
    this.currentUserId = userId;
  }

  getUserId(): string {
    return this.currentUserId;
  }

  async fetchUsers() {
    const response = await fetch('/api/users');
    const users = await response.json();
    await db.users.bulkPut(users);
    return users;
  }

  async fetchTables() {
    const response = await fetch('/api/tables');
    const tables = await response.json();
    await db.appTables.bulkPut(tables);
    return tables;
  }

  async createTable(name: string): Promise<Table> {
    const response = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, userId: this.currentUserId }),
    });
    const table = await response.json();
    await db.appTables.put(table);
    return table;
  }

  async fetchTableData(tableId: string) {
    const [columnsRes, rowsRes, logsRes] = await Promise.all([
      fetch(`/api/tables/${tableId}/columns`),
      fetch(`/api/tables/${tableId}/rows?includeDeleted=true`),
      fetch(`/api/tables/${tableId}/changelog`),
    ]);

    const columns = await columnsRes.json();
    const rows = await rowsRes.json();
    const logs = await logsRes.json();

    await db.columns.bulkPut(columns);

    for (const r of rows) {
      const row: Row = {
        ...r,
        table_id: tableId,
        is_deleted: r.is_deleted ?? false,
        deleted_at: r.deleted_at ?? null,
        deleted_by: r.deleted_by ?? null,
        delete_lamport: r.delete_lamport ?? 0,
        cells: r.cells ?? {},
      };
      await db.mergeRow(row);
    }

    await db.changeLogs.bulkPut(logs);

    return { columns, rows, logs };
  }

  async createColumn(tableId: string, name: string, type: string, position: number): Promise<Column> {
    const response = await fetch(`/api/tables/${tableId}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, position }),
    });
    const column = await response.json();
    await db.columns.put(column);
    return column;
  }

  async createRow(tableId: string): Promise<Row> {
    const response = await fetch(`/api/tables/${tableId}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const row = await response.json();
    
    const fullRow: Row = {
      ...row,
      table_id: tableId,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      delete_lamport: 0,
      cells: {},
    };
    
    await db.rows.put(fullRow);
    
    const lamportTimestamp = await db.incrementLamportTimestamp();
    const change: LocalChange = {
      type: 'row_create',
      tableId,
      rowId: row.id,
      lamportTimestamp,
      userId: this.currentUserId,
      synced: true,
      createdAt: new Date(),
    };
    await db.localChanges.put(change);

    return fullRow;
  }

  async deleteRow(tableId: string, rowId: string): Promise<void> {
    const lamportTimestamp = await db.incrementLamportTimestamp();
    const now = new Date().toISOString();

    const row = await db.rows.get(rowId);
    if (!row) return;

    const wasDeleted = row.is_deleted;

    await db.rows.update(rowId, {
      is_deleted: true,
      deleted_at: now,
      deleted_by: this.currentUserId,
      delete_lamport: lamportTimestamp,
      updated_at: now,
    });

    const change: LocalChange = {
      type: 'row_delete',
      tableId,
      rowId,
      lamportTimestamp,
      userId: this.currentUserId,
      oldValue: wasDeleted ? { alreadyDeleted: true } : null,
      newValue: { tombstone: true, deletedBy: this.currentUserId, deletedAt: now },
      synced: false,
      createdAt: new Date(),
    };
    await db.localChanges.put(change);

    const changeLog: ChangeLog = {
      id: crypto.randomUUID(),
      table_id: tableId,
      row_id: rowId,
      column_id: '',
      user_id: this.currentUserId,
      user_name: '',
      column_name: '',
      action: 'delete',
      old_value: null,
      new_value: { tombstone: true, deletedBy: this.currentUserId, deletedAt: now },
      lamport_timestamp: lamportTimestamp,
      created_at: now,
    };
    await db.changeLogs.put(changeLog);

    if (socketManager.isConnected()) {
      await fetch(`/api/tables/${tableId}/rows/${rowId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, lamportTimestamp }),
      });
    }

    this.syncChanges(tableId);
  }

  async restoreRow(tableId: string, rowId: string): Promise<void> {
    const lamportTimestamp = await db.incrementLamportTimestamp();
    const now = new Date().toISOString();

    const row = await db.rows.get(rowId);
    if (!row || !row.is_deleted) return;

    await db.rows.update(rowId, {
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      delete_lamport: lamportTimestamp,
      updated_at: now,
    });

    const change: LocalChange = {
      type: 'row_undelete',
      tableId,
      rowId,
      lamportTimestamp,
      userId: this.currentUserId,
      oldValue: { tombstone: true },
      newValue: { restored: true },
      synced: false,
      createdAt: new Date(),
    };
    await db.localChanges.put(change);

    const changeLog: ChangeLog = {
      id: crypto.randomUUID(),
      table_id: tableId,
      row_id: rowId,
      column_id: '',
      user_id: this.currentUserId,
      user_name: '',
      column_name: '',
      action: 'undelete',
      old_value: { tombstone: true },
      new_value: { restored: true },
      lamport_timestamp: lamportTimestamp,
      created_at: now,
    };
    await db.changeLogs.put(changeLog);

    if (socketManager.isConnected()) {
      await fetch(`/api/tables/${tableId}/rows/${rowId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.currentUserId, lamportTimestamp }),
      });
    }

    this.syncChanges(tableId);
  }

  async updateCell(
    tableId: string,
    rowId: string,
    columnId: string,
    newValue: any,
    oldValue: any
  ): Promise<void> {
    const row = await db.rows.get(rowId);
    if (!row || row.is_deleted) return;

    const lamportTimestamp = await db.incrementLamportTimestamp();
    
    const cellData: CellData = {
      value: newValue,
      lamportTimestamp,
      lastEditorId: this.currentUserId,
      updatedAt: new Date().toISOString(),
    };

    row.cells = row.cells || {};
    row.cells[columnId] = cellData;
    row.updated_at = new Date().toISOString();
    
    await db.rows.put(row);

    const change: LocalChange = {
      type: 'cell_update',
      tableId,
      rowId,
      columnId,
      oldValue,
      newValue,
      lamportTimestamp,
      userId: this.currentUserId,
      synced: false,
      createdAt: new Date(),
    };
    
    await db.localChanges.put(change);

    const changeLog: ChangeLog = {
      id: crypto.randomUUID(),
      table_id: tableId,
      row_id: rowId,
      column_id: columnId,
      user_id: this.currentUserId,
      user_name: '',
      column_name: '',
      action: 'update',
      old_value: oldValue,
      new_value: newValue,
      lamport_timestamp: lamportTimestamp,
      created_at: new Date().toISOString(),
    };
    await db.changeLogs.put(changeLog);

    this.syncChanges(tableId);
  }

  async syncChanges(tableId: string) {
    if (!socketManager.isConnected()) {
      console.log('Offline - changes queued');
      return;
    }

    const unsyncedChanges = await db.localChanges
      .where('tableId')
      .equals(tableId)
      .and((c) => !c.synced)
      .sortBy('createdAt');

    if (unsyncedChanges.length === 0) return;

    const changes = unsyncedChanges.map((c) => ({
      rowId: c.rowId,
      columnId: c.columnId,
      action: c.type,
      oldValue: c.oldValue,
      newValue: c.newValue,
      lamportTimestamp: c.lamportTimestamp,
    }));

    const updateBuffer = new Uint8Array(8 + changes.length * 4);
    const view = new DataView(updateBuffer.buffer);
    view.setInt32(0, changes.length, true);

    const sent = socketManager.sendSyncUpdate({
      tableId,
      update: updateBuffer,
      userId: this.currentUserId,
      changes,
    });

    if (sent) {
      for (const change of unsyncedChanges) {
        if (change.id) {
          await db.localChanges.update(change.id, { synced: true });
        }
      }
    }
  }

  async getChangeLogs(tableId: string, rowId?: string): Promise<ChangeLog[]> {
    let query = db.changeLogs.where('table_id').equals(tableId);
    
    if (rowId) {
      query = db.changeLogs.where('row_id').equals(rowId);
    }
    
    return query.reverse().sortBy('lamport_timestamp');
  }

  async handleRemoteRowDeleted(data: { rowId: string; tableId: string; userId: string; lamportTimestamp: number; deletedAt: string }) {
    const localRow = await db.rows.get(data.rowId);
    
    if (!localRow) {
      const tombstoneRow: Row = {
        id: data.rowId,
        table_id: data.tableId,
        is_deleted: true,
        deleted_at: data.deletedAt,
        deleted_by: data.userId,
        delete_lamport: data.lamportTimestamp,
        created_at: data.deletedAt,
        updated_at: data.deletedAt,
        cells: {},
      };
      await db.rows.put(tombstoneRow);
    } else {
      if (data.lamportTimestamp >= localRow.delete_lamport) {
        await db.rows.update(data.rowId, {
          is_deleted: true,
          deleted_at: data.deletedAt,
          deleted_by: data.userId,
          delete_lamport: data.lamportTimestamp,
          updated_at: data.deletedAt,
        });
      }
    }

    await db.incrementLamportTimestamp(data.lamportTimestamp);
  }

  async handleRemoteRowRestored(data: { rowId: string; tableId: string; userId: string; lamportTimestamp: number }) {
    const localRow = await db.rows.get(data.rowId);
    
    if (localRow && localRow.is_deleted) {
      if (data.lamportTimestamp > localRow.delete_lamport) {
        await db.rows.update(data.rowId, {
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          delete_lamport: data.lamportTimestamp,
          updated_at: new Date().toISOString(),
        });
      }
    }

    await db.incrementLamportTimestamp(data.lamportTimestamp);
  }

  async cleanupTombstones(tableId: string, olderThanDays: number = 30): Promise<TombstoneCleanupResult> {
    const localCount = await db.cleanupOldTombstones(olderThanDays);

    if (socketManager.isConnected()) {
      try {
        const response = await fetch(`/api/tables/${tableId}/cleanup-tombstones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ olderThanDays }),
        });
        const serverResult = await response.json();
        return {
          success: true,
          purgedCount: localCount + (serverResult.purgedCount || 0),
        };
      } catch {
        return { success: true, purgedCount: localCount };
      }
    }

    return { success: true, purgedCount: localCount };
  }
}

export const dataService = new DataService();
