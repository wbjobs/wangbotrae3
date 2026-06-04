import Dexie, { Table as DexieTable } from 'dexie';
import { Table as TableType, Column, Row, LocalChange, User, ChangeLog } from '../types';

export class AppDB extends Dexie {
  users!: DexieTable<User, string>;
  appTables!: DexieTable<TableType, string>;
  columns!: DexieTable<Column, string>;
  rows!: DexieTable<Row, string>;
  localChanges!: DexieTable<LocalChange, number>;
  changeLogs!: DexieTable<ChangeLog, string>;
  syncState!: DexieTable<{ key: string; value: any }, string>;

  constructor() {
    super('OfflineCollabDB');
    
    this.version(1).stores({
      users: 'id, name, email',
      tables: 'id, name, user_id, created_at, updated_at',
      columns: 'id, table_id, position',
      rows: 'id, table_id, created_at, updated_at',
      localChanges: '++id, tableId, synced, createdAt',
      changeLogs: 'id, table_id, row_id, lamport_timestamp',
      syncState: 'key'
    });

    this.version(2).stores({
      users: 'id, name, email',
      tables: 'id, name, user_id, created_at, updated_at',
      columns: 'id, table_id, position',
      rows: 'id, table_id, is_deleted, deleted_at, created_at, updated_at',
      localChanges: '++id, tableId, synced, type, createdAt',
      changeLogs: 'id, table_id, row_id, lamport_timestamp',
      syncState: 'key'
    }).upgrade((tx) => {
      tx.table('rows').toCollection().modify((row: any) => {
        if (row.is_deleted === undefined) row.is_deleted = false;
        if (row.deleted_at === undefined) row.deleted_at = null;
        if (row.deleted_by === undefined) row.deleted_by = null;
        if (row.delete_lamport === undefined) row.delete_lamport = 0;
      });
    });
  }

  async getLamportTimestamp(): Promise<number> {
    const state = await this.syncState.get('lamportClock');
    return state?.value || 0;
  }

  async incrementLamportTimestamp(received: number = 0): Promise<number> {
    const current = await this.getLamportTimestamp();
    const next = Math.max(current, received) + 1;
    await this.syncState.put({ key: 'lamportClock', value: next });
    return next;
  }

  async mergeRow(remoteRow: Row): Promise<void> {
    const localRow = await this.rows.get(remoteRow.id);

    if (!localRow) {
      await this.rows.put(remoteRow);
      return;
    }

    if (remoteRow.is_deleted && !localRow.is_deleted) {
      if (remoteRow.delete_lamport >= localRow.delete_lamport) {
        await this.rows.update(localRow.id, {
          is_deleted: true,
          deleted_at: remoteRow.deleted_at,
          deleted_by: remoteRow.deleted_by,
          delete_lamport: remoteRow.delete_lamport,
          cells: { ...localRow.cells, ...remoteRow.cells },
          updated_at: remoteRow.updated_at,
        });
      }
      return;
    }

    if (!remoteRow.is_deleted && localRow.is_deleted) {
      if (remoteRow.delete_lamport > localRow.delete_lamport) {
        await this.rows.update(localRow.id, {
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          delete_lamport: remoteRow.delete_lamport,
          cells: { ...localRow.cells, ...remoteRow.cells },
          updated_at: remoteRow.updated_at,
        });
      }
      return;
    }

    if (remoteRow.is_deleted && localRow.is_deleted) {
      if (remoteRow.delete_lamport >= localRow.delete_lamport) {
        await this.rows.update(localRow.id, {
          deleted_at: remoteRow.deleted_at,
          deleted_by: remoteRow.deleted_by,
          delete_lamport: remoteRow.delete_lamport,
          updated_at: remoteRow.updated_at,
        });
      }
      return;
    }

    const mergedCells = { ...localRow.cells };
    for (const [columnId, remoteCell] of Object.entries(remoteRow.cells || {})) {
      const localCell = mergedCells[columnId];
      if (!localCell) {
        mergedCells[columnId] = remoteCell;
      } else if (remoteCell.lamportTimestamp >= localCell.lamportTimestamp) {
        mergedCells[columnId] = remoteCell;
      }
    }

    await this.rows.update(localRow.id, {
      cells: mergedCells,
      updated_at: remoteRow.updated_at > localRow.updated_at
        ? remoteRow.updated_at
        : localRow.updated_at,
    });
  }

  async cleanupOldTombstones(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffISO = cutoffDate.toISOString();

    const oldTombstones = await this.rows
      .where('is_deleted')
      .equals(1)
      .filter((row) => row.deleted_at !== null && row.deleted_at < cutoffISO)
      .toArray();

    if (oldTombstones.length === 0) return 0;

    const idsToDelete = oldTombstones.map((r) => r.id);
    await this.rows.bulkDelete(idsToDelete);

    await this.localChanges
      .where('type')
      .equals('row_delete')
      .filter((c): boolean => !!c.rowId && idsToDelete.includes(c.rowId!))
      .delete();

    return idsToDelete.length;
  }
}

export const db = new AppDB();
