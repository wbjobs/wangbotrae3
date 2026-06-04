class MIDIManager {
    constructor(app) {
        this.app = app;
        this.midiAccess = null;
        this.selectedInput = null;
        this.enabled = true;
        this.clientStartTime = null;
        this.audioContext = null;
        this.activeNotes = new Map();
        this.noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    }
    
    async init() {
        try {
            if (!navigator.requestMIDIAccess) {
                this.updateStatus('不支持MIDI', false);
                console.log('Web MIDI API not supported');
                return;
            }
            
            this.midiAccess = await navigator.requestMIDIAccess({
                sysex: false,
                software: true
            });
            
            this.updateStatus('已检测到', true);
            this.populateInputs();
            
            this.midiAccess.onstatechange = (event) => {
                console.log('MIDI state change:', event.port.name, event.port.state);
                this.populateInputs();
                this.updateStatus(
                    this.midiAccess.inputs.size > 0 ? '已检测到' : '未检测到',
                    this.midiAccess.inputs.size > 0
                );
            };
            
            this.initAudio();
            
            document.getElementById('midi-enabled').addEventListener('change', (e) => {
                this.enabled = e.target.checked;
            });
            
            document.getElementById('midi-input-select').addEventListener('change', (e) => {
                this.selectInput(e.target.value);
            });
            
            console.log('MIDI initialized successfully');
            
        } catch (err) {
            console.error('MIDI initialization error:', err);
            this.updateStatus('初始化失败', false);
        }
    }
    
    initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Audio context initialized');
        } catch (err) {
            console.error('Audio context error:', err);
        }
    }
    
    populateInputs() {
        const select = document.getElementById('midi-input-select');
        select.innerHTML = '<option value="">选择MIDI输入设备</option>';
        
        if (!this.midiAccess) return;
        
        for (const input of this.midiAccess.inputs.values()) {
            const option = document.createElement('option');
            option.value = input.id;
            option.textContent = input.name;
            select.appendChild(option);
        }
        
        if (this.midiAccess.inputs.size === 1) {
            const firstInput = this.midiAccess.inputs.values().next().value;
            select.value = firstInput.id;
            this.selectInput(firstInput.id);
        }
    }
    
    selectInput(inputId) {
        if (this.selectedInput) {
            this.selectedInput.onmidimessage = null;
        }
        
        if (!inputId) {
            this.selectedInput = null;
            return;
        }
        
        this.selectedInput = this.midiAccess.inputs.get(inputId);
        if (this.selectedInput) {
            this.selectedInput.onmidimessage = (event) => this.handleMIDIMessage(event);
            console.log('Selected MIDI input:', this.selectedInput.name);
            this.app.showToast(`已连接到: ${this.selectedInput.name}`, 'success');
        }
    }
    
    handleMIDIMessage(event) {
        if (!this.enabled) return;
        
        const [statusByte, noteNumber, velocity] = event.data;
        const messageType = statusByte & 0xF0;
        const channel = statusByte & 0x0F;
        
        let eventType = null;
        let eventData = {};
        
        switch (messageType) {
            case 0x90:
                eventType = velocity > 0 ? 'note-on' : 'note-off';
                break;
            case 0x80:
                eventType = 'note-off';
                break;
            case 0xB0:
                eventType = 'control-change';
                eventData.controller = noteNumber;
                eventData.value = velocity;
                break;
            case 0xE0:
                eventType = 'pitch-bend';
                eventData.value = (velocity << 7) | noteNumber;
                break;
            default:
                return;
        }
        
        const timestamp = this.getCurrentTimestamp();
        
        const midiEvent = {
            type: eventType,
            note: noteNumber,
            velocity,
            channel,
            timestamp,
            clientStartTime: this.clientStartTime || timestamp,
            ...eventData
        };
        
        this.logMIDIEvent(midiEvent);
        this.playLocalSound(midiEvent);
        this.app.mqttManager.sendMIDIEvent(midiEvent);
    }
    
    getCurrentTimestamp() {
        if (!this.clientStartTime) {
            this.clientStartTime = performance.now();
        }
        return Math.floor(performance.now() - this.clientStartTime);
    }
    
    logMIDIEvent(event) {
        const log = document.getElementById('midi-events');
        const noteName = this.getNoteName(event.note);
        
        let message = '';
        if (event.type === 'note-on') {
            message = `🎵 Note On: ${noteName} (${event.note}), velocity: ${event.velocity}`;
        } else if (event.type === 'note-off') {
            message = `🎼 Note Off: ${noteName} (${event.note})`;
        } else if (event.type === 'control-change') {
            message = `🎛️ CC: ${event.controller}, value: ${event.value}`;
        } else if (event.type === 'pitch-bend') {
            message = `🎚️ Pitch Bend: ${event.value}`;
        }
        
        const eventEl = document.createElement('div');
        eventEl.className = `midi-event ${event.type}`;
        eventEl.textContent = `[${event.timestamp}ms] ${message}`;
        
        log.appendChild(eventEl);
        log.scrollTop = log.scrollHeight;
        
        while (log.children.length > 50) {
            log.removeChild(log.firstChild);
        }
    }
    
    getNoteName(noteNumber) {
        const octave = Math.floor(noteNumber / 12) - 1;
        const noteIndex = noteNumber % 12;
        return `${this.noteNames[noteIndex]}${octave}`;
    }
    
    playLocalSound(event) {
        if (!this.audioContext) return;
        
        if (event.type === 'note-on' && event.velocity > 0) {
            this.playNote(event.note, event.velocity);
        } else if (event.type === 'note-off' || (event.type === 'note-on' && event.velocity === 0)) {
            this.stopNote(event.note);
        }
    }
    
    playNote(noteNumber, velocity) {
        if (!this.audioContext) return;
        
        const frequency = this.noteToFrequency(noteNumber);
        const gainValue = velocity / 127 * 0.3;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(gainValue, this.audioContext.currentTime + 0.01);
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.start();
        
        this.activeNotes.set(noteNumber, { oscillator, gainNode });
    }
    
    stopNote(noteNumber) {
        const activeNote = this.activeNotes.get(noteNumber);
        if (activeNote) {
            const { oscillator, gainNode } = activeNote;
            
            gainNode.gain.linearRampToValueAtTime(
                0, this.audioContext.currentTime + 0.1
            );
            
            setTimeout(() => {
                oscillator.stop();
                oscillator.disconnect();
                gainNode.disconnect();
            }, 100);
            
            this.activeNotes.delete(noteNumber);
        }
    }
    
    noteToFrequency(noteNumber) {
        return 440 * Math.pow(2, (noteNumber - 69) / 12);
    }
    
    playRemoteEvent(event) {
        if (!this.enabled) return;
        
        if (event.type === 'note-on') {
            this.playNote(event.note, event.velocity);
            this.logMIDIEvent({ ...event, remote: true });
        } else if (event.type === 'note-off') {
            this.stopNote(event.note);
        }
    }
    
    resetTimer() {
        this.clientStartTime = null;
    }
    
    updateStatus(text, connected) {
        const statusEl = document.getElementById('midi-status');
        statusEl.textContent = text;
        statusEl.className = `midi-status-text ${connected ? 'connected' : ''}`;
    }
    
    close() {
        if (this.selectedInput) {
            this.selectedInput.onmidimessage = null;
            this.selectedInput = null;
        }
        
        for (const [noteNumber, activeNote] of this.activeNotes) {
            activeNote.oscillator.stop();
            activeNote.oscillator.disconnect();
            activeNote.gainNode.disconnect();
        }
        this.activeNotes.clear();
        
        if (this.midiAccess) {
            this.midiAccess = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

window.MIDIManager = MIDIManager;
