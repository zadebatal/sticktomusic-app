#!/bin/bash
# TTS Hook for Claude Code — called on Stop event
# Reads Claude's response from stdin, speaks conversational replies via OpenAI TTS
# Run: chmod +x voice-bridge/tts-hook.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_SCRIPT="$SCRIPT_DIR/tts-hook.js"

# Run the Node script with stdin piped through
exec node "$NODE_SCRIPT"
