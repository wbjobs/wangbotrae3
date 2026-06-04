const { parseString, Builder } = require('xml2js');

class MusicXMLUtils {
  static async parse(musicxmlString) {
    return new Promise((resolve, reject) => {
      parseString(musicxmlString, { explicitArray: false }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  static async build(scoreObject) {
    const builder = new Builder({ headless: true, renderOpts: { pretty: true } });
    return builder.buildObject(scoreObject);
  }

  static toJSON(musicxmlString) {
    return this.parse(musicxmlString);
  }

  static fromJSON(scoreObject) {
    return this.build(scoreObject);
  }

  static createEmpty(title = 'Untitled') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work>
    <work-title>${title}</work-title>
  </work>
  <identification>
    <encoding>
      <software>Music Collaboration System</software>
      <encoding-date>${new Date().toISOString().split('T')[0]}</encoding-date>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1">
        <instrument-name>Piano</instrument-name>
      </score-instrument>
      <midi-instrument id="P1-I1">
        <midi-program>1</midi-program>
        <midi-channel>1</midi-channel>
      </midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
    </measure>
  </part>
</score-partwise>`;
  }

  static async getMeasures(musicxmlString) {
    const parsed = await this.parse(musicxmlString);
    const part = parsed['score-partwise'].part;
    if (!part || !part.measure) return [];
    
    const measures = Array.isArray(part.measure) ? part.measure : [part.measure];
    return measures.map((measure, index) => ({
      number: measure.$.number,
      index,
      notes: this.extractNotes(measure)
    }));
  }

  static extractNotes(measure) {
    if (!measure.note) return [];
    const notes = Array.isArray(measure.note) ? measure.note : [measure.note];
    
    return notes.map((note, idx) => ({
      index: idx,
      pitch: note.pitch ? {
        step: note.pitch.step,
        octave: note.pitch.octave,
        alter: note.pitch.alter || 0
      } : null,
      duration: note.duration || 4,
      type: note.type || 'quarter',
      rest: note.rest ? true : false,
      chord: note.chord ? true : false
    }));
  }

  static async addNote(musicxmlString, measureIndex, noteIndex, noteData) {
    const parsed = await this.parse(musicxmlString);
    const part = parsed['score-partwise'].part;
    let measures = Array.isArray(part.measure) ? part.measure : [part.measure];
    
    while (measures.length <= measureIndex) {
      measures.push({
        $: { number: String(measures.length + 1) },
        note: []
      });
    }
    
    if (!measures[measureIndex].note) {
      measures[measureIndex].note = [];
    }
    
    if (!Array.isArray(measures[measureIndex].note)) {
      measures[measureIndex].note = [measures[measureIndex].note];
    }
    
    const newNote = {};
    if (noteData.rest) {
      newNote.rest = {};
    } else {
      newNote.pitch = {
        step: noteData.pitch.step,
        octave: noteData.pitch.octave
      };
      if (noteData.pitch.alter) {
        newNote.pitch.alter = noteData.pitch.alter;
      }
    }
    newNote.duration = noteData.duration || 4;
    newNote.type = noteData.type || 'quarter';
    
    measures[measureIndex].note.splice(noteIndex, 0, newNote);
    part.measure = measures;
    
    return this.build(parsed);
  }

  static async deleteNote(musicxmlString, measureIndex, noteIndex) {
    const parsed = await this.parse(musicxmlString);
    const part = parsed['score-partwise'].part;
    let measures = Array.isArray(part.measure) ? part.measure : [part.measure];
    
    if (measures[measureIndex] && measures[measureIndex].note) {
      if (!Array.isArray(measures[measureIndex].note)) {
        measures[measureIndex].note = [measures[measureIndex].note];
      }
      measures[measureIndex].note.splice(noteIndex, 1);
    }
    
    part.measure = measures;
    return this.build(parsed);
  }

  static async updateNote(musicxmlString, measureIndex, noteIndex, property, value) {
    const parsed = await this.parse(musicxmlString);
    const part = parsed['score-partwise'].part;
    let measures = Array.isArray(part.measure) ? part.measure : [part.measure];
    
    if (measures[measureIndex] && measures[measureIndex].note) {
      if (!Array.isArray(measures[measureIndex].note)) {
        measures[measureIndex].note = [measures[measureIndex].note];
      }
      
      const note = measures[measureIndex].note[noteIndex];
      if (note) {
        if (property === 'duration' || property === 'type') {
          note[property] = value;
        } else if (property.startsWith('pitch.')) {
          const pitchProp = property.split('.')[1];
          if (!note.pitch) note.pitch = {};
          note.pitch[pitchProp] = value;
        }
      }
    }
    
    part.measure = measures;
    return this.build(parsed);
  }

  static async updateTimeSignature(musicxmlString, beats, beatType) {
    const parsed = await this.parse(musicxmlString);
    const part = parsed['score-partwise'].part;
    let measures = Array.isArray(part.measure) ? part.measure : [part.measure];
    
    if (measures[0]) {
      if (!measures[0].attributes) {
        measures[0].attributes = {};
      }
      measures[0].attributes.time = {
        beats: beats,
        'beat-type': beatType
      };
    }
    
    part.measure = measures;
    return this.build(parsed);
  }

  static async updateKeySignature(musicxmlString, fifths) {
    const parsed = await this.parse(musicxmlString);
    const part = parsed['score-partwise'].part;
    let measures = Array.isArray(part.measure) ? part.measure : [part.measure];
    
    if (measures[0]) {
      if (!measures[0].attributes) {
        measures[0].attributes = {};
      }
      measures[0].attributes.key = { fifths };
    }
    
    part.measure = measures;
    return this.build(parsed);
  }
}

module.exports = MusicXMLUtils;
