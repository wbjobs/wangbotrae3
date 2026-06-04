const pool = require('../config/db');
const memoryStore = require('../utils/memoryStore');

class User {
  static async create(name, role) {
    try {
      const result = await pool.query(
        'INSERT INTO users (name, role) VALUES ($1, $2) RETURNING *',
        [name, role]
      );
      return result.rows[0];
    } catch (err) {
      console.log('Using memory store for User.create');
      const user = {
        id: memoryStore.generateId(),
        name,
        role,
        created_at: new Date().toISOString()
      };
      memoryStore.users.set(user.id, user);
      return user;
    }
  }

  static async findById(id) {
    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
      );
      return result.rows[0];
    } catch (err) {
      return memoryStore.users.get(id);
    }
  }

  static async findAll() {
    try {
      const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
      return result.rows;
    } catch (err) {
      return Array.from(memoryStore.users.values()).sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
    }
  }
}

module.exports = User;
