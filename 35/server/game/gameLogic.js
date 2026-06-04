const { savePlayerSession, getPlayerSession, getRedisClient } = require('../config/redis');
const { saveGameHistory, updateGameHistory } = require('../models/GameHistory');

const MINING_SUCCESS_RATE = parseFloat(process.env.MINING_SUCCESS_RATE) || 0.7;
const MIN_ORE_VALUE = parseInt(process.env.MIN_ORE_VALUE) || 10;
const MAX_ORE_VALUE = parseInt(process.env.MAX_ORE_VALUE) || 100;
const EMPTY_BLAST_FUEL_COST = parseInt(process.env.EMPTY_BLAST_FUEL_COST) || 1;
const MAX_FUEL = parseInt(process.env.MAX_FUEL) || 10;
const PIRATE_ENCOUNTER_RATE = parseFloat(process.env.PIRATE_ENCOUNTER_RATE) || 0.05;
const PIRATE_BASE_POWER = parseInt(process.env.PIRATE_BASE_POWER) || 6;
const EQUIPMENT_BASE_BONUS = parseInt(process.env.EQUIPMENT_BASE_BONUS) || 1;
const SURRENDER_LOSS_RATE = parseFloat(process.env.SURRENDER_LOSS_RATE) || 0.5;

const UPGRADE_COSTS = {
  2: 50,
  3: 150,
  4: 300,
  5: 500
};

const MAX_EQUIPMENT_LEVEL = 5;

const createPlayerState = (playerId, playerName, roomId) => {
  return {
    playerId,
    playerName,
    roomId,
    fuel: MAX_FUEL,
    totalOreValue: 0,
    miningCount: 0,
    successCount: 0,
    blastCount: 0,
    actions: [],
    gameStatus: 'playing',
    gameHistoryId: null,
    equipmentLevel: 1,
    pendingPirateEvent: null,
    pirateEncounters: 0,
    pirateWins: 0,
    pirateLosses: 0,
    surrenderedCount: 0
  };
};

const generateOreValue = () => {
  return Math.floor(Math.random() * (MAX_ORE_VALUE - MIN_ORE_VALUE + 1)) + MIN_ORE_VALUE;
};

const isMiningSuccess = () => {
  return Math.random() < MINING_SUCCESS_RATE;
};

const performMine = async (playerState) => {
  const result = {
    success: false,
    oreValue: 0,
    fuelUsed: 0,
    message: '',
    gameOver: false,
    pirateEncounter: null
  };

  playerState.miningCount++;

  if (playerState.fuel <= 0) {
    result.message = '燃料耗尽，无法继续挖矿！';
    result.gameOver = true;
    playerState.gameStatus = 'crashed';
    return result;
  }

  if (isMiningSuccess()) {
    const oreValue = generateOreValue();
    playerState.totalOreValue += oreValue;
    playerState.successCount++;
    result.success = true;
    result.oreValue = oreValue;
    result.message = `挖矿成功！获得价值 ${oreValue} 的矿石`;
    
    playerState.actions.push({
      action: 'mine',
      oreValue,
      fuelUsed: 0,
      timestamp: new Date()
    });

    if (playerState.totalOreValue > 0 && !playerState.pendingPirateEvent) {
      const pirateEvent = await handlePirateEncounter(playerState);
      if (pirateEvent) {
        result.pirateEncounter = pirateEvent;
        result.message += ' 警告：遭遇海盗！';
      }
    }
  } else {
    const fuelCost = EMPTY_BLAST_FUEL_COST;
    playerState.fuel -= fuelCost;
    playerState.blastCount++;
    result.success = false;
    result.fuelUsed = fuelCost;
    result.message = `遭遇空爆！损失 ${fuelCost} 燃料，剩余燃料：${playerState.fuel}`;
    
    playerState.actions.push({
      action: 'blast',
      oreValue: 0,
      fuelUsed: fuelCost,
      timestamp: new Date()
    });

    if (playerState.fuel <= 0) {
      result.gameOver = true;
      playerState.gameStatus = 'crashed';
      result.message += ' 燃料耗尽，任务失败！';
    }
  }

  await savePlayerSession(playerState.playerId, playerState);

  if (playerState.gameHistoryId) {
    await updateGameHistory(playerState.gameHistoryId, {
      totalOreValue: playerState.totalOreValue,
      fuelRemaining: playerState.fuel,
      miningCount: playerState.miningCount,
      successCount: playerState.successCount,
      blastCount: playerState.blastCount,
      actions: playerState.actions,
      gameStatus: playerState.gameStatus,
      equipmentLevel: playerState.equipmentLevel,
      pirateEncounters: playerState.pirateEncounters,
      pirateWins: playerState.pirateWins,
      pirateLosses: playerState.pirateLosses,
      surrenderedCount: playerState.surrenderedCount,
      endTime: result.gameOver ? new Date() : undefined
    });
  }

  return result;
};

const returnToBase = async (playerState) => {
  const result = {
    success: true,
    totalEarnings: playerState.totalOreValue,
    miningCount: playerState.miningCount,
    successRate: playerState.miningCount > 0 
      ? ((playerState.successCount / playerState.miningCount) * 100).toFixed(1) 
      : 0,
    message: '',
    blocked: false
  };

  if (playerState.pendingPirateEvent) {
    result.success = false;
    result.blocked = true;
    result.message = '有待处理的海盗事件！请先解决海盗问题再返航。';
    return result;
  }

  playerState.gameStatus = 'completed';
  result.message = `返航成功！本次收益：${playerState.totalOreValue}，挖矿次数：${playerState.miningCount}，成功率：${result.successRate}%`;

  playerState.actions.push({
    action: 'return',
    oreValue: playerState.totalOreValue,
    fuelUsed: 0,
    timestamp: new Date()
  });

  await savePlayerSession(playerState.playerId, playerState);

  if (playerState.gameHistoryId) {
    await updateGameHistory(playerState.gameHistoryId, {
      totalOreValue: playerState.totalOreValue,
      fuelRemaining: playerState.fuel,
      miningCount: playerState.miningCount,
      successCount: playerState.successCount,
      blastCount: playerState.blastCount,
      actions: playerState.actions,
      gameStatus: 'completed',
      equipmentLevel: playerState.equipmentLevel,
      pirateEncounters: playerState.pirateEncounters,
      pirateWins: playerState.pirateWins,
      pirateLosses: playerState.pirateLosses,
      surrenderedCount: playerState.surrenderedCount,
      endTime: new Date()
    });
  }

  return result;
};

const initGameSession = async (playerId, playerName, roomId) => {
  const existingSession = await getPlayerSession(playerId);
  if (existingSession && existingSession.gameStatus === 'playing') {
    return existingSession;
  }

  const playerState = createPlayerState(playerId, playerName, roomId);
  
  const historyRecord = await saveGameHistory({
    playerId,
    playerName,
    roomId,
    totalOreValue: 0,
    fuelRemaining: MAX_FUEL,
    miningCount: 0,
    successCount: 0,
    blastCount: 0,
    actions: [],
    gameStatus: 'playing',
    startTime: new Date()
  });
  
  playerState.gameHistoryId = historyRecord._id.toString();
  await savePlayerSession(playerId, playerState);
  
  return playerState;
};

const getPlayerState = async (playerId) => {
  return await getPlayerSession(playerId);
};

const endGameSession = async (playerId, status = 'crashed') => {
  const playerState = await getPlayerSession(playerId);
  if (!playerState) return null;

  playerState.gameStatus = status;
  
  if (playerState.gameHistoryId) {
    await updateGameHistory(playerState.gameHistoryId, {
      gameStatus: status,
      endTime: new Date(),
      totalOreValue: playerState.totalOreValue,
      fuelRemaining: playerState.fuel,
      miningCount: playerState.miningCount,
      successCount: playerState.successCount,
      blastCount: playerState.blastCount,
      actions: playerState.actions
    });
  }

  return playerState;
};

const addPendingEvent = async (playerId, eventType, eventData) => {
  const client = getRedisClient();
  const key = `player:events:${playerId}`;
  const event = {
    type: eventType,
    data: eventData,
    timestamp: Date.now()
  };
  await client.rPush(key, JSON.stringify(event));
  await client.expire(key, 300);
};

const getPendingEvents = async (playerId) => {
  const client = getRedisClient();
  const key = `player:events:${playerId}`;
  const events = await client.lRange(key, 0, -1);
  return events.map(e => JSON.parse(e));
};

const clearPendingEvents = async (playerId) => {
  const client = getRedisClient();
  const key = `player:events:${playerId}`;
  await client.del(key);
};

const getFullStateSync = async (playerId, roomId) => {
  const playerState = await getPlayerState(playerId);
  const { getRoomPlayers, getRoomLeaderboard } = require('./roomManager');
  
  const roomPlayers = await getRoomPlayers(roomId);
  const roomLeaderboard = await getRoomLeaderboard(roomId);
  const { leaderboardManager } = require('./leaderboard');
  const globalLeaderboard = leaderboardManager.getGlobalLeaderboard();

  return {
    playerState,
    roomPlayers,
    roomLeaderboard,
    globalLeaderboard,
    syncTimestamp: Date.now(),
    syncType: 'full'
  };
};

const shouldEncounterPirate = () => {
  return Math.random() < PIRATE_ENCOUNTER_RATE;
};

const generatePirateEvent = (playerState) => {
  const pirateLevel = Math.max(1, Math.floor(Math.random() * playerState.equipmentLevel) + Math.floor(Math.random() * 3));
  const piratePower = PIRATE_BASE_POWER + pirateLevel * 2;
  const oreDemand = Math.floor(playerState.totalOreValue * SURRENDER_LOSS_RATE);
  
  return {
    eventId: `pirate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    pirateLevel,
    piratePower,
    oreDemand,
    equipmentBonus: EQUIPMENT_BASE_BONUS * playerState.equipmentLevel,
    playerPower: 0,
    pirateRoll: 0,
    timestamp: Date.now()
  };
};

const handlePirateEncounter = async (playerState) => {
  if (playerState.pendingPirateEvent) {
    return null;
  }
  
  if (!shouldEncounterPirate()) {
    return null;
  }
  
  if (playerState.totalOreValue <= 0) {
    return null;
  }
  
  const pirateEvent = generatePirateEvent(playerState);
  playerState.pendingPirateEvent = pirateEvent;
  playerState.pirateEncounters++;
  
  playerState.actions.push({
    action: 'pirate_encounter',
    pirateLevel: pirateEvent.pirateLevel,
    piratePower: pirateEvent.piratePower,
    oreDemand: pirateEvent.oreDemand,
    timestamp: new Date()
  });
  
  await savePlayerSession(playerState.playerId, playerState);
  
  if (playerState.gameHistoryId) {
    await updateGameHistory(playerState.gameHistoryId, {
      actions: playerState.actions,
      equipmentLevel: playerState.equipmentLevel,
      pirateEncounters: playerState.pirateEncounters
    });
  }
  
  return pirateEvent;
};

const fightPirate = async (playerState) => {
  const result = {
    victory: false,
    playerRoll: 0,
    pirateRoll: 0,
    playerPower: 0,
    piratePower: 0,
    oreGained: 0,
    oreLost: 0,
    fuelLost: 0,
    message: ''
  };
  
  if (!playerState.pendingPirateEvent) {
    result.message = '没有待处理的海盗事件';
    return result;
  }
  
  const pirateEvent = playerState.pendingPirateEvent;
  
  result.playerRoll = Math.floor(Math.random() * 6) + 1;
  result.pirateRoll = Math.floor(Math.random() * 6) + 1;
  result.playerPower = result.playerRoll + EQUIPMENT_BASE_BONUS * playerState.equipmentLevel;
  result.piratePower = result.pirateRoll + pirateEvent.pirateLevel * 2;
  
  pirateEvent.playerRoll = result.playerRoll;
  pirateEvent.pirateRoll = result.pirateRoll;
  pirateEvent.playerPower = result.playerPower;
  
  if (result.playerPower >= result.piratePower) {
    result.victory = true;
    result.oreGained = Math.floor(pirateEvent.oreDemand * 0.5);
    playerState.totalOreValue += result.oreGained;
    playerState.pirateWins++;
    result.message = `战斗胜利！你的战力 ${result.playerPower} vs 海盗战力 ${result.piratePower}，缴获 ${result.oreGained} 矿石！`;
  } else {
    result.victory = false;
    result.oreLost = pirateEvent.oreDemand;
    result.fuelLost = 1;
    playerState.totalOreValue = Math.max(0, playerState.totalOreValue - result.oreLost);
    playerState.fuel = Math.max(0, playerState.fuel - result.fuelLost);
    playerState.pirateLosses++;
    result.message = `战斗失败！你的战力 ${result.playerPower} vs 海盗战力 ${result.piratePower}，损失 ${result.oreLost} 矿石和 ${result.fuelLost} 燃料！`;
    
    if (playerState.fuel <= 0) {
      playerState.gameStatus = 'crashed';
      result.message += ' 燃料耗尽，任务失败！';
    }
  }
  
  playerState.actions.push({
    action: 'pirate_fight',
    victory: result.victory,
    playerRoll: result.playerRoll,
    pirateRoll: result.pirateRoll,
    playerPower: result.playerPower,
    piratePower: result.piratePower,
    oreGained: result.oreGained,
    oreLost: result.oreLost,
    fuelLost: result.fuelLost,
    timestamp: new Date()
  });
  
  playerState.pendingPirateEvent = null;
  await savePlayerSession(playerState.playerId, playerState);
  
  if (playerState.gameHistoryId) {
    await updateGameHistory(playerState.gameHistoryId, {
      totalOreValue: playerState.totalOreValue,
      fuelRemaining: playerState.fuel,
      actions: playerState.actions,
      gameStatus: playerState.gameStatus,
      pirateWins: playerState.pirateWins,
      pirateLosses: playerState.pirateLosses,
      endTime: playerState.gameStatus !== 'playing' ? new Date() : undefined
    });
  }
  
  return result;
};

const surrenderToPirate = async (playerState) => {
  const result = {
    success: true,
    oreLost: 0,
    message: ''
  };
  
  if (!playerState.pendingPirateEvent) {
    result.message = '没有待处理的海盗事件';
    result.success = false;
    return result;
  }
  
  const pirateEvent = playerState.pendingPirateEvent;
  result.oreLost = pirateEvent.oreDemand;
  playerState.totalOreValue = Math.max(0, playerState.totalOreValue - result.oreLost);
  playerState.surrenderedCount++;
  
  result.message = `已投降，损失 ${result.oreLost} 矿石（当前矿石的50%）。`;
  
  playerState.actions.push({
    action: 'pirate_surrender',
    oreLost: result.oreLost,
    timestamp: new Date()
  });
  
  playerState.pendingPirateEvent = null;
  await savePlayerSession(playerState.playerId, playerState);
  
  if (playerState.gameHistoryId) {
    await updateGameHistory(playerState.gameHistoryId, {
      totalOreValue: playerState.totalOreValue,
      actions: playerState.actions,
      surrenderedCount: playerState.surrenderedCount
    });
  }
  
  return result;
};

const getUpgradeCost = (currentLevel) => {
  if (currentLevel >= MAX_EQUIPMENT_LEVEL) {
    return null;
  }
  return UPGRADE_COSTS[currentLevel + 1] || null;
};

const canUpgradeEquipment = (playerState) => {
  if (playerState.equipmentLevel >= MAX_EQUIPMENT_LEVEL) {
    return { canUpgrade: false, reason: '已达到最高等级', cost: null };
  }
  
  const cost = getUpgradeCost(playerState.equipmentLevel);
  if (cost === null) {
    return { canUpgrade: false, reason: '无法升级', cost: null };
  }
  
  if (playerState.totalOreValue < cost) {
    return { canUpgrade: false, reason: `矿石不足，需要 ${cost} 矿石`, cost };
  }
  
  return { canUpgrade: true, reason: null, cost };
};

const upgradeEquipment = async (playerState) => {
  const result = {
    success: false,
    newLevel: 0,
    cost: 0,
    bonus: 0,
    message: ''
  };
  
  const checkResult = canUpgradeEquipment(playerState);
  if (!checkResult.canUpgrade) {
    result.message = checkResult.reason;
    return result;
  }
  
  result.cost = checkResult.cost;
  result.newLevel = playerState.equipmentLevel + 1;
  result.bonus = EQUIPMENT_BASE_BONUS * result.newLevel;
  
  playerState.totalOreValue -= result.cost;
  playerState.equipmentLevel = result.newLevel;
  
  result.success = true;
  result.message = `装备升级成功！等级 ${result.newLevel}，战斗加成 +${result.bonus}，消耗 ${result.cost} 矿石。`;
  
  playerState.actions.push({
    action: 'equipment_upgrade',
    oldLevel: playerState.equipmentLevel - 1,
    newLevel: result.newLevel,
    cost: result.cost,
    bonus: result.bonus,
    timestamp: new Date()
  });
  
  await savePlayerSession(playerState.playerId, playerState);
  
  if (playerState.gameHistoryId) {
    await updateGameHistory(playerState.gameHistoryId, {
      totalOreValue: playerState.totalOreValue,
      actions: playerState.actions,
      equipmentLevel: playerState.equipmentLevel
    });
  }
  
  return result;
};

module.exports = {
  createPlayerState,
  generateOreValue,
  isMiningSuccess,
  performMine,
  returnToBase,
  initGameSession,
  getPlayerState,
  endGameSession,
  addPendingEvent,
  getPendingEvents,
  clearPendingEvents,
  getFullStateSync,
  handlePirateEncounter,
  fightPirate,
  surrenderToPirate,
  canUpgradeEquipment,
  upgradeEquipment,
  getUpgradeCost,
  MAX_FUEL,
  MINING_SUCCESS_RATE,
  MAX_EQUIPMENT_LEVEL,
  EQUIPMENT_BASE_BONUS
};
