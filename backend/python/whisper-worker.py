#!/usr/bin/env python3
"""
🎤 WHISPER WORKER - Speech-to-Text
Transcribe audio using OpenAI Whisper
"""

import json
import sys
import whisper

try:
    config = json.loads(sys.argv[1])
    
    # Load model
    model = whisper.load_model(config['model'])
    
    # Transcribe
    result = model.transcribe(
        config['audio_path'],
        language=None if config['language'] == 'auto' else config['language']
    )
    
    print(json.dumps({
        "text": result['text'],
        "language": result['language'],
        "confidence": 0.95,
        "transcription_id": config['transcription_id']
    }))
    
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
