import React, { useState, useRef, useEffect, useCallback } from 'react';
import { trimAudioToFile } from '../../utils/audioTrimmer';

/**
 * AudioClipSelector - Professional dual-playhead audio region selector
 * Like Premiere Pro / Final Cut - drag IN (green) and OUT (orange) points
 *
 * Features:
 * - Draggable IN/OUT playheads
 * - Drag region to move entire selection
 * - Click waveform to position scrub playhead
 * - Keyboard shortcuts: I=IN, O=OUT, Space=play, arrows to scrub
 * - Click time displays to type exact timestamps
 * - Quick presets for common durations
 */
const AudioClipSelector = ({
  audioFile,
  audioUrl,
  audioName, // Original audio name for default clip naming
  onSave,
  onSaveClip, // New: callback to save clip to library
  onCancel,
  initialStart = 0,
  initialEnd = null
}) => {
  // Mobile responsive detection
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [isLoading, setIsLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [inPoint, setInPoint] = useState(initialStart);
  const [outPoint, setOutPoint] = useState(initialEnd || 30);
  const [playheadTime, setPlayheadTime] = useState(initialStart);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformData, setWaveformData] = useState([]);
  const [dragging, setDragging] = useState(null); // 'in' | 'out' | 'region' | null
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartIn, setDragStartIn] = useState(0);
  const [dragStartOut, setDragStartOut] = useState(0);
  const [editingTime, setEditingTime] = useState(null); // 'in' | 'out' | null
  const [editTimeValue, setEditTimeValue] = useState('');
  const [showSaveClipModal, setShowSaveClipModal] = useState(false);
  const [clipName, setClipName] = useState('');
  const [showUseClipPrompt, setShowUseClipPrompt] = useState(false);
  const [savedClipData, setSavedClipData] = useState(null);
  const [showSaveTrimmedPrompt, setShowSaveTrimmedPrompt] = useState(false);
  const [trimmedClipName, setTrimmedClipName] = useState('');
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimProgress, setTrimProgress] = useState('');

  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);

  // Load audio
  useEffect(() => {
    if (!audioUrl) return;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration;
      setDuration(dur);
      const newOut = initialEnd || Math.min(30, dur);
      setOutPoint(newOut);
      setIsLoading(false);
    });

    audio.addEventListener('ended', () => {
      setIsPlaying(false);
    });

    generateWaveform(audioUrl);

    return () => {
      audio.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [audioUrl, initialEnd]);

  // Generate waveform visualization
  const generateWaveform = async (url) => {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const rawData = audioBuffer.getChannelData(0);
      const samples = 300;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];

      for (let i = 0; i < samples; i++) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[i * blockSize + j]);
        }
        filteredData.push(sum / blockSize);
      }

      const maxVal = Math.max(...filteredData);
      const normalizedData = filteredData.map(n => n / maxVal);
      setWaveformData(normalizedData);

      audioContext.close();
    } catch (err) {
      console.error('Waveform generation failed:', err);
      setWaveformData(Array(300).fill(0).map(() => Math.random() * 0.5 + 0.2));
    }
  };

  // Draw waveform on canvas
  useEffect(() => {
    if (!canvasRef.current || waveformData.length === 0 || duration === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Calculate positions
    const inX = (inPoint / duration) * width;
    const outX = (outPoint / duration) * width;
    const playheadX = (playheadTime / duration) * width;

    // Draw dimmed regions (outside selection)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, inX, height);
    ctx.fillRect(outX, 0, width - outX, height);

    // Draw selected region background
    ctx.fillStyle = 'rgba(124, 58, 237, 0.15)';
    ctx.fillRect(inX, 0, outX - inX, height);

    // Draw waveform
    const barWidth = width / waveformData.length;
    const barGap = 1;

    waveformData.forEach((value, index) => {
      const x = index * barWidth;
      const barHeight = value * (height - 30);
      const y = (height - barHeight) / 2;

      const barTime = (index / waveformData.length) * duration;
      const inSelection = barTime >= inPoint && barTime <= outPoint;

      ctx.fillStyle = inSelection ? '#7c3aed' : '#4b5563';
      ctx.fillRect(x + barGap / 2, y, barWidth - barGap, barHeight);
    });

    // Draw time markers
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px monospace';
    for (let t = 0; t <= duration; t += Math.max(5, Math.floor(duration / 10))) {
      const x = (t / duration) * width;
      ctx.fillText(formatTimeShort(t), x + 2, height - 4);
      ctx.fillRect(x, height - 15, 1, 5);
    }

    // Draw scrub playhead (white)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Draw IN marker (green)
    ctx.fillStyle = '#22c55e';
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(inX, 0);
    ctx.lineTo(inX, height);
    ctx.stroke();

    // IN handle (triangle pointing right)
    ctx.beginPath();
    ctx.moveTo(inX, 0);
    ctx.lineTo(inX + 14, 0);
    ctx.lineTo(inX + 14, 20);
    ctx.lineTo(inX, 30);
    ctx.closePath();
    ctx.fill();

    // "I" label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('I', inX + 4, 16);

    // Draw OUT marker (orange)
    ctx.fillStyle = '#f97316';
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(outX, 0);
    ctx.lineTo(outX, height);
    ctx.stroke();

    // OUT handle (triangle pointing left)
    ctx.beginPath();
    ctx.moveTo(outX, 0);
    ctx.lineTo(outX - 14, 0);
    ctx.lineTo(outX - 14, 20);
    ctx.lineTo(outX, 30);
    ctx.closePath();
    ctx.fill();

    // "O" label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('O', outX - 11, 16);

  }, [waveformData, inPoint, outPoint, playheadTime, duration]);

  // Get time from X position
  const getTimeFromX = useCallback((clientX) => {
    if (!containerRef.current || duration === 0) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(duration, (x / rect.width) * duration));
  }, [duration]);

  // Determine what was clicked
  const getClickTarget = useCallback((clientX) => {
    if (!containerRef.current || duration === 0) return 'none';
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const inX = (inPoint / duration) * rect.width;
    const outX = (outPoint / duration) * rect.width;

    // Check if near IN handle (within 15px)
    if (Math.abs(x - inX) < 15) return 'in';
    // Check if near OUT handle
    if (Math.abs(x - outX) < 15) return 'out';
    // Check if inside region
    if (x > inX && x < outX) return 'region';
    return 'none';
  }, [inPoint, outPoint, duration]);

  // Mouse handlers
  const handleMouseDown = useCallback((e) => {
    const target = getClickTarget(e.clientX);
    const time = getTimeFromX(e.clientX);

    if (target === 'in' || target === 'out') {
      setDragging(target);
      e.preventDefault();
    } else if (target === 'region') {
      setDragging('region');
      setDragStartX(e.clientX);
      setDragStartIn(inPoint);
      setDragStartOut(outPoint);
      e.preventDefault();
    } else {
      // Click outside - move scrub playhead
      setPlayheadTime(time);
      if (audioRef.current) {
        audioRef.current.currentTime = time;
      }
    }
  }, [getClickTarget, getTimeFromX, inPoint, outPoint]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      const time = getTimeFromX(e.clientX);

      if (dragging === 'in') {
        setInPoint(Math.max(0, Math.min(time, outPoint - 0.5)));
      } else if (dragging === 'out') {
        setOutPoint(Math.min(duration, Math.max(time, inPoint + 0.5)));
      } else if (dragging === 'region') {
        const deltaX = e.clientX - dragStartX;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const deltaTime = (deltaX / rect.width) * duration;
        const regionDuration = dragStartOut - dragStartIn;

        let newIn = dragStartIn + deltaTime;
        let newOut = dragStartOut + deltaTime;

        // Clamp to bounds
        if (newIn < 0) {
          newIn = 0;
          newOut = regionDuration;
        }
        if (newOut > duration) {
          newOut = duration;
          newIn = duration - regionDuration;
        }

        setInPoint(newIn);
        setOutPoint(newOut);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dragStartX, dragStartIn, dragStartOut, inPoint, outPoint, duration, getTimeFromX]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (editingTime) return; // Don't capture when editing time

      switch (e.key.toLowerCase()) {
        case 'i':
          setInPoint(Math.min(playheadTime, outPoint - 0.5));
          break;
        case 'o':
          setOutPoint(Math.max(playheadTime, inPoint + 0.5));
          break;
        case ' ':
          e.preventDefault();
          togglePlayback();
          break;
        case 'arrowleft':
          e.preventDefault();
          const newTimeL = Math.max(0, playheadTime - (e.shiftKey ? 1 : 0.1));
          setPlayheadTime(newTimeL);
          if (audioRef.current) audioRef.current.currentTime = newTimeL;
          break;
        case 'arrowright':
          e.preventDefault();
          const newTimeR = Math.min(duration, playheadTime + (e.shiftKey ? 1 : 0.1));
          setPlayheadTime(newTimeR);
          if (audioRef.current) audioRef.current.currentTime = newTimeR;
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playheadTime, inPoint, outPoint, duration, editingTime]);

  // Playback
  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      setIsPlaying(false);
    } else {
      audio.currentTime = inPoint;
      setPlayheadTime(inPoint);

      audio.play().then(() => {
        setIsPlaying(true);

        const updateLoop = () => {
          if (!audioRef.current) return;
          const time = audioRef.current.currentTime;
          setPlayheadTime(time);

          if (time >= outPoint) {
            audioRef.current.pause();
            setIsPlaying(false);
            return;
          }

          animationRef.current = requestAnimationFrame(updateLoop);
        };
        animationRef.current = requestAnimationFrame(updateLoop);
      }).catch(err => {
        console.error('Playback failed:', err);
        setIsPlaying(false);
      });
    }
  }, [isPlaying, inPoint, outPoint]);

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const formatTimeShort = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Parse time input
  const parseTimeInput = (str) => {
    const parts = str.split(':');
    if (parts.length === 2) {
      const mins = parseInt(parts[0]) || 0;
      const secs = parseFloat(parts[1]) || 0;
      return mins * 60 + secs;
    }
    return parseFloat(str) || 0;
  };

  // Handle time input
  const handleTimeEdit = (type) => {
    setEditingTime(type);
    setEditTimeValue(formatTime(type === 'in' ? inPoint : outPoint));
  };

  const handleTimeInputConfirm = () => {
    const newTime = parseTimeInput(editTimeValue);
    if (editingTime === 'in') {
      setInPoint(Math.max(0, Math.min(newTime, outPoint - 0.5)));
    } else {
      setOutPoint(Math.min(duration, Math.max(newTime, inPoint + 0.5)));
    }
    setEditingTime(null);
  };

  // Presets
  const applyPreset = (type) => {
    if (type === 'full') {
      setInPoint(0);
      setOutPoint(duration);
    } else {
      const dur = parseFloat(type);
      setOutPoint(Math.min(playheadTime + dur, duration));
      setInPoint(playheadTime);
    }
  };

  const selectedDuration = outPoint - inPoint;

  // Actually trim the audio to a new file and pass to parent
  const handleTrimAndUse = useCallback(async (name) => {
    setIsTrimming(true);
    setTrimProgress('Preparing trim...');
    try {
      // Determine audio source (prefer file, then localUrl/url)
      const source = audioFile || audioUrl;
      if (!source) throw new Error('No audio source available');

      const trimmedFile = await trimAudioToFile(
        source,
        inPoint,
        outPoint,
        name || 'Trimmed Audio',
        (msg) => setTrimProgress(msg)
      );

      console.log('[AudioClipSelector] Trimmed audio:', {
        name: trimmedFile.name,
        size: `${(trimmedFile.size / 1024).toFixed(0)}KB`,
        duration: `${selectedDuration.toFixed(1)}s`
      });

      // Pass the trimmed file to parent — starts at 0, no trim metadata needed
      onSave({
        startTime: 0,
        endTime: selectedDuration,
        duration: selectedDuration,
        trimmedFile: trimmedFile,
        trimmedName: name || trimmedFile.name
      });
    } catch (error) {
      console.error('[AudioClipSelector] Trim failed:', error);
      setTrimProgress('');
      // Fall back to metadata-only approach
      onSave({ startTime: inPoint, endTime: outPoint, duration: selectedDuration });
    } finally {
      setIsTrimming(false);
      setTrimProgress('');
    }
  }, [audioFile, audioUrl, inPoint, outPoint, selectedDuration, onSave]);

  return (
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0 } : {})
    }}>
      <div style={{
        ...styles.modal,
        ...(isMobile ? {
          maxWidth: '100%',
          height: '100vh',
          maxHeight: '100vh',
          borderRadius: 0,
          display: 'flex',
          flexDirection: 'column'
        } : {})
      }}>
        {/* Header */}
        <div style={{
          ...styles.header,
          ...(isMobile ? { padding: '16px' } : {})
        }}>
          <div style={styles.headerLeft}>
            <span style={{
              ...styles.headerIcon,
              ...(isMobile ? { fontSize: '24px' } : {})
            }}>🎵</span>
            <div>
              <h2 style={{
                ...styles.title,
                ...(isMobile ? { fontSize: '16px' } : {})
              }}>Select Audio Region</h2>
              {!isMobile && <p style={styles.subtitle}>Drag the green (IN) and orange (OUT) markers, or press I/O keys</p>}
            </div>
          </div>
          <button style={{
            ...styles.closeButton,
            ...(isMobile ? { width: '44px', height: '44px' } : {})
          }} onClick={onCancel}>
            <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Quick Presets */}
        <div style={{
          ...styles.presets,
          ...(isMobile ? {
            padding: '10px 16px',
            flexWrap: 'wrap',
            gap: '6px'
          } : {})
        }}>
          {!isMobile && <span style={styles.presetLabel}>Quick select from playhead:</span>}
          <button style={{
            ...styles.preset,
            ...(isMobile ? { padding: '10px 16px', fontSize: '14px' } : {})
          }} onClick={() => applyPreset('15')}>15s</button>
          <button style={{
            ...styles.preset,
            ...(isMobile ? { padding: '10px 16px', fontSize: '14px' } : {})
          }} onClick={() => applyPreset('30')}>30s</button>
          <button style={{
            ...styles.preset,
            ...(isMobile ? { padding: '10px 16px', fontSize: '14px' } : {})
          }} onClick={() => applyPreset('60')}>60s</button>
          <button style={{
            ...styles.presetFull,
            ...(isMobile ? { padding: '10px 16px', fontSize: '14px', marginLeft: 0, flex: 1 } : {})
          }} onClick={() => applyPreset('full')}>Full</button>
        </div>

        {/* Waveform */}
        <div style={{
          ...styles.waveformSection,
          ...(isMobile ? {
            padding: '16px',
            flex: 1,
            overflow: 'hidden'
          } : {})
        }}>
          {isLoading ? (
            <div style={styles.loading}>
              <div style={styles.spinner} />
              <span>Loading audio...</span>
            </div>
          ) : (
            <div
              ref={containerRef}
              style={{
                ...styles.canvasContainer,
                ...(isMobile ? { touchAction: 'none' } : {})
              }}
              onMouseDown={handleMouseDown}
              onTouchStart={isMobile ? handleMouseDown : undefined}
            >
              <canvas
                ref={canvasRef}
                width={isMobile ? Math.min(window.innerWidth - 32, 700) : 700}
                height={isMobile ? 120 : 140}
                style={styles.canvas}
              />
            </div>
          )}
        </div>

        {/* Time Display */}
        <div style={{
          ...styles.timeRow,
          ...(isMobile ? {
            flexDirection: 'row',
            gap: '8px',
            padding: '12px 16px'
          } : {})
        }}>
          {/* IN Point */}
          <div style={{
            ...styles.timeBlock,
            ...(isMobile ? { flex: 1, padding: '8px' } : {})
          }}>
            <div style={{
              ...styles.timeLabel,
              ...(isMobile ? { fontSize: '10px' } : {})
            }}>
              <span style={styles.inDot} />
              IN
            </div>
            {editingTime === 'in' ? (
              <input
                type="text"
                value={editTimeValue}
                onChange={(e) => setEditTimeValue(e.target.value)}
                onBlur={handleTimeInputConfirm}
                onKeyDown={(e) => e.key === 'Enter' && handleTimeInputConfirm()}
                style={{
                  ...styles.timeInput,
                  ...(isMobile ? { fontSize: '16px', padding: '8px' } : {})
                }}
                autoFocus={!isMobile}
              />
            ) : (
              <button style={{
                ...styles.timeValue,
                ...(isMobile ? { fontSize: '18px', padding: '8px' } : {})
              }} onClick={() => handleTimeEdit('in')}>
                {formatTime(inPoint)}
              </button>
            )}
            {!isMobile && <span style={styles.timeHint}>Press I to set</span>}
          </div>

          {/* Duration */}
          <div style={{
            ...styles.durationBlock,
            ...(isMobile ? { flex: 1, padding: '8px' } : {})
          }}>
            <div style={{
              ...styles.durationLabel,
              ...(isMobile ? { fontSize: '10px' } : {})
            }}>DURATION</div>
            <div style={{
              ...styles.durationValue,
              ...(isMobile ? { fontSize: '18px' } : {})
            }}>{formatTime(selectedDuration)}</div>
            {!isMobile && <div style={styles.durationSub}>{selectedDuration.toFixed(1)} seconds</div>}
          </div>

          {/* OUT Point */}
          <div style={{
            ...styles.timeBlock,
            ...(isMobile ? { flex: 1, padding: '8px' } : {})
          }}>
            <div style={{
              ...styles.timeLabel,
              ...(isMobile ? { fontSize: '10px' } : {})
            }}>
              <span style={styles.outDot} />
              OUT
            </div>
            {editingTime === 'out' ? (
              <input
                type="text"
                value={editTimeValue}
                onChange={(e) => setEditTimeValue(e.target.value)}
                onBlur={handleTimeInputConfirm}
                onKeyDown={(e) => e.key === 'Enter' && handleTimeInputConfirm()}
                style={{
                  ...styles.timeInput,
                  ...(isMobile ? { fontSize: '16px', padding: '8px' } : {})
                }}
                autoFocus={!isMobile}
              />
            ) : (
              <button style={{
                ...styles.timeValue,
                ...(isMobile ? { fontSize: '18px', padding: '8px' } : {})
              }} onClick={() => handleTimeEdit('out')}>
                {formatTime(outPoint)}
              </button>
            )}
            {!isMobile && <span style={styles.timeHint}>Press O to set</span>}
          </div>
        </div>

        {/* Playback Controls */}
        <div style={{
          ...styles.playbackRow,
          ...(isMobile ? { padding: '12px 16px', gap: '12px' } : {})
        }}>
          <button style={{
            ...styles.playButton,
            ...(isMobile ? { width: '52px', height: '52px' } : {})
          }} onClick={togglePlayback}>
            {isPlaying ? (
              <svg width={isMobile ? 28 : 24} height={isMobile ? 28 : 24} viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            ) : (
              <svg width={isMobile ? 28 : 24} height={isMobile ? 28 : 24} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            )}
          </button>
          <div style={styles.playbackInfo}>
            <span style={{
              ...styles.playbackTime,
              ...(isMobile ? { fontSize: '18px' } : {})
            }}>{formatTime(playheadTime)}</span>
            <span style={styles.playbackSep}>/</span>
            <span style={{
              ...styles.playbackDuration,
              ...(isMobile ? { fontSize: '14px' } : {})
            }}>{formatTime(duration)}</span>
          </div>
          {!isMobile && (
            <div style={styles.shortcuts}>
              <span style={styles.shortcut}><kbd>Space</kbd> Play</span>
              <span style={styles.shortcut}><kbd>I</kbd> Set IN</span>
              <span style={styles.shortcut}><kbd>O</kbd> Set OUT</span>
              <span style={styles.shortcut}><kbd>←→</kbd> Scrub</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          ...styles.footer,
          ...(isMobile ? {
            flexDirection: 'column',
            gap: '12px',
            padding: '16px'
          } : {})
        }}>
          <div style={{
            ...styles.footerInfo,
            ...(isMobile ? { textAlign: 'center' } : {})
          }}>
            Selected: <strong>{formatTime(selectedDuration)}</strong> of {formatTime(duration)}
          </div>
          <div style={{
            ...styles.footerActions,
            ...(isMobile ? {
              width: '100%',
              flexDirection: 'column',
              gap: '8px'
            } : {})
          }}>
            <button style={{
              ...styles.cancelButton,
              ...(isMobile ? { width: '100%', padding: '14px', fontSize: '15px' } : {})
            }} onClick={onCancel}>Cancel</button>
            {onSaveClip && !isMobile && (
              <button
                style={styles.saveClipButton}
                onClick={() => {
                  const baseName = audioName || 'Audio';
                  const defaultName = `${baseName.replace(/\.[^/.]+$/, '')} (${formatTimeShort(inPoint)}-${formatTimeShort(outPoint)})`;
                  setClipName(defaultName);
                  setShowSaveClipModal(true);
                }}
              >
                💾 Save Clip
              </button>
            )}
            <button
              style={{
                ...styles.saveButton,
                ...(isMobile ? { width: '100%', padding: '14px', fontSize: '15px' } : {})
              }}
              disabled={isTrimming}
              onClick={() => {
                // Check if audio was trimmed (not using full track)
                const isTrimmed = inPoint > 0.1 || (duration > 0 && Math.abs(outPoint - duration) > 0.1);
                console.log('[AudioClipSelector] Use This Clip clicked:', {
                  inPoint,
                  outPoint,
                  selectedDuration,
                  fullDuration: duration,
                  isTrimmed
                });
                if (isTrimmed) {
                  // Show prompt to name the trimmed version
                  const baseName = audioName || 'Audio';
                  const defaultName = `${baseName.replace(/\.[^/.]+$/, '')} (${formatTimeShort(inPoint)}-${formatTimeShort(outPoint)})`;
                  setTrimmedClipName(defaultName);
                  setShowSaveTrimmedPrompt(true);
                } else {
                  // Not trimmed, just use directly
                  console.log('[AudioClipSelector] Calling onSave with full audio');
                  onSave({ startTime: 0, endTime: duration, duration: duration });
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Use This Clip
            </button>
          </div>
        </div>

        {/* Save Clip Modal */}
        {showSaveClipModal && (
          <div style={styles.saveClipOverlay} onClick={() => setShowSaveClipModal(false)}>
            <div style={styles.saveClipModal} onClick={e => e.stopPropagation()}>
              <h3 style={styles.saveClipTitle}>💾 Save Audio Clip</h3>
              <p style={styles.saveClipDesc}>
                Save this {formatTime(selectedDuration)} selection for quick reuse
              </p>
              <input
                type="text"
                value={clipName}
                onChange={e => setClipName(e.target.value)}
                placeholder="Clip name..."
                style={styles.saveClipInput}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && clipName.trim()) {
                    const clipData = {
                      name: clipName.trim(),
                      startTime: inPoint,
                      endTime: outPoint,
                      clipDuration: selectedDuration
                    };
                    onSaveClip(clipData);
                    setSavedClipData(clipData);
                    setShowSaveClipModal(false);
                    setShowUseClipPrompt(true);
                  }
                }}
              />
              <div style={styles.saveClipActions}>
                <button style={styles.cancelButton} onClick={() => setShowSaveClipModal(false)}>
                  Cancel
                </button>
                <button
                  style={styles.saveButton}
                  onClick={() => {
                    if (clipName.trim()) {
                      const clipData = {
                        name: clipName.trim(),
                        startTime: inPoint,
                        endTime: outPoint,
                        clipDuration: selectedDuration
                      };
                      onSaveClip(clipData);
                      setSavedClipData(clipData);
                      setShowSaveClipModal(false);
                      setShowUseClipPrompt(true);
                    }
                  }}
                  disabled={!clipName.trim()}
                >
                  Save to Library
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Use Clip Now Prompt */}
        {showUseClipPrompt && savedClipData && (
          <div style={styles.saveClipOverlay} onClick={() => setShowUseClipPrompt(false)}>
            <div style={styles.useClipModal} onClick={e => e.stopPropagation()}>
              <div style={styles.useClipIcon}>✅</div>
              <h3 style={styles.useClipTitle}>Clip Saved!</h3>
              <p style={styles.useClipDesc}>
                "{savedClipData.name}" has been saved to your library.
              </p>
              <p style={styles.useClipQuestion}>
                Would you like to use this clip now?
              </p>
              <div style={styles.useClipActions}>
                <button
                  style={styles.laterButton}
                  onClick={() => {
                    setShowUseClipPrompt(false);
                    setSavedClipData(null);
                    setClipName('');
                  }}
                >
                  Save More Clips
                </button>
                <button
                  style={styles.useNowButton}
                  onClick={() => {
                    // Use the saved clip's trim points - pass as object matching expected format
                    onSave({
                      startTime: savedClipData.startTime,
                      endTime: savedClipData.endTime,
                      duration: savedClipData.clipDuration
                    });
                    setShowUseClipPrompt(false);
                    setSavedClipData(null);
                  }}
                >
                  ✨ Use Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Save Trimmed Clip Prompt - Shows when user clicks "Use This Clip" on trimmed audio */}
        {showSaveTrimmedPrompt && (
          <div style={styles.saveClipOverlay} onClick={() => !isTrimming && setShowSaveTrimmedPrompt(false)}>
            <div style={{
              ...styles.saveTrimmedModal,
              ...(isMobile ? { width: '90%', maxWidth: '90%', padding: '20px' } : {})
            }} onClick={e => e.stopPropagation()}>
              <h3 style={styles.saveTrimmedTitle}>✂️ Name Your Clip</h3>
              <p style={styles.saveTrimmedDesc}>
                Saving a <strong>{formatTime(selectedDuration)}</strong> clip from your audio.
                {!isMobile && ' The original will remain untouched.'}
              </p>
              <input
                type="text"
                value={trimmedClipName}
                onChange={e => setTrimmedClipName(e.target.value)}
                placeholder="Name your trimmed clip..."
                disabled={isTrimming}
                style={{
                  ...styles.saveClipInput,
                  ...(isMobile ? { fontSize: '16px', padding: '14px' } : {}),
                  ...(isTrimming ? { opacity: 0.5 } : {})
                }}
                autoFocus={!isMobile}
                onKeyDown={e => {
                  if (e.key === 'Enter' && trimmedClipName.trim() && !isTrimming) {
                    handleTrimAndUse(trimmedClipName.trim());
                    setShowSaveTrimmedPrompt(false);
                  }
                }}
              />
              {isTrimming && (
                <p style={{ color: '#a78bfa', fontSize: '13px', margin: '8px 0 0', textAlign: 'center' }}>
                  {trimProgress || 'Trimming...'}
                </p>
              )}
              <div style={{
                ...styles.saveTrimmedActions,
                ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
              }}>
                <button
                  style={{
                    ...styles.skipButton,
                    ...(isMobile ? { width: '100%', padding: '14px', fontSize: '15px' } : {}),
                    ...(isTrimming ? { opacity: 0.5, cursor: 'not-allowed' } : {})
                  }}
                  disabled={isTrimming}
                  onClick={() => {
                    setShowSaveTrimmedPrompt(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  style={{
                    ...styles.saveButton,
                    opacity: (trimmedClipName.trim() && !isTrimming) ? 1 : 0.5,
                    cursor: (trimmedClipName.trim() && !isTrimming) ? 'pointer' : 'not-allowed',
                    ...(isMobile ? { width: '100%', padding: '14px', fontSize: '15px' } : {})
                  }}
                  onClick={() => {
                    if (trimmedClipName.trim() && !isTrimming) {
                      handleTrimAndUse(trimmedClipName.trim());
                      setShowSaveTrimmedPrompt(false);
                    }
                  }}
                  disabled={!trimmedClipName.trim() || isTrimming}
                >
                  {isTrimming ? '⏳ Trimming...' : '✂️ Trim & Use'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '20px'
  },
  modal: {
    width: '100%',
    maxWidth: '780px',
    backgroundColor: '#111118',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px',
    borderBottom: '1px solid #1f1f2e'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  headerIcon: {
    fontSize: '28px'
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff',
    margin: 0
  },
  subtitle: {
    fontSize: '13px',
    color: '#9ca3af',
    margin: '4px 0 0 0'
  },
  closeButton: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f1f2e',
    border: 'none',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer'
  },
  presets: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    backgroundColor: '#0a0a0f',
    borderBottom: '1px solid #1f1f2e'
  },
  presetLabel: {
    fontSize: '13px',
    color: '#6b7280',
    marginRight: '8px'
  },
  preset: {
    padding: '6px 14px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '6px',
    color: '#e5e7eb',
    fontSize: '13px',
    cursor: 'pointer'
  },
  presetFull: {
    padding: '6px 14px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    cursor: 'pointer',
    marginLeft: 'auto'
  },
  waveformSection: {
    padding: '24px'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '60px',
    color: '#9ca3af'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #2d2d3d',
    borderTopColor: '#7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  canvasContainer: {
    cursor: 'crosshair',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '140px'
  },
  timeRow: {
    display: 'flex',
    alignItems: 'stretch',
    padding: '0 24px 24px',
    gap: '16px'
  },
  timeBlock: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '16px',
    backgroundColor: '#0a0a0f',
    borderRadius: '12px'
  },
  timeLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '8px'
  },
  inDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#22c55e'
  },
  outDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#f97316'
  },
  timeValue: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'monospace',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px'
  },
  timeInput: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'monospace',
    backgroundColor: '#1f1f2e',
    border: '2px solid #7c3aed',
    borderRadius: '4px',
    padding: '4px 8px',
    textAlign: 'center',
    width: '140px',
    outline: 'none'
  },
  timeHint: {
    fontSize: '11px',
    color: '#4b5563',
    marginTop: '6px'
  },
  durationBlock: {
    flex: 1.2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    backgroundColor: '#7c3aed',
    borderRadius: '12px'
  },
  durationLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '4px'
  },
  durationValue: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'monospace'
  },
  durationSub: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.6)',
    marginTop: '4px'
  },
  playbackRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 24px',
    backgroundColor: '#0a0a0f',
    borderTop: '1px solid #1f1f2e'
  },
  playButton: {
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '50%',
    color: '#fff',
    cursor: 'pointer'
  },
  playbackInfo: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px'
  },
  playbackTime: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'monospace'
  },
  playbackSep: {
    color: '#4b5563'
  },
  playbackDuration: {
    fontSize: '14px',
    color: '#6b7280',
    fontFamily: 'monospace'
  },
  shortcuts: {
    display: 'flex',
    gap: '16px',
    marginLeft: 'auto'
  },
  shortcut: {
    fontSize: '11px',
    color: '#6b7280'
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderTop: '1px solid #1f1f2e'
  },
  footerInfo: {
    fontSize: '13px',
    color: '#9ca3af'
  },
  footerActions: {
    display: 'flex',
    gap: '8px'
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#1f1f2e',
    border: 'none',
    borderRadius: '8px',
    color: '#e5e7eb',
    fontSize: '14px',
    cursor: 'pointer'
  },
  saveButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 20px',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveClipButton: {
    padding: '10px 20px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveClipOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10
  },
  saveClipModal: {
    backgroundColor: '#1a1a2e',
    borderRadius: '12px',
    padding: '24px',
    width: '100%',
    maxWidth: '400px'
  },
  saveClipTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 8px 0'
  },
  saveClipDesc: {
    fontSize: '13px',
    color: '#9ca3af',
    margin: '0 0 16px 0'
  },
  saveClipInput: {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    marginBottom: '16px',
    outline: 'none',
    boxSizing: 'border-box'
  },
  saveClipActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px'
  },
  // Use Clip Now Modal styles
  useClipModal: {
    backgroundColor: '#111118',
    borderRadius: '16px',
    padding: '24px',
    textAlign: 'center',
    maxWidth: '360px'
  },
  useClipIcon: {
    fontSize: '48px',
    marginBottom: '12px'
  },
  useClipTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 8px 0'
  },
  useClipDesc: {
    fontSize: '14px',
    color: '#10b981',
    margin: '0 0 4px 0',
    fontWeight: '500'
  },
  useClipQuestion: {
    fontSize: '14px',
    color: '#9ca3af',
    margin: '0 0 20px 0'
  },
  useClipActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center'
  },
  laterButton: {
    padding: '12px 20px',
    backgroundColor: '#1f1f2e',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  useNowButton: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #10b981, #059669)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  // Save Trimmed Modal styles
  saveTrimmedModal: {
    backgroundColor: '#1a1a2e',
    borderRadius: '16px',
    padding: '28px',
    width: '100%',
    maxWidth: '440px',
    border: '1px solid rgba(139, 92, 246, 0.3)'
  },
  saveTrimmedTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#fff',
    margin: '0 0 12px 0'
  },
  saveTrimmedDesc: {
    fontSize: '14px',
    color: '#d1d5db',
    margin: '0 0 8px 0',
    lineHeight: '1.5'
  },
  saveTrimmedNote: {
    fontSize: '12px',
    color: '#6b7280',
    margin: '0 0 20px 0',
    fontStyle: 'italic'
  },
  saveTrimmedActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px'
  },
  skipButton: {
    padding: '12px 20px',
    backgroundColor: 'transparent',
    border: '1px solid #4b5563',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.15s'
  }
};

// Add keyframes for spinner
if (typeof document !== 'undefined' && !document.getElementById('audio-clip-selector-styles')) {
  const style = document.createElement('style');
  style.id = 'audio-clip-selector-styles';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

export default AudioClipSelector;
