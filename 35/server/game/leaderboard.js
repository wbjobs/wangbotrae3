const { getTopPlayers, getTopScores, getPlayerHistory } = require('../models/GameHistory');
const { getRoomLeaderboard } = require('./roomManager');

class LeaderboardManager {
  constructor() {
    this.globalLeaderboard = [];
    this.roomLeaderboards = new Map();
    this.updateInterval = null;
  }

  async updateGlobalLeaderboard(limit = 10) {
    try {
      const topPlayers = await getTopPlayers(limit);
      const topScores = await getTopScores(limit);
      
      this.globalLeaderboard = {
        byEarnings: topPlayers.map((p, index) => ({
          rank: index + 1,
          playerId: p._id,
          playerName: p.playerName,
          totalEarnings: p.totalEarnings,
          gamesPlayed: p.gamesPlayed,
          bestScore: p.bestScore
        })),
        bySingleScore: topScores.map((s, index) => ({
          rank: index + 1,
          playerName: s.playerName,
          score: s.totalOreValue,
          miningCount: s.miningCount,
          date: s.createdAt
        }))
      };

      return this.globalLeaderboard;
    } catch (error) {
      console.error('Error updating global leaderboard:', error);
      return this.globalLeaderboard;
    }
  }

  async updateRoomLeaderboard(roomId, limit = 10) {
    try {
      const leaderboard = await getRoomLeaderboard(roomId, limit);
      this.roomLeaderboards.set(roomId, leaderboard);
      return leaderboard;
    } catch (error) {
      console.error(`Error updating room ${roomId} leaderboard:`, error);
      return this.roomLeaderboards.get(roomId) || [];
    }
  }

  getGlobalLeaderboard() {
    return this.globalLeaderboard;
  }

  getRoomLeaderboard(roomId) {
    return this.roomLeaderboards.get(roomId) || [];
  }

  async getPlayerStats(playerId) {
    try {
      const history = await getPlayerHistory(playerId, 100);
      
      if (history.length === 0) {
        return null;
      }

      const completedGames = history.filter(h => h.gameStatus === 'completed');
      const crashedGames = history.filter(h => h.gameStatus === 'crashed');
      
      const totalEarnings = completedGames.reduce((sum, h) => sum + h.totalOreValue, 0);
      const totalMiningCount = history.reduce((sum, h) => sum + h.miningCount, 0);
      const totalSuccessCount = history.reduce((sum, h) => sum + h.successCount, 0);
      
      const bestScore = Math.max(...completedGames.map(h => h.totalOreValue), 0);
      const successRate = totalMiningCount > 0 
        ? ((totalSuccessCount / totalMiningCount) * 100).toFixed(1) 
        : 0;

      return {
        playerId,
        playerName: history[0].playerName,
        totalGames: history.length,
        completedGames: completedGames.length,
        crashedGames: crashedGames.length,
        totalEarnings,
        bestScore,
        totalMiningCount,
        totalSuccessCount,
        successRate,
        recentGames: history.slice(0, 10)
      };
    } catch (error) {
      console.error(`Error getting player ${playerId} stats:`, error);
      return null;
    }
  }

  startAutoUpdate(io, intervalMs = 5000) {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(async () => {
      const globalLeaderboard = await this.updateGlobalLeaderboard();
      io.emit('leaderboard:global', globalLeaderboard);
    }, intervalMs);
  }

  stopAutoUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

const leaderboardManager = new LeaderboardManager();

module.exports = {
  LeaderboardManager,
  leaderboardManager
};
