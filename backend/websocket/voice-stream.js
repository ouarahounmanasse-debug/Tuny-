/**
 * 🎤 WebSocket Voice Streaming
 * Real-time speech-to-text and text-to-speech
 * CHECKPOINT: Voice I/O Phase 1.1 - WebSocket Integration ✅
 */

const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class VoiceStreamManager {
  constructor(io, whisperEngine, ttsEngine) {
    this.io = io;
    this.whisperEngine = whisperEngine;
    this.ttsEngine = ttsEngine;
    this.streams = new Map();

    this.setupSocketHandlers();
    logger.info('✨ Voice Stream Manager initialized');
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.debug('Client connected', { socketId: socket.id });

      // Démarrer stream de transcription
      socket.on('voice:start-transcription', async (data) => {
        const streamId = uuidv4();
        this.streams.set(streamId, {
          type: 'transcription',
          socketId: socket.id,
          chunks: [],
          startTime: Date.now()
        });

        socket.emit('voice:transcription-started', { streamId });
        logger.debug('Transcription stream started', { streamId });
      });

      // Recevoir chunks audio
      socket.on('voice:audio-chunk', async (data) => {
        const { streamId, chunk } = data;
        const stream = this.streams.get(streamId);

        if (stream) {
          stream.chunks.push(Buffer.from(chunk));
          logger.debug('Audio chunk received', { streamId, size: chunk.length });
        }
      });

      // Finaliser la transcription
      socket.on('voice:end-transcription', async (data) => {
        const { streamId } = data;
        const stream = this.streams.get(streamId);

        if (stream && stream.chunks.length > 0) {
          try {
            // Concatener les chunks
            const audioBuffer = Buffer.concat(stream.chunks);

            // Transcrire
            const result = await this.whisperEngine.transcribeStream(audioBuffer);

            socket.emit('voice:transcription-result', {
              streamId,
              text: result.text,
              language: result.language
            });

            logger.info('Transcription completed via WebSocket', {
              streamId,
              textLength: result.text.length
            });
          } catch (err) {
            socket.emit('voice:error', { streamId, error: err.message });
            logger.error('Transcription error', { streamId, error: err.message });
          } finally {
            this.streams.delete(streamId);
          }
        }
      });

      // TTS Streaming
      socket.on('voice:synthesize-stream', async (data) => {
        const { text, voice, language, speed } = data;

        try {
          await this.ttsEngine.synthesizeStreaming(text, (chunk) => {
            socket.emit('voice:audio-chunk-tts', chunk);
          }, { voice, language, speed });

          socket.emit('voice:synthesis-complete');
        } catch (err) {
          socket.emit('voice:error', { error: err.message });
        }
      });

      socket.on('disconnect', () => {
        logger.debug('Client disconnected', { socketId: socket.id });
        // Nettoyer les streams
        this.streams.forEach((stream, id) => {
          if (stream.socketId === socket.id) {
            this.streams.delete(id);
          }
        });
      });
    });
  }

  getStats() {
    return {
      activeStreams: this.streams.size,
      totalStreams: this.streams.size
    };
  }
}

module.exports = VoiceStreamManager;
