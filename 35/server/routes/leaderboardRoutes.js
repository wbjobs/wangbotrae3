const express = require('express');
const router = express.Router();
const { leaderboardManager } = require('../game/leaderboard');
const { getTopPlayers, getTopScores, getPlayerHistory } = require('../models/GameHistory');

router.get('/global', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = await leaderboardManager.updateGlobalLeaderboard(limit);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error getting global leaderboard:', error);
    res.status(500).json({ error: 'Failed to get leaderboard' });
  }
});

router.get('/top/earnings', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const topPlayers = await getTopPlayers(limit);
    res.json({ 
      players: topPlayers.map((p, index) => ({
        rank: index + 1,
        ...p
      }))
    });
  } catch (error) {
    console.error('Error getting top earnings:', error);
    res.status(500).json({ error: 'Failed to get top earnings' });
  }
});

router.get('/top/scores', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const topScores = await getTopScores(limit);
    res.json({
      scores: topScores.map((s, index) => ({
        rank: index + 1,
        ...s.toObject()
      }))
    });
  } catch (error) {
    console.error('Error getting top scores:', error);
    res.status(500).json({ error: 'Failed to get top scores' });
  }
});

router.get('/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const stats = await leaderboardManager.getPlayerStats(playerId);
    if (!stats) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }
    res.json(stats);
  } catch (error) {
    console.error('Error getting player stats:', error);
    res.status(500).json({ error: 'Failed to get player stats' });
  }
});

router.get('/player/:playerId/history', async (req, res) => {
  try {
    const { playerId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const history = await getPlayerHistory(playerId, limit);
    res.json({ history });
  } catch (error) {
    console.error('Error getting player history:', error);
    res.status(500).json({ error: 'Failed to get player history' });
  }
});

module.exports = router;
