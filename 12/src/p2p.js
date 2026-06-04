import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { mdns } from '@libp2p/mdns';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@libp2p/yamux';
import { identify } from '@libp2p/identify';
import { kadDHT } from '@libp2p/kad-dht';
import { autoNAT } from '@libp2p/autonat';
import { peerIdFromString } from '@libp2p/peer-id';

const CHUNK_PROTOCOL = '/chunk-exchange/1.0.0';
const ANNOUNCE_PROTOCOL = '/chunk-announce/1.0.0';
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 2;
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const FAIR_SHARE_PER_ROUND = 2;

export class P2PNode {
  constructor(storage, database, options = {}) {
    this.storage = storage;
    this.database = database;
    this.libp2p = null;
    this.port = options.port || 0;
    this.announcedChunks = new Set();
    this.knownPeers = new Map();
    this._heartbeatTimer = null;
    this._staleCheckTimer = null;
  }

  async start() {
    this.libp2p = await createLibp2p({
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${this.port}`]
      },
      transports: [tcp()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        mdns({
          interval: 10000,
          serviceTag: 'p2p-chunk-distributor'
        })
      ],
      services: {
        identify: identify(),
        dht: kadDHT({
          clientMode: false,
          allowQueryWithZeroPeers: true
        }),
        autonat: autoNAT()
      }
    });

    this.libp2p.addEventListener('peer:discovery', (evt) => {
      const peer = evt.detail;
      const peerIdStr = peer.id.toString();
      const existing = this.knownPeers.get(peerIdStr);
      if (existing) {
        existing.multiaddrs = peer.multiaddrs.map(ma => ma.toString());
        existing.lastSeen = Date.now();
      } else {
        this.knownPeers.set(peerIdStr, {
          id: peerIdStr,
          peerIdObj: peer.id,
          multiaddrs: peer.multiaddrs.map(ma => ma.toString()),
          discoveredAt: Date.now(),
          lastSeen: Date.now(),
          consecutiveFailures: 0,
          online: false
        });
      }
    });

    this.libp2p.addEventListener('peer:connect', (evt) => {
      const peerIdStr = evt.detail.toString();
      const peer = this.knownPeers.get(peerIdStr);
      if (peer) {
        peer.lastSeen = Date.now();
        peer.online = true;
        peer.consecutiveFailures = 0;
      } else {
        this.knownPeers.set(peerIdStr, {
          id: peerIdStr,
          peerIdObj: evt.detail,
          multiaddrs: [],
          discoveredAt: Date.now(),
          lastSeen: Date.now(),
          consecutiveFailures: 0,
          online: true
        });
      }
    });

    this.libp2p.addEventListener('peer:disconnect', (evt) => {
      const peerIdStr = evt.detail.toString();
      const remainingConns = this.libp2p.getConnections(evt.detail);
      if (remainingConns.length === 0) {
        this._markPeerOffline(peerIdStr);
      }
    });

    await this.libp2p.handle(CHUNK_PROTOCOL, this._handleChunkRequest.bind(this));
    await this.libp2p.handle(ANNOUNCE_PROTOCOL, this._handleAnnounce.bind(this));

    await this.libp2p.start();

    this._startHeartbeat();

    console.log(`P2P node started with peerId: ${this.libp2p.peerId.toString()}`);
    this.libp2p.getMultiaddrs().forEach(ma => {
      console.log(`Listening on: ${ma.toString()}`);
    });
  }

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      this._runHeartbeatCycle().catch(err => {
        console.error('Heartbeat cycle error:', err.message);
      });
    }, HEARTBEAT_INTERVAL_MS);

    this._staleCheckTimer = setInterval(() => {
      this._removeStaleOfflinePeers();
    }, 30000);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._staleCheckTimer) {
      clearInterval(this._staleCheckTimer);
      this._staleCheckTimer = null;
    }
  }

  async _runHeartbeatCycle() {
    const peers = Array.from(this.knownPeers.values());
    for (const peer of peers) {
      if (!peer.online) continue;
      await this._pingPeer(peer.id);
    }
  }

  async _pingPeer(peerIdStr) {
    const peer = this.knownPeers.get(peerIdStr);
    if (!peer || !peer.online) return;

    try {
      const openConns = this._getOpenConnections(peerIdStr);
      if (openConns.length > 0) {
        peer.consecutiveFailures = 0;
        peer.lastSeen = Date.now();
        return;
      }

      await this.libp2p.dial(peer.peerIdObj, {
        signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS)
      });
      peer.consecutiveFailures = 0;
      peer.lastSeen = Date.now();
      peer.online = true;
    } catch (err) {
      peer.consecutiveFailures = (peer.consecutiveFailures || 0) + 1;
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerOffline(peerIdStr);
      }
    }
  }

  _getOpenConnections(peerIdStr) {
    const allConns = this.libp2p.getConnections();
    return allConns.filter(conn => {
      const connPeerIdStr = conn.remotePeer.toString();
      return connPeerIdStr === peerIdStr && conn.stat.status === 'OPEN';
    });
  }

  _markPeerOffline(peerIdStr) {
    const peer = this.knownPeers.get(peerIdStr);
    if (!peer) return;

    const wasOnline = peer.online;
    peer.online = false;
    peer.consecutiveFailures = (peer.consecutiveFailures || 0) + 1;

    if (wasOnline) {
      console.log(`Peer ${peerIdStr} went offline, cleaning up routing table`);
      const removed = this.database.removeAllPeerChunks(peerIdStr);
      console.log(`Removed ${removed} chunk records for peer ${peerIdStr}`);
    }
  }

  markPeerOfflineForChunk(peerIdStr, chunkHash) {
    const peer = this.knownPeers.get(peerIdStr);
    if (peer) {
      peer.consecutiveFailures = (peer.consecutiveFailures || 0) + 1;
      if (peer.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this._markPeerOffline(peerIdStr);
      } else {
        this.database.removePeerChunk(peerIdStr, chunkHash);
      }
    } else {
      this.database.removePeerChunk(peerIdStr, chunkHash);
    }
  }

  _removeStaleOfflinePeers() {
    const now = Date.now();

    for (const [peerIdStr, peer] of this.knownPeers) {
      if (!peer.online && now - peer.lastSeen > STALE_THRESHOLD_MS) {
        this.knownPeers.delete(peerIdStr);
        this.database.removeAllPeerChunks(peerIdStr);
      }
    }
  }

  async _handleChunkRequest({ stream, connection }) {
    try {
      const chunks = [];
      for await (const chunk of stream.source) {
        chunks.push(chunk);
      }

      const requestData = Buffer.concat(chunks.map(c => c.subarray ? c.subarray() : Buffer.from(c)));
      const requestHash = requestData.toString('utf-8').trim();

      const chunkData = await this.storage.retrieve(requestHash);
      if (chunkData) {
        await stream.sink([chunkData]);
      } else {
        await stream.sink([new Uint8Array(0)]);
      }
    } catch (err) {
      console.error('Error handling chunk request:', err.message);
    }
  }

  async _handleAnnounce({ stream, connection }) {
    try {
      const chunks = [];
      for await (const chunk of stream.source) {
        chunks.push(chunk);
      }

      const data = Buffer.concat(chunks.map(c => c.subarray ? c.subarray() : Buffer.from(c)));
      const message = JSON.parse(data.toString('utf-8'));

      if (message.type === 'announce' && Array.isArray(message.hashes)) {
        const peerIdStr = connection.remotePeer.toString();
        for (const hash of message.hashes) {
          this.database.insertPeerChunk(peerIdStr, hash);
        }
      }
    } catch (err) {
      console.error('Error handling announce:', err.message);
    }
  }

  async fetchChunkFromPeer(peerIdStr, hash) {
    const peer = this.knownPeers.get(peerIdStr);
    if (peer && !peer.online) {
      return null;
    }

    const peerIdObj = peer ? peer.peerIdObj : peerIdFromString(peerIdStr);

    try {
      const stream = await this.libp2p.dialProtocol(peerIdObj, CHUNK_PROTOCOL, {
        signal: AbortSignal.timeout(5000)
      });
      await stream.sink([new TextEncoder().encode(hash)]);

      const chunks = [];
      for await (const chunk of stream.source) {
        chunks.push(chunk);
      }

      const data = Buffer.concat(chunks.map(c => c.subarray ? c.subarray() : Buffer.from(c)));

      if (data.length === 0) {
        this.markPeerOfflineForChunk(peerIdStr, hash);
        return null;
      }

      if (peer) {
        peer.consecutiveFailures = 0;
        peer.online = true;
        peer.lastSeen = Date.now();
      }

      this.database.updatePeerChunkVerification(peerIdStr, hash);

      return new Uint8Array(data);
    } catch (err) {
      console.error(`Error fetching chunk ${hash} from peer ${peerIdStr}:`, err.message);
      this.markPeerOfflineForChunk(peerIdStr, hash);
      return null;
    }
  }

  async fetchChunkFromNetwork(hash) {
    const peerRecords = this.database.getActivePeersForChunk(hash);

    const onlinePeers = peerRecords.filter(r => {
      const peer = this.knownPeers.get(r.peer_id);
      return peer && peer.online;
    });

    for (const record of onlinePeers) {
      const data = await this.fetchChunkFromPeer(record.peer_id, hash);
      if (data) {
        return data;
      }
    }

    for (const [peerIdStr, peer] of this.knownPeers) {
      if (!peer.online) continue;
      const alreadyTried = onlinePeers.some(r => r.peer_id === peerIdStr);
      if (alreadyTried) continue;
      const data = await this.fetchChunkFromPeer(peerIdStr, hash);
      if (data) {
        return data;
      }
    }

    return null;
  }

  async fetchChunksByPriority(fileId, onChunkFetched) {
    const results = { fetched: [], failed: [] };

    while (true) {
      const priorityGroups = this.database.getMissingChunksGroupedByPriority(fileId);

      if (priorityGroups.size === 0) {
        break;
      }

      const allPriorities = Array.from(priorityGroups.keys()).sort((a, b) => b - a);
      const highestPriority = allPriorities[0];

      const batch = this._buildFairBatch(priorityGroups, allPriorities);

      if (batch.length === 0) {
        break;
      }

      let anyFetchedThisRound = false;

      for (const chunk of batch) {
        if (this.storage.hasLocal(chunk.hash)) {
          this.database.markChunkStoredLocally(chunk.hash);
          anyFetchedThisRound = true;
          continue;
        }

        const data = await this.fetchChunkFromNetwork(chunk.hash);
        if (data) {
          await this.storage.store(data, chunk.hash);
          this.database.markChunkStoredLocally(chunk.hash);
          results.fetched.push({
            hash: chunk.hash,
            chunkIndex: chunk.chunk_index,
            priority: chunk.priority,
            size: data.length
          });
          anyFetchedThisRound = true;
          if (onChunkFetched) {
            onChunkFetched({
              hash: chunk.hash,
              chunkIndex: chunk.chunk_index,
              priority: chunk.priority,
              size: data.length
            });
          }
        } else {
          results.failed.push({
            hash: chunk.hash,
            chunkIndex: chunk.chunk_index,
            priority: chunk.priority
          });
        }
      }

      if (!anyFetchedThisRound) {
        break;
      }
    }

    return results;
  }

  _buildFairBatch(priorityGroups, sortedPriorities) {
    const batch = [];
    const highestPriority = sortedPriorities[0];

    const highestChunks = priorityGroups.get(highestPriority);
    for (const chunk of highestChunks) {
      batch.push(chunk);
    }

    let slotsForLower = Math.max(
      FAIR_SHARE_PER_ROUND,
      Math.ceil(batch.length * 0.2)
    );

    for (let i = 1; i < sortedPriorities.length && slotsForLower > 0; i++) {
      const priority = sortedPriorities[i];
      const chunks = priorityGroups.get(priority);
      const take = Math.min(chunks.length, slotsForLower);
      for (let j = 0; j < take; j++) {
        batch.push(chunks[j]);
      }
      slotsForLower -= take;
    }

    return batch;
  }

  async announceChunks(hashes) {
    for (const hash of hashes) {
      this.announcedChunks.add(hash);
    }

    const message = JSON.stringify({
      type: 'announce',
      hashes
    });

    for (const [peerIdStr, peerInfo] of this.knownPeers) {
      if (!peerInfo.online) continue;
      try {
        const stream = await this.libp2p.dialProtocol(peerInfo.peerIdObj, ANNOUNCE_PROTOCOL);
        await stream.sink([new TextEncoder().encode(message)]);
      } catch (err) {
        // peer may not support the protocol, skip silently
      }
    }
  }

  getPeerList() {
    return Array.from(this.knownPeers.values())
      .map(p => ({
        peerId: p.id,
        multiaddrs: p.multiaddrs,
        lastSeen: p.lastSeen,
        online: p.online,
        consecutiveFailures: p.consecutiveFailures || 0
      }));
  }

  getPeerId() {
    return this.libp2p ? this.libp2p.peerId.toString() : null;
  }

  async stop() {
    this._stopHeartbeat();
    if (this.libp2p) {
      await this.libp2p.stop();
      this.libp2p = null;
    }
  }
}
