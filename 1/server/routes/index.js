const express = require('express');
const userRoutes = require('./users');
const scoreRoutes = require('./scores');
const sessionRoutes = require('./sessions');

function setupApiRoutes(app, pool) {
  const apiRouter = express.Router();
  
  apiRouter.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  apiRouter.use('/users', userRoutes(pool));
  apiRouter.use('/scores', scoreRoutes(pool));
  apiRouter.use('/sessions', sessionRoutes(pool));
  
  app.use('/api', apiRouter);
  
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
  });
  
  return apiRouter;
}

module.exports = setupApiRoutes;
