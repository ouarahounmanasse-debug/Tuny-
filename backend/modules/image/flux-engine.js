/**
 * FLUX.1 Engine (Black Forest Labs)
 * Alternative premium pour qualité extrême
 * 
 * @author Gaïus Ouarahoun
 * @version 1.0.0
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');
const crypto = require('crypto');

class FLUXEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      pythonPath: config.pythonPath || 'python3',
      workerScript: config.workerScript || path.join(__dirname, '../../python/flux-worker.py'),
      modelPath: config.modelPath || path.join(__dirname, '../../data/models/flux-1'),
      outputDir: config.outputDir || path.join(__dirname, '../../data/image/generated'),
      maxQueueSize: config.maxQueueSize || 50,
      timeout: config.timeout || 600000, // 10 min (FLUX est plus lent)
      useGpu: config.useGpu !== false,
      variant: config.variant || 'dev', // 'dev' ou 'schnell'
      ...config
    };

    this.queue = [];
    this.processing = false;
    this.stats = {
      totalGenerated: 0,
      totalFailed: 0,
      averageTime: 0,
      timesSaved: []
    };

    this._ensureDirectories();
  }

  async _ensureDirectories() {
    try {
      await fs.mkdir(this.config.outputDir, { recursive: true });
      await fs.mkdir(this.config.modelPath, { recursive: true });
    } catch (error) {
      console.error('Error creating directories:', error);
    }
  }

  /**
   * Générer une image de qualité premium avec FLUX.1
   */
  async generatePremium(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const task = {
        id: crypto.randomUUID(),
        prompt,
        options: {
          width: options.width || 1024,
          height: options.height || 1024,
          steps: options.steps || 30,
          guidance: options.guidance || 3.5,
          seed: options.seed || Math.floor(Math.random() * 1000000),
          num_images: options.num_images || 1,
          variant: options.variant || this.config.variant,
          ...options
        },
        resolve,
        reject,
        startTime: Date.now()
      };

      if (this.queue.length >= this.config.maxQueueSize) {
        return reject(new Error('FLUX Queue is full'));
      }

      this.queue.push(task);
      this.emit('task:queued', { taskId: task.id, queueSize: this.queue.length });
      
      if (!this.processing) {
        this._processQueue();
      }
    });
  }

  async _processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const task = this.queue.shift();

    try {
      this.emit('generation:started', { taskId: task.id, variant: task.options.variant });

      const result = await this._runWorker(task);
      
      const duration = Date.now() - task.startTime;
      this.stats.totalGenerated++;
      this.stats.timesSaved.push(duration);
      this.stats.averageTime = this.stats.timesSaved.reduce((a, b) => a + b, 0) / this.stats.timesSaved.length;

      this.emit('generation:completed', {
        taskId: task.id,
        duration,
        imagePaths: result.paths
      });

      task.resolve(result);
    } catch (error) {
      this.stats.totalFailed++;
      this.emit('generation:error', { taskId: task.id, error: error.message });
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
        '--prompt', task.prompt,
        '--output-dir', this.config.outputDir,
        '--model-path', this.config.modelPath,
        '--width', task.options.width,
        '--height', task.options.height,
        '--steps', task.options.steps,
        '--guidance', task.options.guidance,
        '--seed', task.options.seed,
        '--num-images', task.options.num_images,
        '--variant', task.options.variant
      ];

      if (this.config.useGpu) {
        args.push('--use-gpu');
      }

      const worker = spawn(this.config.pythonPath, args, {
        timeout: this.config.timeout,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
        this.emit('generation:progress', {
          taskId: task.id,
          message: data.toString().trim()
        });
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
        console.warn('FLUX Worker stderr:', data.toString());
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
          resolve({
            id: task.id,
            paths: result.paths,
            filenames: result.paths.map(p => path.basename(p)),
            prompt: task.prompt,
            options: task.options,
            timestamp: new Date(),
            quality: 'premium',
            variant: task.options.variant
          });
        } catch (error) {
          reject(new Error(`Failed to parse worker output: ${error.message}`));
        }
      });
    });
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      isProcessing: this.processing
    };
  }

  clearQueue() {
    const cleared = this.queue.length;
    this.queue.forEach(task => {
      task.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    return cleared;
  }
}

module.exports = FLUXEngine;