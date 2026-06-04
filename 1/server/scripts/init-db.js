const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function initDatabase() {
  try {
    const sqlPath = path.join(__dirname, 'init-db.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Initializing database...');
    await pool.query(sql);
    console.log('Database initialized successfully!');
    
    process.exit(0);
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
}

initDatabase();
