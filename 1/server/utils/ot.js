class OperationalTransform {
  static createInsertOp(measureIndex, noteIndex, note) {
    return {
      type: 'insert',
      measureIndex,
      noteIndex,
      note,
      timestamp: Date.now()
    };
  }

  static createDeleteOp(measureIndex, noteIndex) {
    return {
      type: 'delete',
      measureIndex,
      noteIndex,
      timestamp: Date.now()
    };
  }

  static createUpdateOp(measureIndex, noteIndex, property, value) {
    return {
      type: 'update',
      measureIndex,
      noteIndex,
      property,
      value,
      timestamp: Date.now()
    };
  }

  static createMetadataOp(property, value) {
    return {
      type: 'metadata',
      property,
      value,
      timestamp: Date.now()
    };
  }

  static transform(op1, op2, priority = 'first') {
    if (op1.type === 'metadata' || op2.type === 'metadata') {
      return this.transformMetadata(op1, op2, priority);
    }

    if (op1.measureIndex !== op2.measureIndex) {
      return [op1, op2];
    }

    switch (op1.type) {
      case 'insert':
        return this.transformInsert(op1, op2);
      case 'delete':
        return this.transformDelete(op1, op2);
      case 'update':
        return this.transformUpdate(op1, op2, priority);
      default:
        return [op1, op2];
    }
  }

  static transformMetadata(op1, op2, priority) {
    if (op1.type === 'metadata' && op2.type === 'metadata') {
      if (op1.property === op2.property) {
        if (priority === 'first') {
          return [op1, null];
        } else {
          return [null, op2];
        }
      }
    }
    return [op1, op2];
  }

  static transformInsert(insertOp, otherOp) {
    if (otherOp.type === 'insert') {
      if (insertOp.noteIndex <= otherOp.noteIndex) {
        return [insertOp, { ...otherOp, noteIndex: otherOp.noteIndex + 1 }];
      } else {
        return [{ ...insertOp, noteIndex: insertOp.noteIndex + 1 }, otherOp];
      }
    }
    
    if (otherOp.type === 'delete') {
      if (insertOp.noteIndex <= otherOp.noteIndex) {
        return [insertOp, { ...otherOp, noteIndex: otherOp.noteIndex + 1 }];
      } else {
        return [{ ...insertOp, noteIndex: insertOp.noteIndex - 1 }, otherOp];
      }
    }
    
    if (otherOp.type === 'update') {
      if (insertOp.noteIndex <= otherOp.noteIndex) {
        return [insertOp, { ...otherOp, noteIndex: otherOp.noteIndex + 1 }];
      } else {
        return [insertOp, otherOp];
      }
    }
    
    return [insertOp, otherOp];
  }

  static transformDelete(deleteOp, otherOp) {
    if (otherOp.type === 'insert') {
      if (deleteOp.noteIndex < otherOp.noteIndex) {
        return [deleteOp, { ...otherOp, noteIndex: otherOp.noteIndex - 1 }];
      } else {
        return [deleteOp, otherOp];
      }
    }
    
    if (otherOp.type === 'delete') {
      if (deleteOp.noteIndex === otherOp.noteIndex) {
        return [deleteOp, null];
      }
      if (deleteOp.noteIndex < otherOp.noteIndex) {
        return [deleteOp, { ...otherOp, noteIndex: otherOp.noteIndex - 1 }];
      } else {
        return [{ ...deleteOp, noteIndex: deleteOp.noteIndex - 1 }, otherOp];
      }
    }
    
    if (otherOp.type === 'update') {
      if (deleteOp.noteIndex === otherOp.noteIndex) {
        return [deleteOp, null];
      }
      if (deleteOp.noteIndex < otherOp.noteIndex) {
        return [deleteOp, { ...otherOp, noteIndex: otherOp.noteIndex - 1 }];
      } else {
        return [deleteOp, otherOp];
      }
    }
    
    return [deleteOp, otherOp];
  }

  static transformUpdate(updateOp, otherOp, priority) {
    if (otherOp.type === 'insert') {
      if (updateOp.noteIndex >= otherOp.noteIndex) {
        return [{ ...updateOp, noteIndex: updateOp.noteIndex + 1 }, otherOp];
      }
      return [updateOp, otherOp];
    }
    
    if (otherOp.type === 'delete') {
      if (updateOp.noteIndex === otherOp.noteIndex) {
        return [null, otherOp];
      }
      if (updateOp.noteIndex > otherOp.noteIndex) {
        return [{ ...updateOp, noteIndex: updateOp.noteIndex - 1 }, otherOp];
      }
      return [updateOp, otherOp];
    }
    
    if (otherOp.type === 'update') {
      if (updateOp.noteIndex === otherOp.noteIndex && updateOp.property === otherOp.property) {
        if (priority === 'first') {
          return [updateOp, null];
        } else {
          return [null, otherOp];
        }
      }
      return [updateOp, otherOp];
    }
    
    return [updateOp, otherOp];
  }

  static applyOp(scoreData, op) {
    if (!op) return scoreData;
    
    const newData = JSON.parse(JSON.stringify(scoreData));
    
    switch (op.type) {
      case 'insert':
        if (!newData.measures[op.measureIndex]) {
          newData.measures[op.measureIndex] = { notes: [] };
        }
        newData.measures[op.measureIndex].notes.splice(op.noteIndex, 0, op.note);
        break;
        
      case 'delete':
        if (newData.measures[op.measureIndex] && 
            newData.measures[op.measureIndex].notes[op.noteIndex]) {
          newData.measures[op.measureIndex].notes.splice(op.noteIndex, 1);
        }
        break;
        
      case 'update':
        if (newData.measures[op.measureIndex] && 
            newData.measures[op.measureIndex].notes[op.noteIndex]) {
          newData.measures[op.measureIndex].notes[op.noteIndex][op.property] = op.value;
        }
        break;
        
      case 'metadata':
        newData[op.property] = op.value;
        break;
    }
    
    return newData;
  }

  static composeOps(ops) {
    return ops.reduce((result, op) => {
      if (!op) return result;
      return [...result, op];
    }, []);
  }

  static transformOperations(serverOps, clientOp) {
    let transformedClientOp = clientOp;
    
    for (const serverOp of serverOps) {
      const [, newClientOp] = this.transform(serverOp, transformedClientOp, 'first');
      transformedClientOp = newClientOp;
      if (!transformedClientOp) break;
    }
    
    return transformedClientOp;
  }
}

module.exports = OperationalTransform;
