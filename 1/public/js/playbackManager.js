class PlaybackManager {
    constructor(app) {
        this.app = app;
        this.worker = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.currentTime = 0;
        this.totalTime = 0;
        this.ghostPlayers = new Map();
        this.activeNotes = new Map();
        this.comments = [];
        this.playbackRate = 1.0;
    }

    init(sessionId) {
        return new Promise(async (resolve, reject) => {
            try {
                const [eventsRes, commentsRes] = await Promise.all([
                    fetch(`/api/sessions/${sessionId}/midi-events`),
                    fetch(`/api/sessions/${sessionId}/comments`)
                ]);
                
                const midiEvents = await eventsRes.json();
                const comments = await commentsRes.json();
                
                this.comments = comments;
                
                if (this.worker) {
                    this.worker.terminate();
                }
                
                this.worker = new Worker('/js/playbackWorker.js?v=1.0.0');
                
                this.worker.onmessage = (e) => {
                    this.handleWorkerMessage(e.data);
                };
                
                this.worker.postMessage({
                    type: 'init',
                    data: { midiEvents, comments }
                });
                
                resolve();
            } catch (err) {
                console.error('Failed to init playback:', err);
                reject(err);
            }
        });
    }

    handleWorkerMessage(data) {
        switch (data.type) {
            case 'ready':
                this.totalTime = data.totalTime;
                this.app.updatePlaybackInfo({
                    totalTime: data.totalTime,
                    eventCount: data.eventCount,
                    commentCount: data.commentCount
                });
                break;
                
            case 'midi-event':
                this.handleMidiEvent(data.event);
                break;
                
            case 'comment':
                this.handleComment(data.comment);
                break;
                
            case 'time-update':
                this.currentTime = data.currentTime;
                this.app.updatePlaybackProgress(data.currentTime, this.totalTime);
                break;
                
            case 'playback-complete':
                this.isPlaying = false;
                this.isPaused = false;
                this.clearAllGhostNotes();
                this.app.onPlaybackComplete();
                break;
                
            case 'playing':
            case 'resumed':
                this.isPlaying = true;
                this.isPaused = false;
                this.app.onPlaybackStateChange(true, false);
                break;
                
            case 'paused':
                this.isPaused = true;
                this.currentTime = data.currentTime;
                this.app.onPlaybackStateChange(true, true);
                break;
                
            case 'stopped':
                this.isPlaying = false;
                this.isPaused = false;
                this.currentTime = 0;
                this.clearAllGhostNotes();
                this.app.onPlaybackStateChange(false, false);
                break;
                
            case 'seeked':
                this.currentTime = data.currentTime;
                this.clearAllGhostNotes();
                this.app.updatePlaybackProgress(data.currentTime, this.totalTime);
                break;
        }
    }

    handleMidiEvent(event) {
        const userId = event.user_id || event.userId;
        const eventType = event.event_type || event.eventType;
        const noteNumber = event.note_number || event.noteNumber;
        const velocity = event.velocity;
        
        if (!this.ghostPlayers.has(userId)) {
            const color = this.getGhostColor(userId);
            this.ghostPlayers.set(userId, {
                color: color,
                userName: event.userName || '幽灵演奏者'
            });
        }
        
        const ghost = this.ghostPlayers.get(userId);
        
        if (eventType === 'noteOn' && velocity > 0) {
            this.activeNotes.set(`${userId}-${noteNumber}`, {
                noteNumber,
                startTime: this.currentTime,
                color: ghost.color
            });
            this.app.showGhostNote(userId, noteNumber, ghost.color, true);
        } else if (eventType === 'noteOff' || (eventType === 'noteOn' && velocity === 0)) {
            const key = `${userId}-${noteNumber}`;
            if (this.activeNotes.has(key)) {
                this.activeNotes.delete(key);
            }
            this.app.showGhostNote(userId, noteNumber, ghost.color, false);
        }
    }

    handleComment(comment) {
        this.app.showPlaybackComment(comment);
    }

    getGhostColor(userId) {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
            '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'
        ];
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            hash = userId.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    clearAllGhostNotes() {
        this.activeNotes.forEach((note, key) => {
            const [userId, noteNumber] = key.split('-');
            this.app.showGhostNote(userId, parseInt(noteNumber), note.color, false);
        });
        this.activeNotes.clear();
    }

    play() {
        if (this.worker) {
            this.worker.postMessage({ type: 'play' });
        }
    }

    pause() {
        if (this.worker) {
            this.worker.postMessage({ type: 'pause' });
        }
    }

    stop() {
        if (this.worker) {
            this.worker.postMessage({ type: 'stop' });
        }
    }

    seek(time) {
        if (this.worker) {
            this.worker.postMessage({
                type: 'seek',
                data: { time }
            });
        }
    }

    setRate(rate) {
        this.playbackRate = rate;
        if (this.worker) {
            this.worker.postMessage({
                type: 'set-rate',
                data: { rate }
            });
        }
    }

    async addComment(content, timestamp = null) {
        if (!this.app.currentSession) return;
        
        const finalTimestamp = timestamp !== null ? timestamp : this.currentTime;
        
        try {
            const response = await fetch(`/api/sessions/${this.app.currentSession.id}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: this.app.currentUser.id,
                    content,
                    timestamp: finalTimestamp
                })
            });
            
            const comment = await response.json();
            this.comments.push(comment);
            return comment;
        } catch (err) {
            console.error('Failed to add comment:', err);
            throw err;
        }
    }

    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.clearAllGhostNotes();
        this.ghostPlayers.clear();
    }
}
