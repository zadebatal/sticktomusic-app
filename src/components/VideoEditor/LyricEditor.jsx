import React, { useState, useRef, useEffect, useCallback } from 'react';
import { parseLyrics, parseLyricsIntoLines } from './AutoRemixEngine';
import { DisplayModeSelector } from './TemplateSelector';

/**
 * Lyric Editor - Import, sync, and manage lyrics with tap-to-sync
 */
const LyricEditor = ({
  words = [],
  lyrics = '',
  beats = [],
  currentTime = 0,
  displayMode = 'word',
  onWordsChange,
  onLyricsChange,
  onDisplayModeChange,
  isPlaying,
  onPlay,
  onPause,
  audioRef
}) => {
  const [mode, setMode] = useState('edit'); // edit, tapSync, manual
  const [tapSyncIndex, setTapSyncIndex] = useState(0);
  const [tapSyncWords, setTapSyncWords] = useState([]);
  const [tapSyncTimes, setTapSyncTimes] = useState([]);
  const containerRef = useRef(null);

  // Parse lyrics when they change
  const handleLyricsChange = (newLyrics) => {
    onLyricsChange?.(newLyrics);
    const parsed = parseLyrics(newLyrics);
    setTapSyncWords(parsed);
  };

  // Start tap-to-sync mode
  const startTapSync = () => {
    if (!lyrics.trim()) {
      alert('Please enter lyrics first');
      return;
    }

    const parsed = parseLyrics(lyrics);
    setTapSyncWords(parsed);
    setTapSyncIndex(0);
    setTapSyncTimes([]);
    setMode('tapSync');

    // Focus the container for keyboard events
    containerRef.current?.focus();
  };

  // Handle tap during sync
  const handleTap = useCallback(() => {
    if (mode !== 'tapSync' || !audioRef?.current) return;

    const time = audioRef.current.currentTime;
    const newTimes = [...tapSyncTimes, time];
    setTapSyncTimes(newTimes);
    setTapSyncIndex(prev => prev + 1);

    // Check if we've synced all words
    if (tapSyncIndex + 1 >= tapSyncWords.length) {
      // Finish syncing
      finishTapSync(newTimes);
    }
  }, [mode, audioRef, tapSyncTimes, tapSyncIndex, tapSyncWords]);

  // Finish tap sync and generate word timings
  const finishTapSync = (times) => {
    const newWords = tapSyncWords.map((text, i) => {
      const startTime = times[i] || 0;
      const endTime = times[i + 1] || startTime + 0.5;
      return {
        id: `word_${Date.now()}_${i}`,
        text,
        startTime,
        duration: endTime - startTime,
        index: i
      };
    });

    onWordsChange?.(newWords);
    setMode('edit');
    onPause?.();
  };

  // Cancel tap sync
  const cancelTapSync = () => {
    setMode('edit');
    setTapSyncIndex(0);
    setTapSyncTimes([]);
    onPause?.();
  };

  // Keyboard handler for tap sync
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (mode === 'tapSync') {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleTap();
        } else if (e.code === 'Escape') {
          cancelTapSync();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, handleTap]);

  // Auto-sync to beats
  const autoSyncToBeats = () => {
    if (!lyrics.trim() || beats.length === 0) {
      alert('Need lyrics and beats to auto-sync');
      return;
    }

    const parsed = parseLyrics(lyrics);
    const newWords = parsed.map((text, i) => {
      const beatIndex = Math.min(i, beats.length - 1);
      const startTime = beats[beatIndex] || 0;
      const nextBeat = beats[beatIndex + 1] || startTime + 0.5;
      return {
        id: `word_${Date.now()}_${i}`,
        text,
        startTime,
        duration: nextBeat - startTime,
        index: i
      };
    });

    onWordsChange?.(newWords);
  };

  // Get current word during playback
  const getCurrentWord = () => {
    return words.find(w =>
      currentTime >= w.startTime && currentTime < w.startTime + w.duration
    );
  };

  const currentWord = getCurrentWord();

  return (
    <div
      ref={containerRef}
      style={styles.container}
      tabIndex={0}
    >
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>Lyrics</h3>
        <DisplayModeSelector
          selectedMode={displayMode}
          onChange={onDisplayModeChange}
        />
      </div>

      {/* Mode: Edit */}
      {mode === 'edit' && (
        <>
          {/* Lyrics Input */}
          <textarea
            placeholder="Paste lyrics here...&#10;&#10;Each word will be synced to beats."
            value={lyrics}
            onChange={(e) => handleLyricsChange(e.target.value)}
            style={styles.lyricsInput}
          />

          {/* Sync Actions */}
          <div style={styles.syncActions}>
            <button
              style={styles.syncButton}
              onClick={startTapSync}
              disabled={!lyrics.trim()}
            >
              🎯 Tap to Sync
            </button>
            <button
              style={styles.syncButton}
              onClick={autoSyncToBeats}
              disabled={!lyrics.trim() || beats.length === 0}
            >
              ⚡ Auto-Sync to Beats
            </button>
          </div>

          {/* Synced Words Preview */}
          {words.length > 0 && (
            <div style={styles.wordsPreview}>
              <div style={styles.wordsPreviewHeader}>
                <span>Synced Words ({words.length})</span>
                <button
                  style={styles.clearButton}
                  onClick={() => onWordsChange?.([])}
                >
                  Clear
                </button>
              </div>
              <div style={styles.wordsList}>
                {words.map((word, i) => (
                  <div
                    key={word.id}
                    style={{
                      ...styles.wordItem,
                      ...(currentWord?.id === word.id ? styles.wordItemActive : {})
                    }}
                  >
                    <span style={styles.wordTime}>
                      {word.startTime.toFixed(2)}s
                    </span>
                    <span style={styles.wordText}>{word.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Mode: Tap Sync */}
      {mode === 'tapSync' && (
        <div style={styles.tapSyncContainer}>
          <div style={styles.tapSyncHeader}>
            <h4 style={styles.tapSyncTitle}>Tap to Sync</h4>
            <p style={styles.tapSyncInstructions}>
              Press <kbd style={styles.kbd}>Space</kbd> or <kbd style={styles.kbd}>Enter</kbd> when each word is sung
            </p>
          </div>

          {/* Progress */}
          <div style={styles.tapSyncProgress}>
            <div
              style={{
                ...styles.tapSyncProgressBar,
                width: `${(tapSyncIndex / tapSyncWords.length) * 100}%`
              }}
            />
          </div>
          <span style={styles.tapSyncCount}>
            {tapSyncIndex} / {tapSyncWords.length}
          </span>

          {/* Current Word */}
          <div style={styles.tapSyncWordDisplay}>
            {tapSyncIndex < tapSyncWords.length ? (
              <>
                <span style={styles.tapSyncPrevWord}>
                  {tapSyncWords[tapSyncIndex - 1] || ''}
                </span>
                <span style={styles.tapSyncCurrentWord}>
                  {tapSyncWords[tapSyncIndex]}
                </span>
                <span style={styles.tapSyncNextWord}>
                  {tapSyncWords[tapSyncIndex + 1] || ''}
                </span>
              </>
            ) : (
              <span style={styles.tapSyncComplete}>✓ Sync Complete!</span>
            )}
          </div>

          {/* Controls */}
          <div style={styles.tapSyncControls}>
            <button
              style={styles.tapSyncTapButton}
              onClick={handleTap}
            >
              TAP (Space)
            </button>
            <button
              style={styles.tapSyncCancelButton}
              onClick={cancelTapSync}
            >
              Cancel (Esc)
            </button>
          </div>

          {/* Play control hint */}
          {!isPlaying && tapSyncIndex === 0 && (
            <p style={styles.tapSyncHint}>
              Press Play on the video, then tap along to the lyrics
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    outline: 'none'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: '600',
    color: '#e2e8f0'
  },
  lyricsInput: {
    width: '100%',
    minHeight: '120px',
    padding: '12px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: 'white',
    fontSize: '13px',
    fontFamily: 'monospace',
    resize: 'vertical',
    lineHeight: '1.6'
  },
  syncActions: {
    display: 'flex',
    gap: '8px'
  },
  syncButton: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#334155',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  wordsPreview: {
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  wordsPreviewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#1e293b',
    fontSize: '12px',
    color: '#94a3b8'
  },
  clearButton: {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: '1px solid #475569',
    borderRadius: '4px',
    color: '#94a3b8',
    fontSize: '11px',
    cursor: 'pointer'
  },
  wordsList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    padding: '12px',
    maxHeight: '150px',
    overflow: 'auto'
  },
  wordItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: '#1e293b',
    borderRadius: '4px',
    fontSize: '12px'
  },
  wordItemActive: {
    backgroundColor: '#7c3aed',
    color: 'white'
  },
  wordTime: {
    color: '#64748b',
    fontSize: '10px',
    fontFamily: 'monospace'
  },
  wordText: {
    color: '#e2e8f0'
  },
  tapSyncContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
    padding: '24px',
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    textAlign: 'center'
  },
  tapSyncHeader: {},
  tapSyncTitle: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    fontWeight: '600',
    color: 'white'
  },
  tapSyncInstructions: {
    margin: 0,
    fontSize: '13px',
    color: '#94a3b8'
  },
  kbd: {
    display: 'inline-block',
    padding: '2px 6px',
    backgroundColor: '#334155',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  tapSyncProgress: {
    width: '100%',
    height: '8px',
    backgroundColor: '#334155',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  tapSyncProgressBar: {
    height: '100%',
    backgroundColor: '#7c3aed',
    transition: 'width 0.2s'
  },
  tapSyncCount: {
    fontSize: '14px',
    color: '#94a3b8'
  },
  tapSyncWordDisplay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    minHeight: '80px'
  },
  tapSyncPrevWord: {
    fontSize: '18px',
    color: '#475569'
  },
  tapSyncCurrentWord: {
    fontSize: '36px',
    fontWeight: 'bold',
    color: '#7c3aed',
    padding: '8px 24px',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    borderRadius: '8px'
  },
  tapSyncNextWord: {
    fontSize: '18px',
    color: '#64748b'
  },
  tapSyncComplete: {
    fontSize: '24px',
    color: '#22c55e'
  },
  tapSyncControls: {
    display: 'flex',
    gap: '12px'
  },
  tapSyncTapButton: {
    padding: '16px 48px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    fontSize: '18px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.1s'
  },
  tapSyncCancelButton: {
    padding: '16px 24px',
    backgroundColor: '#475569',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    fontSize: '14px',
    cursor: 'pointer'
  },
  tapSyncHint: {
    fontSize: '13px',
    color: '#64748b',
    fontStyle: 'italic'
  }
};

export default LyricEditor;
