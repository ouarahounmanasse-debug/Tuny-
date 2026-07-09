/**
 * Upscaler Engine
 * Utilise Real-ESRGAN pour upscaler les images (4x à 8x)
 * 
 * @author Gaïus Ouarahoun
 * @version 1.0.0
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');
const crypto = require('crypto');

class UpscalerEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      pythonPath: config.pythonPath || 'python3',
      workerScript: config.workerScript || path.join(__dirname, '../../python/upscaler-worker.py'),
      outputDir: config.outputDir || path.join(__dirname, '../../data/image/upscaled'),
      maxQueueSize: config.maxQueueSize || 50,
      timeout: config.timeout || 120000, // 2 min
      scale: config.scale || 4, // 2x, 3x, 4x
      useGpu: config.useGpu !== false,
      ...config
    };

    this.queue = [];
    this.processing = false;
    this.supportedModels = ['RealESRGAN_x2', 'RealESRGAN_x3', 'RealESRGAN_x4', 'BSRGAN'];
    this.stats = {
      totalUpscaled: 0,
      totalFailed: 0,
      averageTime: 0,
      timesSaved: []
    };

    this._ensureDirectories();
  }

  async _ensureDirectories() {
    try {
      await fs.mkdir(this.config.outputDir, { recursive: true });
    } catch (error) {
      console.error('Error creating directories:', error);
    }
  }

  /**
   * Upscaler une image
   */
  async upscale(imagePath, scale = this.config.scale, model = 'RealESRGAN_x4') {
    if (![2, 3, 4].includes(scale)) {
      throw new Error('Scale must be 2, 3, or 4');
    }

    return new Promise((resolve, reject) => {
      const task = {
        id: crypto.randomUUID(),
        imagePath,
        scale,
        model,
        resolve,
        reject,
        startTime: Date.now()
      };

      if (this.queue.length >= this.config.maxQueueSize) {
        return reject(new Error('Upscaler queue is full'));
      }

      this.queue.push(task);
      this.emit('task:queued', { taskId: task.id, queueSize: this.queue.length });
      
      if (!this.processing) {
        this._processQueue();
      }
    });
  }

  /**
   * Upscaler en batch
   */
  async batchUpscale(imagePaths, scale = this.config.scale) {
    const results = {
      successful: [],
      failed: [],
      total: imagePaths.length
    };

    for (let i = 0; i < imagePaths.length; i++) {
      try {
        const result = await this.upscale(imagePaths[i], scale);
        results.successful.push(result);
      } catch (error) {
        results.failed.push({
          imagePath: imagePaths[i],
          error: error.message
        });
      }
    }

    return results;
  }

  async _processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const task = this.queue.shift();

    try {
      this.emit('upscale:started', { taskId: task.id, scale: task.scale });

      const result = await this._runWorker(task);
      
      const duration = Date.now() - task.startTime;
      this.stats.totalUpscaled++;
      this.stats.timesSaved.push(duration);
      this.stats.averageTime = this.stats.timesSaved.reduce((a, b) => a + b, 0) / this.stats.timesSaved.length;

      this.emit('upscale:completed', {
        taskId: task.id,
        duration,
        upscaledPath: result.path
      });

      task.resolve(result);
    } catch (error) {
      this.stats.totalFailed++;
      this.emit('upscale:error', { taskId: task.id, error: error.message });
      task.reject(error);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        setImmediate(() => this._processQueue());
      }
    }
  }

  async _runWorker(task) {
    return new Promise((resolve, reject) => {
      const args = [
        this.config.workerScript,
        '--input-image', task.imagePath,
        '--output-dir', this.config.outputDir,
        '--scale', task.scale,
        '--model', task.model
      ];

      if (this.config.useGpu) {
        args.push('--use-gpu');
      }

      const worker = spawn(this.config.pythonPath, args, {
        timeout: this.config.timeout
      });

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
        this.emit('upscale:progress', {
          taskId: task.id,
          message: data.toString().trim()
        });
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('error', (error) => {
        reject(new Error(`Worker error: ${error.message}`));
      });

      worker.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          
          // Vérifier que le fichier existe
          await fs.access(result.path);
          
          resolve({
            id: task.id,
            originalPath: task.imagePath,
            upscaledPath: result.path,
            filename: path.basename(result.path),
            scale: task.scale,
            model: task.model,
            timestamp: new Date(),
            originalDimensions: result.original_dimensions,
            upscaledDimensions: result.upscaled_dimensions
          });
        } catch (error) {
          reject(new Error(`Failed to parse worker output: ${error.message}`));
        }
      });
    });
  }

  /**
   * Obtenir les modèles supportés
   */
  getSupportedModels() {
    return {
      'RealESRGAN_x2': { scale: 2, description: 'Real-ESRGAN 2x upscaler - Fast, good for light enhancement' },
      'RealESRGAN_x3': { scale: 3, description: 'Real-ESRGAN 3x upscaler - Balance between quality and speed' },
      'RealESRGAN_x4': { scale: 4, description: 'Real-ESRGAN 4x upscaler - Best quality, moderate speed' },
      'BSRGAN': { scale: 4, description: 'BSRGAN - Specialized for complex textures and degraded images' }
    };
  }

  /**
   * Obtenir les statistiques
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      isProcessing: this.processing,
      supportedModels: this.supportedModels
    };
  }

  /**
   * Vider la queue
   */
  clearQueue() {
    const cleared = this.queue.length;
    this.queue.forEach(task => {
      task.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    return cleared;
  }
}

module.exports = UpscalerEngine;