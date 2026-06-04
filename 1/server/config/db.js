const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'music_collab',
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 20,
});

pool.on('connect', () => {
  console.log('PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('PostgreSQL connection error:', err.message);
});

pool.on('acquire', () => {
});

setTimeout(() => {
  pool.query('SELECT 1')
    .then(() => {
      console.log('PostgreSQL connection verified');
    })
    .catch((err) => {
      console.warn('Warning: Could not verify PostgreSQL connection:', err.message);
      console.warn('The application will run with limited functionality (using memory store)');
    });
}, 1000);

module.exports = pool;
