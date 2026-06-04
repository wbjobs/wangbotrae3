const mongoose = require('mongoose');

const miningActionSchema = new mongoose.Schema({
  action: { type: String, required: true, enum: ['mine', 'return', 'blast'] },
  timestamp: { type: Date, default: Date.now },
  oreValue: { type: Number, default: 0 },
  fuelUsed: { type: Number, default: 0 }
});

const gameHistorySchema = new mongoose.Schema({
  playerId: { type: String, required: true, index: true },
  playerName: { type: String, required: true },
  roomId: { type: String, required: true, index: true },
  totalOreValue: { type: Number, default: 0 },
  fuelRemaining: { type: Number, default: 0 },
  miningCount: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  blastCount: { type: Number, default: 0 },
  actions: [miningActionSchema],
  gameStatus: { 
    type: String, 
    required: true, 
    enum: ['playing', 'completed', 'crashed'] 
  },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date }
}, { timestamps: true });

gameHistorySchema.index({ playerId: 1, createdAt: -1 });
gameHistorySchema.index({ totalOreValue: -1, createdAt: -1 });

const GameHistory = mongoose.model('GameHistory', gameHistorySchema);

const saveGameHistory = async (gameData) => {
  const history = new GameHistory(gameData);
  return await history.save();
};

const updateGameHistory = async (id, updates) => {
  return await GameHistory.findByIdAndUpdate(id, updates, { new: true });
};

const getPlayerHistory = async (playerId, limit = 10) => {
  return await GameHistory.find({ playerId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

const getTopPlayers = async (limit = 10) => {
  return await GameHistory.aggregate([
    { $match: { gameStatus: 'completed' } },
    { $group: {
        _id: '$playerId',
        playerName: { $first: '$playerName' },
        totalEarnings: { $sum: '$totalOreValue' },
        gamesPlayed: { $sum: 1 },
        bestScore: { $max: '$totalOreValue' }
      }
    },
    { $sort: { totalEarnings: -1 } },
    { $limit: limit }
  ]);
};

const getTopScores = async (limit = 10) => {
  return await GameHistory.find({ gameStatus: 'completed' })
    .sort({ totalOreValue: -1 })
    .limit(limit)
    .select('playerName totalOreValue miningCount successRate createdAt');
};

module.exports = {
  GameHistory,
  saveGameHistory,
  updateGameHistory,
  getPlayerHistory,
  getTopPlayers,
  getTopScores
};
