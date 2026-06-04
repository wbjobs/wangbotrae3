const express = require('express');
const User = require('../models/User');

function userRoutes(pool) {
  const router = express.Router();
  
  router.post('/', async (req, res) => {
    try {
      const { name, role } = req.body;
      
      if (!name || !role) {
        return res.status(400).json({ error: 'Name and role are required' });
      }
      
      if (!['teacher', 'student'].includes(role)) {
        return res.status(400).json({ error: 'Role must be teacher or student' });
      }
      
      const user = await User.create(name, role);
      res.json(user);
    } catch (err) {
      console.error('Error creating user:', err);
      res.status(500).json({ error: 'Failed to create user' });
    }
  });
  
  router.get('/:id', async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    } catch (err) {
      console.error('Error getting user:', err);
      res.status(500).json({ error: 'Failed to get user' });
    }
  });
  
  return router;
}

module.exports = userRoutes;
