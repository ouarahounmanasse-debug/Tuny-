/**
 * Stable Diffusion 3.5 Engine
 * Orchestre la génération d'images via Stable Diffusion 3.5
 * 
 * @author Gaïus Ouarahoun
 * @version 1.0.0
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');
const crypto = require('crypto');

class SD3Engine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      pythonPath: config.pythonPath || 'python3',
      workerScript: config.workerScript || path.join(__dirname, '../../python/sd3-worker.py'),
      modelPath: config.modelPath || path.join(__dirname, '../../data/models/sd3-medium'),
      outputDir: config.outputDir || path.join(__dirname, '../../data/image/generated'),
      maxQueueSize: config.maxQueueSize || 100,
      timeout: config.timeout || 300000, // 5 min
      useGpu: config.useGpu !== false,
      precision: config.precision || 'fp16', // fp16 for speed, fp32 for quality
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
    this.currentGeneration = null;

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
   * Générer une image à partir d'un prompt
   * @param {string} prompt - Description de l'image
   * @param {object} options - Options de génération
   * @returns {Promise<object>} Métadonnées de l'image générée
   */
  async generate(prompt, options = {}) {
    return new Promise((resolve, reject) => {
      const task = {
        id: crypto.randomUUID(),
        prompt,
        options: {
          width: options.width || 768,
          height: options.height || 768,
          steps: options.steps || 20,
          guidance_scale: options.guidance_scale || 7.5,
          seed: options.seed || Math.floor(Math.random() * 1000000),
          negative_prompt: options.negative_prompt || '',
          scheduler: options.scheduler || 'euler',
          ...options
        },
        resolve,
        reject,
        startTime: Date.now()
      };

      if (this.queue.length >= this.config.maxQueueSize) {
        return reject(new Error('Queue is full'));
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
    this.currentGeneration = task;

    try {
      this.emit('generation:started', { taskId: task.id });

      const result = await this._runWorker(task);
      
      const duration = Date.now() - task.startTime;
      this.stats.totalGenerated++;
      this.stats.timesSaved.push(duration);
      this.stats.averageTime = this.stats.timesSaved.reduce((a, b) => a + b, 0) / this.stats.timesSaved.length;

      this.emit('generation:completed', {
        taskId: task.id,
        duration,
        imagePath: result.path
      });

      task.resolve(result);
    } catch (error) {
      this.stats.totalFailed++;
      this.emit('generation:error', { taskId: task.id, error: error.message });
      task.reject(error);
    } finally {
      this.processing = false;
      this.currentGeneration = null;
      if (this.queue.length > 0) {
        setImmediate(() => this._processQueue());
      }
    }
  }

  /**
   * Exécute le worker Python pour la génération
   */
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
        '--guidance-scale', task.options.guidance_scale,
        '--seed', task.options.seed,
        '--precision', this.config.precision,
        '--scheduler', task.options.scheduler
      ];

      if (task.options.negative_prompt) {
        args.push('--negative-prompt', task.options.negative_prompt);
      }

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
        console.warn('SD3 Worker stderr:', data.toString());
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
            path: result.path,
            filename: path.basename(result.path),
            prompt: task.prompt,
            options: task.options,
            timestamp: new Date(),
            size: result.size,
            dimensions: {
              width: task.options.width,
              height: task.options.height
            }
          });
        } catch (error) {
          reject(new Error(`Failed to parse worker output: ${error.message}`));
        }
      });
    });
  }

  /**
   * Génération batch d'images
   */
  async batchGenerate(prompts, options = {}) {
    const results = {
      successful: [],
      failed: [],
      total: prompts.length
    };

    for (let i = 0; i < prompts.length; i++) {
      try {
        const result = await this.generate(prompts[i], {
          ...options,
          seed: options.seed ? options.seed + i : undefined
        });
        results.successful.push(result);
      } catch (error) {
        results.failed.push({
          prompt: prompts[i],
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Obtenir les statistiques
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      isProcessing: this.processing,
      currentGeneration: this.currentGeneration ? {
        id: this.currentGeneration.id,
        prompt: this.currentGeneration.prompt
      } : null
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

  /**
   * Annuler une génération en cours
   */
  cancel(taskId) {
    if (this.currentGeneration && this.currentGeneration.id === taskId) {
      this.currentGeneration.reject(new Error('Generation cancelled'));
      this.processing = false;
      this._processQueue();
      return true;
    }
    return false;
  }
}

module.exports = SD3Engine;