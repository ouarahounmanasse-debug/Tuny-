/**
 * 🎤 WHISPER ENGINE - Speech-to-Text Transcription
 * OpenAI Whisper integration pour reconnaissance vocale
 * 
 * CHECKPOINT: Voice I/O Phase 1.1 - Speech Recognition ✅
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

class WhisperEngine {
  constructor(config = {}) {
    this.config = {
      model: config.model || 'base', // tiny, base, small, medium, large
      language: config.language || 'auto',
      device: config.device || 'cpu', // cuda for GPU
      audioDir: config.audioDir || './backend/data/audio',
      ...config
    };

    if (!fs.existsSync(this.config.audioDir)) {
      fs.mkdirSync(this.config.audioDir, { recursive: true });
    }

    this.transcriptions = new Map();
    logger.info('✨ Whisper Engine initialized', { model: this.config.model });
  }

  /**
   * Transcrire un fichier audio
   */
  async transcribeAudio(audioPath, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const transcriptionId = uuidv4();
        logger.debug('Starting transcription', { audioPath, transcriptionId });

        const python = spawn('python', [
          './backend/python/whisper-worker.py',
          JSON.stringify({
            audio_path: audioPath,
            model: this.config.model,
            language: options.language || this.config.language,
            device: this.config.device,
            transcription_id: transcriptionId
          })
        ]);

        let stdout = '';
        let stderr = '';

        python.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        python.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        python.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              this.transcriptions.set(transcriptionId, result);
              logger.info('Transcription completed', { transcriptionId });
              resolve({
                id: transcriptionId,
                text: result.text,
                language: result.language,
                confidence: result.confidence || 0.95
              });
            } catch (e) {
              reject(new Error('Invalid transcription output'));
            }
          } else {
            reject(new Error(`Whisper error: ${stderr}`));
          }
        });
      } catch (err) {
        logger.error('Transcription failed', { error: err.message });
        reject(err);
      }
    });
  }

  /**
   * Transcrire depuis WebSocket (stream audio)
   */
  async transcribeStream(audioBuffer, options = {}) {
    const audioId = uuidv4();
    const audioPath = path.join(this.config.audioDir, `${audioId}.wav`);

    // Sauvegarder le buffer
    fs.writeFileSync(audioPath, audioBuffer);

    // Transcrire
    return this.transcribeAudio(audioPath, options);
  }

  /**
   * Transcrire avec détection de langue
   */
  async detectLanguage(audioPath) {
    return new Promise((resolve, reject) => {
      const python = spawn('python', [
        './backend/python/detect-language-worker.py',
        audioPath
      ]);

      let stdout = '';
      python.stdout.on('data', (data) => { stdout += data.toString(); });

      python.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve({
              language: result.language,
              confidence: result.confidence
            });
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error('Language detection failed'));
        }
      });
    });
  }

  /**
   * Transcrire avec timestamps (pour sous-titres)
   */
  async transcribeWithTimestamps(audioPath) {
    return new Promise((resolve, reject) => {
      const python = spawn('python', [
        './backend/python/whisper-timestamps-worker.py',
        JSON.stringify({
          audio_path: audioPath,
          model: this.config.model
        })
      ]);

      let stdout = '';
      python.stdout.on('data', (data) => { stdout += data.toString(); });

      python.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve({
              text: result.text,
              segments: result.segments // [{start: 0, end: 5, text: "..."}]
            });
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error('Timestamped transcription failed'));
        }
      });
    });
  }

  /**
   * Obtenir statistiques
   */
  getStats() {
    return {
      totalTranscriptions: this.transcriptions.size,
      audioFilesStored: fs.readdirSync(this.config.audioDir).length
    };
  }
}

module.exports = WhisperEngine;
