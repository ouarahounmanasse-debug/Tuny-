/**
 * 🎤🎙️ Voice Routes - Speech-to-Text & Text-to-Speech
 * CHECKPOINT: Voice I/O Phase 1.1 Complete
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const logger = require('../../utils/logger');

const upload = multer({ dest: './backend/data/audio/uploads' });

module.exports = (whisperEngine, ttsEngine) => {
  /**
   * POST /voice/transcribe - Transcrire audio en texte
   */
  router.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Audio file required' });
      }

      const result = await whisperEngine.transcribeAudio(req.file.path, {
        language: req.body.language
      });

      res.json(result);
    } catch (err) {
      logger.error('Transcription failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /voice/synthesize - Texte en voix
   */
  router.post('/synthesize', async (req, res) => {
    try {
      const { text, voice, language, speed } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'text required' });
      }

      const result = await ttsEngine.synthesize(text, {
        voice,
        language,
        speed
      });

      res.json(result);
    } catch (err) {
      logger.error('TTS failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /voice/clone - Cloner une voix
   */
  router.post('/clone', upload.single('reference'), async (req, res) => {
    try {
      const { text } = req.body;

      if (!req.file || !text) {
        return res.status(400).json({ error: 'reference audio and text required' });
      }

      const result = await ttsEngine.cloneVoice(req.file.path, text);

      res.json(result);
    } catch (err) {
      logger.error('Voice cloning failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /voice/voices - Lister les voix disponibles
   */
  router.get('/voices', async (req, res) => {
    try {
      const voices = await ttsEngine.getAvailableVoices();
      res.json({ voices });
    } catch (err) {
      logger.error('Failed to list voices', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /voice/stats - Statistiques
   */
  router.get('/stats', (req, res) => {
    res.json({
      whisper: whisperEngine.getStats(),
      tts: ttsEngine.getStats()
    });
  });

  return router;
};
