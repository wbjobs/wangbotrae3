import pg from 'pg';

const { Client } = pg;

const config = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
};

const targetDB = process.env.DB_NAME || 'offline_collab_db';

async function createDatabase() {
  const client = new Client(config);
  
  try {
    await client.connect();
    console.log(`Checking if database "${targetDB}" exists...`);
    
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDB]
    );
    
    if (result.rows.length === 0) {
      console.log(`Creating database "${targetDB}"...`);
      await client.query(`CREATE DATABASE "${targetDB}"`);
      console.log(`Database "${targetDB}" created successfully!`);
    } else {
      console.log(`Database "${targetDB}" already exists.`);
    }
  } catch (err) {
    console.error('Error creating database:', err.message);
  } finally {
    await client.end();
  }
}

createDatabase();
