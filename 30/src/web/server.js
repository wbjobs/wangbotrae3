const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('../config');

const app = express();
const PORT = config.WEB_PORT;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    daemonUrl: `http://localhost:${config.PORT}`,
    webPort: PORT,
  });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log(`Web 前端运行在 http://localhost:${PORT}`);
  console.log('========================================');
});
