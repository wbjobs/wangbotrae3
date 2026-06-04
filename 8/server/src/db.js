import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'offline_collab_db',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

export const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        user_id UUID REFERENCES users(id),
        ydoc BYTEA,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS columns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        config JSONB DEFAULT '{}',
        position INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rows (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at TIMESTAMP,
        deleted_by UUID REFERENCES users(id),
        delete_lamport INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cells (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        row_id UUID REFERENCES rows(id) ON DELETE CASCADE,
        column_id UUID REFERENCES columns(id) ON DELETE CASCADE,
        value JSONB,
        lamport_timestamp INTEGER NOT NULL DEFAULT 0,
        last_editor_id UUID REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(row_id, column_id)
      );

      CREATE TABLE IF NOT EXISTS change_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
        row_id UUID REFERENCES rows(id) ON DELETE CASCADE,
        column_id UUID REFERENCES columns(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        old_value JSONB,
        new_value JSONB,
        lamport_timestamp INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_change_logs_row ON change_logs(row_id);
      CREATE INDEX IF NOT EXISTS idx_change_logs_table ON change_logs(table_id);
      CREATE INDEX IF NOT EXISTS idx_rows_tombstone ON rows(table_id, is_deleted, deleted_at);

      CREATE TABLE IF NOT EXISTS views (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
        query_text TEXT NOT NULL,
        query_ast JSONB NOT NULL,
        materialized_view JSONB,
        affected_columns TEXT[] DEFAULT '{}',
        last_sync_lamport INTEGER NOT NULL DEFAULT 0,
        is_aggregate BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS view_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        view_id UUID REFERENCES views(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        socket_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(view_id, user_id, socket_id)
      );

      CREATE INDEX IF NOT EXISTS idx_views_table ON views(table_id);
      CREATE INDEX IF NOT EXISTS idx_view_subscriptions_view ON view_subscriptions(view_id);
    `);

    const rowsColCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'rows' AND column_name = 'is_deleted'
    `);
    if (rowsColCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE rows ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE rows ADD COLUMN deleted_at TIMESTAMP;
        ALTER TABLE rows ADD COLUMN deleted_by UUID REFERENCES users(id);
        ALTER TABLE rows ADD COLUMN delete_lamport INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_rows_tombstone ON rows(table_id, is_deleted, deleted_at);
      `);
      console.log('Added tombstone columns to rows table');
    }

    const userCheck = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO users (id, name, email) VALUES
        ('11111111-1111-1111-1111-111111111111', 'Alice', 'alice@example.com'),
        ('22222222-2222-2222-2222-222222222222', 'Bob', 'bob@example.com'),
        ('33333333-3333-3333-3333-333333333333', 'Charlie', 'charlie@example.com')
      `);
    }

    console.log('Database initialized');
  } finally {
    client.release();
  }
};

export const query = (text, params) => pool.query(text, params);
export default pool;
