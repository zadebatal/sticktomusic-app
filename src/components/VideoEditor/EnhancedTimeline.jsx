import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Enhanced Timeline - Clip timeline with thumbnails, waveform, beat markers, and quick actions
 *
 * TIME WINDOW CONTRACT:
 * This component expects ALL time-based data (clips, words, beats) to be in LOCAL time.
 * LOCAL time means 0 = start of trimmed range, not start of full audio file.
 * The parent component (VideoEditorModal) is responsible for normalizing data
 * using the timelineNormalization utility before passing it here.
 *
 * @see src/utils/timelineNormalization.js for normalization functions
 * @see docs/DOMAIN_INVARIANTS.md Section A for time window rules
 */
const EnhancedTimeline = ({
  clips = [],
  words = [],
  beats = [],
  duration = 30,
  currentTime = 0,
  zoom = 1,
  onTimeChange,
  onClipClick,
  onClipReroll,
  onClipLock,
  onClipDelete,
  onRerollAll,
  onShuffleOrder,
  selectedClipIndex,
  audioBuffer, // For waveform
  isPlaying = false // New prop to know if video is playing
}) => {
  const timelineRef = useRef(null);
  const [waveformData, setWaveformData] = useState([]);
  const [hoveredClip, setHoveredClip] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);

  // Find the active clip (the one the playhead is currently in)
  const activeClipIndex = clips.findIndex(clip =>
    currentTime >= clip.startTime && currentTime < (clip.startTime + clip.duration)
  );

  // Generate waveform data from audio buffer
  useEffect(() => {
    if (audioBuffer) {
      generateWaveform(audioBuffer);
    }
  }, [audioBuffer]);

  const generateWaveform = (buffer) => {
    const rawData = buffer.getChannelData(0);
    const samples = 200; // Number of bars in waveform
    const blockSize = Math.floor(rawData.length / samples);
    const filteredData = [];

    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[(i * blockSize) + j]);
      }
      filteredData.push(sum / blockSize);
    }

    // Normalize
    const max = Math.max(...filteredData);
    setWaveformData(filteredData.map(d => d / max));
  };

  // Calculate pixel position from time
  const timeToPixels = (time) => {
    const pixelsPerSecond = 50 * zoom;
    return time * pixelsPerSecond;
  };

  // Calculate time from pixel position
  const pixelsToTime = (pixels) => {
    const pixelsPerSecond = 50 * zoom;
    return pixels / pixelsPerSecond;
  };

  // Handle timeline click
  const handleTimelineClick = (e) => {
    if (contextMenu) {
      setContextMenu(null);
      return;
    }
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const time = Math.max(0, Math.min(pixelsToTime(x), duration));
    onTimeChange?.(time);
  };

  // Handle right-click on clip
  const handleClipContextMenu = (e, clipIndex) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      clipIndex
    });
  };

  // Close context menu
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const totalWidth = timeToPixels(duration);

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <span style={styles.label}>Timeline</span>
          <span style={styles.clipCount}>{clips.length} clips</span>
        </div>
        <div style={styles.toolbarRight}>
          <button
            style={styles.toolbarButton}
            onClick={onRerollAll}
            title="Reroll all unlocked clips"
          >
            🎲 Reroll All
          </button>
          <button
            style={styles.toolbarButton}
            onClick={onShuffleOrder}
            title="Shuffle clip order"
          >
            🔀 Shuffle
          </button>
          <div style={styles.zoomControl}>
            <span style={styles.zoomLabel}>Zoom:</span>
            <span style={styles.zoomValue}>{zoom.toFixed(1)}x</span>
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      <div
        ref={timelineRef}
        style={styles.timelineScroll}
        onClick={handleTimelineClick}
      >
        <div style={{ ...styles.timelineContent, width: totalWidth }}>
          {/* Time Ruler */}
          <div style={styles.ruler}>
            {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
              <div
                key={i}
                style={{
                  ...styles.rulerMark,
                  left: timeToPixels(i)
                }}
              >
                <div style={styles.rulerLine} />
                <span style={styles.rulerTime}>{i}s</span>
              </div>
            ))}
          </div>

          {/* Beat Markers */}
          <div style={styles.beatTrack}>
            {beats.map((beat, i) => (
              <div
                key={i}
                style={{
                  ...styles.beatMarker,
                  left: timeToPixels(beat)
                }}
                title={`Beat ${i + 1}`}
              />
            ))}
          </div>

          {/* Waveform */}
          {waveformData.length > 0 && (
            <div style={styles.waveform}>
              {waveformData.map((amplitude, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.waveformBar,
                    height: `${amplitude * 100}%`
                  }}
                />
              ))}
            </div>
          )}

          {/* Clips Track */}
          <div style={styles.clipsTrack}>
            {clips.map((clip, index) => (
              <div
                key={clip.id}
                style={{
                  ...styles.clip,
                  left: timeToPixels(clip.startTime),
                  width: Math.max(timeToPixels(clip.duration), 20),
                  ...(selectedClipIndex === index ? styles.clipSelected : {}),
                  ...(clip.locked ? styles.clipLocked : {}),
                  ...(hoveredClip === index ? styles.clipHovered : {}),
                  ...(activeClipIndex === index && isPlaying ? styles.clipActive : {})
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onClipClick?.(index);
                }}
                onContextMenu={(e) => handleClipContextMenu(e, index)}
                onMouseEnter={() => setHoveredClip(index)}
                onMouseLeave={() => setHoveredClip(null)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!clip.locked) {
                    onClipReroll?.(index);
                  }
                }}
              >
                {/* Thumbnail */}
                {clip.thumbnail ? (
                  <img
                    src={clip.thumbnail}
                    alt=""
                    style={styles.clipThumbnail}
                  />
                ) : (
                  <div style={styles.clipPlaceholder}>🎬</div>
                )}

                {/* Lock indicator */}
                {clip.locked && (
                  <div style={styles.lockIndicator}>🔒</div>
                )}

                {/* Clip number */}
                <div style={styles.clipNumber}>{index + 1}</div>

                {/* Hover actions */}
                {hoveredClip === index && !clip.locked && (
                  <div style={styles.hoverActions}>
                    <button
                      style={styles.hoverAction}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClipReroll?.(index);
                      }}
                      title="Reroll (or double-click)"
                    >
                      🎲
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Word Markers */}
          <div style={styles.wordTrack}>
            {words.map((word, i) => (
              <div
                key={word.id || i}
                style={{
                  ...styles.wordMarker,
                  left: timeToPixels(word.startTime),
                  width: Math.max(timeToPixels(word.duration), 30)
                }}
                title={word.text}
              >
                <span style={styles.wordText}>{word.text}</span>
              </div>
            ))}
          </div>

          {/* Playhead */}
          <div
            style={{
              ...styles.playhead,
              left: timeToPixels(currentTime)
            }}
          >
            <div style={styles.playheadHead} />
            <div style={styles.playheadLine} />
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            ...styles.contextMenu,
            left: contextMenu.x,
            top: contextMenu.y
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={styles.contextMenuItem}
            onClick={() => {
              onClipReroll?.(contextMenu.clipIndex);
              setContextMenu(null);
            }}
          >
            🎲 Reroll Clip
          </button>
          <button
            style={styles.contextMenuItem}
            onClick={() => {
              onClipLock?.(contextMenu.clipIndex);
              setContextMenu(null);
            }}
          >
            {clips[contextMenu.clipIndex]?.locked ? '🔓 Unlock' : '🔒 Lock'}
          </button>
          <div style={styles.contextMenuDivider} />
          <button
            style={{ ...styles.contextMenuItem, color: '#ef4444' }}
            onClick={() => {
              onClipDelete?.(contextMenu.clipIndex);
              setContextMenu(null);
            }}
          >
            🗑️ Delete
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0f0f23',
    borderTop: '1px solid #1e293b',
    height: '220px'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155'
  },
  toolbarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  toolbarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  label: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#e2e8f0'
  },
  clipCount: {
    fontSize: '12px',
    color: '#64748b'
  },
  toolbarButton: {
    padding: '6px 12px',
    backgroundColor: '#334155',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  zoomControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginLeft: '8px'
  },
  zoomLabel: {
    fontSize: '12px',
    color: '#94a3b8'
  },
  zoomValue: {
    fontSize: '12px',
    color: '#e2e8f0',
    fontWeight: '500'
  },
  timelineScroll: {
    flex: 1,
    overflow: 'auto',
    position: 'relative'
  },
  timelineContent: {
    position: 'relative',
    minHeight: '100%',
    paddingTop: '24px'
  },
  ruler: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '24px',
    backgroundColor: '#1e293b'
  },
  rulerMark: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  rulerLine: {
    width: '1px',
    height: '8px',
    backgroundColor: '#475569'
  },
  rulerTime: {
    fontSize: '10px',
    color: '#64748b',
    marginTop: '2px'
  },
  beatTrack: {
    position: 'absolute',
    top: '28px',
    left: 0,
    right: 0,
    height: '16px'
  },
  beatMarker: {
    position: 'absolute',
    width: '2px',
    height: '100%',
    backgroundColor: '#7c3aed',
    opacity: 0.5
  },
  waveform: {
    position: 'absolute',
    top: '46px',
    left: 0,
    right: 0,
    height: '30px',
    display: 'flex',
    alignItems: 'center',
    gap: '1px',
    opacity: 0.3
  },
  waveformBar: {
    flex: 1,
    backgroundColor: '#22c55e',
    minWidth: '1px'
  },
  clipsTrack: {
    position: 'absolute',
    top: '80px',
    left: 0,
    right: 0,
    height: '60px'
  },
  clip: {
    position: 'absolute',
    height: '100%',
    backgroundColor: '#334155',
    borderRadius: '4px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform 0.1s, box-shadow 0.1s',
    border: '2px solid transparent'
  },
  clipSelected: {
    borderColor: '#7c3aed',
    boxShadow: '0 0 0 2px rgba(124, 58, 237, 0.3)'
  },
  clipLocked: {
    borderColor: '#eab308',
    opacity: 0.8
  },
  clipHovered: {
    transform: 'scale(1.02)',
    zIndex: 10
  },
  clipActive: {
    borderColor: '#22c55e',
    boxShadow: '0 0 12px rgba(34, 197, 94, 0.6), 0 0 0 2px rgba(34, 197, 94, 0.3)',
    transform: 'scale(1.03)',
    zIndex: 15
  },
  clipThumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  clipPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    backgroundColor: '#1e293b'
  },
  lockIndicator: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    fontSize: '12px'
  },
  clipNumber: {
    position: 'absolute',
    bottom: '4px',
    left: '4px',
    fontSize: '10px',
    fontWeight: 'bold',
    color: 'white',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: '2px 4px',
    borderRadius: '2px'
  },
  hoverActions: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    gap: '4px'
  },
  hoverAction: {
    padding: '4px 8px',
    backgroundColor: 'rgba(0,0,0,0.8)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  wordTrack: {
    position: 'absolute',
    top: '145px',
    left: 0,
    right: 0,
    height: '30px'
  },
  wordMarker: {
    position: 'absolute',
    height: '100%',
    backgroundColor: 'rgba(124, 58, 237, 0.3)',
    borderRadius: '4px',
    borderLeft: '2px solid #7c3aed',
    padding: '2px 4px',
    overflow: 'hidden'
  },
  wordText: {
    fontSize: '10px',
    color: '#e2e8f0',
    whiteSpace: 'nowrap'
  },
  playhead: {
    position: 'absolute',
    top: '24px',
    bottom: 0,
    zIndex: 20,
    pointerEvents: 'none'
  },
  playheadHead: {
    width: '12px',
    height: '12px',
    backgroundColor: '#ef4444',
    borderRadius: '2px',
    transform: 'translateX(-50%) rotate(45deg)',
    marginTop: '-6px'
  },
  playheadLine: {
    width: '2px',
    height: 'calc(100% - 6px)',
    backgroundColor: '#ef4444',
    marginLeft: '-1px'
  },
  contextMenu: {
    position: 'fixed',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '4px',
    zIndex: 100,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    color: 'white',
    fontSize: '13px',
    textAlign: 'left',
    cursor: 'pointer'
  },
  contextMenuDivider: {
    height: '1px',
    backgroundColor: '#334155',
    margin: '4px 0'
  }
};

export default EnhancedTimeline;
