class MusicCollabApp {
    constructor() {
        this.currentUser = null;
        this.currentRole = 'teacher';
        this.currentSession = null;
        this.currentScore = null;
        this.ws = null;
        this.selectedNote = null;
        this.initialized = false;
        this.playbackManager = null;
        this.isPlaybackMode = false;
    }
    
    init() {
        if (this.initialized) return;
        
        this.webrtcManager = new WebRTCManager(this);
        this.midiManager = new MIDIManager(this);
        this.mqttManager = new MQTTManager(this);
        this.scoreEditor = new ScoreEditor(this);
        this.playbackManager = new PlaybackManager(this);
        
        this.initEventListeners();
        this.loadStoredUser();
        
        this.initialized = true;
    }
    
    initEventListeners() {
        document.querySelectorAll('.role-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentRole = e.target.dataset.role;
                this.updateRoleUI();
            });
        });
        
        document.getElementById('login-btn').addEventListener('click', () => this.login());
        
        document.getElementById('create-score-btn').addEventListener('click', () => this.createScore());
        
        document.getElementById('join-session-btn').addEventListener('click', () => this.joinSession());
        
        document.getElementById('leave-session-btn').addEventListener('click', () => this.leaveSession());
        
        document.getElementById('toggle-play-btn').addEventListener('click', () => this.togglePlayback());
        
        document.getElementById('show-versions-btn').addEventListener('click', () => this.showVersionHistory());
        
        document.getElementById('close-versions-modal').addEventListener('click', () => {
            document.getElementById('versions-modal').classList.remove('active');
        });
        
        document.getElementById('chat-send-btn').addEventListener('click', () => this.sendChatMessage());
        
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
        
        document.getElementById('apply-time-signature-btn').addEventListener('click', () => {
            this.scoreEditor.applyTimeSignature();
        });
        
        document.getElementById('apply-key-signature-btn').addEventListener('click', () => {
            this.scoreEditor.applyKeySignature();
        });
        
        document.getElementById('add-note-btn').addEventListener('click', () => {
            this.scoreEditor.addNote();
        });
        
        document.getElementById('delete-note-btn').addEventListener('click', () => {
            this.scoreEditor.deleteSelectedNote();
        });
        
        document.getElementById('add-rest-btn').addEventListener('click', () => {
            this.scoreEditor.addRest();
        });
        
        document.getElementById('show-history-btn').addEventListener('click', () => {
            this.loadHistorySessions();
        });
        
        document.getElementById('playback-play-btn').addEventListener('click', () => {
            this.playbackManager.play();
        });
        
        document.getElementById('playback-pause-btn').addEventListener('click', () => {
            this.playbackManager.pause();
        });
        
        document.getElementById('playback-stop-btn').addEventListener('click', () => {
            this.playbackManager.stop();
        });
        
        document.getElementById('playback-seek-slider').addEventListener('input', (e) => {
            const time = parseInt(e.target.value);
            this.playbackManager.seek(time);
        });
        
        document.getElementById('playback-rate-select').addEventListener('change', (e) => {
            const rate = parseFloat(e.target.value);
            this.playbackManager.setRate(rate);
        });
        
        document.getElementById('add-comment-btn').addEventListener('click', () => {
            this.addPlaybackComment();
        });
        
        document.getElementById('playback-comment-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlaybackComment();
        });
        
        document.getElementById('close-playback-btn').addEventListener('click', () => {
            this.exitPlaybackMode();
        });
    }
    
    updateRoleUI() {
        const teacherPanel = document.getElementById('teacher-panel');
        const studentPanel = document.getElementById('student-panel');
        const welcomeGreeting = document.getElementById('welcome-greeting');
        const welcomeDesc = document.getElementById('welcome-description');
        
        if (this.currentRole === 'teacher') {
            teacherPanel.style.display = 'block';
            studentPanel.style.display = 'none';
            welcomeGreeting.textContent = '欢迎，教师！';
            welcomeDesc.textContent = '创建新乐谱或选择现有乐谱开始协作';
        } else {
            teacherPanel.style.display = 'none';
            studentPanel.style.display = 'block';
            welcomeGreeting.textContent = '欢迎，学生！';
            welcomeDesc.textContent = '输入邀请码加入协作会话';
        }
    }
    
    async login() {
        const name = document.getElementById('user-name').value.trim();
        if (!name) {
            this.showToast('请输入姓名', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, role: this.currentRole })
            });
            
            if (!response.ok) throw new Error('Login failed');
            
            this.currentUser = await response.json();
            localStorage.setItem('musicCollabUser', JSON.stringify(this.currentUser));
            
            this.showUserInfo();
            this.showView('dashboard-view');
            this.loadMyScores();
            this.loadActiveSessions();
            
            this.updateRoleUI();
            
            this.showToast(`欢迎，${name}！`, 'success');
        } catch (err) {
            console.error('Login error:', err);
            this.showToast('登录失败，请重试', 'error');
        }
    }
    
    loadStoredUser() {
        const stored = localStorage.getItem('musicCollabUser');
        if (stored) {
            try {
                this.currentUser = JSON.parse(stored);
                this.currentRole = this.currentUser.role;
                this.showUserInfo();
                this.showView('dashboard-view');
                this.updateRoleUI();
                this.loadMyScores();
                this.loadActiveSessions();
            } catch (e) {
                localStorage.removeItem('musicCollabUser');
            }
        }
    }
    
    showUserInfo() {
        const userInfo = document.getElementById('user-info');
        userInfo.innerHTML = `
            <span class="badge ${this.currentUser.role}">
                ${this.currentUser.role === 'teacher' ? '👨‍🏫' : '👨‍🎓'} ${this.currentUser.name}
            </span>
            <button class="btn btn-sm btn-secondary" onclick="app.logout()">退出</button>
        `;
    }
    
    logout() {
        localStorage.removeItem('musicCollabUser');
        this.currentUser = null;
        this.currentSession = null;
        this.disconnectWebSocket();
        this.mqttManager.disconnect();
        this.webrtcManager.closeAllConnections();
        this.showView('login-view');
        document.getElementById('user-info').innerHTML = '';
    }
    
    showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
    }
    
    async createScore() {
        const title = document.getElementById('score-title').value.trim();
        if (!title) {
            this.showToast('请输入乐谱标题', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/scores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, userId: this.currentUser.id })
            });
            
            if (!response.ok) throw new Error('Failed to create score');
            
            const score = await response.json();
            this.showToast('乐谱创建成功！', 'success');
            
            document.getElementById('score-title').value = '';
            await this.startSession(score.id);
            
        } catch (err) {
            console.error('Create score error:', err);
            this.showToast('创建乐谱失败', 'error');
        }
    }
    
    async loadMyScores() {
        if (this.currentRole !== 'teacher') return;
        
        try {
            const response = await fetch(`/api/scores/user/${this.currentUser.id}`);
            const scores = await response.json();
            
            const container = document.getElementById('my-scores');
            if (scores.length === 0) {
                container.innerHTML = '<p style="color: #888; font-size: 0.9rem;">暂无乐谱</p>';
                return;
            }
            
            container.innerHTML = scores.map(score => `
                <div class="score-item" data-score-id="${score.id}">
                    <div class="score-item-title">${score.title}</div>
                    <div class="score-item-meta">创建于 ${new Date(score.created_at).toLocaleDateString()}</div>
                    <div style="margin-top: 0.5rem;">
                        <button class="btn btn-sm btn-primary" onclick="app.startSession('${score.id}')">
                            开始协作
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="app.editScore('${score.id}')">
                            编辑
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            console.error('Load scores error:', err);
        }
    }
    
    async loadActiveSessions() {
        if (this.currentRole !== 'teacher') return;
        
        try {
            const response = await fetch(`/api/sessions/teacher/${this.currentUser.id}/active`);
            const sessions = await response.json();
            
            const container = document.getElementById('active-sessions');
            if (sessions.length === 0) {
                container.innerHTML = '<p style="color: #888; font-size: 0.9rem;">暂无进行中的会话</p>';
                return;
            }
            
            container.innerHTML = sessions.map(session => `
                <div class="session-item">
                    <div class="score-item-title">${session.score_title}</div>
                    <div class="score-item-meta">邀请码: ${session.invite_code}</div>
                    <div style="margin-top: 0.5rem;">
                        <button class="btn btn-sm btn-primary" onclick="app.resumeSession('${session.id}')">
                            继续会话
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            console.error('Load sessions error:', err);
        }
    }
    
    async startSession(scoreId) {
        try {
            const response = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scoreId, teacherId: this.currentUser.id })
            });
            
            if (!response.ok) throw new Error('Failed to create session');
            
            const session = await response.json();
            await this.joinSessionByInviteCode(session.invite_code);
            
        } catch (err) {
            console.error('Start session error:', err);
            this.showToast('创建会话失败', 'error');
        }
    }
    
    async resumeSession(sessionId) {
        try {
            const response = await fetch(`/api/sessions/${sessionId}`);
            const session = await response.json();
            await this.joinSessionByInviteCode(session.invite_code);
        } catch (err) {
            console.error('Resume session error:', err);
            this.showToast('恢复会话失败', 'error');
        }
    }
    
    async joinSession() {
        const inviteCode = document.getElementById('invite-code').value.trim().toUpperCase();
        if (!inviteCode || inviteCode.length !== 8) {
            this.showToast('请输入8位邀请码', 'error');
            return;
        }
        
        await this.joinSessionByInviteCode(inviteCode);
    }
    
    async joinSessionByInviteCode(inviteCode) {
        try {
            const checkResponse = await fetch(`/api/sessions/invite/${inviteCode}`);
            if (!checkResponse.ok) {
                throw new Error('Invalid invite code');
            }
            
            this.currentSession = await checkResponse.json();
            
            this.connectWebSocket(inviteCode);
            
        } catch (err) {
            console.error('Join session error:', err);
            this.showToast('邀请码无效或会话已结束', 'error');
        }
    }
    
    connectWebSocket(inviteCode) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.updateConnectionStatus('ws', 'connecting', '连接中...');
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.updateConnectionStatus('ws', 'connected', '已连接');
            
            this.ws.send(JSON.stringify({
                type: 'join',
                inviteCode,
                userId: this.currentUser.id,
                name: this.currentUser.name,
                role: this.currentUser.role
            }));
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateConnectionStatus('ws', 'disconnected', '未连接');
        };
        
        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            this.updateConnectionStatus('ws', 'disconnected', '连接错误');
        };
    }
    
    disconnectWebSocket() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    
    handleWebSocketMessage(data) {
        console.log('Received message:', data.type);
        
        switch (data.type) {
            case 'joined':
                this.handleJoined(data);
                break;
                
            case 'participant-joined':
                this.handleParticipantJoined(data.participant);
                break;
                
            case 'participant-left':
                this.handleParticipantLeft(data.userId);
                break;
                
            case 'new-student':
                this.webrtcManager.handleNewStudent(data.studentId, data.studentName);
                break;
                
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                this.webrtcManager.handleSignalingMessage(data);
                break;
                
            case 'score-operation':
                this.scoreEditor.handleRemoteOperation(data);
                break;
                
            case 'score-operation-ack':
                this.scoreEditor.handleOperationAck(data);
                break;
                
            case 'score-operation-error':
                this.showToast('操作失败: ' + data.error, 'error');
                break;
                
            case 'chat':
                this.handleChatMessage(data);
                break;
                
            case 'cursor':
                this.handleCursorUpdate(data);
                break;
                
            case 'error':
                this.showToast(data.message, 'error');
                break;
        }
    }
    
    handleJoined(data) {
        this.currentSession = {
            ...this.currentSession,
            sessionId: data.sessionId,
            scoreId: data.scoreId,
            scoreTitle: data.scoreTitle,
            currentVersion: data.currentVersion,
            isTeacher: data.isTeacher
        };
        
        this.currentScore = data.score;
        
        this.showView('session-view');
        
        document.getElementById('session-score-title').textContent = data.scoreTitle;
        document.getElementById('invite-code-display').textContent = this.currentSession.invite_code;
        
        const roleBadge = document.getElementById('session-role-badge');
        roleBadge.textContent = data.isTeacher ? '教师' : '学生';
        roleBadge.className = `badge ${data.isTeacher ? 'teacher' : 'student'}`;
        
        const editorToolbar = document.getElementById('editor-toolbar');
        if (!data.isTeacher) {
            editorToolbar.style.display = 'none';
        } else {
            editorToolbar.style.display = 'flex';
        }
        
        this.renderParticipants(data.participants);
        this.scoreEditor.renderScore(data.score);
        
        this.webrtcManager.setIceServers(data.iceServers);
        
        this.mqttManager.connect(this.currentSession.sessionId);
        
        if (this.currentUser.role === 'student') {
            this.midiManager.init();
        }
        
        this.showToast('成功加入会话！', 'success');
    }
    
    handleParticipantJoined(participant) {
        this.showToast(`${participant.name} 加入了会话`, 'info');
        this.refreshParticipants();
    }
    
    handleParticipantLeft(userId) {
        this.showToast('有参与者离开了会话', 'info');
        this.refreshParticipants();
        this.webrtcManager.removeConnection(userId);
    }
    
    async refreshParticipants() {
        try {
            const response = await fetch(`/api/sessions/${this.currentSession.sessionId}/participants`);
            const participants = await response.json();
            this.renderParticipants(participants);
        } catch (err) {
            console.error('Refresh participants error:', err);
        }
    }
    
    renderParticipants(participants) {
        const container = document.getElementById('participants-list');
        document.getElementById('session-participants').textContent = `参与者: ${participants.length}人`;
        
        container.innerHTML = participants.map(p => `
            <div class="participant-item">
                <div class="participant-avatar">${p.name.charAt(0).toUpperCase()}</div>
                <div class="participant-info">
                    <div class="participant-name">${p.name}</div>
                    <div class="participant-role">${p.role === 'teacher' ? '教师' : '学生'}</div>
                </div>
                ${p.role === 'teacher' ? '<span class="badge teacher">👑</span>' : ''}
            </div>
        `).join('');
    }
    
    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message || !this.ws) return;
        
        this.ws.send(JSON.stringify({
            type: 'chat',
            message
        }));
        
        this.addChatMessage({
            userId: this.currentUser.id,
            name: this.currentUser.name,
            message,
            timestamp: Date.now(),
            own: true
        });
        
        input.value = '';
    }
    
    handleChatMessage(data) {
        data.own = data.userId === this.currentUser.id;
        this.addChatMessage(data);
    }
    
    addChatMessage(data) {
        const container = document.getElementById('chat-messages');
        const msgEl = document.createElement('div');
        msgEl.className = `chat-message ${data.own ? 'own' : 'other'}`;
        
        if (!data.own) {
            msgEl.innerHTML = `
                <div class="chat-message-sender">${data.name}</div>
                <div class="chat-message-text">${data.message}</div>
            `;
        } else {
            msgEl.innerHTML = `<div class="chat-message-text">${data.message}</div>`;
        }
        
        container.appendChild(msgEl);
        container.scrollTop = container.scrollHeight;
    }
    
    handleCursorUpdate(data) {
        console.log('Cursor update:', data);
    }
    
    async showVersionHistory() {
        if (!this.currentSession) return;
        
        try {
            const response = await fetch(`/api/scores/${this.currentSession.scoreId}/versions`);
            const versions = await response.json();
            
            const container = document.getElementById('versions-list');
            container.innerHTML = versions.map(v => `
                <div class="version-item" onclick="app.restoreVersion(${v.version_number})">
                    <div class="version-number">版本 ${v.version_number}</div>
                    <div class="version-meta">
                        修改者: ${v.user_name || '未知'} | 
                        ${new Date(v.created_at).toLocaleString()}
                    </div>
                </div>
            `).join('');
            
            document.getElementById('versions-modal').classList.add('active');
        } catch (err) {
            console.error('Load versions error:', err);
            this.showToast('加载版本历史失败', 'error');
        }
    }
    
    restoreVersion(versionNumber) {
        this.showToast(`恢复到版本 ${versionNumber}`, 'info');
        document.getElementById('versions-modal').classList.remove('active');
    }
    
    togglePlayback() {
        const btn = document.getElementById('toggle-play-btn');
        const isPlaying = btn.textContent.includes('停止');
        
        if (!isPlaying) {
            btn.textContent = '⏹️ 停止演奏';
            this.mqttManager.sendStartSignal();
            this.showToast('演奏开始！', 'success');
        } else {
            btn.textContent = '▶️ 开始演奏';
            this.showToast('演奏已停止', 'info');
        }
    }
    
    leaveSession() {
        if (confirm('确定要离开会话吗？')) {
            this.disconnectWebSocket();
            this.mqttManager.disconnect();
            this.webrtcManager.closeAllConnections();
            this.midiManager.close();
            
            this.currentSession = null;
            this.currentScore = null;
            
            this.showView('dashboard-view');
            this.loadMyScores();
            this.loadActiveSessions();
            
            this.showToast('已离开会话', 'info');
        }
    }
    
    updateConnectionStatus(type, status, text) {
        const statusEl = document.getElementById(`${type}-status`);
        if (!statusEl) return;
        
        statusEl.textContent = text;
        statusEl.className = `status-indicator status-${status}`;
    }
    
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
    
    editScore(scoreId) {
        this.showToast('编辑功能开发中...', 'info');
    }
    
    async loadHistorySessions() {
        if (this.currentRole !== 'teacher') return;
        
        try {
            const response = await fetch(`/api/sessions/teacher/${this.currentUser.id}/all`);
            const sessions = await response.json();
            
            const container = document.getElementById('history-sessions');
            if (sessions.length === 0) {
                container.innerHTML = '<p style="color: #888; font-size: 0.9rem;">暂无历史会话</p>';
                return;
            }
            
            container.innerHTML = sessions.map(session => `
                <div class="session-item ${session.status === 'ended' ? 'ended' : ''}">
                    <div class="score-item-title">${session.score_title}</div>
                    <div class="score-item-meta">
                        创建于 ${new Date(session.created_at).toLocaleString()}
                        ${session.status === 'ended' ? ' • 已结束' : ' • 进行中'}
                    </div>
                    <div style="margin-top: 0.5rem;">
                        <button class="btn btn-sm btn-success" onclick="app.viewPlayback('${session.id}')">
                            📹 查看回放
                        </button>
                    </div>
                </div>
            `).join('');
        } catch (err) {
            console.error('Failed to load history sessions:', err);
            this.showToast('加载历史会话失败', 'error');
        }
    }
    
    async viewPlayback(sessionId) {
        try {
            this.isPlaybackMode = true;
            
            const sessionRes = await fetch(`/api/sessions/${sessionId}`);
            this.currentSession = await sessionRes.json();
            
            await this.playbackManager.init(sessionId);
            
            this.showView('playback-view');
            this.updatePlaybackUI();
            
            this.showToast('回放准备就绪', 'success');
        } catch (err) {
            console.error('Failed to load playback:', err);
            this.showToast('加载回放失败', 'error');
            this.isPlaybackMode = false;
        }
    }
    
    updatePlaybackUI() {
        const sessionTitle = document.getElementById('playback-session-title');
        if (sessionTitle && this.currentSession) {
            sessionTitle.textContent = this.currentSession.score_title || '回放';
        }
    }
    
    updatePlaybackInfo(info) {
        const totalTime = document.getElementById('playback-total-time');
        if (totalTime) {
            totalTime.textContent = this.formatTime(info.totalTime);
        }
        
        const slider = document.getElementById('playback-seek-slider');
        if (slider) {
            slider.max = info.totalTime;
        }
    }
    
    updatePlaybackProgress(currentTime, totalTime) {
        const currentTimeEl = document.getElementById('playback-current-time');
        if (currentTimeEl) {
            currentTimeEl.textContent = this.formatTime(currentTime);
        }
        
        const slider = document.getElementById('playback-seek-slider');
        if (slider && !slider.matches(':active')) {
            slider.value = currentTime;
        }
    }
    
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    
    onPlaybackStateChange(isPlaying, isPaused) {
        const playBtn = document.getElementById('playback-play-btn');
        const pauseBtn = document.getElementById('playback-pause-btn');
        
        if (playBtn && pauseBtn) {
            if (isPlaying && !isPaused) {
                playBtn.style.display = 'none';
                pauseBtn.style.display = 'inline-block';
            } else {
                playBtn.style.display = 'inline-block';
                pauseBtn.style.display = 'none';
            }
        }
    }
    
    onPlaybackComplete() {
        this.showToast('回放完成', 'success');
        this.onPlaybackStateChange(false, false);
    }
    
    showGhostNote(userId, noteNumber, color, isOn) {
        const ghostVisualizer = document.getElementById('ghost-player-visualizer');
        if (!ghostVisualizer) return;
        
        const noteId = `ghost-${userId}-${noteNumber}`;
        let noteEl = document.getElementById(noteId);
        
        if (isOn) {
            if (!noteEl) {
                noteEl = document.createElement('div');
                noteEl.id = noteId;
                noteEl.className = 'ghost-note';
                noteEl.style.backgroundColor = color;
                noteEl.style.left = `${(noteNumber % 12) * 30}px`;
                noteEl.style.bottom = '0';
                noteEl.style.height = '60px';
                ghostVisualizer.appendChild(noteEl);
            }
            noteEl.classList.add('active');
        } else {
            if (noteEl) {
                noteEl.classList.remove('active');
                setTimeout(() => {
                    if (noteEl.parentNode) {
                        noteEl.parentNode.removeChild(noteEl);
                    }
                }, 100);
            }
        }
    }
    
    showPlaybackComment(comment) {
        const commentsContainer = document.getElementById('playback-comments');
        if (!commentsContainer) return;
        
        const commentEl = document.createElement('div');
        commentEl.className = 'playback-comment';
        commentEl.innerHTML = `
            <div class="comment-header">
                <span class="comment-user">${comment.user_name || '用户'}</span>
                <span class="comment-time">${this.formatTime(comment.timestamp || 0)}</span>
            </div>
            <div class="comment-content">${comment.content}</div>
        `;
        commentsContainer.appendChild(commentEl);
        commentsContainer.scrollTop = commentsContainer.scrollHeight;
        
        setTimeout(() => {
            commentEl.classList.add('highlight');
        }, 100);
        
        setTimeout(() => {
            commentEl.classList.remove('highlight');
        }, 3000);
    }
    
    async addPlaybackComment() {
        const input = document.getElementById('playback-comment-input');
        const content = input.value.trim();
        
        if (!content) return;
        
        try {
            await this.playbackManager.addComment(content);
            input.value = '';
            this.showToast('点评已添加', 'success');
        } catch (err) {
            this.showToast('添加点评失败', 'error');
        }
    }
    
    exitPlaybackMode() {
        this.playbackManager.stop();
        this.playbackManager.destroy();
        this.isPlaybackMode = false;
        this.currentSession = null;
        
        this.showView('dashboard-view');
        this.showToast('已退出回放模式', 'info');
    }
}

window.MusicCollabApp = MusicCollabApp;

function initApp() {
    if (typeof WebRTCManager !== 'undefined' && 
        typeof MIDIManager !== 'undefined' && 
        typeof MQTTManager !== 'undefined' &&
        typeof ScoreEditor !== 'undefined') {
        window.app = new MusicCollabApp();
        window.app.init();
    } else {
        console.log('Waiting for dependencies...');
        setTimeout(initApp, 100);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
