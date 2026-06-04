class WebRTCManager {
    constructor(app) {
        this.app = app;
        this.peerConnections = new Map();
        this.dataChannels = new Map();
        this.iceServers = [];
        this.students = new Map();
    }
    
    setIceServers(servers) {
        this.iceServers = servers;
    }
    
    handleNewStudent(studentId, studentName) {
        console.log('New student joined:', studentId, studentName);
        this.students.set(studentId, { id: studentId, name: studentName });
        
        if (this.app.currentSession?.isTeacher) {
            this.createOffer(studentId);
        }
    }
    
    createPeerConnection(peerId) {
        if (this.peerConnections.has(peerId)) {
            return this.peerConnections.get(peerId);
        }
        
        const configuration = {
            iceServers: this.iceServers
        };
        
        const pc = new RTCPeerConnection(configuration);
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({
                    type: 'ice-candidate',
                    from: this.app.currentUser.id,
                    to: peerId,
                    candidate: event.candidate
                });
            }
        };
        
        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
            this.updateWebRTCStatus();
            
            if (pc.connectionState === 'connected') {
                this.app.showToast(`已与 ${this.students.get(peerId)?.name || peerId} 建立连接`, 'success');
            } else if (pc.connectionState === 'disconnected') {
                this.app.showToast(`与 ${this.students.get(peerId)?.name || peerId} 断开连接`, 'info');
            } else if (pc.connectionState === 'failed') {
                this.app.showToast(`与 ${this.students.get(peerId)?.name || peerId} 连接失败`, 'error');
            }
        };
        
        pc.ondatachannel = (event) => {
            this.setupDataChannel(peerId, event.channel);
        };
        
        pc.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${peerId}: ${pc.iceConnectionState}`);
        };
        
        this.peerConnections.set(peerId, pc);
        this.updateWebRTCStatus();
        
        return pc;
    }
    
    async createOffer(studentId) {
        try {
            const pc = this.createPeerConnection(studentId);
            
            const dataChannel = pc.createDataChannel('score-sync', {
                ordered: true,
                reliable: true
            });
            
            this.setupDataChannel(studentId, dataChannel);
            
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this.sendSignalingMessage({
                type: 'offer',
                from: this.app.currentUser.id,
                to: studentId,
                offer: offer
            });
            
            console.log('Offer sent to', studentId);
        } catch (err) {
            console.error('Error creating offer:', err);
        }
    }
    
    async handleOffer(from, offer) {
        try {
            const pc = this.createPeerConnection(from);
            
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.sendSignalingMessage({
                type: 'answer',
                from: this.app.currentUser.id,
                to: from,
                answer: answer
            });
            
            console.log('Answer sent to', from);
        } catch (err) {
            console.error('Error handling offer:', err);
        }
    }
    
    async handleAnswer(from, answer) {
        try {
            const pc = this.peerConnections.get(from);
            if (!pc) {
                console.error('No peer connection for', from);
                return;
            }
            
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('Answer received from', from);
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    }
    
    async handleIceCandidate(from, candidate) {
        try {
            const pc = this.peerConnections.get(from);
            if (!pc) {
                console.error('No peer connection for', from);
                return;
            }
            
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('ICE candidate added from', from);
        } catch (err) {
            console.error('Error handling ICE candidate:', err);
        }
    }
    
    setupDataChannel(peerId, channel) {
        channel.onopen = () => {
            console.log(`Data channel opened with ${peerId}`);
            this.dataChannels.set(peerId, channel);
            this.updateWebRTCStatus();
        };
        
        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleDataChannelMessage(peerId, data);
            } catch (err) {
                console.error('Error parsing data channel message:', err);
            }
        };
        
        channel.onclose = () => {
            console.log(`Data channel closed with ${peerId}`);
            this.dataChannels.delete(peerId);
            this.updateWebRTCStatus();
        };
        
        channel.onerror = (err) => {
            console.error(`Data channel error with ${peerId}:`, err);
        };
    }
    
    handleDataChannelMessage(peerId, data) {
        console.log('Received via DataChannel:', data.type, 'from', peerId);
        
        switch (data.type) {
            case 'score-operation':
                this.app.scoreEditor.handleRemoteOperation(data);
                break;
                
            case 'cursor':
                this.app.handleCursorUpdate(data);
                break;
                
            case 'chat':
                this.app.handleChatMessage(data);
                break;
                
            case 'ping':
                this.sendViaDataChannel(peerId, { type: 'pong', timestamp: Date.now() });
                break;
                
            case 'pong':
                const latency = Date.now() - data.timestamp;
                console.log(`Latency to ${peerId}: ${latency}ms`);
                break;
        }
    }
    
    sendViaDataChannel(peerId, data) {
        const channel = this.dataChannels.get(peerId);
        if (channel && channel.readyState === 'open') {
            channel.send(JSON.stringify(data));
            return true;
        }
        return false;
    }
    
    broadcastToAll(data, excludeId = null) {
        for (const [peerId, channel] of this.dataChannels) {
            if (peerId !== excludeId && channel.readyState === 'open') {
                channel.send(JSON.stringify(data));
            }
        }
    }
    
    sendSignalingMessage(message) {
        if (this.app.ws && this.app.ws.readyState === WebSocket.OPEN) {
            this.app.ws.send(JSON.stringify(message));
        }
    }
    
    handleSignalingMessage(data) {
        const { type, from, to, offer, answer, candidate } = data;
        
        if (to !== this.app.currentUser.id) {
            return;
        }
        
        switch (type) {
            case 'offer':
                this.handleOffer(from, offer);
                break;
                
            case 'answer':
                this.handleAnswer(from, answer);
                break;
                
            case 'ice-candidate':
                this.handleIceCandidate(from, candidate);
                break;
        }
    }
    
    removeConnection(peerId) {
        const channel = this.dataChannels.get(peerId);
        if (channel) {
            channel.close();
            this.dataChannels.delete(peerId);
        }
        
        const pc = this.peerConnections.get(peerId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(peerId);
        }
        
        this.students.delete(peerId);
        this.updateWebRTCStatus();
    }
    
    closeAllConnections() {
        for (const [peerId, channel] of this.dataChannels) {
            channel.close();
        }
        this.dataChannels.clear();
        
        for (const [peerId, pc] of this.peerConnections) {
            pc.close();
        }
        this.peerConnections.clear();
        
        this.students.clear();
        this.updateWebRTCStatus();
    }
    
    updateWebRTCStatus() {
        const connectedCount = this.dataChannels.size;
        const statusEl = document.getElementById('webrtc-status');
        
        if (!statusEl) return;
        
        if (connectedCount > 0) {
            statusEl.textContent = `已连接 (${connectedCount})`;
            statusEl.className = 'status-indicator status-connected';
        } else if (this.peerConnections.size > 0) {
            statusEl.textContent = '连接中...';
            statusEl.className = 'status-indicator status-connecting';
        } else {
            statusEl.textContent = '未连接';
            statusEl.className = 'status-indicator status-disconnected';
        }
    }
    
    broadcastScoreOperation(operation, version) {
        const message = {
            type: 'score-operation',
            operation,
            version,
            userId: this.app.currentUser.id,
            timestamp: Date.now()
        };
        
        this.broadcastToAll(message);
    }
    
    sendCursorPosition(position) {
        const message = {
            type: 'cursor',
            position,
            userId: this.app.currentUser.id,
            name: this.app.currentUser.name,
            timestamp: Date.now()
        };
        
        this.broadcastToAll(message);
    }
    
    pingAll() {
        for (const peerId of this.dataChannels.keys()) {
            this.sendViaDataChannel(peerId, {
                type: 'ping',
                timestamp: Date.now()
            });
        }
    }
    
    getConnectedPeers() {
        return Array.from(this.dataChannels.keys());
    }
    
    isConnectedTo(peerId) {
        const channel = this.dataChannels.get(peerId);
        return channel && channel.readyState === 'open';
    }
}

window.WebRTCManager = WebRTCManager;
