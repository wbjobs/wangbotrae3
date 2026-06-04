import { create } from 'zustand';
import { Table, Column, Row, User, ChangeLog } from '../types';

interface AppState {
  currentUser: User | null;
  users: User[];
  tables: Table[];
  currentTable: Table | null;
  columns: Column[];
  rows: Row[];
  changeLogs: ChangeLog[];
  isOnline: boolean;
  setCurrentUser: (user: User) => void;
  setUsers: (users: User[]) => void;
  setTables: (tables: Table[]) => void;
  setCurrentTable: (table: Table | null) => void;
  setColumns: (columns: Column[]) => void;
  setRows: (rows: Row[]) => void;
  setChangeLogs: (logs: ChangeLog[]) => void;
  addRow: (row: Row) => void;
  markRowDeleted: (rowId: string, lamportTimestamp: number, userId: string) => void;
  markRowRestored: (rowId: string, lamportTimestamp: number) => void;
  updateCell: (rowId: string, columnId: string, value: any, timestamp: number, editorId: string) => void;
  setOnline: (online: boolean) => void;
  getVisibleRows: () => Row[];
}

export const useStore = create<AppState>((set, get) => ({
  currentUser: null,
  users: [],
  tables: [],
  currentTable: null,
  columns: [],
  rows: [],
  changeLogs: [],
  isOnline: navigator.onLine,

  setCurrentUser: (user) => set({ currentUser: user }),
  setUsers: (users) => set({ users }),
  setTables: (tables) => set({ tables }),
  setCurrentTable: (table) => set({ currentTable: table }),
  setColumns: (columns) => set({ columns }),
  setRows: (rows) => set({ rows }),
  setChangeLogs: (logs) => set({ changeLogs: logs }),
  
  addRow: (row) => set((state) => ({
    rows: [...state.rows, row],
  })),

  markRowDeleted: (rowId, lamportTimestamp, userId) => set((state) => {
    const newRows = state.rows.map((row) => {
      if (row.id !== rowId) return row;
      if (row.delete_lamport >= lamportTimestamp) return row;
      return {
        ...row,
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        delete_lamport: lamportTimestamp,
        updated_at: new Date().toISOString(),
      };
    });
    return { rows: newRows };
  }),

  markRowRestored: (rowId, lamportTimestamp) => set((state) => {
    const newRows = state.rows.map((row) => {
      if (row.id !== rowId) return row;
      if (lamportTimestamp <= row.delete_lamport) return row;
      return {
        ...row,
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        delete_lamport: lamportTimestamp,
        updated_at: new Date().toISOString(),
      };
    });
    return { rows: newRows };
  }),

  updateCell: (rowId, columnId, value, timestamp, editorId) => set((state) => {
    const newRows = state.rows.map((row) => {
      if (row.id !== rowId) return row;
      if (row.is_deleted) return row;
      
      const currentCell = row.cells?.[columnId];
      if (currentCell && currentCell.lamportTimestamp >= timestamp) {
        return row;
      }
      
      return {
        ...row,
        cells: {
          ...row.cells,
          [columnId]: {
            value,
            lamportTimestamp: timestamp,
            lastEditorId: editorId,
            updatedAt: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      };
    });
    return { rows: newRows };
  }),

  setOnline: (online) => set({ isOnline: online }),

  getVisibleRows: () => get().rows.filter((row) => !row.is_deleted),
}));
