const express = require('express');
const router = express.Router();
const { getAllRooms } = require('../game/roomManager');
const { MAX_FUEL, MINING_SUCCESS_RATE } = require('../game/gameLogic');

router.get('/config', (req, res) => {
  res.json({
    maxFuel: MAX_FUEL,
    miningSuccessRate: MINING_SUCCESS_RATE,
    minOreValue: parseInt(process.env.MIN_ORE_VALUE) || 10,
    maxOreValue: parseInt(process.env.MAX_ORE_VALUE) || 100,
    emptyBlastFuelCost: parseInt(process.env.EMPTY_BLAST_FUEL_COST) || 1
  });
});

router.get('/rooms', (req, res) => {
  const rooms = getAllRooms();
  res.json({ rooms });
});

module.exports = router;
