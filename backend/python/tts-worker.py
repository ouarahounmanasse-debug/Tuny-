#!/usr/bin/env python3
"""
🎙️ TTS WORKER - Text-to-Speech
Synthesize speech using Coqui TTS or other engines
"""

import json
import sys
from TTS.api import TTS
import torch

try:
    config = json.loads(sys.argv[1])
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    # Initialize TTS
    tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC", device=device, gpu=True)
    
    # Generate speech
    tts.tts_to_file(
        text=config['text'],
        file_path=config['output_path'],
        speaker_wav=None
    )
    
    # Get duration (approximate)
    duration = len(config['text']) / 150  # ~150 chars per second
    
    print(json.dumps({
        "audio_id": config['audio_id'],
        "duration": duration,
        "status": "success"
    }))
    
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
