const { v4: uuidv4 } = require('uuid');
const { saveRoomState, getRoomState, deleteRoomState } = require('../config/redis');
const { getPlayerState } = require('./gameLogic');

const rooms = new Map();

const DEFAULT_ROOM_ID = 'asteroid-belt-1';

const createRoom = (roomId = null, options = {}) => {
  const id = roomId || uuidv4().slice(0, 8);
  
  const room = {
    id,
    name: options.name || `Room ${id}`,
    players: new Map(),
    maxPlayers: options.maxPlayers || 50,
    createdAt: Date.now(),
    isPrivate: options.isPrivate || false,
    password: options.password || null
  };

  rooms.set(id, room);
  return room;
};

const getRoom = (roomId) => {
  return rooms.get(roomId);
};

const getOrCreateDefaultRoom = () => {
  let room = rooms.get(DEFAULT_ROOM_ID);
  if (!room) {
    room = createRoom(DEFAULT_ROOM_ID, {
      name: '主小行星带',
      maxPlayers: 100,
      isPrivate: false
    });
  }
  return room;
};

const addPlayerToRoom = (roomId, playerId, socketId, playerName) => {
  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
  }

  if (room.players.size >= room.maxPlayers) {
    throw new Error('房间已满');
  }

  room.players.set(playerId, {
    socketId,
    playerName,
    joinedAt: Date.now()
  });

  return room;
};

const removePlayerFromRoom = (roomId, playerId) => {
  const room = rooms.get(roomId);
  if (room) {
    room.players.delete(playerId);
    
    if (room.players.size === 0 && room.id !== DEFAULT_ROOM_ID) {
      rooms.delete(roomId);
    }
  }
};

const updatePlayerSocketId = (roomId, playerId, socketId) => {
  const room = rooms.get(roomId);
  if (room && room.players.has(playerId)) {
    const playerInfo = room.players.get(playerId);
    playerInfo.socketId = socketId;
    playerInfo.lastSeen = Date.now();
    return true;
  }
  return false;
};

const getRoomPlayers = async (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return [];

  const players = [];
  for (const [playerId, playerInfo] of room.players) {
    const playerState = await getPlayerState(playerId);
    players.push({
      playerId,
      playerName: playerInfo.playerName,
      socketId: playerInfo.socketId,
      joinedAt: playerInfo.joinedAt,
      totalOreValue: playerState?.totalOreValue || 0,
      fuel: playerState?.fuel || 0,
      gameStatus: playerState?.gameStatus || 'idle',
      miningCount: playerState?.miningCount || 0
    });
  }

  return players.sort((a, b) => b.totalOreValue - a.totalOreValue);
};

const getAllRooms = () => {
  const roomList = [];
  for (const [id, room] of rooms) {
    roomList.push({
      id: room.id,
      name: room.name,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt
    });
  }
  return roomList;
};

const getPlayerRoomId = (playerId) => {
  for (const [roomId, room] of rooms) {
    if (room.players.has(playerId)) {
      return roomId;
    }
  }
  return null;
};

const broadcastToRoom = (io, roomId, event, data) => {
  io.to(roomId).emit(event, data);
};

const broadcastToAll = (io, event, data) => {
  io.emit(event, data);
};

const getRoomLeaderboard = async (roomId, limit = 10) => {
  const players = await getRoomPlayers(roomId);
  return players.slice(0, limit).map((p, index) => ({
    rank: index + 1,
    playerId: p.playerId,
    playerName: p.playerName,
    totalOreValue: p.totalOreValue,
    miningCount: p.miningCount,
    gameStatus: p.gameStatus
  }));
};

const persistRoomState = async (roomId) => {
  const room = rooms.get(roomId);
  if (room) {
    const state = {
      id: room.id,
      name: room.name,
      maxPlayers: room.maxPlayers,
      createdAt: room.createdAt,
      isPrivate: room.isPrivate,
      players: Array.from(room.players.entries()).map(([id, info]) => ({
        playerId: id,
        ...info
      }))
    };
    await saveRoomState(roomId, state);
  }
};

const loadRoomState = async (roomId) => {
  const state = await getRoomState(roomId);
  if (state) {
    const room = {
      id: state.id,
      name: state.name,
      maxPlayers: state.maxPlayers,
      createdAt: state.createdAt,
      isPrivate: state.isPrivate,
      players: new Map(state.players.map(p => [p.playerId, {
        socketId: p.socketId,
        playerName: p.playerName,
        joinedAt: p.joinedAt
      }]))
    };
    rooms.set(roomId, room);
    return room;
  }
  return null;
};

module.exports = {
  createRoom,
  getRoom,
  getOrCreateDefaultRoom,
  addPlayerToRoom,
  removePlayerFromRoom,
  updatePlayerSocketId,
  getRoomPlayers,
  getAllRooms,
  getPlayerRoomId,
  broadcastToRoom,
  broadcastToAll,
  getRoomLeaderboard,
  persistRoomState,
  loadRoomState,
  DEFAULT_ROOM_ID
};
