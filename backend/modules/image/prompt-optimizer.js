/**
 * Prompt Optimizer
 * Utilise Ollama (LLM local) pour raffiner et améliorer les prompts
 * 
 * @author Gaïus Ouarahoun
 * @version 1.0.0
 */

const fetch = require('node-fetch');
const EventEmitter = require('events');

class PromptOptimizer extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
      model: config.model || 'mistral:latest',
      temperature: config.temperature || 0.7,
      topP: config.topP || 0.95,
      timeout: config.timeout || 30000,
      ...config
    };

    this.systemPrompt = `You are an expert image generation prompt engineer. Your job is to transform user prompts into highly detailed, artistic descriptions that will produce stunning images.

Guidelines:
1. Add specific artistic styles (e.g., "oil painting", "digital art", "photograph")
2. Include lighting details (e.g., "golden hour lighting", "dramatic shadows")
3. Add composition hints (e.g., "rule of thirds", "centered composition")
4. Specify quality modifiers (e.g., "masterpiece", "high quality", "4K")
5. Include mood/atmosphere (e.g., "cinematic", "moody", "vibrant")
6. Add texture and material details
7. Keep it concise but descriptive (max 150 words)
8. Avoid contradictions
9. Make it specific and visual

Return ONLY the optimized prompt, nothing else.`;
  }

  /**
   * Optimiser un prompt utilisateur
   */
  async optimize(userPrompt, style = 'general') {
    try {
      this.emit('optimization:started', { prompt: userPrompt });

      const enhancedSystemPrompt = this._getStyleSpecificPrompt(style);
      
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: userPrompt,
          system: enhancedSystemPrompt,
          stream: false,
          options: {
            temperature: this.config.temperature,
            top_p: this.config.topP,
            num_predict: 200
          }
        }),
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusCode}`);
      }

      const data = await response.json();
      const optimizedPrompt = data.response.trim();

      this.emit('optimization:completed', { 
        original: userPrompt,
        optimized: optimizedPrompt
      });

      return {
        original: userPrompt,
        optimized: optimizedPrompt,
        style,
        timestamp: new Date()
      };
    } catch (error) {
      this.emit('optimization:error', { error: error.message });
      throw error;
    }
  }

  /**
   * Créer plusieurs variantes d'un prompt
   */
  async generateVariants(userPrompt, count = 3, style = 'general') {
    const variants = [];

    const variantSystemPrompt = `You are an expert at creating diverse image generation prompts. Generate ${count} different but related image descriptions based on the user's prompt. Each should take a different creative angle or interpretation.

Return ONLY the prompts separated by newlines. Do not number them.`;

    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: userPrompt,
          system: variantSystemPrompt,
          stream: false,
          options: {
            temperature: 0.9,
            top_p: this.config.topP,
            num_predict: 500
          }
        }),
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusCode}`);
      }

      const data = await response.json();
      const prompts = data.response
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .slice(0, count);

      return {
        original: userPrompt,
        variants: prompts,
        count: prompts.length,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error generating variants:', error);
      throw error;
    }
  }

  /**
   * Analyser un prompt pour les améliorations possibles
   */
  async analyze(prompt) {
    const analysisSystemPrompt = `Analyze this image generation prompt and provide feedback on:
1. Clarity (is it clear what image should be generated?)
2. Detail level (is it detailed enough?)
3. Potential issues (contradictions, vague terms)
4. Suggestions for improvement

Format your response as JSON:
{
  "clarity": 1-10,
  "detail": 1-10,
  "issues": ["issue1", "issue2"],
  "suggestions": ["suggestion1", "suggestion2"],
  "overallScore": 1-10
}`;

    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          system: analysisSystemPrompt,
          stream: false,
          options: {
            temperature: 0.3,
            top_p: 0.9,
            num_predict: 300
          }
        }),
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusCode}`);
      }

      const data = await response.json();
      
      try {
        const analysis = JSON.parse(data.response);
        return {
          prompt,
          analysis,
          timestamp: new Date()
        };
      } catch (parseError) {
        // Si pas de JSON, retourner comme texte
        return {
          prompt,
          analysis: { feedback: data.response },
          timestamp: new Date()
        };
      }
    } catch (error) {
      console.error('Error analyzing prompt:', error);
      throw error;
    }
  }

  /**
   * Générer un prompt à partir d'une description simple
   */
  async expandPrompt(simpleDescription) {
    const expandSystemPrompt = `Transform this simple description into a detailed image generation prompt. Be creative and add artistic details, mood, lighting, and composition hints.`;

    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: simpleDescription,
          system: expandSystemPrompt,
          stream: false,
          options: {
            temperature: 0.8,
            top_p: this.config.topP,
            num_predict: 250
          }
        }),
        timeout: this.config.timeout
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusCode}`);
      }

      const data = await response.json();

      return {
        original: simpleDescription,
        expanded: data.response.trim(),
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Error expanding prompt:', error);
      throw error;
    }
  }

  /**
   * Obtenir les styles supportés
   */
  getSupportedStyles() {
    return {
      'realistic': 'Photorealistic images',
      'oil_painting': 'Oil painting style',
      'watercolor': 'Watercolor art',
      'digital_art': 'Digital artwork',
      'anime': 'Anime style',
      'cyberpunk': 'Cyberpunk aesthetic',
      'fantasy': 'Fantasy art',
      'sci_fi': 'Science fiction',
      'steampunk': 'Steampunk style',
      'minimalist': 'Minimalist art',
      'surreal': 'Surrealism',
      'abstract': 'Abstract art'
    };
  }

  /**
   * Générer un prompt spécifique au style
   */
  _getStyleSpecificPrompt(style) {
    const stylePrompts = {
      'realistic': `${this.systemPrompt}\nFocus on photorealistic details and natural lighting.`,
      'oil_painting': `${this.systemPrompt}\nStyle: classical oil painting with visible brushstrokes.`,
      'watercolor': `${this.systemPrompt}\nStyle: watercolor painting with soft washes and delicate details.`,
      'digital_art': `${this.systemPrompt}\nStyle: digital artwork with vibrant colors and clean lines.`,
      'anime': `${this.systemPrompt}\nStyle: anime/manga art with expressive eyes and dynamic poses.`,
      'cyberpunk': `${this.systemPrompt}\nStyle: cyberpunk with neon colors, high tech, dystopian.`,
      'fantasy': `${this.systemPrompt}\nStyle: fantasy art with magical elements and whimsical creatures.`,
      'sci_fi': `${this.systemPrompt}\nStyle: science fiction with futuristic technology and alien worlds.`,
      'steampunk': `${this.systemPrompt}\nStyle: steampunk with brass, gears, and Victorian elements.`,
      'minimalist': `${this.systemPrompt}\nStyle: minimalist with limited colors and simple forms.`,
      'surreal': `${this.systemPrompt}\nStyle: surrealism with dreamlike, impossible scenes.`,
      'abstract': `${this.systemPrompt}\nStyle: abstract art with emphasis on color and form over representation.`
    };

    return stylePrompts[style] || this.systemPrompt;
  }

  /**
   * Vérifier la santé de la connexion Ollama
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/tags`, {
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error('Ollama not responding');
      }

      const data = await response.json();
      return {
        healthy: true,
        models: data.models || [],
        timestamp: new Date()
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

module.exports = PromptOptimizer;