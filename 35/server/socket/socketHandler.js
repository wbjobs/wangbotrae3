const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const {
  initGameSession,
  performMine,
  returnToBase,
  getPlayerState,
  endGameSession,
  MAX_FUEL,
  getPendingEvents,
  clearPendingEvents,
  fightPirate,
  surrenderToPirate,
  canUpgradeEquipment,
  upgradeEquipment,
  MAX_EQUIPMENT_LEVEL,
  EQUIPMENT_BASE_BONUS
} = require('../game/gameLogic');
const {
  getOrCreateDefaultRoom,
  addPlayerToRoom,
  removePlayerFromRoom,
  getRoomPlayers,
  getRoomLeaderboard,
  broadcastToRoom,
  getPlayerRoomId,
  DEFAULT_ROOM_ID,
  updatePlayerSocketId
} = require('../game/roomManager');
const { leaderboardManager } = require('../game/leaderboard');
const { deletePlayerSession } = require('../config/redis');

let io = null;
const pendingCleanups = new Map();
const RECONNECT_WINDOW = 30 * 1000;

const initSocketIO = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    pingInterval: 10000,
    pingTimeout: 5000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    }
  });

  getOrCreateDefaultRoom();
  leaderboardManager.startAutoUpdate(io);

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id, 'recovered:', socket.recovered);

    socket.on('player:join', async (data) => {
      try {
        const { playerName, roomId = DEFAULT_ROOM_ID, playerId: existingPlayerId } = data;
        
        if (!playerName || playerName.trim().length === 0) {
          socket.emit('error', { message: '请输入玩家名称' });
          return;
        }

        let playerId = existingPlayerId;
        let isReconnect = false;
        let playerState = null;

        if (playerId) {
          playerState = await getPlayerState(playerId);
          if (playerState) {
            isReconnect = true;
            console.log('Attempting to reconnect player:', playerId);
            updatePlayerSocketId(roomId, playerId, socket.id);
            socket.join(roomId);
          } else {
            playerId = null;
          }
        }

        if (!playerId) {
          playerId = uuidv4();
          addPlayerToRoom(roomId, playerId, socket.id, playerName.trim());
          socket.join(roomId);
          playerState = await initGameSession(playerId, playerName.trim(), roomId);
        }

        socket.data = { playerId, roomId, playerName: playerName.trim() };

        const pendingEvents = isReconnect ? await getPendingEvents(playerId) : [];
        
        if (pendingEvents.length > 0) {
          await clearPendingEvents(playerId);
        }

        if (isReconnect) {
          const cleanupKey = `${roomId}:${playerId}`;
          const timeout = pendingCleanups.get(cleanupKey);
          if (timeout) {
            clearTimeout(timeout);
            pendingCleanups.delete(cleanupKey);
          }
        }

        socket.emit(isReconnect ? 'player:reconnected' : 'player:joined', {
          playerId,
          playerState,
          maxFuel: MAX_FUEL,
          isReconnect,
          pendingEvents,
          syncType: 'full'
        });
        
        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);
        
        console.log(`${isReconnect ? 'Reconnected' : 'New'} player ${playerName} (${playerId}) in room ${roomId}`);
      } catch (error) {
        console.error('Error joining room:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('player:reconnect', async (data) => {
      try {
        const { playerId } = data;
        
        if (!playerId) {
          socket.emit('player:reconnect:failed', { message: 'Missing playerId' });
          return;
        }

        const playerState = await getPlayerState(playerId);
        
        if (!playerState) {
          socket.emit('player:reconnect:failed', { message: 'Session expired or not found' });
          return;
        }

        const roomId = playerState.roomId;
        const playerName = playerState.playerName;

        updatePlayerSocketId(roomId, playerId, socket.id);
        socket.join(roomId);
        socket.data = { playerId, roomId, playerName };

        const pendingEvents = await getPendingEvents(playerId);
        await clearPendingEvents(playerId);

        const cleanupKey = `${roomId}:${playerId}`;
        const timeout = pendingCleanups.get(cleanupKey);
        if (timeout) {
          clearTimeout(timeout);
          pendingCleanups.delete(cleanupKey);
        }

        socket.emit('player:reconnected', {
          playerId,
          playerState,
          maxFuel: MAX_FUEL,
          isReconnect: true,
          pendingEvents,
          syncType: 'full'
        });

        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);

        console.log('Player reconnected:', playerId, 'pending events:', pendingEvents.length);
      } catch (error) {
        console.error('Error reconnecting:', error);
        socket.emit('player:reconnect:failed', { message: error.message });
      }
    });

    socket.on('game:mine', async () => {
      try {
        const { playerId, roomId } = socket.data;
        if (!playerId) {
          socket.emit('error', { message: '请先加入游戏' });
          return;
        }

        const playerState = await getPlayerState(playerId);
        if (!playerState || playerState.gameStatus !== 'playing') {
          socket.emit('error', { message: '游戏已结束，请重新开始' });
          return;
        }

        if (playerState.pendingPirateEvent) {
          socket.emit('error', { message: '有待处理的海盗事件！请先解决海盗问题。' });
          return;
        }

        const result = await performMine(playerState);
        
        socket.emit('game:mineResult', {
          ...result,
          playerState: await getPlayerState(playerId)
        });

        if (result.pirateEncounter) {
          socket.emit('pirate:encounter', {
            pirateEvent: result.pirateEncounter,
            playerState: await getPlayerState(playerId)
          });
        }

        if (result.gameOver) {
          socket.emit('game:ended', {
            status: 'crashed',
            message: result.message,
            playerState: await getPlayerState(playerId)
          });
        }

        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);
        
        const globalLeaderboard = await leaderboardManager.updateGlobalLeaderboard();
        io.emit('leaderboard:global', globalLeaderboard);
        
      } catch (error) {
        console.error('Error mining:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('game:return', async () => {
      try {
        const { playerId, roomId } = socket.data;
        if (!playerId) {
          socket.emit('error', { message: '请先加入游戏' });
          return;
        }

        const playerState = await getPlayerState(playerId);
        if (!playerState || playerState.gameStatus !== 'playing') {
          socket.emit('error', { message: '游戏已结束，请重新开始' });
          return;
        }

        const result = await returnToBase(playerState);
        
        socket.emit('game:returnResult', {
          ...result,
          playerState: await getPlayerState(playerId)
        });

        socket.emit('game:ended', {
          status: 'completed',
          message: result.message,
          playerState: await getPlayerState(playerId)
        });

        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);
        
        const globalLeaderboard = await leaderboardManager.updateGlobalLeaderboard();
        io.emit('leaderboard:global', globalLeaderboard);
        
      } catch (error) {
        console.error('Error returning:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('game:restart', async () => {
      try {
        const { playerId, roomId, playerName } = socket.data;
        if (!playerId) {
          socket.emit('error', { message: '请先加入游戏' });
          return;
        }

        await endGameSession(playerId, 'crashed');
        await deletePlayerSession(playerId);
        
        const playerState = await initGameSession(playerId, playerName, roomId);
        
        socket.emit('game:restarted', {
          playerState,
          maxFuel: MAX_FUEL
        });

        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);
        
      } catch (error) {
        console.error('Error restarting:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('pirate:fight', async () => {
      try {
        const { playerId, roomId } = socket.data;
        if (!playerId) {
          socket.emit('error', { message: '请先加入游戏' });
          return;
        }

        const playerState = await getPlayerState(playerId);
        if (!playerState || playerState.gameStatus !== 'playing') {
          socket.emit('error', { message: '游戏已结束，请重新开始' });
          return;
        }

        if (!playerState.pendingPirateEvent) {
          socket.emit('error', { message: '没有待处理的海盗事件' });
          return;
        }

        const result = await fightPirate(playerState);
        
        socket.emit('pirate:fightResult', {
          ...result,
          playerState: await getPlayerState(playerId)
        });

        if (result.fuelLost && playerState.fuel <= 0) {
          socket.emit('game:ended', {
            status: 'crashed',
            message: result.message,
            playerState: await getPlayerState(playerId)
          });
        }

        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);
        
        const globalLeaderboard = await leaderboardManager.updateGlobalLeaderboard();
        io.emit('leaderboard:global', globalLeaderboard);
        
      } catch (error) {
        console.error('Error fighting pirate:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('pirate:surrender', async () => {
      try {
        const { playerId, roomId } = socket.data;
        if (!playerId) {
          socket.emit('error', { message: '请先加入游戏' });
          return;
        }

        const playerState = await getPlayerState(playerId);
        if (!playerState || playerState.gameStatus !== 'playing') {
          socket.emit('error', { message: '游戏已结束，请重新开始' });
          return;
        }

        if (!playerState.pendingPirateEvent) {
          socket.emit('error', { message: '没有待处理的海盗事件' });
          return;
        }

        const result = await surrenderToPirate(playerState);
        
        socket.emit('pirate:surrenderResult', {
          ...result,
          playerState: await getPlayerState(playerId)
        });

        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);
        
        const globalLeaderboard = await leaderboardManager.updateGlobalLeaderboard();
        io.emit('leaderboard:global', globalLeaderboard);
        
      } catch (error) {
        console.error('Error surrendering to pirate:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('equipment:checkUpgrade', async () => {
      try {
        const { playerId } = socket.data;
        if (!playerId) {
          socket.emit('error', { message: '请先加入游戏' });
          return;
        }

        const playerState = await getPlayerState(playerId);
        if (!playerState) {
          socket.emit('error', { message: '玩家不存在' });
          return;
        }

        const result = canUpgradeEquipment(playerState);
        
        socket.emit('equipment:upgradeInfo', {
          ...result,
          currentLevel: playerState.equipmentLevel,
          maxLevel: MAX_EQUIPMENT_LEVEL,
          currentBonus: EQUIPMENT_BASE_BONUS * playerState.equipmentLevel,
          nextBonus: playerState.equipmentLevel < MAX_EQUIPMENT_LEVEL 
            ? EQUIPMENT_BASE_BONUS * (playerState.equipmentLevel + 1) 
            : null,
          playerState
        });
        
      } catch (error) {
        console.error('Error checking upgrade:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('equipment:upgrade', async () => {
      try {
        const { playerId, roomId } = socket.data;
        if (!playerId) {
          socket.emit('error', { message: '请先加入游戏' });
          return;
        }

        const playerState = await getPlayerState(playerId);
        if (!playerState || playerState.gameStatus !== 'playing') {
          socket.emit('error', { message: '游戏已结束，请重新开始' });
          return;
        }

        const result = await upgradeEquipment(playerState);
        
        socket.emit('equipment:upgradeResult', {
          ...result,
          playerState: await getPlayerState(playerId),
          maxLevel: MAX_EQUIPMENT_LEVEL
        });

        await broadcastRoomState(roomId);
        await broadcastRoomLeaderboard(roomId);
        
        const globalLeaderboard = await leaderboardManager.updateGlobalLeaderboard();
        io.emit('leaderboard:global', globalLeaderboard);
        
      } catch (error) {
        console.error('Error upgrading equipment:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('room:players', async () => {
      try {
        const { roomId } = socket.data;
        if (roomId) {
          const players = await getRoomPlayers(roomId);
          socket.emit('room:players', players);
        }
      } catch (error) {
        console.error('Error getting room players:', error);
      }
    });

    socket.on('room:leaderboard', async () => {
      try {
        const { roomId } = socket.data;
        if (roomId) {
          const leaderboard = await getRoomLeaderboard(roomId);
          socket.emit('room:leaderboard', leaderboard);
        }
      } catch (error) {
        console.error('Error getting room leaderboard:', error);
      }
    });

    socket.on('leaderboard:global', async () => {
      try {
        const leaderboard = leaderboardManager.getGlobalLeaderboard();
        socket.emit('leaderboard:global', leaderboard);
      } catch (error) {
        console.error('Error getting global leaderboard:', error);
      }
    });

    socket.on('player:stats', async (data) => {
      try {
        const { playerId } = data || socket.data;
        if (playerId) {
          const stats = await leaderboardManager.getPlayerStats(playerId);
          socket.emit('player:stats', stats);
        }
      } catch (error) {
        console.error('Error getting player stats:', error);
      }
    });

    socket.on('disconnect', async () => {
      try {
        const { playerId, roomId } = socket.data;
        if (playerId && roomId) {
          console.log(`Player ${playerId} disconnected, waiting for reconnection...`);

          const cleanupKey = `${roomId}:${playerId}`;
          const existingTimeout = pendingCleanups.get(cleanupKey);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          const timeout = setTimeout(async () => {
            try {
              await endGameSession(playerId, 'crashed');
              removePlayerFromRoom(roomId, playerId);
              await deletePlayerSession(playerId);
              await broadcastRoomState(roomId);
              await broadcastRoomLeaderboard(roomId);
              pendingCleanups.delete(cleanupKey);
              console.log(`Player ${playerId} cleanup completed (session expired)`);
            } catch (cleanupError) {
              console.error('Cleanup error:', cleanupError);
              pendingCleanups.delete(cleanupKey);
            }
          }, RECONNECT_WINDOW);

          pendingCleanups.set(cleanupKey, timeout);
        }
      } catch (error) {
        console.error('Error on disconnect:', error);
      }
    });

    socket.on('player:reconnect:cancel', (playerId) => {
      const cleanupKey = `${socket.data.roomId}:${playerId}`;
      const timeout = pendingCleanups.get(cleanupKey);
      if (timeout) {
        clearTimeout(timeout);
        pendingCleanups.delete(cleanupKey);
        console.log(`Player ${playerId} reconnected, cleanup cancelled`);
      }
    });

    socket.on('state:sync', async (data) => {
      try {
        const { playerId, roomId, syncType = 'full' } = data || socket.data;
        if (!playerId || !roomId) {
          socket.emit('error', { message: 'Missing playerId or roomId' });
          return;
        }

        const { getFullStateSync } = require('../game/gameLogic');
        
        if (syncType === 'full') {
          const fullState = await getFullStateSync(playerId, roomId);
          socket.emit('state:update', fullState);
        } else {
          const playerState = await getPlayerState(playerId);
          socket.emit('state:update:partial', {
            playerState,
            syncType: 'partial',
            syncTimestamp: Date.now()
          });
        }
      } catch (error) {
        console.error('Error syncing state:', error);
        socket.emit('error', { message: error.message });
      }
    });
  });

  return io;
};

const broadcastRoomState = async (roomId) => {
  if (!io) return;
  const players = await getRoomPlayers(roomId);
  broadcastToRoom(io, roomId, 'room:state', {
    roomId,
    playerCount: players.length,
    players
  });
};

const broadcastRoomLeaderboard = async (roomId) => {
  if (!io) return;
  const leaderboard = await getRoomLeaderboard(roomId);
  broadcastToRoom(io, roomId, 'room:leaderboard', leaderboard);
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

module.exports = {
  initSocketIO,
  getIO,
  broadcastRoomState,
  broadcastRoomLeaderboard
};
