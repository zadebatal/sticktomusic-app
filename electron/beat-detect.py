#!/usr/bin/env python3
"""
Beat detection via madmom (RNN + DBN).
Called from Electron main process via child_process.spawn.

Usage: python3 beat-detect.py <audio_file_path> [--start <seconds>] [--end <seconds>]

Output: JSON to stdout:
  { "beats": [0.07, 0.46, 0.87, ...], "bpm": 146 }
"""
import sys
import json
import warnings
warnings.filterwarnings('ignore')

import madmom
import numpy as np


def detect_beats(audio_path, start=None, end=None):
    # Run RNN beat processor (neural network)
    proc = madmom.features.beats.RNNBeatProcessor()(audio_path)

    # Apply trim if specified
    fps = 100  # madmom default: 100 frames per second
    if start is not None:
        start_frame = int(start * fps)
        proc = proc[start_frame:]
    if end is not None and start is not None:
        duration_frames = int((end - start) * fps)
        proc = proc[:duration_frames]
    elif end is not None:
        end_frame = int(end * fps)
        proc = proc[:end_frame]

    # DBN beat tracking (dynamic Bayesian network — finds optimal beat positions)
    beats = madmom.features.beats.DBNBeatTrackingProcessor(fps=fps)(proc)

    # Shift beats to local time if trimmed
    if start is not None:
        # beats are already relative to the trimmed section
        pass

    beats = [round(float(b), 3) for b in beats]

    # Estimate BPM from median interval
    bpm = 120
    if len(beats) >= 3:
        intervals = [beats[i+1] - beats[i] for i in range(len(beats)-1)]
        intervals.sort()
        median = intervals[len(intervals)//2]
        if median > 0:
            bpm = round(60 / median)
            while bpm < 60:
                bpm *= 2
            while bpm > 200:
                bpm //= 2

    return {"beats": beats, "bpm": bpm}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: beat-detect.py <audio_file>"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    start = None
    end = None

    # Parse optional --start and --end args
    for i, arg in enumerate(sys.argv):
        if arg == "--start" and i + 1 < len(sys.argv):
            start = float(sys.argv[i + 1])
        if arg == "--end" and i + 1 < len(sys.argv):
            end = float(sys.argv[i + 1])

    try:
        result = detect_beats(audio_path, start, end)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
