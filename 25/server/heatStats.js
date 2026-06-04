class HeatStats {
  constructor() {
    this.nodeVisits = {};
    this.edgeSelections = {};
    this.playPaths = [];
    this.sessionVisitedNodes = {};
  }

  recordPath(path, userId, sessionId) {
    const record = {
      userId,
      sessionId,
      path,
      timestamp: Date.now(),
    };
    this.playPaths.push(record);

    if (!sessionId) {
      sessionId = `anon-${Date.now()}-${Math.random()}`;
    }

    if (!this.sessionVisitedNodes[sessionId]) {
      this.sessionVisitedNodes[sessionId] = new Set();
    }
    const visited = this.sessionVisitedNodes[sessionId];

    for (let i = 0; i < path.length; i++) {
      const nodeId = path[i];
      if (!this.nodeVisits[nodeId]) {
        this.nodeVisits[nodeId] = 0;
      }
      if (!visited.has(nodeId)) {
        this.nodeVisits[nodeId]++;
        visited.add(nodeId);
      }
    }

    for (let i = 0; i < path.length - 1; i++) {
      const edgeKey = `${path[i]}->${path[i + 1]}`;
      if (!this.edgeSelections[edgeKey]) {
        this.edgeSelections[edgeKey] = 0;
      }
      this.edgeSelections[edgeKey]++;
    }
  }

  getNodeVisits() {
    return { ...this.nodeVisits };
  }

  getEdgeSelections() {
    return { ...this.edgeSelections };
  }

  getMaxNodeVisits() {
    const values = Object.values(this.nodeVisits);
    return values.length > 0 ? Math.max(...values) : 0;
  }

  getMaxEdgeSelections() {
    const values = Object.values(this.edgeSelections);
    return values.length > 0 ? Math.max(...values) : 0;
  }

  getRecentPaths(limit = 20) {
    return this.playPaths.slice(-limit);
  }

  reset() {
    this.nodeVisits = {};
    this.edgeSelections = {};
    this.playPaths = [];
    this.sessionVisitedNodes = {};
  }

  getSessionCount() {
    return Object.keys(this.sessionVisitedNodes).length;
  }

  getStats() {
    return {
      nodeVisits: this.getNodeVisits(),
      edgeSelections: this.getEdgeSelections(),
      maxNodeVisits: this.getMaxNodeVisits(),
      maxEdgeSelections: this.getMaxEdgeSelections(),
      totalPaths: this.playPaths.length,
      uniqueSessions: this.getSessionCount(),
    };
  }
}

module.exports = { HeatStats };
