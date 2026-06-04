import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initDB, query } from './db.js';
import { SQLParser, QueryExecutor } from './queryEngine.js';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

const queryExecutor = new QueryExecutor(query);
const activeViews = new Map();

function refreshActiveViewsCache() {
  query('SELECT * FROM views').then(result => {
    activeViews.clear();
    for (const view of result.rows) {
      activeViews.set(view.id, view);
    }
  });
}

async function updateViewMaterialized(viewId) {
  const view = activeViews.get(viewId);
  if (!view) return;

  const result = await queryExecutor.executeQuery(view.query_ast, view.table_id);
  
  await query(`
    UPDATE views SET 
      materialized_view = $1, 
      affected_columns = $2,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `, [
    { data: result.data, meta: { generatedAt: Date.now() } },
    result.affectedColumns,
    viewId
  ]);

  view.materialized_view = { data: result.data };
  view.affected_columns = result.affectedColumns;
  
  return result.data;
}

async function notifyViewSubscribers(viewId, updateData) {
  const subscriptions = await query(`
    SELECT socket_id FROM view_subscriptions WHERE view_id = $1
  `, [viewId]);

  for (const sub of subscriptions.rows) {
    if (sub.socket_id) {
      io.to(sub.socket_id).emit('view-update', {
        viewId,
        type: updateData.type,
        data: updateData.data,
        updated: updateData.updated,
        removed: updateData.removed,
      });
    }
  }
}

async function processViewsForTableChange(tableId, changes) {
  const affectedViews = Array.from(activeViews.values()).filter(
    v => v.table_id === tableId
  );

  for (const view of affectedViews) {
    const updateResult = await queryExecutor.computeIncrementalUpdate(view, changes);
    await updateViewMaterialized(view.id);
    await notifyViewSubscribers(view.id, updateResult);
  }
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-table', async (tableId) => {
    socket.join(tableId);
    console.log(`Socket ${socket.id} joined table ${tableId}`);
    
    const result = await query(
      'SELECT ydoc FROM tables WHERE id = $1',
      [tableId]
    );
    
    if (result.rows.length > 0 && result.rows[0].ydoc) {
      socket.emit('doc-state', result.rows[0].ydoc);
    }
  });

  socket.on('subscribe-view', async ({ viewId, userId }) => {
    try {
      await query(`
        INSERT INTO view_subscriptions (view_id, user_id, socket_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (view_id, user_id, socket_id) DO NOTHING
      `, [viewId, userId, socket.id]);
      
      socket.join(`view:${viewId}`);
      
      const view = activeViews.get(viewId);
      if (view && view.materialized_view) {
        socket.emit('view-update', {
          viewId,
          type: 'initial',
          data: view.materialized_view.data,
        });
      }
      
      console.log(`Socket ${socket.id} subscribed to view ${viewId}`);
    } catch (err) {
      console.error('Subscribe error:', err);
    }
  });

  socket.on('unsubscribe-view', async ({ viewId, userId }) => {
    try {
      await query(`
        DELETE FROM view_subscriptions 
        WHERE view_id = $1 AND user_id = $2 AND socket_id = $3
      `, [viewId, userId, socket.id]);
      
      socket.leave(`view:${viewId}`);
      console.log(`Socket ${socket.id} unsubscribed from view ${viewId}`);
    } catch (err) {
      console.error('Unsubscribe error:', err);
    }
  });

  socket.on('sync-update', async (data) => {
    const { tableId, update, userId, changes } = data;
    
    io.to(tableId).emit('doc-update', { update, userId, changes });

    const result = await query(
      'SELECT ydoc FROM tables WHERE id = $1',
      [tableId]
    );

    await query(
      'UPDATE tables SET ydoc = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [Buffer.from(update), tableId]
    );

    if (changes && changes.length > 0) {
      for (const change of changes) {
        if (change.action === 'row_delete' || change.action === 'delete') {
          const existingRow = await query(
            'SELECT id, is_deleted, delete_lamport FROM rows WHERE id = $1',
            [change.rowId]
          );

          if (existingRow.rows.length === 0) {
            await query(`
              INSERT INTO rows (id, table_id, is_deleted, deleted_at, deleted_by, delete_lamport, created_at, updated_at)
              VALUES ($1, $2, TRUE, CURRENT_TIMESTAMP, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              ON CONFLICT (id) DO UPDATE SET
                is_deleted = TRUE,
                deleted_at = CURRENT_TIMESTAMP,
                deleted_by = $3,
                delete_lamport = GREATEST(rows.delete_lamport, $4),
                updated_at = CURRENT_TIMESTAMP
            `, [change.rowId, tableId, userId, change.lamportTimestamp]);
          } else {
            const current = existingRow.rows[0];
            if (change.lamportTimestamp >= current.delete_lamport) {
              await query(`
                UPDATE rows SET
                  is_deleted = TRUE,
                  deleted_at = CURRENT_TIMESTAMP,
                  deleted_by = $1,
                  delete_lamport = $2,
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
              `, [userId, change.lamportTimestamp, change.rowId]);
            }
          }

          await query(`
            INSERT INTO change_logs
            (table_id, row_id, column_id, user_id, action, old_value, new_value, lamport_timestamp)
            VALUES ($1, $2, $3, $4, 'delete', $5, $6, $7)
          `, [
            tableId,
            change.rowId,
            change.columnId || null,
            userId,
            change.oldValue || null,
            { tombstone: true, deletedBy: userId },
            change.lamportTimestamp
          ]);
        } else if (change.action === 'row_undelete') {
          const existingRow = await query(
            'SELECT id, is_deleted, delete_lamport FROM rows WHERE id = $1',
            [change.rowId]
          );

          if (existingRow.rows.length > 0) {
            const current = existingRow.rows[0];
            if (change.lamportTimestamp > current.delete_lamport) {
              await query(`
                UPDATE rows SET
                  is_deleted = FALSE,
                  deleted_at = NULL,
                  deleted_by = NULL,
                  delete_lamport = $1,
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
              `, [change.lamportTimestamp, change.rowId]);
            }
          }

          await query(`
            INSERT INTO change_logs
            (table_id, row_id, column_id, user_id, action, old_value, new_value, lamport_timestamp)
            VALUES ($1, $2, $3, $4, 'undelete', $5, $6, $7)
          `, [
            tableId,
            change.rowId,
            change.columnId || null,
            userId,
            { tombstone: true },
            { restored: true },
            change.lamportTimestamp
          ]);
        } else {
          await query(`
            INSERT INTO change_logs 
            (table_id, row_id, column_id, user_id, action, old_value, new_value, lamport_timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            tableId,
            change.rowId,
            change.columnId,
            userId,
            change.action,
            change.oldValue,
            change.newValue,
            change.lamportTimestamp
          ]);
        }
      }
    }

    processViewsForTableChange(tableId, changes || []);
  });

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    await query('DELETE FROM view_subscriptions WHERE socket_id = $1', [socket.id]);
  });
});

app.get('/api/users', async (req, res) => {
  const result = await query('SELECT id, name, email FROM users ORDER BY name');
  res.json(result.rows);
});

app.get('/api/tables', async (req, res) => {
  const result = await query('SELECT * FROM tables ORDER BY created_at DESC');
  res.json(result.rows);
});

app.post('/api/tables', async (req, res) => {
  const { name, userId } = req.body;
  const result = await query(
    'INSERT INTO tables (name, user_id) VALUES ($1, $2) RETURNING *',
    [name, userId]
  );
  res.json(result.rows[0]);
});

app.get('/api/tables/:id', async (req, res) => {
  const result = await query('SELECT * FROM tables WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Table not found' });
  }
  res.json(result.rows[0]);
});

app.get('/api/tables/:id/columns', async (req, res) => {
  const result = await query(
    'SELECT * FROM columns WHERE table_id = $1 ORDER BY position',
    [req.params.id]
  );
  res.json(result.rows);
});

app.post('/api/tables/:id/columns', async (req, res) => {
  const { name, type, config, position } = req.body;
  const result = await query(`
    INSERT INTO columns (table_id, name, type, config, position)
    VALUES ($1, $2, $3, $4, $5) RETURNING *
  `, [req.params.id, name, type, config || {}, position]);
  res.json(result.rows[0]);
});

app.get('/api/tables/:id/rows', async (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  
  const whereClause = includeDeleted ? '' : 'AND r.is_deleted = FALSE';
  
  const result = await query(`
    SELECT r.id, r.table_id, r.created_at, r.updated_at,
           r.is_deleted, r.deleted_at, r.deleted_by, r.delete_lamport,
           json_object_agg(c.id, json_build_object(
             'value', cl.value,
             'lamportTimestamp', cl.lamport_timestamp,
             'lastEditorId', cl.last_editor_id,
             'updatedAt', cl.updated_at
           )) as cells
    FROM rows r
    LEFT JOIN cells cl ON cl.row_id = r.id
    LEFT JOIN columns c ON c.id = cl.column_id
    WHERE r.table_id = $1 ${whereClause}
    GROUP BY r.id, r.table_id, r.created_at, r.updated_at,
             r.is_deleted, r.deleted_at, r.deleted_by, r.delete_lamport
    ORDER BY r.created_at
  `, [req.params.id]);
  res.json(result.rows);
});

app.post('/api/tables/:id/rows', async (req, res) => {
  const result = await query(
    'INSERT INTO rows (table_id) VALUES ($1) RETURNING *',
    [req.params.id]
  );
  res.json(result.rows[0]);
});

app.delete('/api/tables/:tableId/rows/:rowId', async (req, res) => {
  const { tableId, rowId } = req.params;
  const { userId, lamportTimestamp } = req.body;

  const existingRow = await query(
    'SELECT id, is_deleted, delete_lamport FROM rows WHERE id = $1 AND table_id = $2',
    [rowId, tableId]
  );

  if (existingRow.rows.length === 0) {
    return res.status(404).json({ error: 'Row not found' });
  }

  const current = existingRow.rows[0];
  const effectiveLamport = lamportTimestamp || 0;

  if (effectiveLamport >= current.delete_lamport) {
    await query(`
      UPDATE rows SET
        is_deleted = TRUE,
        deleted_at = CURRENT_TIMESTAMP,
        deleted_by = $1,
        delete_lamport = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [userId, effectiveLamport, rowId]);
  }

  await query(`
    INSERT INTO change_logs
    (table_id, row_id, user_id, action, new_value, lamport_timestamp)
    VALUES ($1, $2, $3, 'delete', $4, $5)
  `, [tableId, rowId, userId, { tombstone: true, deletedBy: userId }, effectiveLamport]);

  io.to(tableId).emit('row-deleted', {
    rowId,
    tableId,
    userId,
    lamportTimestamp: effectiveLamport,
    deletedAt: new Date().toISOString(),
  });

  processViewsForTableChange(tableId, [{
    rowId,
    action: 'delete',
    lamportTimestamp: effectiveLamport,
  }]);

  res.json({ success: true, rowId, isDeleted: true });
});

app.post('/api/tables/:tableId/rows/:rowId/restore', async (req, res) => {
  const { tableId, rowId } = req.params;
  const { userId, lamportTimestamp } = req.body;

  const existingRow = await query(
    'SELECT id, is_deleted, delete_lamport FROM rows WHERE id = $1 AND table_id = $2',
    [rowId, tableId]
  );

  if (existingRow.rows.length === 0) {
    return res.status(404).json({ error: 'Row not found' });
  }

  const current = existingRow.rows[0];
  if (!current.is_deleted) {
    return res.status(400).json({ error: 'Row is not deleted' });
  }

  if (lamportTimestamp > current.delete_lamport) {
    await query(`
      UPDATE rows SET
        is_deleted = FALSE,
        deleted_at = NULL,
        deleted_by = NULL,
        delete_lamport = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [lamportTimestamp, rowId]);
  }

  io.to(tableId).emit('row-restored', {
    rowId,
    tableId,
    userId,
    lamportTimestamp,
  });

  processViewsForTableChange(tableId, [{
    rowId,
    action: 'undelete',
    lamportTimestamp,
  }]);

  res.json({ success: true, rowId, isDeleted: false });
});

app.post('/api/tables/:id/cleanup-tombstones', async (req, res) => {
  const tableId = req.params.id;
  const { olderThanDays = 30 } = req.body;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const deletedRows = await query(`
    SELECT id FROM rows
    WHERE table_id = $1 AND is_deleted = TRUE AND deleted_at < $2
  `, [tableId, cutoffDate]);

  if (deletedRows.rows.length === 0) {
    return res.json({ success: true, purgedCount: 0 });
  }

  const rowIds = deletedRows.rows.map((r) => r.id);

  await query('DELETE FROM cells WHERE row_id = ANY($1)', [rowIds]);
  await query('DELETE FROM change_logs WHERE row_id = ANY($1) AND action = $2', [rowIds, 'delete']);
  await query('DELETE FROM rows WHERE id = ANY($1)', [rowIds]);

  console.log(`Purged ${rowIds.length} tombstones older than ${olderThanDays} days from table ${tableId}`);

  res.json({ success: true, purgedCount: rowIds.length });
});

app.get('/api/tables/:id/views', async (req, res) => {
  const result = await query(
    'SELECT * FROM views WHERE table_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(result.rows);
});

app.post('/api/tables/:id/views', async (req, res) => {
  const { name, query: queryText } = req.body;
  const tableId = req.params.id;

  try {
    const ast = SQLParser.parse(queryText);
    
    const result = await query(`
      INSERT INTO views (name, table_id, query_text, query_ast, is_aggregate)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name, tableId, queryText, ast, ast.isAggregate]);

    const view = result.rows[0];
    activeViews.set(view.id, view);
    await updateViewMaterialized(view.id);

    res.json(view);
  } catch (err) {
    console.error('Create view error:', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/views/:id', async (req, res) => {
  const result = await query('SELECT * FROM views WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'View not found' });
  }
  
  const view = result.rows[0];
  
  if (view.materialized_view && view.materialized_view.data) {
    res.json({ ...view, data: view.materialized_view.data });
  } else {
    try {
      const execResult = await queryExecutor.executeQuery(view.query_ast, view.table_id);
      res.json({ ...view, data: execResult.data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.delete('/api/views/:id', async (req, res) => {
  await query('DELETE FROM views WHERE id = $1', [req.params.id]);
  activeViews.delete(req.params.id);
  res.json({ success: true });
});

app.post('/api/views/:id/refresh', async (req, res) => {
  try {
    const data = await updateViewMaterialized(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tables/:id/query', async (req, res) => {
  const { query: queryText } = req.body;
  
  try {
    const ast = SQLParser.parse(queryText);
    const result = await queryExecutor.executeQuery(ast, req.params.id);
    res.json({
      data: result.data,
      ast,
      affectedColumns: result.affectedColumns,
    });
  } catch (err) {
    console.error('Query error:', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tables/:id/changelog', async (req, res) => {
  const { rowId } = req.query;
  let queryText = `
    SELECT cl.*, u.name as user_name, c.name as column_name
    FROM change_logs cl
    LEFT JOIN users u ON u.id = cl.user_id
    LEFT JOIN columns c ON c.id = cl.column_id
    WHERE cl.table_id = $1
  `;
  let params = [req.params.id];
  
  if (rowId) {
    queryText += ' AND cl.row_id = $2';
    params.push(rowId);
  }
  
  queryText += ' ORDER BY cl.lamport_timestamp DESC, cl.created_at DESC';
  
  const result = await query(queryText, params);
  res.json(result.rows);
});

const PORT = process.env.PORT || 3001;

initDB().then(() => {
  refreshActiveViewsCache();
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
