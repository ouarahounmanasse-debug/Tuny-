/**
 * Image Processor
 * Post-traitement des images : nettoyage, correction couleur, etc.
 * 
 * @author Gaïus Ouarahoun
 * @version 1.0.0
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');
const crypto = require('crypto');

class ImageProcessor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      pythonPath: config.pythonPath || 'python3',
      processorScript: config.processorScript || path.join(__dirname, '../../python/image-processor.py'),
      rembgScript: config.rembgScript || path.join(__dirname, '../../python/rembg-worker.py'),
      outputDir: config.outputDir || path.join(__dirname, '../../data/image/processed'),
      timeout: config.timeout || 60000,
      ...config
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
   * Supprimer l'arrière-plan avec Rembg
   */
  async removeBackground(imagePath) {
    return new Promise((resolve, reject) => {
      const taskId = crypto.randomUUID();
      const outputPath = path.join(
        this.config.outputDir,
        `${path.basename(imagePath, path.extname(imagePath))}_nobg_${taskId}.png`
      );

      const args = [
        this.config.rembgScript,
        '--input', imagePath,
        '--output', outputPath
      ];

      const worker = spawn(this.config.pythonPath, args, {
        timeout: this.config.timeout
      });

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Background removal failed: ${errorOutput}`));
          return;
        }

        try {
          await fs.access(outputPath);
          resolve({
            taskId,
            originalPath: imagePath,
            processedPath: outputPath,
            process: 'removeBackground',
            timestamp: new Date()
          });
        } catch (error) {
          reject(new Error(`Output file not created: ${error.message}`));
        }
      });
    });
  }

  /**
   * Correction automatique des couleurs
   */
  async autoColorCorrection(imagePath) {
    return this._runProcessor(imagePath, 'color_correction', {
      enhancement: 'auto'
    });
  }

  /**
   * Amélioration du contraste
   */
  async enhanceContrast(imagePath, factor = 1.5) {
    return this._runProcessor(imagePath, 'enhance_contrast', {
      factor
    });
  }

  /**
   * Réduction du bruit
   */
  async denoise(imagePath, strength = 'medium') {
    return this._runProcessor(imagePath, 'denoise', {
      strength
    });
  }

  /**
   * Augmentation de la netteté
   */
  async sharpen(imagePath, kernel = 'unsharp_mask') {
    return this._runProcessor(imagePath, 'sharpen', {
      kernel
    });
  }

  /**
   * Correction gamma
   */
  async gammaCorrection(imagePath, gamma = 1.2) {
    return this._runProcessor(imagePath, 'gamma_correction', {
      gamma
    });
  }

  /**
   * Détection et suppression des artefacts
   */
  async removeArtifacts(imagePath) {
    return this._runProcessor(imagePath, 'remove_artifacts', {});
  }

  /**
   * Analyse de composition
   */
  async analyzeComposition(imagePath) {
    return new Promise((resolve, reject) => {
      const args = [
        this.config.processorScript,
        'analyze',
        '--input', imagePath
      ];

      const worker = spawn(this.config.pythonPath, args, {
        timeout: this.config.timeout
      });

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Analysis failed: ${errorOutput}`));
          return;
        }

        try {
          const analysis = JSON.parse(output);
          resolve({
            imagePath,
            analysis,
            timestamp: new Date()
          });
        } catch (error) {
          reject(new Error(`Failed to parse analysis: ${error.message}`));
        }
      });
    });
  }

  /**
   * Pipeline complet d'amélioration
   */
  async improveQuality(imagePath, options = {}) {
    const results = {
      steps: [],
      originalPath: imagePath,
      finalPath: imagePath
    };

    try {
      // Étape 1: Denoise
      if (options.denoise !== false) {
        const denoised = await this.denoise(imagePath, options.denoiseStrength || 'medium');
        results.steps.push('denoise');
        results.finalPath = denoised.processedPath;
      }

      // Étape 2: Color correction
      if (options.colorCorrection !== false) {
        const corrected = await this.autoColorCorrection(results.finalPath);
        results.steps.push('color_correction');
        results.finalPath = corrected.processedPath;
      }

      // Étape 3: Enhance contrast
      if (options.enhanceContrast !== false) {
        const enhanced = await this.enhanceContrast(results.finalPath, options.contrastFactor || 1.5);
        results.steps.push('enhance_contrast');
        results.finalPath = enhanced.processedPath;
      }

      // Étape 4: Sharpen
      if (options.sharpen !== false) {
        const sharpened = await this.sharpen(results.finalPath);
        results.steps.push('sharpen');
        results.finalPath = sharpened.processedPath;
      }

      // Étape 5: Remove artifacts
      if (options.removeArtifacts !== false) {
        const cleaned = await this.removeArtifacts(results.finalPath);
        results.steps.push('remove_artifacts');
        results.finalPath = cleaned.processedPath;
      }

      results.status = 'completed';
      this.emit('quality:improved', results);
      return results;
    } catch (error) {
      results.status = 'error';
      results.error = error.message;
      this.emit('quality:error', results);
      throw error;
    }
  }

  /**
   * Traitement générique
   */
  async _runProcessor(imagePath, processType, params = {}) {
    return new Promise((resolve, reject) => {
      const taskId = crypto.randomUUID();
      const outputPath = path.join(
        this.config.outputDir,
        `${path.basename(imagePath, path.extname(imagePath))}_${processType}_${taskId}.png`
      );

      const args = [
        this.config.processorScript,
        'process',
        '--input', imagePath,
        '--output', outputPath,
        '--process-type', processType,
        '--params', JSON.stringify(params)
      ];

      const worker = spawn(this.config.pythonPath, args, {
        timeout: this.config.timeout
      });

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Processing failed: ${errorOutput}`));
          return;
        }

        try {
          await fs.access(outputPath);
          resolve({
            taskId,
            originalPath: imagePath,
            processedPath: outputPath,
            process: processType,
            parameters: params,
            timestamp: new Date()
          });
        } catch (error) {
          reject(new Error(`Output file not created: ${error.message}`));
        }
      });
    });
  }

  /**
   * Obtenir les processus disponibles
   */
  getAvailableProcesses() {
    return {
      'removeBackground': 'Remove image background',
      'color_correction': 'Automatic color correction',
      'enhance_contrast': 'Enhance image contrast',
      'denoise': 'Reduce image noise',
      'sharpen': 'Sharpen image details',
      'gamma_correction': 'Correct gamma levels',
      'remove_artifacts': 'Remove generation artifacts',
      'analyze': 'Analyze image composition'
    };
  }
}

module.exports = ImageProcessor;