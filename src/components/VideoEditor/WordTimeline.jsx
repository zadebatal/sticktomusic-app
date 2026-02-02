import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * WordTimeline - Flowstage-inspired word timing editor
 * Features draggable/resizable word blocks, zoom, auto-scroll, and live preview
 */
const WordTimeline = ({
  words = [],
  setWords,
  duration = 30,
  currentTime = 0,
  onSeek,
  isPlaying,
  onPlayPause,
  onClose
}) => {
  const [zoom, setZoom] = useState(1);
  const [selectedWordIndex, setSelectedWordIndex] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [autoCensor, setAutoCensor] = useState(true);
  const timelineRef = useRef(null);

  // Find the current word based on playhead position
  const currentWord = words.find(word =>
    currentTime >= word.startTime && currentTime < word.startTime + (word.duration || 0.5)
  );

  // Profanity filter
  const censorWord = (text) => {
    if (!autoCensor || !text) return text;
    const profanity = ['fuck', 'shit', 'bitch', 'ass', 'damn', 'hell', 'crap'];
    let censored = text;
    profanity.forEach(word => {
      const regex = new RegExp(word, 'gi');
      censored = censored.replace(regex, match => match[0] + '*'.repeat(match.length - 1));
    });
    return censored;
  };

  const timeToPixels = useCallback((time) => {
    const pixelsPerSecond = 80 * zoom;
    return time * pixelsPerSecond;
  }, [zoom]);

  const pixelsToTime = useCallback((pixels) => {
    const pixelsPerSecond = 80 * zoom;
    return pixels / pixelsPerSecond;
  }, [zoom]);

  const getTimelineWidth = () => timeToPixels(duration);

  // Auto-scroll timeline to follow playhead during playback
  useEffect(() => {
    if (!isPlaying || !timelineRef.current) return;

    const timeline = timelineRef.current;
    const playheadPosition = timeToPixels(currentTime);
    const timelineWidth = timeline.clientWidth;
    const scrollLeft = timeline.scrollLeft;

    // Keep playhead in the middle-ish of the visible area
    const margin = timelineWidth * 0.3;

    if (playheadPosition < scrollLeft + margin) {
      timeline.scrollTo({ left: Math.max(0, playheadPosition - margin), behavior: 'smooth' });
    } else if (playheadPosition > scrollLeft + timelineWidth - margin) {
      timeline.scrollTo({ left: playheadPosition - timelineWidth + margin, behavior: 'smooth' });
    }
  }, [currentTime, isPlaying, timeToPixels]);

  const handleWordMouseDown = (e, index, type = 'move') => {
    e.stopPropagation();
    const word = words[index];
    setSelectedWordIndex(index);
    setDragState({
      index,
      type,
      startX: e.clientX,
      startTime: word.startTime,
      startDuration: word.duration || 0.5
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e) => {
      const deltaX = e.clientX - dragState.startX;
      const deltaTime = pixelsToTime(deltaX);

      setWords(prev => {
        const newWords = [...prev];
        const word = { ...newWords[dragState.index] };

        if (dragState.type === 'move') {
          const newStartTime = Math.max(0, Math.min(duration - (word.duration || 0.5), dragState.startTime + deltaTime));
          word.startTime = newStartTime;
        } else if (dragState.type === 'resize-left') {
          const newStartTime = Math.max(0, dragState.startTime + deltaTime);
          const endTime = dragState.startTime + dragState.startDuration;
          const newDuration = Math.max(0.1, endTime - newStartTime);
          word.startTime = newStartTime;
          word.duration = newDuration;
        } else if (dragState.type === 'resize-right') {
          const newDuration = Math.max(0.1, dragState.startDuration + deltaTime);
          word.duration = newDuration;
        }

        newWords[dragState.index] = word;
        return newWords;
      });
    };

    const handleMouseUp = () => setDragState(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, pixelsToTime, duration, setWords]);

  const handleTimelineClick = (e) => {
    if (dragState) return;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scrollLeft = timelineRef.current?.scrollLeft || 0;
    const clickX = e.clientX - rect.left + scrollLeft;
    const time = pixelsToTime(clickX);
    onSeek?.(Math.max(0, Math.min(duration, time)));
  };

  const handleAddWord = () => {
    const text = prompt('Enter word text:');
    if (!text) return;
    const newWord = {
      id: `word_${Date.now()}`,
      text,
      startTime: currentTime,
      duration: 0.5
    };
    setWords(prev => [...prev, newWord].sort((a, b) => a.startTime - b.startTime));
  };

  const handleDeleteWord = () => {
    if (selectedWordIndex === null) return;
    setWords(prev => prev.filter((_, i) => i !== selectedWordIndex));
    setSelectedWordIndex(null);
  };

  const handleSplitWord = () => {
    if (selectedWordIndex === null) return;
    const word = words[selectedWordIndex];
    if (!word.text.includes(' ')) {
      alert('Word has no spaces to split');
      return;
    }
    const parts = word.text.split(' ');
    const partDuration = word.duration / parts.length;
    const newWords = parts.map((text, i) => ({
      id: `word_${Date.now()}_${i}`,
      text,
      startTime: word.startTime + (i * partDuration),
      duration: partDuration
    }));
    setWords(prev => {
      const result = [...prev];
      result.splice(selectedWordIndex, 1, ...newWords);
      return result;
    });
  };

  const handleCombineWords = () => {
    if (selectedWordIndex === null || selectedWordIndex >= words.length - 1) return;
    const word1 = words[selectedWordIndex];
    const word2 = words[selectedWordIndex + 1];
    const combined = {
      id: word1.id,
      text: `${word1.text} ${word2.text}`,
      startTime: word1.startTime,
      duration: (word2.startTime + word2.duration) - word1.startTime
    };
    setWords(prev => {
      const result = [...prev];
      result.splice(selectedWordIndex, 2, combined);
      return result;
    });
  };

  const handleChangeCase = (caseType) => {
    if (selectedWordIndex === null) return;
    setWords(prev => {
      const newWords = [...prev];
      const word = { ...newWords[selectedWordIndex] };
      if (caseType === 'lower') word.text = word.text.toLowerCase();
      else if (caseType === 'title') word.text = word.text.charAt(0).toUpperCase() + word.text.slice(1).toLowerCase();
      else if (caseType === 'upper') word.text = word.text.toUpperCase();
      newWords[selectedWordIndex] = word;
      return newWords;
    });
  };

  const handleMakeLegato = () => {
    setWords(prev => {
      const sorted = [...prev].sort((a, b) => a.startTime - b.startTime);
      return sorted.map((word, i) => {
        if (i === sorted.length - 1) return word;
        const nextWord = sorted[i + 1];
        return { ...word, duration: nextWord.startTime - word.startTime };
      });
    });
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  const getLines = () => {
    const lines = [];
    let currentLine = [];
    words.forEach((word, i) => {
      currentLine.push(word);
      const nextWord = words[i + 1];
      if (currentLine.length >= 6 || (nextWord && nextWord.startTime - (word.startTime + word.duration) > 1)) {
        lines.push(currentLine);
        currentLine = [];
      }
    });
    if (currentLine.length > 0) lines.push(currentLine);
    return lines;
  };

  const selectedWord = selectedWordIndex !== null ? words[selectedWordIndex] : null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Word timeline</h2>
          <button style={styles.closeButton} onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={styles.toolbar}>
          <div style={styles.timeDisplay}>
            <span style={styles.currentTimeText}>{formatTime(currentTime)}</span>
            <span style={styles.totalTime}> / {formatTime(duration)}</span>
            <span style={styles.originalTime}>(Original: {formatTime(duration)})</span>
          </div>
          <div style={styles.toolbarButtons}>
            <button style={styles.toolButton} onClick={handleCombineWords} disabled={selectedWordIndex === null}>Combine</button>
            <button style={styles.toolButton} onClick={handleSplitWord} disabled={selectedWordIndex === null}>Split</button>
            <button style={styles.toolButtonPrimary} onClick={handleAddWord}>Add</button>
            <button style={styles.toolButton} onClick={handleDeleteWord} disabled={selectedWordIndex === null}>Delete</button>
            <div style={styles.zoomControl}>
              <span>Zoom</span>
              <input type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={styles.zoomSlider} />
            </div>
            <div style={styles.caseButtons}>
              <button style={styles.caseButton} onClick={() => handleChangeCase('lower')}>aa</button>
              <button style={styles.caseButton} onClick={() => handleChangeCase('title')}>Aa</button>
              <button style={styles.caseButton} onClick={() => handleChangeCase('upper')}>AA</button>
            </div>
            <button style={styles.legatoButton} onClick={handleMakeLegato}>Make legato</button>
            <label style={styles.censorLabel}>
              <input type="checkbox" checked={autoCensor} onChange={(e) => setAutoCensor(e.target.checked)} />
              Auto-censor
            </label>
          </div>
        </div>

        <div style={styles.timelineContainer}>
          <button style={styles.playButton} onClick={onPlayPause}>
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            )}
          </button>
          <div ref={timelineRef} style={styles.timeline} onClick={handleTimelineClick}>
            <div style={{ ...styles.timelineInner, width: getTimelineWidth() }}>
              <div style={{ ...styles.playhead, left: timeToPixels(currentTime) }} />
              {words.map((word, index) => (
                <div
                  key={word.id || index}
                  style={{
                    ...styles.wordBlock,
                    left: timeToPixels(word.startTime),
                    width: Math.max(30, timeToPixels(word.duration || 0.5)),
                    ...(selectedWordIndex === index ? styles.wordBlockSelected : {}),
                    ...(currentWord?.id === word.id ? styles.wordBlockCurrent : {})
                  }}
                  onMouseDown={(e) => handleWordMouseDown(e, index, 'move')}
                >
                  <div style={styles.resizeHandle} onMouseDown={(e) => handleWordMouseDown(e, index, 'resize-left')} />
                  <span style={styles.wordText}>{censorWord(word.text).slice(0, 8)}{word.text.length > 8 ? '...' : ''}</span>
                  <div style={{ ...styles.resizeHandle, right: 0, left: 'auto' }} onMouseDown={(e) => handleWordMouseDown(e, index, 'resize-right')} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.bottomSections}>
          <div style={styles.linePreviewSection}>
            <h4 style={styles.sectionTitle}>Line build preview</h4>
            <div style={styles.linesContainer}>
              {getLines().map((line, lineIndex) => (
                <div key={lineIndex} style={styles.lineRow}>
                  {line.map((word, wordIndex) => (
                    <span key={word.id || wordIndex} style={{
                      ...styles.wordChip,
                      ...(currentTime >= word.startTime && currentTime < word.startTime + word.duration ? styles.wordChipActive : {})
                    }}>
                      {censorWord(word.text)}
                    </span>
                  ))}
                </div>
              ))}
              {words.length === 0 && <p style={styles.noWords}>No words yet. Click "Add" to add words.</p>}
            </div>
          </div>

          <div style={styles.wordEditorSection}>
            <h4 style={styles.sectionTitle}>Current word (click to edit!)</h4>
            <div style={styles.wordEditorContent}>
              {/* Live preview of current word at playhead */}
              <div style={styles.livePreview}>
                <span style={styles.livePreviewText}>
                  {currentWord ? censorWord(currentWord.text) : '—'}
                </span>
              </div>

              {/* Edit form for selected word */}
              {selectedWord && (
                <div style={styles.wordEditForm}>
                  <div style={styles.wordEditRow}>
                    <label style={styles.wordEditLabel}>Text:</label>
                    <input type="text" value={selectedWord.text} onChange={(e) => {
                      setWords(prev => {
                        const newWords = [...prev];
                        newWords[selectedWordIndex] = { ...newWords[selectedWordIndex], text: e.target.value };
                        return newWords;
                      });
                    }} style={styles.wordEditInput} />
                  </div>
                  <div style={styles.wordEditRow}>
                    <label style={styles.wordEditLabel}>Start:</label>
                    <input type="number" value={selectedWord.startTime.toFixed(2)} step="0.1" onChange={(e) => {
                      setWords(prev => {
                        const newWords = [...prev];
                        newWords[selectedWordIndex] = { ...newWords[selectedWordIndex], startTime: parseFloat(e.target.value) || 0 };
                        return newWords;
                      });
                    }} style={styles.wordEditInput} />
                  </div>
                  <div style={styles.wordEditRow}>
                    <label style={styles.wordEditLabel}>Duration:</label>
                    <input type="number" value={(selectedWord.duration || 0.5).toFixed(2)} step="0.1" onChange={(e) => {
                      setWords(prev => {
                        const newWords = [...prev];
                        newWords[selectedWordIndex] = { ...newWords[selectedWordIndex], duration: parseFloat(e.target.value) || 0.1 };
                        return newWords;
                      });
                    }} style={styles.wordEditInput} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.saveButton} onClick={onClose}>Save word timings</button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 },
  modal: { width: '95%', maxWidth: '1200px', maxHeight: '90vh', backgroundColor: '#111118', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1f1f2e' },
  title: { margin: 0, fontSize: '18px', fontWeight: '600', color: '#fff' },
  closeButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '6px', color: '#9ca3af', cursor: 'pointer' },
  toolbar: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 20px', borderBottom: '1px solid #1f1f2e', backgroundColor: '#0a0a0f' },
  timeDisplay: { display: 'flex', alignItems: 'baseline', gap: '4px' },
  currentTimeText: { fontSize: '20px', fontWeight: '600', color: '#fff', fontFamily: 'monospace' },
  totalTime: { fontSize: '16px', color: '#6b7280', fontFamily: 'monospace' },
  originalTime: { fontSize: '12px', color: '#4b5563', marginLeft: '8px' },
  toolbarButtons: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  toolButton: { padding: '6px 12px', backgroundColor: '#1f1f2e', border: '1px solid #2d2d3d', borderRadius: '6px', fontSize: '13px', color: '#e5e7eb', cursor: 'pointer' },
  toolButtonPrimary: { padding: '6px 12px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '6px', fontSize: '13px', color: '#fff', cursor: 'pointer' },
  zoomControl: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px', fontSize: '13px', color: '#9ca3af' },
  zoomSlider: { width: '80px', accentColor: '#7c3aed' },
  caseButtons: { display: 'flex', border: '1px solid #2d2d3d', borderRadius: '6px', overflow: 'hidden' },
  caseButton: { padding: '6px 10px', backgroundColor: '#1f1f2e', border: 'none', borderRight: '1px solid #2d2d3d', fontSize: '13px', color: '#e5e7eb', cursor: 'pointer' },
  legatoButton: { padding: '6px 12px', backgroundColor: '#1f1f2e', border: '1px solid #2d2d3d', borderRadius: '6px', fontSize: '13px', color: '#e5e7eb', cursor: 'pointer' },
  censorLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#9ca3af', cursor: 'pointer' },
  timelineContainer: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', backgroundColor: '#0a0a0f' },
  playButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '50%', color: '#fff', cursor: 'pointer', flexShrink: 0 },
  timeline: { flex: 1, height: '50px', backgroundColor: '#1a1a2e', borderRadius: '8px', overflowX: 'auto', overflowY: 'hidden', position: 'relative', cursor: 'pointer' },
  timelineInner: { position: 'relative', height: '100%', minWidth: '100%' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: '2px', backgroundColor: '#ef4444', zIndex: 10, pointerEvents: 'none' },
  wordBlock: { position: 'absolute', top: '8px', height: '34px', backgroundColor: '#7c3aed', border: '1px solid #9333ea', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', userSelect: 'none', overflow: 'hidden', transition: 'background-color 0.1s' },
  wordBlockSelected: { backgroundColor: '#9333ea', border: '2px solid #a855f7', boxShadow: '0 2px 8px rgba(168, 85, 247, 0.5)' },
  wordBlockCurrent: { backgroundColor: '#22c55e', border: '2px solid #4ade80' },
  resizeHandle: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', backgroundColor: 'transparent' },
  wordText: { fontSize: '11px', fontWeight: '600', color: '#fff', padding: '0 8px', whiteSpace: 'nowrap' },
  bottomSections: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1px', backgroundColor: '#1f1f2e', flex: 1, overflow: 'hidden', minHeight: '200px' },
  linePreviewSection: { backgroundColor: '#111118', padding: '16px 20px', overflow: 'auto' },
  sectionTitle: { margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#e5e7eb' },
  linesContainer: { display: 'flex', flexDirection: 'column', gap: '8px' },
  lineRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  wordChip: { display: 'inline-block', padding: '6px 10px', backgroundColor: '#1f1f2e', borderRadius: '4px', fontSize: '13px', fontWeight: '500', color: '#e5e7eb', transition: 'all 0.1s', border: '1px solid #2d2d3d' },
  wordChipActive: { backgroundColor: '#22c55e', color: '#fff', border: '1px solid #4ade80', boxShadow: '0 0 0 2px rgba(34, 197, 94, 0.3)' },
  noWords: { color: '#6b7280', fontSize: '13px', fontStyle: 'italic' },
  wordEditorSection: { backgroundColor: '#111118', padding: '16px 20px', borderLeft: '1px solid #1f1f2e', display: 'flex', flexDirection: 'column' },
  wordEditorContent: { flex: 1, display: 'flex', flexDirection: 'column' },
  livePreview: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80px', marginBottom: '16px', backgroundColor: '#0a0a0f', borderRadius: '12px' },
  livePreviewText: { fontSize: '32px', fontWeight: '600', color: '#fff', textAlign: 'center' },
  noActiveWord: { color: '#6b7280', fontSize: '14px', textAlign: 'center', padding: '40px 0' },
  wordEditForm: { display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1f1f2e', paddingTop: '12px' },
  wordEditRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  wordEditLabel: { width: '60px', fontSize: '12px', color: '#9ca3af' },
  wordEditInput: { flex: 1, padding: '6px 10px', backgroundColor: '#0a0a0f', border: '1px solid #2d2d3d', borderRadius: '6px', fontSize: '12px', color: '#fff', outline: 'none' },
  footer: { display: 'flex', justifyContent: 'flex-end', padding: '16px 20px', borderTop: '1px solid #1f1f2e', backgroundColor: '#0a0a0f' },
  saveButton: { padding: '10px 20px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', color: '#fff', cursor: 'pointer' }
};

export default WordTimeline;
