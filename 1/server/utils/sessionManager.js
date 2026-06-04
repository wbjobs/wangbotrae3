class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(sessionId, teacherId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        teacherId,
        teacherWs: null,
        students: new Map(),
        scoreVersion: 1,
        pendingOps: [],
        startTime: null
      });
    }
    return this.sessions.get(sessionId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  setTeacherWebSocket(sessionId, ws) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.teacherWs = ws;
    }
  }

  addStudent(sessionId, userId, ws) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.students.set(userId, { ws, connected: true });
    }
  }

  removeStudent(sessionId, userId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.students.delete(userId);
    }
  }

  broadcastToStudents(sessionId, message, excludeUserId = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const data = JSON.stringify(message);
    for (const [userId, student] of session.students) {
      if (userId !== excludeUserId && student.ws && student.ws.readyState === 1) {
        student.ws.send(data);
      }
    }
  }

  sendToTeacher(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (session && session.teacherWs && session.teacherWs.readyState === 1) {
      session.teacherWs.send(JSON.stringify(message));
    }
  }

  broadcastToAll(sessionId, message, excludeUserId = null) {
    this.sendToTeacher(sessionId, message);
    this.broadcastToStudents(sessionId, message, excludeUserId);
  }

  getParticipants(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    
    const participants = [];
    if (session.teacherId) {
      participants.push({ userId: session.teacherId, role: 'teacher' });
    }
    for (const [userId] of session.students) {
      participants.push({ userId, role: 'student' });
    }
    return participants;
  }

  setStartTime(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.startTime = Date.now();
      return session.startTime;
    }
    return null;
  }

  getStartTime(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.startTime : null;
  }

  removeSession(sessionId) {
    this.sessions.delete(sessionId);
  }
}

module.exports = new SessionManager();
