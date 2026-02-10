import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import useTimelineZoom from '../../hooks/useTimelineZoom';

const ClipTimeline = ({
  clips = [],
  onClipsChange,
  totalDuration,
  currentTime,
  onSeek,
  selectedIndex,
  onSelect,
  selectedIndices: selectedIndicesProp,
  onSelectionChange,
  beats = [],
  audioBuffer
}) => {
  const { theme } = useTheme();
  const timelineRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [waveformData, setWaveformData] = useState([]);
  const [marqueeState, setMarqueeState] = useState(null);
  const justFinishedMarqueeRef = useRef(false);

  // Multi-select: use prop if provided, else derive from single selectedIndex
  const selectedIndices = selectedIndicesProp || (selectedIndex !== null ? [selectedIndex] : []);
  const setSelectedIndices = onSelectionChange || ((indices) => onSelect(indices[0] ?? null));

  // Generate waveform data from audio buffer
  useEffect(() => {
    if (!audioBuffer) return;
    const rawData = audioBuffer.getChannelData(0);
    const samples = 200;
    const blockSize = Math.floor(rawData.length / samples);
    const filteredData = [];
    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[(i * blockSize) + j]);
      }
      filteredData.push(sum / blockSize);
    }
    const max = Math.max(...filteredData);
    setWaveformData(filteredData.map(d => d / max));
  }, [audioBuffer]);

  const { pixelsPerSecond } = useTimelineZoom(timelineRef, {
    zoom, setZoom, minZoom: 0.5, maxZoom: 3, basePixelsPerSecond: 50,
  });
  const timelineWidth = Math.max(totalDuration * pixelsPerSecond, 800);

  // Handle clip selection — also jump playhead to clip start
  const handleClipClick = (index, e) => {
    e.stopPropagation();
    if (justFinishedMarqueeRef.current) { justFinishedMarqueeRef.current = false; return; }
    if (e.shiftKey) {
      setSelectedIndices(
        selectedIndices.includes(index) ? selectedIndices.filter(i => i !== index) : [...selectedIndices, index]
      );
    } else {
      const wasSelected = selectedIndices.length === 1 && selectedIndices[0] === index;
      setSelectedIndices(wasSelected ? [] : [index]);
      onSelect(wasSelected ? null : index);
      if (!wasSelected) onSeek(getClipStartTime(index));
    }
  };

  // Marquee pointer handlers
  const handleMarqueeDown = (e) => {
    if (e.target.closest('[data-ct-clip]')) return;
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft || 0;
    const startX = e.clientX - rect.left + scrollLeft;
    const startY = e.clientY - rect.top;
    setMarqueeState({ startX, startY, currentX: startX, currentY: startY });
    if (!e.shiftKey) setSelectedIndices([]);
  };

  useEffect(() => {
    if (!marqueeState) return;
    const handlePointerMove = (e) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scrollLeft = timelineRef.current?.scrollLeft || 0;
      const currentX = e.clientX - rect.left + scrollLeft;
      const currentY = e.clientY - rect.top;
      setMarqueeState(prev => ({ ...prev, currentX, currentY }));
      const minX = Math.min(marqueeState.startX, currentX);
      const maxX = Math.max(marqueeState.startX, currentX);
      const indices = [];
      clips.forEach((clip, i) => {
        const clipLeft = getClipStartTime(i) * pixelsPerSecond;
        const clipRight = clipLeft + clip.duration * pixelsPerSecond;
        if (clipRight >= minX && clipLeft <= maxX) indices.push(i);
      });
      setSelectedIndices(indices);
    };
    const handlePointerUp = () => {
      const hasDragged = marqueeState && (
        Math.abs(marqueeState.currentX - marqueeState.startX) > 5 ||
        Math.abs(marqueeState.currentY - marqueeState.startY) > 5
      );
      if (hasDragged) justFinishedMarqueeRef.current = true;
      setMarqueeState(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [marqueeState, clips, pixelsPerSecond]);

  // Handle timeline click for seeking
  const handleTimelineClick = (e) => {
    if (isDragging) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const time = x / pixelsPerSecond;
    onSeek(Math.max(0, Math.min(time, totalDuration)));
  };

  // Combine selected clips
  const handleCombine = useCallback(() => {
    if (selectedIndex === null || selectedIndex >= clips.length - 1) return;

    const newClips = [...clips];
    const current = newClips[selectedIndex];
    const next = newClips[selectedIndex + 1];

    // Merge the two clips
    newClips[selectedIndex] = {
      ...current,
      duration: current.duration + next.duration
    };
    newClips.splice(selectedIndex + 1, 1);

    onClipsChange(newClips);
  }, [clips, selectedIndex, onClipsChange]);

  // Split clip at current time
  const handleBreak = useCallback(() => {
    if (selectedIndex === null) return;

    const clip = clips[selectedIndex];
    const clipStartTime = clips.slice(0, selectedIndex).reduce((sum, c) => sum + c.duration, 0);
    const splitPoint = currentTime - clipStartTime;

    if (splitPoint <= 0 || splitPoint >= clip.duration) return;

    const newClips = [...clips];
    newClips.splice(selectedIndex, 1,
      { ...clip, duration: splitPoint, id: `${clip.id}_a` },
      { ...clip, startTime: clipStartTime + splitPoint, duration: clip.duration - splitPoint, id: `${clip.id}_b` }
    );

    onClipsChange(newClips);
  }, [clips, selectedIndex, currentTime, onClipsChange]);

  // Rearrange clips (move selected clip)
  const handleMoveClip = useCallback((direction) => {
    if (selectedIndex === null) return;

    const newIndex = selectedIndex + direction;
    if (newIndex < 0 || newIndex >= clips.length) return;

    const newClips = [...clips];
    const [removed] = newClips.splice(selectedIndex, 1);
    newClips.splice(newIndex, 0, removed);

    onClipsChange(newClips);
    onSelect(newIndex);
  }, [clips, selectedIndex, onClipsChange, onSelect]);

  // Delete selected clip
  const handleDelete = useCallback(() => {
    if (selectedIndex === null) return;

    const newClips = clips.filter((_, i) => i !== selectedIndex);
    onClipsChange(newClips);
    onSelect(null);
  }, [clips, selectedIndex, onClipsChange, onSelect]);

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  // Get cumulative start time for a clip
  const getClipStartTime = (index) => {
    return clips.slice(0, index).reduce((sum, c) => sum + c.duration, 0);
  };

  const styles = getStyles(theme);

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.label}>Clips</span>
        <div style={styles.actions}>
          <button
            onClick={handleCombine}
            disabled={selectedIndex === null || selectedIndex >= clips.length - 1}
            style={styles.actionButton}
            title="Combine with next clip"
          >
            Combine
          </button>
          <button
            onClick={handleBreak}
            disabled={selectedIndex === null}
            style={styles.actionButton}
            title="Split at playhead"
          >
            Break
          </button>
          <button
            onClick={() => handleMoveClip(-1)}
            disabled={selectedIndex === null || selectedIndex === 0}
            style={styles.actionButton}
            title="Move left"
          >
            ← Move
          </button>
          <button
            onClick={() => handleMoveClip(1)}
            disabled={selectedIndex === null || selectedIndex >= clips.length - 1}
            style={styles.actionButton}
            title="Move right"
          >
            Move →
          </button>
          <button
            onClick={handleDelete}
            disabled={selectedIndex === null}
            style={{ ...styles.actionButton, color: '#ef4444' }}
            title="Delete clip"
          >
            Delete
          </button>
        </div>
        <div style={styles.zoomControl}>
          <span>Zoom:</span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            style={styles.zoomSlider}
          />
          <span>{zoom.toFixed(1)}x</span>
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={timelineRef}
        style={styles.timeline}
        onClick={handleTimelineClick}
        onPointerDown={handleMarqueeDown}
      >
        {/* Marquee overlay */}
        {marqueeState && (() => {
          const minX = Math.min(marqueeState.startX, marqueeState.currentX);
          const maxX = Math.max(marqueeState.startX, marqueeState.currentX);
          const minY = Math.min(marqueeState.startY, marqueeState.currentY);
          const maxY = Math.max(marqueeState.startY, marqueeState.currentY);
          return (
            <div style={{
              position: 'absolute', left: minX, top: minY,
              width: maxX - minX, height: maxY - minY,
              backgroundColor: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(99, 102, 241, 0.5)',
              pointerEvents: 'none', zIndex: 25
            }} />
          );
        })()}
        {/* Time markers */}
        <div style={{ ...styles.timeMarkers, width: timelineWidth }}>
          {Array.from({ length: Math.ceil(totalDuration) + 1 }, (_, i) => (
            <div
              key={i}
              style={{
                ...styles.timeMarker,
                left: i * pixelsPerSecond
              }}
            >
              {formatTime(i)}
            </div>
          ))}
        </div>

        {/* Beat markers */}
        <div style={{ ...styles.beatMarkers, width: timelineWidth }}>
          {beats.map((beat, i) => (
            <div
              key={i}
              style={{
                ...styles.beatMarker,
                left: beat * pixelsPerSecond
              }}
            />
          ))}
        </div>

        {/* Waveform */}
        {waveformData.length > 0 && (
          <div style={{ ...styles.waveform, width: timelineWidth }}>
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

        {/* Clips track */}
        <div style={{ ...styles.clipsTrack, width: timelineWidth }}>
          {clips.map((clip, index) => {
            const clipStart = getClipStartTime(index);
            return (
              <div
                key={clip.id || index}
                data-ct-clip="true"
                style={{
                  ...styles.clip,
                  left: clipStart * pixelsPerSecond,
                  width: clip.duration * pixelsPerSecond,
                  borderColor: selectedIndices.includes(index) ? theme.accent.primary : theme.bg.elevated
                }}
                onClick={(e) => handleClipClick(index, e)}
              >
                {clip.thumbnail && (
                  <img
                    src={clip.thumbnail}
                    alt=""
                    style={styles.clipThumbnail}
                  />
                )}
                <div style={styles.clipInfo}>
                  <span style={styles.clipDuration}>
                    {clip.duration.toFixed(1)}s
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={selectedIndices.includes(index)}
                  onChange={() => {
                    if (selectedIndices.includes(index)) {
                      setSelectedIndices(selectedIndices.filter(i => i !== index));
                    } else {
                      setSelectedIndices([...selectedIndices, index]);
                    }
                  }}
                  style={styles.clipCheckbox}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div
          style={{
            ...styles.playhead,
            left: currentTime * pixelsPerSecond
          }}
        />
      </div>
    </div>
  );
};

const getStyles = (theme) => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '8px 0'
  },
  label: {
    fontWeight: '600',
    color: theme.text.secondary,
    fontSize: '13px'
  },
  actions: {
    display: 'flex',
    gap: '4px'
  },
  actionButton: {
    padding: '4px 10px',
    backgroundColor: theme.bg.surface,
    color: theme.text.primary,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  zoomControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginLeft: 'auto',
    fontSize: '12px',
    color: theme.text.secondary
  },
  zoomSlider: {
    width: '80px',
    cursor: 'pointer'
  },
  timeline: {
    position: 'relative',
    height: '130px',
    backgroundColor: theme.bg.surface,
    borderRadius: '8px',
    overflow: 'auto',
    cursor: 'pointer'
  },
  timeMarkers: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '20px',
    borderBottom: `1px solid ${theme.bg.elevated}`
  },
  timeMarker: {
    position: 'absolute',
    top: '4px',
    fontSize: '10px',
    color: theme.text.muted,
    transform: 'translateX(-50%)'
  },
  beatMarkers: {
    position: 'absolute',
    top: '20px',
    left: 0,
    height: '80px'
  },
  beatMarker: {
    position: 'absolute',
    top: 0,
    width: '1px',
    height: '100%',
    backgroundColor: 'rgba(124, 58, 237, 0.3)'
  },
  waveform: {
    position: 'absolute',
    top: '20px',
    left: 0,
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
    top: '24px',
    left: 0,
    height: '60px',
    padding: '4px 0'
  },
  clip: {
    position: 'absolute',
    height: '52px',
    backgroundColor: theme.bg.elevated,
    border: `2px solid ${theme.bg.elevated}`,
    borderRadius: '6px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'border-color 0.15s'
  },
  clipThumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0.7
  },
  clipInfo: {
    position: 'absolute',
    bottom: '2px',
    left: '4px',
    right: '4px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  clipDuration: {
    fontSize: '10px',
    color: theme.text.primary,
    backgroundColor: theme.overlay.heavy,
    padding: '1px 4px',
    borderRadius: '2px'
  },
  clipCheckbox: {
    position: 'absolute',
    top: '4px',
    left: '4px',
    cursor: 'pointer'
  },
  playhead: {
    position: 'absolute',
    top: 0,
    width: '2px',
    height: '100%',
    backgroundColor: '#ef4444',
    pointerEvents: 'none',
    zIndex: 10
  }
});

export default ClipTimeline;
