class LWWRegister {
  constructor() {
    this.state = new Map();
  }

  get(key) {
    const entry = this.state.get(key);
    if (!entry || entry.deleted) return null;
    return entry.value;
  }

  getRaw(key) {
    return this.state.get(key) || null;
  }

  set(key, value, timestamp, userId) {
    const existing = this.state.get(key);
    if (!existing || timestamp >= existing.timestamp) {
      this.state.set(key, { value, timestamp, userId, deleted: false });
      return true;
    }
    return false;
  }

  delete(key, timestamp, userId) {
    const existing = this.state.get(key);
    if (!existing || timestamp >= existing.timestamp) {
      this.state.set(key, { value: null, timestamp, userId, deleted: true });
      return true;
    }
    return false;
  }

  getAll() {
    const result = {};
    for (const [key, entry] of this.state) {
      if (!entry.deleted) {
        result[key] = entry.value;
      }
    }
    return result;
  }

  getAllWithMeta() {
    const result = {};
    for (const [key, entry] of this.state) {
      result[key] = entry;
    }
    return result;
  }

  applyOperation(op) {
    switch (op.type) {
      case 'addNode':
      case 'updateNode':
        return this.set(`node:${op.payload.id}`, op.payload, op.timestamp, op.userId);
      case 'deleteNode':
        return this.delete(`node:${op.payload.id}`, op.timestamp, op.userId);
      case 'addEdge':
      case 'updateEdge':
        return this.set(`edge:${op.payload.id}`, op.payload, op.timestamp, op.userId);
      case 'deleteEdge':
        return this.delete(`edge:${op.payload.id}`, op.timestamp, op.userId);
      default:
        return false;
    }
  }

  getNodes() {
    const nodes = {};
    for (const [key, entry] of this.state) {
      if (key.startsWith('node:') && !entry.deleted) {
        nodes[entry.value.id] = entry.value;
      }
    }
    return nodes;
  }

  getEdges() {
    const edges = {};
    for (const [key, entry] of this.state) {
      if (key.startsWith('edge:') && !entry.deleted) {
        edges[entry.value.id] = entry.value;
      }
    }
    return edges;
  }

  getFullGraph() {
    return {
      nodes: this.getNodes(),
      edges: this.getEdges(),
    };
  }

  merge(otherState) {
    for (const [key, entry] of Object.entries(otherState)) {
      const existing = this.state.get(key);
      if (!existing || entry.timestamp >= existing.timestamp) {
        this.state.set(key, entry);
      }
    }
  }

  exportState() {
    return Object.fromEntries(this.state);
  }

  importState(state) {
    this.state = new Map(Object.entries(state));
  }
}

module.exports = { LWWRegister };
