#!/bin/bash
# Quick ElevenLabs TTS — speaks text via Archie voice
# Usage: ./speak.sh "Hello world"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env" 2>/dev/null
VOICE_ID="${ELEVENLABS_VOICE_ID:-kmSVBPu7loj4ayNinwWM}"
API_KEY="${ELEVENLABS_API_KEY}"
TMP="/tmp/el-speak-$$.mp3"

curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128" \
  -H "xi-api-key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"text\":$(echo "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"model_id\":\"eleven_turbo_v2_5\",\"voice_settings\":{\"stability\":0.5,\"similarity_boost\":0.75}}" \
  -o "$TMP" && afplay "$TMP"
rm -f "$TMP"
