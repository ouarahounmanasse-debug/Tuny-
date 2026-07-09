/**
 * 🎙️ TEXT-TO-SPEECH ENGINE - Voice Synthesis
 * Multiple TTS providers: Coqui TTS, gTTS, Azure, Google
 * 
 * CHECKPOINT: Voice I/O Phase 1.1 - Voice Synthesis ✅
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

class TTSEngine {
  constructor(config = {}) {
    this.config = {
      engine: config.engine || 'coqui', // coqui, gtts, azure, google
      voice: config.voice || 'default',
      language: config.language || 'en',
      speed: config.speed || 1.0,
      outputDir: config.outputDir || './backend/data/audio/tts',
      ...config
    };

    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    this.synthesizedAudio = new Map();
    logger.info('✨ TTS Engine initialized', { engine: this.config.engine });
  }

  /**
   * Synthétiser du texte en voix
   */
  async synthesize(text, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const audioId = uuidv4();
        const outputPath = path.join(this.config.outputDir, `${audioId}.mp3`);

        logger.debug('Starting TTS synthesis', { audioId, textLength: text.length });

        const python = spawn('python', [
          './backend/python/tts-worker.py',
          JSON.stringify({
            text: text,
            engine: this.config.engine,
            voice: options.voice || this.config.voice,
            language: options.language || this.config.language,
            speed: options.speed || this.config.speed,
            output_path: outputPath,
            audio_id: audioId
          })
        ]);

        let stdout = '';
        let stderr = '';

        python.stdout.on('data', (data) => { stdout += data.toString(); });
        python.stderr.on('data', (data) => { stderr += data.toString(); });

        python.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout);
              this.synthesizedAudio.set(audioId, {
                text,
                path: outputPath,
                duration: result.duration,
                timestamp: new Date()
              });

              logger.info('TTS synthesis completed', { audioId });
              resolve({
                id: audioId,
                audioPath: outputPath,
                duration: result.duration,
                format: 'mp3'
              });
            } catch (e) {
              reject(new Error('Invalid TTS output'));
            }
          } else {
            reject(new Error(`TTS error: ${stderr}`));
          }
        });
      } catch (err) {
        logger.error('TTS synthesis failed', { error: err.message });
        reject(err);
      }
    });
  }

  /**
   * Synthétiser avec streaming (pour réponses temps réel)
   */
  async synthesizeStreaming(text, onChunk, options = {}) {
    const python = spawn('python', [
      './backend/python/tts-streaming-worker.py',
      JSON.stringify({
        text,
        engine: this.config.engine,
        chunk_size: options.chunkSize || 1024
      })
    ]);

    python.stdout.on('data', (data) => {
      onChunk(data);
    });

    return new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (code === 0) resolve({ success: true });
        else reject(new Error('Streaming TTS failed'));
      });
    });
  }

  /**
   * Voices disponibles
   */
  async getAvailableVoices() {
    return new Promise((resolve, reject) => {
      const python = spawn('python', [
        './backend/python/list-voices-worker.py',
        this.config.engine
      ]);

      let stdout = '';
      python.stdout.on('data', (data) => { stdout += data.toString(); });

      python.on('close', (code) => {
        if (code === 0) {
          try {
            const voices = JSON.parse(stdout);
            resolve(voices);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error('Failed to list voices'));
        }
      });
    });
  }

  /**
   * Clone de voix (TTS avancé)
   */
  async cloneVoice(referenceAudioPath, text, options = {}) {
    return new Promise((resolve, reject) => {
      const audioId = uuidv4();
      const outputPath = path.join(this.config.outputDir, `clone_${audioId}.mp3`);

      const python = spawn('python', [
        './backend/python/voice-clone-worker.py',
        JSON.stringify({
          reference_audio: referenceAudioPath,
          text: text,
          output_path: outputPath,
          audio_id: audioId
        })
      ]);

      let stdout = '';
      python.stdout.on('data', (data) => { stdout += data.toString(); });

      python.on('close', (code) => {
        if (code === 0) {
          resolve({
            id: audioId,
            audioPath: outputPath,
            cloned: true
          });
        } else {
          reject(new Error('Voice cloning failed'));
        }
      });
    });
  }

  /**
   * Obtenir les stats
   */
  getStats() {
    return {
      totalSynthesized: this.synthesizedAudio.size,
      outputFilesSize: fs.readdirSync(this.config.outputDir).length
    };
  }
}

module.exports = TTSEngine;
