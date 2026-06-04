const { v4: uuidv4 } = require('uuid');

class MemoryStore {
    constructor() {
        this.users = new Map();
        this.scores = new Map();
        this.sessions = new Map();
        this.scoreVersions = new Map();
        this.midiEvents = new Map();
        this.sessionParticipants = new Map();
        this.comments = new Map();
        
        this._initSampleData();
    }
    
    _initSampleData() {
    }
    
    generateId() {
        return uuidv4();
    }
    
    generateInviteCode() {
        return Math.random().toString(36).substring(2, 10).toUpperCase();
    }
}

module.exports = new MemoryStore();
