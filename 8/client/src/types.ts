export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Table {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  table_id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'attachment';
  config: Record<string, any>;
  position: number;
  created_at: string;
}

export interface Row {
  id: string;
  table_id: string;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_lamport: number;
  created_at: string;
  updated_at: string;
  cells: Record<string, CellData>;
}

export interface CellData {
  value: any;
  lamportTimestamp: number;
  lastEditorId: string;
  updatedAt: string;
}

export interface ChangeLog {
  id: string;
  table_id: string;
  row_id: string;
  column_id: string;
  user_id: string;
  user_name: string;
  column_name: string;
  action: 'create' | 'update' | 'delete' | 'undelete';
  old_value: any;
  new_value: any;
  lamport_timestamp: number;
  created_at: string;
}

export interface LocalChange {
  id?: number;
  type: 'cell_update' | 'row_create' | 'row_delete' | 'row_undelete' | 'column_create' | 'column_delete';
  tableId: string;
  rowId?: string;
  columnId?: string;
  oldValue?: any;
  newValue?: any;
  lamportTimestamp: number;
  userId: string;
  synced: boolean;
  createdAt: Date;
}

export interface TombstoneCleanupResult {
  success: boolean;
  purgedCount: number;
}

export interface QueryCondition {
  type: 'comparison' | 'and' | 'or';
  left?: string;
  operator?: string;
  right?: any;
  conditions?: QueryCondition[];
}

export interface QueryAST {
  type: string;
  columns: Array<string | { name: string; alias: string }>;
  from: string;
  joins: Array<{
    type: string;
    table: string;
    leftKey: string;
    rightKey: string;
  }>;
  where: QueryCondition | null;
  groupBy: string[];
  aggregations: Array<{
    function: string;
    column: string | null;
    alias: string;
  }>;
  isAggregate: boolean;
}

export interface View {
  id: string;
  name: string;
  table_id: string;
  query_text: string;
  query_ast: QueryAST;
  materialized_view?: {
    data: Record<string, any>[];
    meta?: { generatedAt: number };
  };
  affected_columns?: string[];
  last_sync_lamport: number;
  is_aggregate: boolean;
  created_at: string;
  updated_at: string;
  data?: Record<string, any>[];
}

export interface ViewUpdate {
  viewId: string;
  type: 'initial' | 'incremental' | 'full';
  data: Record<string, any>[];
  updated?: Record<string, any>[];
  removed?: string[];
}
