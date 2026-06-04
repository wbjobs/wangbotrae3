class ScoreEditor {
    constructor(app) {
        this.app = app;
        this.currentMusicxml = null;
        this.parsedScore = null;
        this.currentVersion = 1;
        this.pendingOperations = [];
        this.selectedMeasure = 0;
        this.selectedNoteIndex = -1;
        this.localOperations = [];
    }
    
    async renderScore(musicxml) {
        this.currentMusicxml = musicxml;
        
        try {
            const response = await fetch('/api/scores/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ musicxml })
            });
            
            const data = await response.json();
            this.parsedScore = data;
            
            this.renderMeasures();
            
        } catch (err) {
            console.error('Parse score error:', err);
            document.getElementById('score-render').innerHTML = 
                '<div class="loading">解析乐谱失败</div>';
        }
    }
    
    renderMeasures() {
        const container = document.getElementById('score-render');
        const measures = this.parsedScore.measures || [];
        
        if (measures.length === 0) {
            container.innerHTML = '<div class="loading">空乐谱，点击"添加音符"开始创作</div>';
            return;
        }
        
        let html = '<div class="measures-container">';
        
        measures.forEach((measure, mIndex) => {
            html += `
                <div class="measure" data-measure="${mIndex}" onclick="app.scoreEditor.selectMeasure(${mIndex}, event)">
                    <div class="measure-header">小节 ${mIndex + 1}</div>
                    <div class="staff">
                        ${this.renderStaffLines()}
                        ${this.renderNotes(measure.notes || [], mIndex)}
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
    }
    
    renderStaffLines() {
        let html = '';
        for (let i = 0; i < 5; i++) {
            const top = 30 + i * 25;
            html += `<div class="staff-line" style="top: ${top}px;"></div>`;
        }
        return html;
    }
    
    renderNotes(notes, measureIndex) {
        if (notes.length === 0) {
            return '<div style="position: absolute; top: 60px; left: 10px; color: #999; font-size: 0.8rem;">空</div>';
        }
        
        let html = '';
        notes.forEach((note, nIndex) => {
            const isSelected = this.selectedMeasure === measureIndex && 
                              this.selectedNoteIndex === nIndex;
            
            const position = this.calculateNotePosition(note);
            const noteClass = this.getNoteClass(note);
            
            html += `
                <div class="note ${noteClass} ${isSelected ? 'selected' : ''}"
                     style="left: ${10 + nIndex * 35}px; top: ${position.top}px;"
                     data-measure="${measureIndex}"
                     data-note="${nIndex}"
                     onclick="app.scoreEditor.selectNote(${measureIndex}, ${nIndex}, event)">
                    ${note.rest ? 
                        '<div class="rest">𝄽</div>' : 
                        '<div class="notehead"></div><div class="note-stem"></div>'}
                </div>
            `;
        });
        
        return html;
    }
    
    calculateNotePosition(note) {
        if (note.rest || !note.pitch) {
            return { top: 60 };
        }
        
        const { step, octave, alter } = note.pitch;
        const referenceOctave = 4;
        const octaveDiff = octave - referenceOctave;
        
        const stepPositions = {
            'C': 140, 'D': 128, 'E': 116, 'F': 104, 'G': 92, 'A': 80, 'B': 68
        };
        
        let top = stepPositions[step] || 80;
        top -= octaveDiff * 49;
        
        return { top };
    }
    
    getNoteClass(note) {
        if (note.rest) return 'rest-note';
        
        const duration = note.duration || 4;
        if (duration >= 16) return 'whole';
        if (duration >= 8) return 'half';
        return '';
    }
    
    selectMeasure(measureIndex, event) {
        event.stopPropagation();
        this.selectedMeasure = measureIndex;
        this.selectedNoteIndex = -1;
        this.renderMeasures();
    }
    
    selectNote(measureIndex, noteIndex, event) {
        event.stopPropagation();
        this.selectedMeasure = measureIndex;
        this.selectedNoteIndex = noteIndex;
        this.renderMeasures();
    }
    
    getSelectedDuration() {
        const durationSelect = document.getElementById('note-duration');
        const duration = parseInt(durationSelect.value);
        const typeMap = {
            1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th'
        };
        return { duration, type: typeMap[duration] };
    }
    
    addNote() {
        if (!this.app.currentSession?.isTeacher) {
            this.app.showToast('只有教师可以编辑乐谱', 'error');
            return;
        }
        
        const { duration, type } = this.getSelectedDuration();
        const note = {
            pitch: { step: 'C', octave: 4, alter: 0 },
            duration,
            type,
            rest: false
        };
        
        const measureIndex = this.selectedMeasure;
        const noteIndex = this.selectedNoteIndex >= 0 ? this.selectedNoteIndex + 1 : 
                         (this.parsedScore.measures[measureIndex]?.notes?.length || 0);
        
        const operation = {
            type: 'insert',
            measureIndex,
            noteIndex,
            note,
            timestamp: Date.now()
        };
        
        this.sendOperation(operation);
    }
    
    addRest() {
        if (!this.app.currentSession?.isTeacher) {
            this.app.showToast('只有教师可以编辑乐谱', 'error');
            return;
        }
        
        const { duration, type } = this.getSelectedDuration();
        const note = {
            duration,
            type,
            rest: true
        };
        
        const measureIndex = this.selectedMeasure;
        const noteIndex = this.selectedNoteIndex >= 0 ? this.selectedNoteIndex + 1 : 
                         (this.parsedScore.measures[measureIndex]?.notes?.length || 0);
        
        const operation = {
            type: 'insert',
            measureIndex,
            noteIndex,
            note,
            timestamp: Date.now()
        };
        
        this.sendOperation(operation);
    }
    
    deleteSelectedNote() {
        if (!this.app.currentSession?.isTeacher) {
            this.app.showToast('只有教师可以编辑乐谱', 'error');
            return;
        }
        
        if (this.selectedNoteIndex < 0) {
            this.app.showToast('请先选择要删除的音符', 'error');
            return;
        }
        
        const operation = {
            type: 'delete',
            measureIndex: this.selectedMeasure,
            noteIndex: this.selectedNoteIndex,
            timestamp: Date.now()
        };
        
        this.sendOperation(operation);
        this.selectedNoteIndex = -1;
    }
    
    applyTimeSignature() {
        if (!this.app.currentSession?.isTeacher) {
            this.app.showToast('只有教师可以编辑乐谱', 'error');
            return;
        }
        
        const beats = parseInt(document.getElementById('time-signature-beats').value);
        const beatType = parseInt(document.getElementById('time-signature-type').value);
        
        const operation = {
            type: 'metadata',
            property: 'timeSignature',
            value: { beats, beatType },
            timestamp: Date.now()
        };
        
        this.sendOperation(operation);
        this.app.showToast(`拍号已改为 ${beats}/${beatType}`, 'success');
    }
    
    applyKeySignature() {
        if (!this.app.currentSession?.isTeacher) {
            this.app.showToast('只有教师可以编辑乐谱', 'error');
            return;
        }
        
        const fifths = parseInt(document.getElementById('key-signature').value);
        
        const operation = {
            type: 'metadata',
            property: 'keySignature',
            value: fifths,
            timestamp: Date.now()
        };
        
        this.sendOperation(operation);
        this.app.showToast('调号已更新', 'success');
    }
    
    sendOperation(operation) {
        if (!this.app.ws) {
            this.app.showToast('未连接到服务器', 'error');
            return;
        }
        
        this.localOperations.push({
            operation,
            version: this.currentVersion,
            sent: false,
            acknowledged: false
        });
        
        this.applyOperationLocally(operation);
        
        this.app.ws.send(JSON.stringify({
            type: 'score-operation',
            operation,
            scoreId: this.app.currentSession.scoreId,
            version: this.currentVersion
        }));
    }
    
    handleOperationAck(data) {
        const { originalVersion, newVersion, operation } = data;
        
        this.currentVersion = newVersion;
        
        const index = this.localOperations.findIndex(
            op => op.version === originalVersion && 
                  op.operation.type === operation.type
        );
        
        if (index >= 0) {
            this.localOperations[index].acknowledged = true;
            this.localOperations.splice(index, 1);
        }
        
        this.currentVersion = newVersion;
    }
    
    handleRemoteOperation(data) {
        const { operation, version, musicxml, userId } = data;
        
        if (userId === this.app.currentUser.id) {
            return;
        }
        
        this.currentVersion = version;
        
        for (let i = 0; i < this.localOperations.length; i++) {
            const localOp = this.localOperations[i];
            const [, transformedLocal] = this.transformOperations(operation, localOp.operation);
            if (transformedLocal) {
                this.localOperations[i].operation = transformedLocal;
            }
        }
        
        this.applyOperationLocally(operation);
        this.currentMusicxml = musicxml;
        
        this.renderMeasures();
    }
    
    applyOperationLocally(operation) {
        if (!this.parsedScore || !this.parsedScore.measures) {
            this.parsedScore = { measures: [] };
        }
        
        const measures = this.parsedScore.measures;
        
        switch (operation.type) {
            case 'insert':
                if (!measures[operation.measureIndex]) {
                    measures[operation.measureIndex] = { notes: [] };
                }
                if (!measures[operation.measureIndex].notes) {
                    measures[operation.measureIndex].notes = [];
                }
                measures[operation.measureIndex].notes.splice(
                    operation.noteIndex, 0, operation.note
                );
                break;
                
            case 'delete':
                if (measures[operation.measureIndex]?.notes) {
                    measures[operation.measureIndex].notes.splice(
                        operation.noteIndex, 1
                    );
                }
                break;
                
            case 'update':
                if (measures[operation.measureIndex]?.notes?.[operation.noteIndex]) {
                    const note = measures[operation.measureIndex].notes[operation.noteIndex];
                    if (operation.property.startsWith('pitch.')) {
                        const prop = operation.property.split('.')[1];
                        note.pitch = note.pitch || {};
                        note.pitch[prop] = operation.value;
                    } else {
                        note[operation.property] = operation.value;
                    }
                }
                break;
                
            case 'metadata':
                console.log('Metadata update:', operation.property, operation.value);
                break;
        }
        
        this.renderMeasures();
    }
    
    transformOperations(op1, op2) {
        if (op1.type === 'metadata' || op2.type === 'metadata') {
            return [op1, op2];
        }
        
        if (op1.measureIndex !== op2.measureIndex) {
            return [op1, op2];
        }
        
        if (op1.type === 'insert' && op2.type === 'insert') {
            if (op1.noteIndex <= op2.noteIndex) {
                return [op1, { ...op2, noteIndex: op2.noteIndex + 1 }];
            } else {
                return [{ ...op1, noteIndex: op1.noteIndex + 1 }, op2];
            }
        }
        
        if (op1.type === 'insert' && op2.type === 'delete') {
            if (op1.noteIndex <= op2.noteIndex) {
                return [op1, { ...op2, noteIndex: op2.noteIndex + 1 }];
            }
            return [op1, op2];
        }
        
        if (op1.type === 'delete' && op2.type === 'insert') {
            if (op1.noteIndex < op2.noteIndex) {
                return [op1, { ...op2, noteIndex: op2.noteIndex - 1 }];
            }
            return [op1, op2];
        }
        
        if (op1.type === 'delete' && op2.type === 'delete') {
            if (op1.noteIndex === op2.noteIndex) {
                return [op1, null];
            }
            if (op1.noteIndex < op2.noteIndex) {
                return [op1, { ...op2, noteIndex: op2.noteIndex - 1 }];
            }
            return [{ ...op1, noteIndex: op1.noteIndex - 1 }, op2];
        }
        
        return [op1, op2];
    }
}

window.ScoreEditor = ScoreEditor;
