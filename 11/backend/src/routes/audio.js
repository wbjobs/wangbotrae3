const express = require('express');
const router = express.Router();
const audioController = require('../controllers/audioController');

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /wav|mp3|ogg|m4a|flac|aac|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname || mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('只支持音频文件'));
    }
  }
});

router.post('/upload', upload.single('audio'), audioController.uploadAudio);
router.get('/:id', audioController.getAudioTrack);
router.get('/:id/waveform', audioController.getAudioWaveform);
router.get('/room/:roomId', audioController.listRoomAudioTracks);
router.get('/:id/download', audioController.downloadAudio);
router.delete('/:id', audioController.deleteAudioTrack);

module.exports = router;
