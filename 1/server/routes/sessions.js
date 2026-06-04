const express = require('express');
const Session = require('../models/Session');
const MidiEvent = require('../models/MidiEvent');
const Comment = require('../models/Comment');

function sessionRoutes(pool) {
  const router = express.Router();
  
  router.post('/', async (req, res) => {
    try {
      const { scoreId, teacherId } = req.body;
      
      if (!scoreId || !teacherId) {
        return res.status(400).json({ error: 'scoreId and teacherId are required' });
      }
      
      const session = await Session.create(scoreId, teacherId);
      res.json(session);
    } catch (err) {
      console.error('Error creating session:', err);
      res.status(500).json({ error: 'Failed to create session' });
    }
  });
  
  router.get('/invite/:inviteCode', async (req, res) => {
    try {
      const session = await Session.findByInviteCode(req.params.inviteCode);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or inactive' });
      }
      res.json(session);
    } catch (err) {
      console.error('Error getting session by invite code:', err);
      res.status(500).json({ error: 'Failed to get session' });
    }
  });
  
  router.get('/:id', async (req, res) => {
    try {
      const session = await Session.findById(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(session);
    } catch (err) {
      console.error('Error getting session:', err);
      res.status(500).json({ error: 'Failed to get session' });
    }
  });
  
  router.get('/teacher/:teacherId/active', async (req, res) => {
    try {
      const sessions = await Session.findActiveByTeacher(req.params.teacherId);
      res.json(sessions);
    } catch (err) {
      console.error('Error getting teacher sessions:', err);
      res.status(500).json({ error: 'Failed to get teacher sessions' });
    }
  });
  
  router.get('/:id/participants', async (req, res) => {
    try {
      const participants = await Session.getParticipants(req.params.id);
      res.json(participants);
    } catch (err) {
      console.error('Error getting session participants:', err);
      res.status(500).json({ error: 'Failed to get participants' });
    }
  });
  
  router.post('/:id/participants', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }
      
      const success = await Session.addParticipant(req.params.id, userId);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Failed to add participant' });
      }
    } catch (err) {
      console.error('Error adding participant:', err);
      res.status(500).json({ error: 'Failed to add participant' });
    }
  });
  
  router.put('/:id/end', async (req, res) => {
    try {
      const session = await Session.endSession(req.params.id);
      res.json(session);
    } catch (err) {
      console.error('Error ending session:', err);
      res.status(500).json({ error: 'Failed to end session' });
    }
  });
  
  router.get('/:id/midi-events', async (req, res) => {
    try {
      const { startTime, endTime } = req.query;
      const events = await MidiEvent.getBySession(
        req.params.id,
        startTime ? parseInt(startTime) : null,
        endTime ? parseInt(endTime) : null
      );
      res.json(events);
    } catch (err) {
      console.error('Error getting MIDI events:', err);
      res.status(500).json({ error: 'Failed to get MIDI events' });
    }
  });

  router.get('/teacher/:teacherId/all', async (req, res) => {
    try {
      const sessions = await Session.findAllByTeacher(req.params.teacherId);
      res.json(sessions);
    } catch (err) {
      console.error('Error getting all teacher sessions:', err);
      res.status(500).json({ error: 'Failed to get teacher sessions' });
    }
  });

  router.get('/:id/stats', async (req, res) => {
    try {
      const stats = await Session.getSessionStats(req.params.id);
      res.json(stats);
    } catch (err) {
      console.error('Error getting session stats:', err);
      res.status(500).json({ error: 'Failed to get session stats' });
    }
  });

  router.get('/:id/comments', async (req, res) => {
    try {
      const comments = await Comment.getBySession(req.params.id);
      res.json(comments);
    } catch (err) {
      console.error('Error getting comments:', err);
      res.status(500).json({ error: 'Failed to get comments' });
    }
  });

  router.post('/:id/comments', async (req, res) => {
    try {
      const { userId, content, timestamp } = req.body;
      if (!userId || !content) {
        return res.status(400).json({ error: 'userId and content are required' });
      }
      
      const comment = await Comment.create(
        req.params.id,
        userId,
        content,
        timestamp ? parseInt(timestamp) : null
      );
      res.json(comment);
    } catch (err) {
      console.error('Error creating comment:', err);
      res.status(500).json({ error: 'Failed to create comment' });
    }
  });

  router.delete('/:id/comments/:commentId', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }
      
      const comment = await Comment.delete(req.params.commentId, userId);
      if (!comment) {
        return res.status(404).json({ error: 'Comment not found or permission denied' });
      }
      res.json(comment);
    } catch (err) {
      console.error('Error deleting comment:', err);
      res.status(500).json({ error: 'Failed to delete comment' });
    }
  });
  
  return router;
}

module.exports = sessionRoutes;
