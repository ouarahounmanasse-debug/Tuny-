/**
 * ControlNet & IP-Adapter Manager
 * Gère les contrôles avancés : pose, depth, canny, style transfer
 * 
 * @author Gaïus Ouarahoun
 * @version 1.0.0
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const EventEmitter = require('events');

class ControlNetManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      pythonPath: config.pythonPath || 'python3',
      workerScript: config.workerScript || path.join(__dirname, '../../python/controlnet-worker.py'),
      outputDir: config.outputDir || path.join(__dirname, '../../data/image/controlnet'),
      timeout: config.timeout || 300000,
      ...config
    };

    this.supportedControlTypes = [
      'canny',           // Edge detection
      'depth',           // Depth maps
      'pose',            // Human pose
      'normalbae',       // Normal maps
      'mlsd',            // Line extraction
      'scribble',        // Hand-drawn lines
      'softedge',        // Soft edges
      'lineart',         // Clean line art
      'anime_lineart',   // Anime style lines
      'zoe',             // Zero-shot object edges
      'mediapipe_face'   // Face landmarks
    ];

    this.processing = {};
  }

  /**
   * Générer un control map (ex: depth map, pose skeleton)
   */
  async generateControlMap(inputImage, controlType) {
    if (!this.supportedControlTypes.includes(controlType)) {
      throw new Error(`Unsupported control type: ${controlType}`);
    }

    return new Promise((resolve, reject) => {
      const taskId = crypto.randomUUID();

      const args = [
        this.config.workerScript,
        '--input-image', inputImage,
        '--control-type', controlType,
        '--output-dir', this.config.outputDir,
        '--task-id', taskId
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
          reject(new Error(`ControlNet worker failed: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve({
            taskId,
            controlMapPath: result.control_map_path,
            controlType,
            processedAt: new Date()
          });
        } catch (error) {
          reject(new Error(`Failed to parse ControlNet output: ${error.message}`));
        }
      });
    });
  }

  /**
   * Générer image avec ControlNet
   */
  async generateWithControl(prompt, controlMapPath, controlType, options = {}) {
    return new Promise((resolve, reject) => {
      const taskId = crypto.randomUUID();

      const args = [
        this.config.workerScript,
        'generate',
        '--prompt', prompt,
        '--control-map', controlMapPath,
        '--control-type', controlType,
        '--output-dir', this.config.outputDir,
        '--task-id', taskId,
        '--strength', options.strength || 1.0,
        '--guidance', options.guidance || 7.5,
        '--steps', options.steps || 20
      ];

      const worker = spawn(this.config.pythonPath, args, {
        timeout: this.config.timeout
      });

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
        this.emit('progress', { taskId, message: data.toString().trim() });
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`Generation failed: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve({
            taskId,
            imagePath: result.image_path,
            prompt,
            controlType,
            timestamp: new Date()
          });
        } catch (error) {
          reject(new Error(`Failed to parse output: ${error.message}`));
        }
      });
    });
  }

  /**
   * Style transfer avec IP-Adapter
   */
  async styleTransfer(baseImagePath, styleReferenceImagePath, strength = 0.5) {
    return new Promise((resolve, reject) => {
      const taskId = crypto.randomUUID();

      const args = [
        this.config.workerScript,
        'style-transfer',
        '--base-image', baseImagePath,
        '--style-image', styleReferenceImagePath,
        '--strength', strength,
        '--output-dir', this.config.outputDir,
        '--task-id', taskId
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
          reject(new Error(`Style transfer failed: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve({
            taskId,
            styledImagePath: result.styled_image_path,
            strength,
            timestamp: new Date()
          });
        } catch (error) {
          reject(new Error(`Failed to parse output: ${error.message}`));
        }
      });
    });
  }

  /**
   * Pose-guided generation (Human pose control)
   */
  async poseGuidedGeneration(prompt, poseImagePath, options = {}) {
    const poseMapResult = await this.generateControlMap(poseImagePath, 'pose');
    
    return this.generateWithControl(
      prompt,
      poseMapResult.controlMapPath,
      'pose',
      options
    );
  }

  /**
   * Depth-guided generation
   */
  async depthGuidedGeneration(prompt, depthImagePath, options = {}) {
    const depthMapResult = await this.generateControlMap(depthImagePath, 'depth');
    
    return this.generateWithControl(
      prompt,
      depthMapResult.controlMapPath,
      'depth',
      options
    );
  }

  /**
   * Scribble-to-image (Dessiner et générer)
   */
  async scribbleToImage(prompt, scribbleImagePath, options = {}) {
    const scribbleMapResult = await this.generateControlMap(scribbleImagePath, 'scribble');
    
    return this.generateWithControl(
      prompt,
      scribbleMapResult.controlMapPath,
      'scribble',
      {
        strength: 0.8,
        ...options
      }
    );
  }

  /**
   * Lister les types de contrôle supportés
   */
  getControlTypes() {
    return this.supportedControlTypes.map(type => ({
      name: type,
      description: this._getControlTypeDescription(type)
    }));
  }

  _getControlTypeDescription(type) {
    const descriptions = {
      'canny': 'Edge detection - Perfect for line art and structure',
      'depth': 'Depth maps - Maintain spatial relationships',
      'pose': 'Human pose - Control body position and skeleton',
      'normalbae': 'Normal maps - 3D surface information',
      'mlsd': 'Line extraction - Clean architectural lines',
      'scribble': 'Hand-drawn lines - Freehand sketch to image',
      'softedge': 'Soft edges - Smooth boundary guidance',
      'lineart': 'Clean line art - Precise outlines',
      'anime_lineart': 'Anime style lines - Anime-specific artistry',
      'zoe': 'Zero-shot object edges - Automatic edge detection',
      'mediapipe_face': 'Face landmarks - Precise facial control'
    };
    return descriptions[type] || 'Control type';
  }
}

module.exports = ControlNetManager;