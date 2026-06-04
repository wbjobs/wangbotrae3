const { createClient } = require('redis');

let redisClient = null;

const initRedis = async () => {
  redisClient = createClient({
    url: process.env.REDIS_URL
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  await redisClient.connect();
  return redisClient;
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
};

const savePlayerSession = async (playerId, sessionData) => {
  const client = getRedisClient();
  const key = `player:session:${playerId}`;
  await client.setEx(key, process.env.SESSION_TTL, JSON.stringify(sessionData));
};

const getPlayerSession = async (playerId) => {
  const client = getRedisClient();
  const key = `player:session:${playerId}`;
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
};

const deletePlayerSession = async (playerId) => {
  const client = getRedisClient();
  const key = `player:session:${playerId}`;
  await client.del(key);
};

const saveRoomState = async (roomId, state) => {
  const client = getRedisClient();
  const key = `room:state:${roomId}`;
  await client.set(key, JSON.stringify(state));
};

const getRoomState = async (roomId) => {
  const client = getRedisClient();
  const key = `room:state:${roomId}`;
  const data = await client.get(key);
  return data ? JSON.parse(data) : null;
};

const deleteRoomState = async (roomId) => {
  const client = getRedisClient();
  const key = `room:state:${roomId}`;
  await client.del(key);
};

module.exports = {
  initRedis,
  getRedisClient,
  savePlayerSession,
  getPlayerSession,
  deletePlayerSession,
  saveRoomState,
  getRoomState,
  deleteRoomState
};
