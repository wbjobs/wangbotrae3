class GraphStore {
  constructor(crdt) {
    this.crdt = crdt;
    this.history = [];
    this.maxHistory = 100;
  }

  recordVersion(description) {
    const graph = this.crdt.getFullGraph();
    const version = {
      id: this.history.length + 1,
      timestamp: Date.now(),
      description,
      snapshot: JSON.parse(JSON.stringify(graph)),
      state: JSON.parse(JSON.stringify(this.crdt.exportState())),
    };
    this.history.push(version);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    return version;
  }

  getHistory() {
    return this.history.map((v) => ({
      id: v.id,
      timestamp: v.timestamp,
      description: v.description,
      nodeCount: Object.keys(v.snapshot.nodes).length,
      edgeCount: Object.keys(v.snapshot.edges).length,
    }));
  }

  getVersion(id) {
    const version = this.history.find((v) => v.id === id);
    if (!version) return null;
    return {
      id: version.id,
      timestamp: version.timestamp,
      description: version.description,
      snapshot: version.snapshot,
    };
  }

  restoreVersion(id) {
    const version = this.history.find((v) => v.id === id);
    if (!version) return false;
    this.crdt.importState(JSON.parse(JSON.stringify(version.state)));
    return true;
  }
}

module.exports = { GraphStore };
