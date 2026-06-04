const express = require('express');
const Score = require('../models/Score');
const MusicXMLUtils = require('../utils/musicxml');

function scoreRoutes(pool) {
  const router = express.Router();
  
  router.post('/', async (req, res) => {
    try {
      const { title, musicxml, userId } = req.body;
      
      if (!title || !userId) {
        return res.status(400).json({ error: 'Title and userId are required' });
      }
      
      let xml = musicxml;
      if (!xml) {
        xml = MusicXMLUtils.createEmpty(title);
      }
      
      const score = await Score.create(title, xml, userId);
      res.json(score);
    } catch (err) {
      console.error('Error creating score:', err);
      res.status(500).json({ error: 'Failed to create score' });
    }
  });
  
  router.get('/:id', async (req, res) => {
    try {
      const score = await Score.findById(req.params.id);
      if (!score) {
        return res.status(404).json({ error: 'Score not found' });
      }
      res.json(score);
    } catch (err) {
      console.error('Error getting score:', err);
      res.status(500).json({ error: 'Failed to get score' });
    }
  });
  
  router.get('/user/:userId', async (req, res) => {
    try {
      const scores = await Score.findByUserId(req.params.userId);
      res.json(scores);
    } catch (err) {
      console.error('Error getting user scores:', err);
      res.status(500).json({ error: 'Failed to get user scores' });
    }
  });
  
  router.put('/:id', async (req, res) => {
    try {
      const { musicxml, userId, operation } = req.body;
      
      if (!musicxml || !userId) {
        return res.status(400).json({ error: 'MusicXML and userId are required' });
      }
      
      const score = await Score.update(req.params.id, musicxml, userId, operation);
      res.json(score);
    } catch (err) {
      console.error('Error updating score:', err);
      res.status(500).json({ error: 'Failed to update score' });
    }
  });
  
  router.get('/:id/versions', async (req, res) => {
    try {
      const versions = await Score.getVersions(req.params.id);
      res.json(versions);
    } catch (err) {
      console.error('Error getting score versions:', err);
      res.status(500).json({ error: 'Failed to get score versions' });
    }
  });
  
  router.post('/parse', async (req, res) => {
    try {
      const { musicxml } = req.body;
      if (!musicxml) {
        return res.status(400).json({ error: 'MusicXML is required' });
      }
      
      const measures = await MusicXMLUtils.getMeasures(musicxml);
      res.json({ measures });
    } catch (err) {
      console.error('Error parsing MusicXML:', err);
      res.status(500).json({ error: 'Failed to parse MusicXML' });
    }
  });
  
  return router;
}

module.exports = scoreRoutes;
