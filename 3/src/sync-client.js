export class LamportClock {
  constructor() {
    this.time = 0;
  }

  tick() {
    this.time += 1;
    return this.time;
  }

  update(receivedTime) {
    this.time = Math.max(this.time, receivedTime) + 1;
    return this.time;
  }

  get current() {
    return this.time;
  }
}

export class SyncClient {
  constructor() {
    this.ws = null;
    this.userId = null;
    this.username = null;
    this.tableId = null;
    this.color = null;
    this.lamportClock = new LamportClock();
    this.connected = false;
    this.reagents = [];
    this.templates = [];
    this.users = {};
    this.currentState = {};
    this.lastSeenServerVersion = 0;
    this.timelineData = { entries: [], current_position: -1, total_entries: 0, is_recording: false };

    this._handlers = {
      init: [],
      state_update: [],
      user_joined: [],
      user_left: [],
      reagents_list: [],
      templates_list: [],
      timeline_data: [],
      playback_state: [],
      playback_event: [],
      recording_status: [],
    };
  }

  on(event, handler) {
    if (this._handlers[event]) {
      this._handlers[event].push(handler);
    }
  }

  off(event, handler) {
    if (this._handlers[event]) {
      this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    }
  }

  _emit(event, data) {
    if (this._handlers[event]) {
      for (const handler of this._handlers[event]) {
        try {
          handler(data);
        } catch (e) {
          console.error(`Handler error for ${event}:`, e);
        }
      }
    }
  }

  connect(url = 'ws://localhost:8765') {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.connected = true;
          console.log('Connected to experiment server');
          resolve();
        };

        this.ws.onclose = () => {
          this.connected = false;
          console.log('Disconnected from experiment server');
          this._scheduleReconnect(url);
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          reject(err);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this._handleMessage(data);
          } catch (e) {
            console.error('Message parse error:', e);
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  _scheduleReconnect(url) {
    setTimeout(() => {
      if (!this.connected) {
        console.log('Attempting reconnect...');
        this.connect(url).catch(() => {});
      }
    }, 3000);
  }

  _handleMessage(data) {
    switch (data.type) {
      case 'init':
        this.userId = data.user_id;
        this.tableId = data.table_id;
        this.color = data.color;
        this.reagents = data.reagents || [];
        this.templates = data.templates || [];
        this.users = data.users || {};
        this.currentState = data.state || {};
        this.timelineData = data.timeline || this.timelineData;
        if (data.server_version !== undefined) {
          this.lastSeenServerVersion = data.server_version;
        }
        this._emit('init', data);
        break;

      case 'state_update':
        if (data.lamport_time !== undefined) {
          this.lamportClock.update(data.lamport_time);
        }
        if (data.server_version !== undefined) {
          this.lastSeenServerVersion = data.server_version;
        }
        if (data.timeline) {
          this.timelineData = data.timeline;
        }
        this.currentState = data.state || {};
        this._emit('state_update', data);
        break;

      case 'playback_state':
        if (data.server_version !== undefined) {
          this.lastSeenServerVersion = data.server_version;
        }
        if (data.timeline) {
          this.timelineData = data.timeline;
        }
        this.currentState = data.state || {};
        this._emit('playback_state', data);
        this._emit('state_update', data);
        break;

      case 'timeline_data':
        this.timelineData = data.timeline || this.timelineData;
        this._emit('timeline_data', data);
        break;

      case 'recording_status':
        this.timelineData = data.timeline || this.timelineData;
        this._emit('recording_status', data);
        this._emit('timeline_data', data);
        break;

      case 'playback_event':
        this._emit('playback_event', data);
        break;

      case 'user_joined':
        this.users = data.users || {};
        this._emit('user_joined', data);
        break;

      case 'user_left':
        this.users = data.users || {};
        this._emit('user_left', data);
        break;

      case 'reagents_list':
        this.reagents = data.reagents || [];
        this._emit('reagents_list', data);
        break;

      case 'templates_list':
        this.templates = data.templates || [];
        this._emit('templates_list', data);
        break;

      case 'current_state':
        if (data.server_version !== undefined) {
          this.lastSeenServerVersion = data.server_version;
        }
        this.currentState = data.state || {};
        this._emit('current_state', data);
        break;
    }
  }

  join(username, tableId = 'default') {
    this.username = username;
    this._send({
      type: 'join',
      username,
      table_id: tableId,
    });
  }

  addReagent(reagentId, volume = 50) {
    const lamportTime = this.lamportClock.tick();
    this._send({
      type: 'operation',
      op_type: 'add_reagent',
      lamport_time: lamportTime,
      base_version: this.lastSeenServerVersion,
      data: {
        reagent: reagentId,
        volume,
      },
    });
  }

  heat(duration = 5.0, power = 50.0) {
    const lamportTime = this.lamportClock.tick();
    this._send({
      type: 'operation',
      op_type: 'heat',
      lamport_time: lamportTime,
      base_version: this.lastSeenServerVersion,
      data: { duration, power },
    });
  }

  stir(duration = 3.0) {
    const lamportTime = this.lamportClock.tick();
    this._send({
      type: 'operation',
      op_type: 'stir',
      lamport_time: lamportTime,
      base_version: this.lastSeenServerVersion,
      data: { duration },
    });
  }

  reset() {
    const lamportTime = this.lamportClock.tick();
    this._send({
      type: 'operation',
      op_type: 'reset',
      lamport_time: lamportTime,
      base_version: this.lastSeenServerVersion,
      data: {},
    });
  }

  startRecording() {
    this._send({ type: 'start_recording' });
  }

  stopRecording() {
    this._send({ type: 'stop_recording' });
  }

  seekToPosition(position) {
    this._send({ type: 'seek_to', position });
  }

  stepForward() {
    this._send({ type: 'step_forward' });
  }

  stepBackward() {
    this._send({ type: 'step_backward' });
  }

  playForward(speed = 1.0) {
    this._send({ type: 'play_forward', speed });
  }

  playBackward(speed = 1.0) {
    this._send({ type: 'play_backward', speed });
  }

  pausePlayback() {
    this._send({ type: 'pause_playback' });
  }

  resetPlayback() {
    this._send({ type: 'reset_playback' });
  }

  requestReagents() {
    this._send({ type: 'get_reagents' });
  }

  requestTemplates() {
    this._send({ type: 'get_templates' });
  }

  requestState() {
    this._send({ type: 'get_state' });
  }

  requestTimeline() {
    this._send({ type: 'get_timeline' });
  }

  _send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}
