import * as THREE from 'three';
import { LabScene } from './lab-scene.js';
import { SyncClient } from './sync-client.js';

class ChemistryLabApp {
  constructor() {
    this.scene = null;
    this.sync = new SyncClient();
    this.activeTool = null;
    this.reagentBottles = [];
    this.isHeating = false;
    this.heatInterval = null;
    this.isStirring = false;
    this.stirInterval = null;
    this.localState = {
      ph: 7.0, temperature: 25.0, color: [0.9, 0.95, 1.0],
      color_name: '无色', precipitate_grams: 0, precipitate_color: [1, 1, 1],
      precipitate_name: '', volume_ml: 0, is_boiling: false,
      gas_evolved: '', reactions_log: [],
    };
    this._timelineUI = {
      isPlayingForward: false,
      isPlayingBackward: false,
      isRecording: false,
      lastSliderValue: -1,
    };
  }

  async init() {
    this.scene = new LabScene(document.getElementById('canvas-container'));

    this._setupSyncHandlers();
    this._setupUI();
    this._setupDragDrop();
    this._setupToolbar();
    this._setupTimeline();

    try {
      await this.sync.connect();
      const username = `实验员${Math.floor(Math.random() * 9000 + 1000)}`;
      this.sync.join(username);
      this._addLog('系统', `已连接服务器，用户名: ${username}`);
    } catch (e) {
      this._addLog('系统', '离线模式启动（无法连接服务器）');
      this._loadDefaultReagents();
    }
  }

  _setupSyncHandlers() {
    this.sync.on('init', (data) => {
      this._addLog('系统', `已加入实验台: ${data.table_id}`);
      this._updateUsersPanel(data.users);
      this._loadReagents(data.reagents);
      this._updateInfoPanel(data.state);
      this._updateScene(data.state);
    });

    this.sync.on('state_update', (data) => {
      this._updateInfoPanel(data.state);
      this._updateScene(data.state);
      if (data.operation) {
        const op = data.operation;
        if (op.op_type === 'add_reagent') {
          this._addLog('操作', `添加了 ${op.data.reagent} ${op.data.volume}mL`);
        } else if (op.op_type === 'heat') {
          this._addLog('操作', `加热 ${op.data.duration}s`);
        } else if (op.op_type === 'stir') {
          this._addLog('操作', `搅拌 ${op.data.duration}s`);
        } else if (op.op_type === 'reset') {
          this._addLog('操作', '重置实验');
        }
      }
    });

    this.sync.on('user_joined', (data) => {
      this._addLog('系统', `${data.username} 加入了实验台`);
      this._updateUsersPanel(data.users);
    });

    this.sync.on('user_left', (data) => {
      this._updateUsersPanel(data.users);
    });

    this.sync.on('reagents_list', (data) => {
      this._loadReagents(data.reagents);
    });

    this.sync.on('timeline_data', (data) => {
      this._updateTimelineUI(data.timeline);
    });

    this.sync.on('recording_status', (data) => {
      this._updateTimelineUI(data.timeline);
      if (data.timeline?.is_recording) {
        this._addLog('录制', '开始录制实验过程');
      } else if (data.timeline?.is_recording === false && this._timelineUI.isRecording) {
        this._addLog('录制', `停止录制，共 ${data.timeline.total_entries || 0} 步操作`);
      }
      this._timelineUI.isRecording = !!(data.timeline?.is_recording);
    });

    this.sync.on('playback_state', (data) => {
      this._updateTimelineUI(data.timeline);
    });

    this.sync.on('playback_event', (data) => {
      if (data.event === 'playback_started') {
        if (data.direction === 'forward') {
          this._addLog('回放', '开始正向回放');
        } else {
          this._addLog('回放', '开始逆向回放');
        }
      } else if (data.event === 'playback_paused') {
        this._addLog('回放', '回放已暂停');
      } else if (data.event === 'playback_finished') {
        if (data.direction === 'forward') {
          this._addLog('回放', '正向回放完成');
        } else {
          this._addLog('回放', '逆向回放完成，已回到初始状态');
        }
        this._timelineUI.isPlayingForward = false;
        this._timelineUI.isPlayingBackward = false;
        this._updatePlaybackButtons();
      } else if (data.event === 'playback_reset') {
        this._addLog('回放', '已重置回放');
      }
    });
  }

  _loadDefaultReagents() {
    const defaults = [
      { id: 'HCl', name: '盐酸 HCl', color: [0.95, 0.98, 1.0], color_name: '无色', concentration: 1.0, default_volume: 50 },
      { id: 'NaOH', name: '氢氧化钠 NaOH', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 1.0, default_volume: 50 },
      { id: 'CuSO4', name: '硫酸铜 CuSO₄', color: [0.1, 0.4, 0.9], color_name: '蓝色', concentration: 0.5, default_volume: 50 },
      { id: 'AgNO3', name: '硝酸银 AgNO₃', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 0.5, default_volume: 50 },
      { id: 'NaCl', name: '氯化钠 NaCl', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 1.0, default_volume: 50 },
      { id: 'BaCl2', name: '氯化钡 BaCl₂', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 0.5, default_volume: 50 },
      { id: 'Na2SO4', name: '硫酸钠 Na₂SO₄', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 0.5, default_volume: 50 },
      { id: 'CaCO3', name: '碳酸钙 CaCO₃', color: [1.0, 1.0, 1.0], color_name: '白色', concentration: 0.5, default_volume: 30 },
      { id: 'FeCl3', name: '氯化铁 FeCl₃', color: [0.8, 0.55, 0.1], color_name: '黄褐色', concentration: 0.5, default_volume: 50 },
      { id: 'KSCN', name: '硫氰化钾 KSCN', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 1.0, default_volume: 50 },
      { id: 'NaHCO3', name: '碳酸氢钠 NaHCO₃', color: [1.0, 1.0, 1.0], color_name: '白色', concentration: 1.0, default_volume: 50 },
      { id: 'H2SO4', name: '硫酸 H₂SO₄', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 1.0, default_volume: 50 },
      { id: 'NaOH_Solution', name: 'NaOH溶液', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 1.0, default_volume: 50 },
      { id: 'Litmus', name: '石蕊指示剂', color: [0.6, 0.2, 0.8], color_name: '紫色', concentration: 0.01, default_volume: 10 },
      { id: 'Phenolphthalein', name: '酚酞指示剂', color: [0.95, 0.95, 1.0], color_name: '无色', concentration: 0.01, default_volume: 10 },
    ];
    this._loadReagents(defaults);
  }

  _loadReagents(reagents) {
    const list = document.getElementById('reagent-list');
    list.innerHTML = '';
    this.reagentBottles.forEach(b => this.scene.scene.remove(b));
    this.reagentBottles = [];

    const bottlePositions = [
      new THREE.Vector3(-1.5, 1.15, -0.8),
      new THREE.Vector3(-1.5, 1.15, -0.4),
      new THREE.Vector3(-1.5, 1.15, 0.0),
      new THREE.Vector3(-1.5, 1.15, 0.4),
      new THREE.Vector3(-1.5, 1.15, 0.8),
      new THREE.Vector3(1.5, 1.15, -0.8),
      new THREE.Vector3(1.5, 1.15, -0.4),
      new THREE.Vector3(1.5, 1.15, 0.0),
      new THREE.Vector3(1.5, 1.15, 0.4),
      new THREE.Vector3(1.5, 1.15, 0.8),
    ];

    reagents.forEach((r, i) => {
      const item = document.createElement('div');
      item.className = 'reagent-item';
      item.draggable = true;
      item.dataset.reagentId = r.id;
      item.dataset.reagentName = r.name;
      item.dataset.volume = r.default_volume || 50;
      item.innerHTML = `<span class="reagent-color" style="background:rgb(${Math.round(r.color[0]*255)},${Math.round(r.color[1]*255)},${Math.round(r.color[2]*255)})"></span><span>${r.name}</span>`;
      list.appendChild(item);

      if (i < bottlePositions.length) {
        const bottle = this.scene.createReagentBottle(r.name, r.color, bottlePositions[i]);
        this.reagentBottles.push(bottle);
      }
    });
  }

  _setupDragDrop() {
    const list = document.getElementById('reagent-list');

    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.reagent-item');
      if (!item) return;
      e.dataTransfer.setData('text/plain', JSON.stringify({
        id: item.dataset.reagentId,
        name: item.dataset.reagentName,
        volume: parseInt(item.dataset.volume),
      }));
      item.classList.add('dragging');
    });

    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.reagent-item');
      if (item) item.classList.remove('dragging');
    });

    const container = document.getElementById('canvas-container');
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.getElementById('drop-zone').classList.add('visible');
    });

    container.addEventListener('dragleave', (e) => {
      document.getElementById('drop-zone').classList.remove('visible');
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      document.getElementById('drop-zone').classList.remove('visible');

      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        this._pourReagent(data.id, data.name, data.volume);
      } catch (err) {
        console.error('Drop error:', err);
      }
    });

    list.addEventListener('click', (e) => {
      const item = e.target.closest('.reagent-item');
      if (!item) return;
      const data = {
        id: item.dataset.reagentId,
        name: item.dataset.reagentName,
        volume: parseInt(item.dataset.volume),
      };
      this._pourReagent(data.id, data.name, data.volume);
    });
  }

  _pourReagent(reagentId, reagentName, volume) {
    this.sync.addReagent(reagentId, volume);
    this._addLog('试剂', `倾倒 ${reagentName} ${volume}mL`);

    this.scene.createPourAnimation(
      new THREE.Vector3(0, 2.5, 0),
      new THREE.Vector3(0, 1.6, 0),
      this.localState.color || [0.9, 0.95, 1.0]
    );
  }

  _setupToolbar() {
    const toolbar = document.getElementById('toolbar');
    const buttons = toolbar.querySelectorAll('.tool-btn');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;

        if (tool === 'reset') {
          this._stopAllActions();
          this.sync.reset();
          this._addLog('操作', '重置实验台');
          return;
        }

        if (this.activeTool === tool) {
          this._stopAllActions();
          this.activeTool = null;
          buttons.forEach(b => b.classList.remove('active'));
          return;
        }

        this._stopAllActions();
        this.activeTool = tool;
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (tool === 'heat') {
          this._startHeating();
        } else if (tool === 'stir') {
          this._startStirring();
        } else if (tool === 'pour') {
          this._addLog('提示', '点击或拖拽试剂瓶倾倒试剂');
        }
      });
    });
  }

  _startHeating() {
    this.isHeating = true;
    this.scene.setHeating(true);
    this._addLog('操作', '开始加热...');

    this.heatInterval = setInterval(() => {
      if (this.isHeating) {
        this.sync.heat(1.0, 50.0);

        if (this.localState.volume_ml > 0) {
          this.scene.createBubbles();
        }
      }
    }, 1000);
  }

  _startStirring() {
    this.isStirring = true;
    this.scene.setStirring(true);
    this._addLog('操作', '开始搅拌...');

    this.stirInterval = setInterval(() => {
      if (this.isStirring) {
        this.sync.stir(1.0);
      }
    }, 1000);
  }

  _stopAllActions() {
    this.isHeating = false;
    this.isStirring = false;
    this.scene.setHeating(false);
    this.scene.setStirring(false);

    if (this.heatInterval) {
      clearInterval(this.heatInterval);
      this.heatInterval = null;
    }
    if (this.stirInterval) {
      clearInterval(this.stirInterval);
      this.stirInterval = null;
    }
  }

  _setupUI() {
    // UI is set up via HTML, event bindings in other methods
  }

  _updateInfoPanel(state) {
    if (!state) return;
    this.localState = state;

    document.getElementById('ph-value').textContent = state.ph?.toFixed(2) || '7.00';
    document.getElementById('temp-value').textContent = `${state.temperature?.toFixed(1) || 25.0}°C`;
    document.getElementById('color-value').textContent = state.color_name || '无色';
    document.getElementById('precip-value').textContent = `${state.precipitate_grams?.toFixed(3) || 0}g`;
    document.getElementById('volume-value').textContent = `${state.volume_ml?.toFixed(1) || 0}mL`;

    const phEl = document.getElementById('ph-value');
    if (state.ph < 5) phEl.style.color = '#ff6b6b';
    else if (state.ph < 6.5) phEl.style.color = '#ffa502';
    else if (state.ph < 7.5) phEl.style.color = '#64ffda';
    else if (state.ph < 8.5) phEl.style.color = '#7bed9f';
    else phEl.style.color = '#70a1ff';

    if (state.is_boiling) {
      document.getElementById('temp-value').style.color = '#ff6b6b';
    } else {
      document.getElementById('temp-value').style.color = '#64ffda';
    }
  }

  _updateScene(state) {
    if (!state) return;
    this.localState = state;
    this.scene.updateLiquid(state);
    this.scene.updatePrecipitate(state);

    if (state.is_boiling && !this.isHeating) {
      this.scene.createBubbles();
    }

    if (state.reactions_log && state.reactions_log.length > 0) {
      const lastReaction = state.reactions_log[state.reactions_log.length - 1];
      if (!this._lastLoggedReaction || this._lastLoggedReaction !== lastReaction) {
        this._lastLoggedReaction = lastReaction;
        this._addLog('反应', lastReaction);
      }
    }
  }

  _updateUsersPanel(users) {
    const listEl = document.getElementById('user-list');
    const countEl = document.getElementById('user-count');
    const count = users ? Object.keys(users).length : 0;
    countEl.textContent = count;

    listEl.innerHTML = '';
    if (users) {
      Object.values(users).forEach(u => {
        const div = document.createElement('div');
        div.style.marginTop = '4px';
        div.innerHTML = `<span class="user-dot" style="background:${u.color}"></span>${u.username}`;
        listEl.appendChild(div);
      });
    }
  }

  _setupTimeline() {
    const recordBtn = document.getElementById('record-btn');
    const playForwardBtn = document.getElementById('play-forward-btn');
    const playBackBtn = document.getElementById('play-back-btn');
    const stepForwardBtn = document.getElementById('step-forward-btn');
    const stepBackBtn = document.getElementById('step-back-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resetBtn = document.getElementById('reset-playback-btn');
    const slider = document.getElementById('timeline-slider');

    recordBtn.addEventListener('click', () => {
      if (this._timelineUI.isRecording) {
        this.sync.stopRecording();
      } else {
        this.sync.startRecording();
      }
    });

    playForwardBtn.addEventListener('click', () => {
      if (this._timelineUI.isPlayingForward) {
        this.sync.pausePlayback();
        this._timelineUI.isPlayingForward = false;
      } else {
        this.sync.playForward(1.0);
        this._timelineUI.isPlayingForward = true;
        this._timelineUI.isPlayingBackward = false;
      }
      this._updatePlaybackButtons();
    });

    playBackBtn.addEventListener('click', () => {
      if (this._timelineUI.isPlayingBackward) {
        this.sync.pausePlayback();
        this._timelineUI.isPlayingBackward = false;
      } else {
        this.sync.playBackward(1.0);
        this._timelineUI.isPlayingBackward = true;
        this._timelineUI.isPlayingForward = false;
      }
      this._updatePlaybackButtons();
    });

    stepForwardBtn.addEventListener('click', () => {
      this.sync.stepForward();
    });

    stepBackBtn.addEventListener('click', () => {
      this.sync.stepBackward();
    });

    pauseBtn.addEventListener('click', () => {
      this.sync.pausePlayback();
      this._timelineUI.isPlayingForward = false;
      this._timelineUI.isPlayingBackward = false;
      this._updatePlaybackButtons();
    });

    resetBtn.addEventListener('click', () => {
      this.sync.resetPlayback();
      this._timelineUI.isPlayingForward = false;
      this._timelineUI.isPlayingBackward = false;
      this._updatePlaybackButtons();
    });

    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      if (value !== this._timelineUI.lastSliderValue) {
        this._timelineUI.lastSliderValue = value;
        this.sync.seekToPosition(value);
      }
    });
  }

  _updatePlaybackButtons() {
    const playForwardBtn = document.getElementById('play-forward-btn');
    const playBackBtn = document.getElementById('play-back-btn');
    const pauseBtn = document.getElementById('pause-btn');

    playForwardBtn.classList.toggle('active', this._timelineUI.isPlayingForward);
    playBackBtn.classList.toggle('active', this._timelineUI.isPlayingBackward);
    pauseBtn.disabled = !this._timelineUI.isPlayingForward && !this._timelineUI.isPlayingBackward;
  }

  _updateTimelineUI(timeline) {
    if (!timeline) return;

    const recordBtn = document.getElementById('record-btn');
    const stepForwardBtn = document.getElementById('step-forward-btn');
    const stepBackBtn = document.getElementById('step-back-btn');
    const playForwardBtn = document.getElementById('play-forward-btn');
    const playBackBtn = document.getElementById('play-back-btn');
    const slider = document.getElementById('timeline-slider');
    const statusEl = document.getElementById('timeline-status');
    const counterEl = document.getElementById('timeline-counter');
    const markersEl = document.getElementById('timeline-markers');

    if (timeline.is_recording) {
      recordBtn.textContent = '⏹ 停止';
      recordBtn.classList.add('recording');
      statusEl.textContent = '⏺ 录制中...';
    } else {
      recordBtn.textContent = '⏺ 录制';
      recordBtn.classList.remove('recording');
    }

    const total = timeline.total_entries || 0;
    const current = timeline.current_position ?? -1;

    counterEl.textContent = `${Math.max(0, current + 1)} / ${total}`;

    if (total > 0) {
      slider.min = -1;
      slider.max = total - 1;
      slider.disabled = false;
      stepBackBtn.disabled = current <= -1;
      stepForwardBtn.disabled = current >= total - 1;
      playForwardBtn.disabled = current >= total - 1;
      playBackBtn.disabled = current <= -1;
    } else {
      slider.min = -1;
      slider.max = -1;
      slider.disabled = true;
      stepBackBtn.disabled = true;
      stepForwardBtn.disabled = true;
      playForwardBtn.disabled = true;
      playBackBtn.disabled = true;
    }

    if (this._timelineUI.lastSliderValue !== current) {
      slider.value = current;
      this._timelineUI.lastSliderValue = current;
    }

    if (!timeline.is_recording && this._timelineUI.isPlayingForward) {
      statusEl.textContent = '▶ 正向播放中';
    } else if (!timeline.is_recording && this._timelineUI.isPlayingBackward) {
      statusEl.textContent = '◀ 逆向播放中';
    } else if (!timeline.is_recording) {
      statusEl.textContent = '⏸ 已暂停';
    }

    markersEl.innerHTML = '';
    if (timeline.entries && timeline.entries.length > 0) {
      timeline.entries.forEach((entry, idx) => {
        const marker = document.createElement('div');
        marker.className = 'timeline-marker';
        const percent = (idx / (timeline.entries.length - 1)) * 100;
        marker.style.left = `${percent}%`;

        const tooltip = document.createElement('div');
        tooltip.className = 'marker-tooltip';
        const opDesc = this._getOperationDescription(entry);
        tooltip.textContent = `#${idx + 1}: ${opDesc}`;
        marker.appendChild(tooltip);
        markersEl.appendChild(marker);
      });
    }
  }

  _getOperationDescription(entry) {
    const op = entry.operation;
    if (!op) return '操作';
    if (op.op_type === 'add_reagent') {
      return `添加 ${op.data?.reagent || '试剂'} ${op.data?.volume || 0}mL`;
    } else if (op.op_type === 'heat') {
      return `加热 ${op.data?.duration || 0}s`;
    } else if (op.op_type === 'stir') {
      return `搅拌 ${op.data?.duration || 0}s`;
    } else if (op.op_type === 'reset') {
      return '重置实验';
    }
    return op.op_type || '操作';
  }

  _addLog(category, message) {
    const logPanel = document.getElementById('log-panel');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    entry.innerHTML = `<span class="time">${timeStr}</span><span class="reaction">[${category}]</span> ${message}`;
    logPanel.appendChild(entry);
    logPanel.scrollTop = logPanel.scrollHeight;

    while (logPanel.children.length > 50) {
      logPanel.removeChild(logPanel.firstChild);
    }
  }
}

const app = new ChemistryLabApp();
app.init();
