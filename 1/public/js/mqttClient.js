class MQTTManager {
    constructor(app) {
        this.app = app;
        this.client = null;
        this.sessionId = null;
        this.connected = false;
        this.sessionStartTime = null;
        this.serverStartTime = null;
        this.playbackState = 'stopped';
        this.bpm = 120;
        this.eventBuffer = [];
        this.playbackInterval = null;
    }
    
    connect(sessionId) {
        this.sessionId = sessionId;
        
        const host = window.location.hostname;
        const port = 1883;
        const wsPort = 9001;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        
        const credentials = JSON.stringify({
            sessionId,
            userId: this.app.currentUser.id,
            role: this.app.currentUser.role
        });
        
        const clientId = `client-${this.app.currentUser.id}-${Date.now()}`;
        
        let connectUrl = `mqtt://${host}:${port}`;
        
        if (typeof mqtt !== 'undefined') {
            try {
                this.client = mqtt.connect(`ws://${host}:${wsPort}`, {
                    clientId,
                    password: credentials,
                    keepalive: 60,
                    reconnectPeriod: 1000,
                    connectTimeout: 30 * 1000
                });
                
                this.client.on('connect', () => {
                    console.log('MQTT connected');
                    this.connected = true;
                    this.app.updateConnectionStatus('mqtt', 'connected', '已连接');
                    
                    this.subscribeToTopics();
                    
                    if (this.app.currentUser.role === 'student') {
                        this.sendSyncMessage('ready');
                    }
                });
                
                this.client.on('error', (err) => {
                    console.error('MQTT error:', err);
                    this.connected = false;
                    this.app.updateConnectionStatus('mqtt', 'disconnected', '连接错误');
                });
                
                this.client.on('reconnect', () => {
                    console.log('MQTT reconnecting...');
                    this.app.updateConnectionStatus('mqtt', 'connecting', '重连中...');
                });
                
                this.client.on('close', () => {
                    console.log('MQTT connection closed');
                    this.connected = false;
                    this.app.updateConnectionStatus('mqtt', 'disconnected', '未连接');
                });
                
                this.client.on('message', (topic, message) => {
                    this.handleMessage(topic, message.toString());
                });
                
            } catch (err) {
                console.error('Failed to create MQTT client:', err);
                this.setupFallbackMQTT();
            }
        } else {
            console.log('MQTT library not loaded, using fallback');
            this.setupFallbackMQTT();
        }
    }
    
    setupFallbackMQTT() {
        console.log('Using WebSocket fallback for MIDI events');
        
        this.connected = true;
        this.app.updateConnectionStatus('mqtt', 'connected', '已连接 (WS)');
        
        this.handleFallbackMessage = (data) => {
            if (data.type === 'midi-event') {
                this.handleMIDIMessage(data.event);
            } else if (data.type === 'control') {
                this.handleControlMessage(data);
            }
        };
        
        const originalHandler = this.app.handleWebSocketMessage.bind(this.app);
        this.app.handleWebSocketMessage = (data) => {
            if (data.type === 'midi-event') {
                this.handleFallbackMessage(data);
            } else if (data.type === 'control') {
                this.handleFallbackMessage(data);
            } else {
                originalHandler(data);
            }
        };
    }
    
    subscribeToTopics() {
        if (!this.client) return;
        
        const topics = [
            `session/${this.sessionId}/midi`,
            `session/${this.sessionId}/control`
        ];
        
        topics.forEach(topic => {
            this.client.subscribe(topic, (err) => {
                if (err) {
                    console.error(`Failed to subscribe to ${topic}:`, err);
                } else {
                    console.log(`Subscribed to ${topic}`);
                }
            });
        });
    }
    
    handleMessage(topic, message) {
        try {
            const data = JSON.parse(message);
            const topicParts = topic.split('/');
            const messageType = topicParts[topicParts.length - 1];
            
            if (messageType === 'midi') {
                this.handleMIDIMessage(data);
            } else if (messageType === 'control') {
                this.handleControlMessage(data);
            }
            
        } catch (err) {
            console.error('Error parsing MQTT message:', err);
        }
    }
    
    handleMIDIMessage(event) {
        if (event.userId === this.app.currentUser.id) {
            return;
        }
        
        if (this.playbackState === 'playing') {
            this.bufferEvent(event);
        } else {
            this.app.midiManager.playRemoteEvent(event);
        }
    }
    
    handleControlMessage(data) {
        console.log('Control message:', data);
        
        switch (data.type) {
            case 'start':
                this.handleStart(data);
                break;
                
            case 'stop':
                this.handleStop();
                break;
                
            case 'pause':
                this.handlePause();
                break;
                
            case 'ready':
                console.log('Student ready:', data.userId);
                break;
        }
    }
    
    handleStart(data) {
        this.serverStartTime = data.serverTime;
        this.bpm = data.bpm || 120;
        this.playbackState = 'playing';
        this.eventBuffer = [];
        
        this.app.midiManager.resetTimer();
        
        this.app.showToast(`演奏开始！BPM: ${this.bpm}`, 'success');
        
        this.startPlayback();
    }
    
    handleStop() {
        this.playbackState = 'stopped';
        this.eventBuffer = [];
        
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
        
        this.app.showToast('演奏已停止', 'info');
    }
    
    handlePause() {
        this.playbackState = 'paused';
        
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
        
        this.app.showToast('演奏已暂停', 'info');
    }
    
    bufferEvent(event) {
        this.eventBuffer.push(event);
        this.eventBuffer.sort((a, b) => a.timestamp - b.timestamp);
        
        while (this.eventBuffer.length > 1000) {
            this.eventBuffer.shift();
        }
    }
    
    startPlayback() {
        const startTime = Date.now();
        
        this.playbackInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            
            while (this.eventBuffer.length > 0 && 
                   this.eventBuffer[0].timestamp <= elapsed) {
                const event = this.eventBuffer.shift();
                this.app.midiManager.playRemoteEvent(event);
            }
        }, 1);
    }
    
    sendMIDIEvent(event) {
        if (!this.connected || !this.sessionId) return;
        
        const message = {
            ...event,
            userId: this.app.currentUser.id,
            sessionId: this.sessionId
        };
        
        if (this.client) {
            this.client.publish(
                `session/${this.sessionId}/midi`,
                JSON.stringify(message),
                { qos: 0 }
            );
        } else {
            this.app.ws?.send(JSON.stringify({
                type: 'midi-event',
                event: message
            }));
        }
    }
    
    sendStartSignal() {
        if (!this.connected || !this.sessionId) return;
        
        const startMessage = {
            type: 'start',
            bpm: this.bpm,
            serverTime: Date.now(),
            userId: this.app.currentUser.id
        };
        
        if (this.client) {
            this.client.publish(
                `session/${this.sessionId}/sync`,
                JSON.stringify(startMessage),
                { qos: 1 }
            );
            
            this.client.publish(
                `session/${this.sessionId}/control`,
                JSON.stringify(startMessage),
                { qos: 1 }
            );
        } else {
            this.app.ws?.send(JSON.stringify({
                type: 'control',
                ...startMessage
            }));
        }
        
        this.handleStart(startMessage);
    }
    
    sendSyncMessage(type) {
        if (!this.connected || !this.sessionId) return;
        
        const message = {
            type,
            userId: this.app.currentUser.id,
            timestamp: Date.now()
        };
        
        if (this.client) {
            this.client.publish(
                `session/${this.sessionId}/sync`,
                JSON.stringify(message),
                { qos: 1 }
            );
        } else {
            this.app.ws?.send(JSON.stringify({
                type: 'sync',
                ...message
            }));
        }
    }
    
    sendChatMessage(message) {
        if (!this.connected || !this.sessionId) return;
        
        const chatMessage = {
            type: 'chat',
            userId: this.app.currentUser.id,
            name: this.app.currentUser.name,
            message,
            timestamp: Date.now()
        };
        
        if (this.client) {
            this.client.publish(
                `session/${this.sessionId}/chat`,
                JSON.stringify(chatMessage),
                { qos: 0 }
            );
        }
    }
    
    setBPM(bpm) {
        this.bpm = bpm;
    }
    
    getPlaybackState() {
        return this.playbackState;
    }
    
    getCurrentTime() {
        if (!this.serverStartTime) return 0;
        return Date.now() - this.serverStartTime;
    }
    
    disconnect() {
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
        
        if (this.client) {
            this.client.end();
            this.client = null;
        }
        
        this.connected = false;
        this.sessionId = null;
        this.playbackState = 'stopped';
        this.eventBuffer = [];
    }
}

window.MQTTManager = MQTTManager;
