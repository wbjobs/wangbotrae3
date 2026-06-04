const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');

router.post('/', syncController.calculateSync);
router.post('/quick', syncController.quickSync);
router.get('/matrix/:id', syncController.getOffsetMatrix);
router.get('/matrix/room/:roomId', syncController.listRoomMatrices);
router.get('/pool-status', syncController.getWorkerPoolStatus);
router.get('/session/:id', syncController.getSyncSession);
router.get('/room/:roomId', syncController.listRoomSyncSessions);

module.exports = router;
