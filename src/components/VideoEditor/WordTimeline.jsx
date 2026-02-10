import React, { useState, useRef, useEffect, useCallback } from 'react';
import log from '../../utils/logger';
import useIsMobile from '../../hooks/useIsMobile';

/**
 * WordTimeline - Flowstage-inspired word timing editor
 * Features draggable/resizable word blocks, zoom, auto-scroll, and live preview
 *
 * TIME WINDOW CONTRACT:
 * This component expects ALL word timestamps to be in LOCAL time.
 * LOCAL time means 0 = start of trimmed range, not start of full audio file.
 * The parent component is responsible for normalizing word data
 * using the timelineNormalization utility before passing it here.
 *
 * Word objects must have: { id, text, startTime (LOCAL), duration }
 *
 * @see src/utils/timelineNormalization.js for normalization functions
 * @see docs/DOMAIN_INVARIANTS.md Section A for time window rules
 */
const WordTimeline = ({
  words = [],
  setWords,
  duration = 30,
  currentTime = 0,
  onSeek,
  isPlaying,
  onPlayPause,
  onClose,
  audioRef, // Add audioRef for direct time tracking
  loadedBankLyricId = null, // ID of lyric loaded from bank (if any)
  onSaveToBank, // Callback to save word timings back to bank (update existing)
  onAddToBank // Callback to add new lyrics to bank (create new)
}) => {
  // Mobile responsive detection
  const { isMobile } = useIsMobile();

  const [zoom, setZoom] = useState(() => {
    try {
      const saved = localStorage.getItem('stm_wordtimeline_zoom');
      return saved ? parseFloat(saved) : 1;
    } catch { return 1; }
  });
  // Multi-select: array of selected word indices
  const [selectedWordIndices, setSelectedWordIndices] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null); // For shift+click range selection
  const [dragState, setDragState] = useState(null);
  const [playheadDragging, setPlayheadDragging] = useState(false);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false); // Track if we're dragging selected words
  // Marquee selection state
  const [marqueeSelection, setMarqueeSelection] = useState(null); // { startX, startY, currentX, currentY }
  const justFinishedMarqueeRef = useRef(false); // Prevent click from clearing selection after marquee
  const justFinishedDragRef = useRef(false); // Prevent click from clearing selection after drag
  const [autoCensor, setAutoCensor] = useState(true);
  const [localTime, setLocalTime] = useState(currentTime); // Local playhead time for smooth animation
  const [editingWordId, setEditingWordId] = useState(null); // Which word is being edited inline
  const [editText, setEditText] = useState(''); // Text being edited
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, index: -1, text: '' }); // Delete confirmation
  const [saveToBankPrompt, setSaveToBankPrompt] = useState({ show: false, name: '' }); // Save to bank prompt
  const timelineRef = useRef(null);
  const animationRef = useRef(null);
  const editInputRef = useRef(null);
  const waveformCanvasRef = useRef(null);
  const modalRef = useRef(null);
  const [waveformData, setWaveformData] = useState(null); // Array of peak values for waveform
  const [audioBufferReady, setAudioBufferReady] = useState(false); // Track when buffer is decoded

  // Undo history (stores previous word states)
  const historyRef = useRef([]);
  const MAX_HISTORY = 50;

  // Refs to hold latest callback functions (avoids stale closures in keyboard handler)
  const callbacksRef = useRef({});

  // Audio scrubbing refs
  const scrubContextRef = useRef(null);
  const scrubBufferRef = useRef(null);
  const scrubSourceRef = useRef(null);
  const lastScrubTimeRef = useRef(0);
  const scrubIntervalRef = useRef(null);

  // Initialize audio scrubbing - decode audio for scrub playback
  useEffect(() => {
    const initScrubAudio = async () => {
      if (!audioRef?.current?.src) return;

      try {
        // Create audio context for scrubbing
        if (!scrubContextRef.current) {
          scrubContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Fetch and decode the audio
        const response = await fetch(audioRef.current.src);
        const arrayBuffer = await response.arrayBuffer();
        scrubBufferRef.current = await scrubContextRef.current.decodeAudioData(arrayBuffer);
        setAudioBufferReady(true);
        log('[Scrub] Audio buffer ready for scrubbing and waveform');
      } catch (err) {
        console.warn('[Scrub] Could not init scrub audio:', err.message);
        setAudioBufferReady(false);
      }
    };

    initScrubAudio();

    return () => {
      // Cleanup on unmount
      if (scrubSourceRef.current) {
        try { scrubSourceRef.current.stop(); } catch {}
      }
      if (scrubIntervalRef.current) {
        clearInterval(scrubIntervalRef.current);
      }
    };
  }, [audioRef?.current?.src]);

  // Play a short audio snippet at the given time (for scrubbing)
  const playScrubSnippet = useCallback((time) => {
    if (!scrubContextRef.current || !scrubBufferRef.current) return;

    // Get the start boundary (trim offset)
    const startBoundary = audioRef?.current?._startBoundary || 0;
    const globalTime = startBoundary + time;

    // Don't play if out of bounds
    if (globalTime < 0 || globalTime >= scrubBufferRef.current.duration) return;

    // Stop any existing scrub source
    if (scrubSourceRef.current) {
      try { scrubSourceRef.current.stop(); } catch {}
    }

    // Create a new source for this snippet
    const source = scrubContextRef.current.createBufferSource();
    source.buffer = scrubBufferRef.current;
    source.connect(scrubContextRef.current.destination);

    // Play a short snippet (50ms)
    const snippetDuration = 0.05;
    source.start(0, globalTime, snippetDuration);
    scrubSourceRef.current = source;
  }, [audioRef]);

  // Generate waveform data from audio buffer
  useEffect(() => {
    if (!audioBufferReady || !scrubBufferRef.current) return;

    const buffer = scrubBufferRef.current;
    const startBoundary = audioRef?.current?._startBoundary || 0;
    const sampleRate = buffer.sampleRate;

    // Get the relevant portion of the audio (trimmed range)
    const startSample = Math.floor(startBoundary * sampleRate);
    const endSample = Math.floor((startBoundary + duration) * sampleRate);
    const channelData = buffer.getChannelData(0); // Use first channel

    // Calculate number of peaks we need (one per 2 pixels at zoom 1)
    const peaksPerSecond = 40; // 40 peaks per second gives good resolution
    const totalPeaks = Math.ceil(duration * peaksPerSecond);
    const samplesPerPeak = Math.floor((endSample - startSample) / totalPeaks);

    if (samplesPerPeak <= 0) return;

    const peaks = [];
    for (let i = 0; i < totalPeaks; i++) {
      const start = startSample + (i * samplesPerPeak);
      const end = Math.min(start + samplesPerPeak, channelData.length);

      let max = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j] || 0);
        if (abs > max) max = abs;
      }
      peaks.push(max);
    }

    setWaveformData(peaks);
    log('[Waveform] Generated', peaks.length, 'peaks');
  }, [audioBufferReady, duration, audioRef]);

  // Draw waveform on canvas when zoom changes or waveform data updates
  useEffect(() => {
    if (!waveformData || !waveformCanvasRef.current) return;

    const canvas = waveformCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = getTimelineWidth();
    const height = 50; // Waveform height

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw waveform
    const barWidth = width / waveformData.length;
    const centerY = height / 2;

    ctx.fillStyle = 'rgba(139, 92, 246, 0.4)'; // Purple, semi-transparent

    waveformData.forEach((peak, i) => {
      const x = i * barWidth;
      const barHeight = peak * height * 0.9; // Scale to 90% of height

      // Draw bar centered vertically
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 0.5), barHeight);
    });

    // Add a subtle gradient overlay
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.1)');
    gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

  }, [waveformData, zoom, duration]);

  // Save current state to undo history
  const saveToHistory = useCallback(() => {
    historyRef.current.push(JSON.parse(JSON.stringify(words)));
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift(); // Remove oldest
    }
  }, [words]);

  // Undo last action
  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const previousState = historyRef.current.pop();
    setWords(previousState);
  }, [setWords]);

  // Sync localTime with currentTime prop when not playing
  useEffect(() => {
    if (!isPlaying && !playheadDragging) {
      setLocalTime(currentTime);
    }
  }, [currentTime, isPlaying, playheadDragging]);

  // Persist zoom level
  useEffect(() => {
    try {
      localStorage.setItem('stm_wordtimeline_zoom', zoom.toString());
    } catch { /* ignore */ }
  }, [zoom]);

  // Animate playhead during playback using requestAnimationFrame
  useEffect(() => {
    if (isPlaying && audioRef?.current && !playheadDragging) {
      const startBoundary = audioRef.current._startBoundary || 0;

      const updatePlayhead = () => {
        if (!audioRef?.current) return;

        const actualTime = audioRef.current.currentTime;
        const relativeTime = actualTime - startBoundary;
        setLocalTime(Math.max(0, relativeTime));

        if (isPlaying) {
          animationRef.current = requestAnimationFrame(updatePlayhead);
        }
      };

      animationRef.current = requestAnimationFrame(updatePlayhead);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, audioRef, playheadDragging]);

  // Find the current word based on playhead position (use localTime for smooth tracking)
  const displayTime = isPlaying && !playheadDragging ? localTime : currentTime;

  // Get the index of the word at the playhead position
  const currentWordIndex = words.findIndex(word =>
    displayTime >= word.startTime && displayTime < word.startTime + (word.duration || 0.5)
  );
  const currentWord = currentWordIndex >= 0 ? words[currentWordIndex] : null;

  // Get the effective word index for operations (first selected or at playhead)
  const getEffectiveWordIndex = useCallback(() => {
    if (selectedWordIndices.length > 0) return selectedWordIndices[0];
    return currentWordIndex;
  }, [selectedWordIndices, currentWordIndex]);

  // Check if a word is selected
  const isWordSelected = useCallback((index) => {
    return selectedWordIndices.includes(index);
  }, [selectedWordIndices]);

  // Select all words
  const selectAllWords = useCallback(() => {
    setSelectedWordIndices(words.map((_, i) => i));
  }, [words]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedWordIndices([]);
    setLastSelectedIndex(null);
  }, []);

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
    if (!isPlaying || !timelineRef.current || playheadDragging) return;

    const timeline = timelineRef.current;
    const playheadPosition = timeToPixels(displayTime);
    const timelineWidth = timeline.clientWidth;
    const scrollLeft = timeline.scrollLeft;

    // Keep playhead in the middle-ish of the visible area
    const margin = timelineWidth * 0.3;

    if (playheadPosition < scrollLeft + margin) {
      timeline.scrollTo({ left: Math.max(0, playheadPosition - margin), behavior: 'smooth' });
    } else if (playheadPosition > scrollLeft + timelineWidth - margin) {
      timeline.scrollTo({ left: playheadPosition - timelineWidth + margin, behavior: 'smooth' });
    }
  }, [displayTime, isPlaying, timeToPixels, playheadDragging]);

  // Trackpad pinch-to-zoom handler
  const handleTimelineWheel = useCallback((e) => {
    // Pinch zoom is reported as wheel event with ctrlKey on trackpads
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      // Calculate zoom change based on wheel delta
      const zoomSensitivity = 0.01;
      const delta = -e.deltaY * zoomSensitivity;

      // Get cursor position relative to timeline for zoom centering
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;

      const scrollLeft = timelineRef.current?.scrollLeft || 0;
      const cursorX = e.clientX - rect.left + scrollLeft;
      const cursorTime = pixelsToTime(cursorX);

      // Calculate new zoom level
      const newZoom = Math.max(0.5, Math.min(3, zoom + delta));

      if (newZoom !== zoom) {
        setZoom(newZoom);

        // Adjust scroll position to keep cursor position stable
        requestAnimationFrame(() => {
          if (!timelineRef.current) return;
          const newPixelsPerSecond = 80 * newZoom;
          const newCursorX = cursorTime * newPixelsPerSecond;
          const cursorOffset = e.clientX - rect.left;
          timelineRef.current.scrollLeft = newCursorX - cursorOffset;
        });
      }
    }
  }, [zoom, pixelsToTime]);

  // Attach wheel handler with passive: false to allow preventDefault
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    timeline.addEventListener('wheel', handleTimelineWheel, { passive: false });
    return () => timeline.removeEventListener('wheel', handleTimelineWheel);
  }, [handleTimelineWheel]);

  // Handle word block click for selection (with modifier keys)
  const handleWordClick = (e, index) => {
    e.stopPropagation();

    if (e.shiftKey && lastSelectedIndex !== null) {
      // Shift+click: range selection
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIndices = [];
      for (let i = start; i <= end; i++) {
        rangeIndices.push(i);
      }
      setSelectedWordIndices(rangeIndices);
    } else if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl+click: toggle selection
      setSelectedWordIndices(prev => {
        if (prev.includes(index)) {
          return prev.filter(i => i !== index);
        } else {
          return [...prev, index].sort((a, b) => a - b);
        }
      });
      setLastSelectedIndex(index);
    } else {
      // Regular click: single selection (unless already part of multi-selection)
      if (!selectedWordIndices.includes(index) || selectedWordIndices.length === 1) {
        setSelectedWordIndices([index]);
      }
      setLastSelectedIndex(index);
    }
  };

  // Handle word block dragging/resizing (pointer events for mouse + touch)
  const handleWordPointerDown = (e, index, type = 'move') => {
    e.stopPropagation();
    const word = words[index];

    // Check if clicked word is part of current multi-selection FIRST
    const isPartOfMultiSelection = selectedWordIndices.includes(index) && selectedWordIndices.length > 1;

    // If part of multi-selection, ALWAYS treat as move (even if clicking resize handles)
    // This ensures dragging any part of a selected word moves all selected words
    const effectiveType = isPartOfMultiSelection ? 'move' : type;

    // Determine which indices we're dragging BEFORE any state changes
    let indicesToDrag;

    if (effectiveType === 'move') {
      if (isPartOfMultiSelection) {
        // Dragging a multi-selection - keep all selected words, make a copy of the array
        indicesToDrag = [...selectedWordIndices];
      } else {
        // Clicking on unselected word or single selection - select just this word
        indicesToDrag = [index];
        // Update selection to this word only
        setSelectedWordIndices([index]);
        setLastSelectedIndex(index);
      }
    } else {
      // For resize operations on single word, only work with that word
      indicesToDrag = [index];
    }

    // Save to history before dragging starts
    saveToHistory();

    // Store initial times for ALL words being dragged
    const initialTimes = {};
    indicesToDrag.forEach(idx => {
      initialTimes[idx] = words[idx].startTime;
    });

    setDragState({
      index,
      type: effectiveType,
      indicesToDrag,
      initialTimes,
      startX: e.clientX,
      startTime: word.startTime,
      startDuration: word.duration || 0.5
    });
    setIsDraggingSelection(effectiveType === 'move' && indicesToDrag.length > 1);
  };

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e) => {
      const deltaX = e.clientX - dragState.startX;
      const deltaTime = pixelsToTime(deltaX);

      setWords(prev => {
        const newWords = [...prev];

        if (dragState.type === 'move') {
          // Move all selected words together
          const indicesToMove = dragState.indicesToDrag || [dragState.index];

          indicesToMove.forEach(idx => {
            const word = { ...newWords[idx] };
            const initialTime = dragState.initialTimes?.[idx] ?? dragState.startTime;
            const newStartTime = Math.max(0, Math.min(duration - (word.duration || 0.5), initialTime + deltaTime));
            word.startTime = newStartTime;
            newWords[idx] = word;
          });
        } else if (dragState.type === 'resize-left') {
          const word = { ...newWords[dragState.index] };
          const newStartTime = Math.max(0, dragState.startTime + deltaTime);
          const endTime = dragState.startTime + dragState.startDuration;
          const newDuration = Math.max(0.1, endTime - newStartTime);
          word.startTime = newStartTime;
          word.duration = newDuration;
          newWords[dragState.index] = word;
        } else if (dragState.type === 'resize-right') {
          const word = { ...newWords[dragState.index] };
          const newDuration = Math.max(0.1, dragState.startDuration + deltaTime);
          word.duration = newDuration;
          newWords[dragState.index] = word;
        }

        return newWords;
      });
    };

    const handlePointerUp = () => {
      // Set flag to prevent click from clearing selection after drag
      justFinishedDragRef.current = true;
      setDragState(null);
      setIsDraggingSelection(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, pixelsToTime, duration, setWords]);

  // Handle playhead dragging (pointer events for mouse + touch)
  const handlePlayheadPointerDown = (e) => {
    e.stopPropagation();
    setPlayheadDragging(true);
    // Pause playback when drag starts to prevent audio from restarting
    if (isPlaying) {
      onPlayPause?.();
    }
  };

  useEffect(() => {
    if (!playheadDragging) return;

    let lastScrubTime = Date.now();

    const handlePointerMove = (e) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scrollLeft = timelineRef.current?.scrollLeft || 0;
      const clickX = e.clientX - rect.left + scrollLeft;
      const time = pixelsToTime(clickX);
      const clampedTime = Math.max(0, Math.min(duration, time));
      onSeek?.(clampedTime);

      // Play scrub audio snippet (throttled to every 50ms)
      const now = Date.now();
      if (now - lastScrubTime > 50) {
        playScrubSnippet(clampedTime);
        lastScrubTime = now;
      }
    };

    const handlePointerUp = () => {
      setPlayheadDragging(false);
      // Stop any playing scrub audio
      if (scrubSourceRef.current) {
        try { scrubSourceRef.current.stop(); } catch {}
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [playheadDragging, pixelsToTime, duration, onSeek, playScrubSnippet]);

  const handleTimelineClick = (e) => {
    if (dragState || playheadDragging || marqueeSelection) return;

    // Don't clear selection if we just finished a marquee selection
    if (justFinishedMarqueeRef.current) {
      justFinishedMarqueeRef.current = false;
      return;
    }

    // Don't clear selection if we just finished a drag operation
    if (justFinishedDragRef.current) {
      justFinishedDragRef.current = false;
      return;
    }

    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scrollLeft = timelineRef.current?.scrollLeft || 0;
    const clickX = e.clientX - rect.left + scrollLeft;
    const time = pixelsToTime(clickX);
    const clampedTime = Math.max(0, Math.min(duration, time));
    onSeek?.(clampedTime);
    // Play a short audio snippet at the clicked position
    playScrubSnippet(clampedTime);
    // Clear selection when clicking empty timeline space
    if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
      clearSelection();
    }
  };

  // Start marquee selection on pointer down in empty timeline space
  const handleTimelinePointerDown = (e) => {
    // Don't start marquee if clicking on word blocks (they have their own drag handlers)
    if (e.target.closest('[data-word-block]')) return;
    // Don't start marquee if clicking on playhead
    if (e.target.closest('[data-playhead]')) return;
    // Don't start if already dragging
    if (dragState || playheadDragging) return;

    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;

    const scrollLeft = timelineRef.current?.scrollLeft || 0;
    const startX = e.clientX - rect.left + scrollLeft;
    const startY = e.clientY - rect.top;

    setMarqueeSelection({
      startX,
      startY,
      currentX: startX,
      currentY: startY
    });

    // Clear existing selection unless shift is held
    if (!e.shiftKey) {
      clearSelection();
    }
  };

  // Marquee selection effect (pointer events for mouse + touch)
  useEffect(() => {
    if (!marqueeSelection) return;

    const handlePointerMove = (e) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect) return;

      const scrollLeft = timelineRef.current?.scrollLeft || 0;
      const currentX = e.clientX - rect.left + scrollLeft;
      const currentY = e.clientY - rect.top;

      setMarqueeSelection(prev => ({
        ...prev,
        currentX,
        currentY
      }));

      // Calculate which words fall within the marquee
      const minX = Math.min(marqueeSelection.startX, currentX);
      const maxX = Math.max(marqueeSelection.startX, currentX);

      const selectedIndices = [];
      words.forEach((word, index) => {
        const wordLeft = timeToPixels(word.startTime);
        const wordRight = wordLeft + timeToPixels(word.duration || 0.5);

        // Check if word overlaps with marquee (horizontal overlap is enough)
        if (wordRight >= minX && wordLeft <= maxX) {
          selectedIndices.push(index);
        }
      });

      setSelectedWordIndices(selectedIndices);
    };

    const handlePointerUp = () => {
      // Only set flag if there was actual dragging (marquee had some size)
      // This allows simple clicks to pass through to the click handler for seeking
      const hasDragged = marqueeSelection && (
        Math.abs(marqueeSelection.currentX - marqueeSelection.startX) > 5 ||
        Math.abs(marqueeSelection.currentY - marqueeSelection.startY) > 5
      );
      if (hasDragged) {
        justFinishedMarqueeRef.current = true;
      }
      setMarqueeSelection(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [marqueeSelection, words, timeToPixels, clearSelection]);

  const handleAddWord = () => {
    const text = prompt('Enter word text:');
    if (!text) return;
    const newWord = {
      id: `word_${Date.now()}`,
      text,
      startTime: displayTime,
      duration: 0.5
    };
    setWords(prev => [...prev, newWord].sort((a, b) => a.startTime - b.startTime));
  };

  const handleDeleteWord = () => {
    // Delete all selected words, or word at playhead
    const indicesToDelete = selectedWordIndices.length > 0 ? selectedWordIndices : (currentWordIndex >= 0 ? [currentWordIndex] : []);
    if (indicesToDelete.length === 0) return;

    const wordTexts = indicesToDelete.map(i => words[i]?.text).filter(Boolean).join(', ');
    setDeleteConfirm({
      show: true,
      indices: indicesToDelete,
      text: indicesToDelete.length === 1 ? wordTexts : `${indicesToDelete.length} words`
    });
  };

  const confirmDelete = () => {
    if (deleteConfirm.indices?.length > 0) {
      saveToHistory();
      const indicesToDelete = new Set(deleteConfirm.indices);
      setWords(prev => prev.filter((_, i) => !indicesToDelete.has(i)));
      clearSelection();
    }
    setDeleteConfirm({ show: false, indices: [], text: '' });
  };

  const cancelDelete = () => {
    setDeleteConfirm({ show: false, indices: [], text: '' });
  };

  // Cut word at playhead position - splits timing without changing text
  const handleCutWord = () => {
    const index = getEffectiveWordIndex();
    if (index < 0) return;
    const word = words[index];

    // Cut at the current playhead position
    const cutTime = displayTime;

    // Make sure cut point is within the word
    if (cutTime <= word.startTime || cutTime >= word.startTime + word.duration) {
      // Cut at middle if playhead not inside word
      const midTime = word.startTime + word.duration / 2;
      const firstDuration = word.duration / 2;
      const secondDuration = word.duration / 2;

      // Save for undo
      saveToHistory();

      const newWords = [
        { id: `word_${Date.now()}_0`, text: word.text, startTime: word.startTime, duration: firstDuration },
        { id: `word_${Date.now()}_1`, text: word.text, startTime: midTime, duration: secondDuration }
      ];

      setWords(prev => {
        const result = [...prev];
        result.splice(index, 1, ...newWords);
        return result;
      });
    } else {
      // Cut at playhead position
      const firstDuration = cutTime - word.startTime;
      const secondDuration = (word.startTime + word.duration) - cutTime;

      // Save for undo
      saveToHistory();

      const newWords = [
        { id: `word_${Date.now()}_0`, text: word.text, startTime: word.startTime, duration: firstDuration },
        { id: `word_${Date.now()}_1`, text: word.text, startTime: cutTime, duration: secondDuration }
      ];

      setWords(prev => {
        const result = [...prev];
        result.splice(index, 1, ...newWords);
        return result;
      });
    }
  };

  const handleCombineWords = () => {
    const index = getEffectiveWordIndex();
    if (index < 0 || index >= words.length - 1) return;
    saveToHistory();
    const word1 = words[index];
    const word2 = words[index + 1];
    const combined = {
      id: word1.id,
      text: `${word1.text} ${word2.text}`,
      startTime: word1.startTime,
      duration: (word2.startTime + word2.duration) - word1.startTime
    };
    setWords(prev => {
      const result = [...prev];
      result.splice(index, 2, combined);
      return result;
    });
  };

  const handleChangeCase = (caseType) => {
    // Apply to all selected words, or word at playhead
    const indicesToChange = selectedWordIndices.length > 0 ? selectedWordIndices : (currentWordIndex >= 0 ? [currentWordIndex] : []);
    if (indicesToChange.length === 0) return;
    saveToHistory();
    setWords(prev => {
      const newWords = [...prev];
      indicesToChange.forEach(index => {
        const word = { ...newWords[index] };
        if (caseType === 'lower') word.text = word.text.toLowerCase();
        else if (caseType === 'title') word.text = word.text.charAt(0).toUpperCase() + word.text.slice(1).toLowerCase();
        else if (caseType === 'upper') word.text = word.text.toUpperCase();
        newWords[index] = word;
      });
      return newWords;
    });
  };

  const handleMakeLegato = () => {
    saveToHistory();
    setWords(prev => {
      const sorted = [...prev].sort((a, b) => a.startTime - b.startTime);
      return sorted.map((word, i) => {
        if (i === sorted.length - 1) return word;
        const nextWord = sorted[i + 1];
        return { ...word, duration: nextWord.startTime - word.startTime };
      });
    });
  };

  // Start inline editing a word
  const startEditingWord = (wordId, wordText) => {
    setEditingWordId(wordId);
    setEditText(wordText);
    // Also select the word
    const wordIndex = words.findIndex(w => w.id === wordId);
    if (wordIndex >= 0) {
      setSelectedWordIndices([wordIndex]);
      setLastSelectedIndex(wordIndex);
    }
    // Focus the input after render
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  };

  // Save inline edit
  const saveInlineEdit = () => {
    if (editingWordId === null) return;
    saveToHistory();
    setWords(prev => prev.map(w =>
      w.id === editingWordId ? { ...w, text: editText } : w
    ));
    setEditingWordId(null);
    setEditText('');
  };

  // Cancel inline edit
  const cancelInlineEdit = () => {
    setEditingWordId(null);
    setEditText('');
  };

  // Handle inline edit key events
  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveInlineEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
    }
  };

  // Click on a word chip in the line preview
  const handleWordChipClick = (e, word, index) => {
    // Support multi-select in line preview too
    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIndices = [];
      for (let i = start; i <= end; i++) {
        rangeIndices.push(i);
      }
      setSelectedWordIndices(rangeIndices);
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedWordIndices(prev => {
        if (prev.includes(index)) {
          return prev.filter(i => i !== index);
        } else {
          return [...prev, index].sort((a, b) => a - b);
        }
      });
      setLastSelectedIndex(index);
    } else {
      setSelectedWordIndices([index]);
      setLastSelectedIndex(index);
      startEditingWord(word.id, word.text);
    }
  };

  // Click on the live preview text
  const handleLivePreviewClick = () => {
    if (currentWord) {
      startEditingWord(currentWord.id, currentWord.text);
    }
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
      currentLine.push({ ...word, globalIndex: i });
      const nextWord = words[i + 1];
      if (currentLine.length >= 6 || (nextWord && nextWord.startTime - (word.startTime + word.duration) > 1)) {
        lines.push(currentLine);
        currentLine = [];
      }
    });
    if (currentLine.length > 0) lines.push(currentLine);
    return lines;
  };

  // Nudge selected words with arrow keys
  const nudgeSelectedWords = useCallback((direction) => {
    if (selectedWordIndices.length === 0) return;
    const nudgeAmount = 0.05; // 50ms
    saveToHistory();
    setWords(prev => {
      const newWords = [...prev];
      selectedWordIndices.forEach(idx => {
        const word = { ...newWords[idx] };
        word.startTime = Math.max(0, Math.min(duration - (word.duration || 0.5), word.startTime + (direction * nudgeAmount)));
        newWords[idx] = word;
      });
      return newWords;
    });
  }, [selectedWordIndices, saveToHistory, setWords, duration]);

  // Keep callbacks ref updated (avoids re-registering keyboard listener on every render)
  useEffect(() => {
    callbacksRef.current = {
      onPlayPause,
      onClose,
      handleDeleteWord,
      cancelDelete,
      confirmDelete,
      cancelInlineEdit,
      getEffectiveWordIndex,
      handleUndo,
      selectAllWords,
      clearSelection,
      nudgeSelectedWords
    };
  });

  // Keyboard shortcuts - use refs to avoid constant re-registration
  useEffect(() => {
    const handleKeyDown = (e) => {
      const {
        onPlayPause: playPause,
        onClose: close,
        handleDeleteWord: deleteWord,
        cancelDelete: cancelDel,
        confirmDelete: confirmDel,
        cancelInlineEdit: cancelEdit,
        getEffectiveWordIndex: getIndex,
        handleUndo: undo,
        selectAllWords: selectAll,
        clearSelection: clearSel,
        nudgeSelectedWords: nudge
      } = callbacksRef.current;

      // Command/Ctrl+A to select all (when not editing)
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !editingWordId && !deleteConfirm.show) {
        e.preventDefault();
        selectAll?.();
        return;
      }

      // Command/Ctrl+Z to undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !editingWordId) {
        e.preventDefault();
        undo?.();
        return;
      }

      // Arrow keys to nudge selected words
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !editingWordId && !deleteConfirm.show) {
        e.preventDefault();
        nudge?.(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }

      // Escape to cancel delete confirmation, clear selection, or close modal
      if (e.key === 'Escape') {
        if (deleteConfirm.show) {
          cancelDel?.();
        } else if (editingWordId) {
          cancelEdit?.();
        } else if (selectedWordIndices.length > 0) {
          clearSel?.();
        } else {
          close?.();
        }
        return;
      }

      // Enter to confirm delete
      if (e.key === 'Enter' && deleteConfirm.show) {
        e.preventDefault();
        confirmDel?.();
        return;
      }

      // Space to toggle play/pause (when not editing and not in a text input)
      if (e.key === ' ' && !editingWordId && !deleteConfirm.show) {
        // Don't trigger if focus is on an input or textarea (but buttons are OK)
        const tagName = document.activeElement?.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea') {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (typeof playPause === 'function') {
          playPause();
        }
        return;
      }

      // Delete key to delete word
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingWordId && !deleteConfirm.show) {
        const index = getIndex?.();
        if (index >= 0) {
          e.preventDefault();
          deleteWord?.();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteConfirm.show, editingWordId]); // Only re-register when these state values change

  const selectedWord = selectedWordIndices.length > 0 ? words[selectedWordIndices[0]] : null;
  const effectiveIndex = getEffectiveWordIndex();
  const hasWordAtPlayhead = effectiveIndex >= 0;

  // Auto-focus modal for keyboard events
  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  // Direct spacebar handler on modal (more reliable than window listener)
  const handleModalKeyDown = (e) => {
    if (e.key === ' ' && !editingWordId && !deleteConfirm.show) {
      const tagName = e.target?.tagName?.toLowerCase();
      if (tagName !== 'input' && tagName !== 'textarea') {
        e.preventDefault();
        e.stopPropagation();
        onPlayPause?.();
      }
    }
  };

  return (
    <div style={{
      ...styles.overlay,
      ...(isMobile ? { padding: 0 } : {})
    }}>
      <div ref={modalRef} tabIndex={-1} style={{
        ...styles.modal,
        outline: 'none',
        ...(isMobile ? {
          width: '100%',
          maxWidth: '100%',
          maxHeight: '100vh',
          height: '100vh',
          borderRadius: 0
        } : {})
      }} onKeyDown={handleModalKeyDown}>
        <div style={{
          ...styles.header,
          ...(isMobile ? { padding: '12px 16px' } : {})
        }}>
          <h2 style={{
            ...styles.title,
            ...(isMobile ? { fontSize: '16px' } : {})
          }}>Word timeline</h2>
          <button style={{
            ...styles.closeButton,
            ...(isMobile ? { width: '40px', height: '40px' } : {})
          }} onClick={onClose}>
            <svg width={isMobile ? 24 : 20} height={isMobile ? 24 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={{
          ...styles.toolbar,
          ...(isMobile ? {
            padding: '8px 12px',
            gap: '8px',
            maxHeight: '140px',
            overflowY: 'auto'
          } : {})
        }}>
          <div style={styles.timeDisplay}>
            <span style={styles.currentTimeText}>{formatTime(displayTime)}</span>
            <span style={styles.totalTime}> / {formatTime(duration)}</span>
            <span style={styles.originalTime}>(Original: {formatTime(duration)})</span>
          </div>
          <div style={{
            ...styles.toolbarButtons,
            ...(isMobile ? {
              gap: '6px',
              justifyContent: 'flex-start',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              flexWrap: 'nowrap'
            } : {})
          }}>
            <button
              style={{
                ...styles.toolButton,
                opacity: hasWordAtPlayhead ? 1 : 0.5,
                cursor: hasWordAtPlayhead ? 'pointer' : 'not-allowed',
                ...(isMobile ? { padding: '10px 14px', fontSize: '12px', whiteSpace: 'nowrap' } : {})
              }}
              onClick={handleCombineWords}
              disabled={!hasWordAtPlayhead}
              title={hasWordAtPlayhead ? 'Combine with next word' : 'Move playhead over a word'}
            >
              Combine
            </button>
            <button
              style={{
                ...styles.toolButton,
                opacity: hasWordAtPlayhead ? 1 : 0.5,
                cursor: hasWordAtPlayhead ? 'pointer' : 'not-allowed',
                ...(isMobile ? { padding: '10px 14px', fontSize: '12px', whiteSpace: 'nowrap' } : {})
              }}
              onClick={handleCutWord}
              disabled={!hasWordAtPlayhead}
              title={hasWordAtPlayhead ? 'Cut word at playhead (keeps text)' : 'Move playhead over a word'}
            >
              ✂️ Cut
            </button>
            <button style={{
              ...styles.toolButtonPrimary,
              ...(isMobile ? { padding: '10px 16px', fontSize: '12px' } : {})
            }} onClick={handleAddWord}>Add</button>
            <button
              style={{
                ...styles.toolButton,
                opacity: hasWordAtPlayhead ? 1 : 0.5,
                cursor: hasWordAtPlayhead ? 'pointer' : 'not-allowed',
                ...(isMobile ? { padding: '10px 14px', fontSize: '12px', whiteSpace: 'nowrap' } : {})
              }}
              onClick={handleDeleteWord}
              disabled={!hasWordAtPlayhead}
              title={hasWordAtPlayhead ? 'Delete word' : 'Move playhead over a word'}
            >
              Delete
            </button>
            {!isMobile && (
              <div style={styles.zoomControl}>
                <span>Zoom</span>
                <input type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={styles.zoomSlider} />
              </div>
            )}
            <div style={styles.caseButtons}>
              <button
                style={{
                  ...styles.caseButton,
                  opacity: hasWordAtPlayhead ? 1 : 0.5,
                  ...(isMobile ? { padding: '10px 12px' } : {})
                }}
                onClick={() => handleChangeCase('lower')}
                disabled={!hasWordAtPlayhead}
              >aa</button>
              <button
                style={{
                  ...styles.caseButton,
                  opacity: hasWordAtPlayhead ? 1 : 0.5,
                  ...(isMobile ? { padding: '10px 12px' } : {})
                }}
                onClick={() => handleChangeCase('title')}
                disabled={!hasWordAtPlayhead}
              >Aa</button>
              <button
                style={{
                  ...styles.caseButton,
                  opacity: hasWordAtPlayhead ? 1 : 0.5,
                  ...(isMobile ? { padding: '10px 12px' } : {})
                }}
                onClick={() => handleChangeCase('upper')}
                disabled={!hasWordAtPlayhead}
              >AA</button>
            </div>
            {!isMobile && (
              <button style={styles.legatoButton} onClick={handleMakeLegato}>Make legato</button>
            )}
            {!isMobile && (
              <label style={styles.censorLabel}>
                <input type="checkbox" checked={autoCensor} onChange={(e) => setAutoCensor(e.target.checked)} />
                Auto-censor
              </label>
            )}
            {/* Selection indicator */}
            {selectedWordIndices.length > 0 && (
              <div style={{
                ...styles.selectionIndicator,
                ...(isMobile ? { padding: '6px 10px', whiteSpace: 'nowrap' } : {})
              }}>
                <span>{selectedWordIndices.length} selected</span>
                <button style={styles.clearSelectionBtn} onClick={clearSelection} title="Clear selection (Esc)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{
          ...styles.timelineContainer,
          ...(isMobile ? { padding: '12px 16px', gap: '10px' } : {})
        }}>
          <button style={{
            ...styles.playButton,
            ...(isMobile ? { width: '48px', height: '48px' } : {})
          }} onClick={onPlayPause}>
            {isPlaying ? (
              <svg width={isMobile ? 20 : 16} height={isMobile ? 20 : 16} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg width={isMobile ? 20 : 16} height={isMobile ? 20 : 16} viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            )}
          </button>
          <div
            ref={timelineRef}
            style={{
              ...styles.timeline,
              ...(isMobile ? {
                height: '140px',
                touchAction: 'pan-x',
                WebkitOverflowScrolling: 'touch'
              } : {})
            }}
            onClick={handleTimelineClick}
            onPointerDown={handleTimelinePointerDown}
          >
            <div data-timeline-inner style={{ ...styles.timelineInner, width: getTimelineWidth() }}>
              {/* Marquee Selection Box */}
              {marqueeSelection && (
                <div
                  style={{
                    ...styles.marqueeBox,
                    left: Math.min(marqueeSelection.startX, marqueeSelection.currentX),
                    top: Math.min(marqueeSelection.startY, marqueeSelection.currentY),
                    width: Math.abs(marqueeSelection.currentX - marqueeSelection.startX),
                    height: Math.abs(marqueeSelection.currentY - marqueeSelection.startY)
                  }}
                />
              )}
              {/* Time Ruler */}
              <div style={styles.timeRuler}>
                {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
                  <div key={i} style={{ ...styles.timeMarker, left: timeToPixels(i) }}>
                    <div style={styles.timeMarkerLine} />
                    <span style={styles.timeMarkerLabel}>{i}s</span>
                  </div>
                ))}
              </div>
              {/* Audio Waveform */}
              <canvas
                ref={waveformCanvasRef}
                style={styles.waveformCanvas}
              />
              {/* Draggable Playhead */}
              <div
                data-playhead
                style={{
                  ...styles.playhead,
                  left: timeToPixels(displayTime),
                  cursor: 'ew-resize',
                  pointerEvents: 'auto',
                  width: isMobile ? '44px' : '12px',
                  marginLeft: isMobile ? '-21px' : '-5px',
                  backgroundColor: 'transparent',
                  touchAction: 'none'
                }}
                onPointerDown={handlePlayheadPointerDown}
              >
                <div style={{
                  position: 'absolute',
                  left: isMobile ? '21px' : '5px',
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  backgroundColor: '#ef4444'
                }} />
                {/* Playhead handle */}
                <div style={{
                  position: 'absolute',
                  left: isMobile ? '16px' : '0px',
                  top: '-4px',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#ef4444',
                  borderRadius: '2px',
                  transform: 'rotate(45deg)'
                }} />
              </div>
              {words.map((word, index) => (
                <div
                  key={word.id || index}
                  data-word-block
                  style={{
                    ...styles.wordBlock,
                    left: timeToPixels(word.startTime),
                    width: Math.max(isMobile ? 40 : 30, timeToPixels(word.duration || 0.5)),
                    ...(isMobile ? { height: '46px', top: '24px' } : {}),
                    ...(isWordSelected(index) ? styles.wordBlockSelected : {}),
                    ...(currentWord?.id === word.id && !isWordSelected(index) ? styles.wordBlockCurrent : {}),
                    touchAction: 'none'
                  }}
                  onPointerDown={(e) => handleWordPointerDown(e, index, 'move')}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEditingWord(word.id, word.text);
                  }}
                >
                  <div
                    style={{
                      ...styles.resizeHandle,
                      ...(isMobile ? { width: '16px' } : {}),
                      touchAction: 'none'
                    }}
                    onPointerDown={(e) => handleWordPointerDown(e, index, 'resize-left')}
                  />
                  {editingWordId === word.id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      onBlur={saveInlineEdit}
                      style={{
                        ...styles.inlineEditInput,
                        ...(isMobile ? { fontSize: '14px' } : {})
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span style={{
                      ...styles.wordText,
                      ...(isMobile ? { fontSize: '12px' } : {})
                    }}>{censorWord(word.text).slice(0, 8)}{word.text.length > 8 ? '...' : ''}</span>
                  )}
                  <div
                    style={{
                      ...styles.resizeHandle,
                      right: 0,
                      left: 'auto',
                      ...(isMobile ? { width: '16px' } : {}),
                      touchAction: 'none'
                    }}
                    onPointerDown={(e) => handleWordPointerDown(e, index, 'resize-right')}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{
          ...styles.bottomSections,
          ...(isMobile ? {
            gridTemplateColumns: '1fr',
            minHeight: '150px',
            maxHeight: '200px'
          } : {})
        }}>
          <div style={{
            ...styles.linePreviewSection,
            ...(isMobile ? { padding: '12px 16px' } : {})
          }}>
            <h4 style={{
              ...styles.sectionTitle,
              ...(isMobile ? { fontSize: '13px', marginBottom: '8px' } : {})
            }}>{isMobile ? 'Line preview (tap to select)' : 'Line build preview (Shift+click to multi-select)'}</h4>
            <div style={styles.linesContainer}>
              {getLines().map((line, lineIndex) => (
                <div key={lineIndex} style={styles.lineRow}>
                  {line.map((word) => (
                    <span
                      key={word.id || word.globalIndex}
                      style={{
                        ...styles.wordChip,
                        ...(displayTime >= word.startTime && displayTime < word.startTime + word.duration && !isWordSelected(word.globalIndex) ? styles.wordChipActive : {}),
                        ...(isWordSelected(word.globalIndex) ? styles.wordChipSelected : {}),
                        cursor: 'pointer'
                      }}
                      onClick={(e) => handleWordChipClick(e, word, word.globalIndex)}
                    >
                      {editingWordId === word.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          onBlur={saveInlineEdit}
                          style={styles.chipEditInput}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        censorWord(word.text)
                      )}
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
              {/* Live preview of current word at playhead - clickable */}
              <div
                style={{
                  ...styles.livePreview,
                  cursor: currentWord ? 'pointer' : 'default'
                }}
                onClick={handleLivePreviewClick}
                title={currentWord ? 'Click to edit' : ''}
              >
                {editingWordId === currentWord?.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={saveInlineEdit}
                    style={styles.livePreviewInput}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span style={styles.livePreviewText}>
                    {currentWord ? censorWord(currentWord.text) : '—'}
                  </span>
                )}
              </div>

              {/* Edit form for selected word OR word at playhead */}
              {(selectedWord || currentWord) && (
                <div style={styles.wordEditForm}>
                  {selectedWordIndices.length > 1 && (
                    <div style={styles.multiSelectInfo}>
                      {selectedWordIndices.length} words selected
                    </div>
                  )}
                  <div style={styles.wordEditRow}>
                    <label style={styles.wordEditLabel}>Text:</label>
                    <input
                      type="text"
                      value={(selectedWord || currentWord).text}
                      onChange={(e) => {
                        const indexToUpdate = selectedWordIndices.length > 0 ? selectedWordIndices[0] : currentWordIndex;
                        if (indexToUpdate < 0) return;
                        setWords(prev => {
                          const newWords = [...prev];
                          newWords[indexToUpdate] = { ...newWords[indexToUpdate], text: e.target.value };
                          return newWords;
                        });
                      }}
                      style={styles.wordEditInput}
                    />
                  </div>
                  <div style={styles.wordEditRow}>
                    <label style={styles.wordEditLabel}>Start:</label>
                    <input
                      type="number"
                      value={(selectedWord || currentWord).startTime.toFixed(2)}
                      step="0.1"
                      onChange={(e) => {
                        const indexToUpdate = selectedWordIndices.length > 0 ? selectedWordIndices[0] : currentWordIndex;
                        if (indexToUpdate < 0) return;
                        setWords(prev => {
                          const newWords = [...prev];
                          newWords[indexToUpdate] = { ...newWords[indexToUpdate], startTime: parseFloat(e.target.value) || 0 };
                          return newWords;
                        });
                      }}
                      style={styles.wordEditInput}
                    />
                  </div>
                  <div style={styles.wordEditRow}>
                    <label style={styles.wordEditLabel}>Duration:</label>
                    <input
                      type="number"
                      value={((selectedWord || currentWord).duration || 0.5).toFixed(2)}
                      step="0.1"
                      onChange={(e) => {
                        const indexToUpdate = selectedWordIndices.length > 0 ? selectedWordIndices[0] : currentWordIndex;
                        if (indexToUpdate < 0) return;
                        setWords(prev => {
                          const newWords = [...prev];
                          newWords[indexToUpdate] = { ...newWords[indexToUpdate], duration: parseFloat(e.target.value) || 0.1 };
                          return newWords;
                        });
                      }}
                      style={styles.wordEditInput}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{
          ...styles.footer,
          ...(isMobile ? { padding: '12px 16px' } : {})
        }}>
          <button
            style={{
              ...styles.saveButton,
              ...(isMobile ? { width: '100%', padding: '14px 20px', fontSize: '15px' } : {})
            }}
            onClick={() => {
              // If loaded from bank, save back to that entry
              if (loadedBankLyricId && onSaveToBank) {
                onSaveToBank(loadedBankLyricId, words);
                onClose();
              } else if (words.length > 0 && onAddToBank) {
                // Not from bank but has words - prompt to save to bank
                setSaveToBankPrompt({ show: true, name: '' });
              } else {
                onClose();
              }
            }}
          >
            Save word timings
          </button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.show && (
        <div style={styles.confirmOverlay}>
          <div style={{
            ...styles.confirmDialog,
            ...(isMobile ? { width: '90%', maxWidth: '90%', padding: '20px' } : {})
          }}>
            <h3 style={styles.confirmTitle}>Delete word?</h3>
            <p style={styles.confirmMessage}>
              Are you sure you want to delete "{deleteConfirm.text}"?
            </p>
            <div style={{
              ...styles.confirmButtons,
              ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
            }}>
              <button style={styles.confirmCancel} onClick={cancelDelete}>Cancel</button>
              <button style={styles.confirmDelete} onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Save to Bank Prompt */}
      {saveToBankPrompt.show && (
        <div style={styles.confirmOverlay}>
          <div style={{
            ...styles.confirmDialog,
            minWidth: isMobile ? 'auto' : '350px',
            ...(isMobile ? { width: '90%', maxWidth: '90%', padding: '20px' } : {})
          }}>
            <h3 style={styles.confirmTitle}>💾 Save to Lyric Bank?</h3>
            <p style={styles.confirmMessage}>
              Save these {words.length} words with their timing to your lyric bank for reuse.
            </p>
            <input
              type="text"
              value={saveToBankPrompt.name}
              onChange={(e) => setSaveToBankPrompt(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter a name for this lyric..."
              style={{
                width: '100%',
                padding: isMobile ? '14px' : '10px 12px',
                backgroundColor: '#1f1f2e',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#fff',
                fontSize: isMobile ? '16px' : '14px',
                marginBottom: '16px',
                outline: 'none'
              }}
              autoFocus={!isMobile}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveToBankPrompt.name.trim()) {
                  const content = words.map(w => w.text).join(' ');
                  onAddToBank({
                    title: saveToBankPrompt.name.trim(),
                    content,
                    words
                  });
                  setSaveToBankPrompt({ show: false, name: '' });
                  onClose();
                }
              }}
            />
            <div style={{
              ...styles.confirmButtons,
              ...(isMobile ? { flexDirection: 'column', gap: '8px' } : {})
            }}>
              <button
                style={{
                  ...styles.confirmCancel,
                  ...(isMobile ? { width: '100%', padding: '14px' } : {})
                }}
                onClick={() => {
                  setSaveToBankPrompt({ show: false, name: '' });
                  onClose();
                }}
              >
                Skip
              </button>
              <button
                style={{
                  ...styles.saveButton,
                  opacity: saveToBankPrompt.name.trim() ? 1 : 0.5,
                  cursor: saveToBankPrompt.name.trim() ? 'pointer' : 'not-allowed',
                  ...(isMobile ? { width: '100%', padding: '14px' } : {})
                }}
                disabled={!saveToBankPrompt.name.trim()}
                onClick={() => {
                  if (saveToBankPrompt.name.trim()) {
                    const content = words.map(w => w.text).join(' ');
                    onAddToBank({
                      title: saveToBankPrompt.name.trim(),
                      content,
                      words
                    });
                    setSaveToBankPrompt({ show: false, name: '' });
                    onClose();
                  }
                }}
              >
                Save to Bank
              </button>
            </div>
          </div>
        </div>
      )}
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
  selectionIndicator: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', backgroundColor: 'rgba(139, 92, 246, 0.2)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '6px', fontSize: '12px', fontWeight: '500', color: '#a78bfa' },
  clearSelectionBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', backgroundColor: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', color: '#a78bfa', cursor: 'pointer', padding: 0 },
  timelineContainer: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', backgroundColor: '#0a0a0f' },
  playButton: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '50%', color: '#fff', cursor: 'pointer', flexShrink: 0 },
  timeline: { flex: 1, height: '120px', backgroundColor: '#1a1a2e', borderRadius: '8px', overflowX: 'auto', overflowY: 'hidden', position: 'relative', cursor: 'pointer' },
  timelineInner: { position: 'relative', height: '100%', minWidth: '100%' },
  marqueeBox: { position: 'absolute', backgroundColor: 'rgba(139, 92, 246, 0.2)', border: '1px solid rgba(139, 92, 246, 0.5)', borderRadius: '2px', pointerEvents: 'none', zIndex: 100 },
  timeRuler: { position: 'absolute', top: 0, left: 0, right: 0, height: '20px', cursor: 'pointer' },
  timeMarker: { position: 'absolute', top: 0, height: '100%' },
  timeMarkerLine: { width: '1px', height: '8px', backgroundColor: 'rgba(255,255,255,0.2)' },
  timeMarkerLabel: { position: 'absolute', top: '8px', left: '-8px', fontSize: '9px', color: '#6b7280', fontFamily: 'monospace' },
  waveformCanvas: { position: 'absolute', top: '65px', left: 0, height: '50px', pointerEvents: 'none', opacity: 0.9 },
  playhead: { position: 'absolute', top: 0, bottom: 0, zIndex: 20 },
  wordBlock: { position: 'absolute', top: '22px', height: '38px', backgroundColor: '#7c3aed', border: '1px solid #9333ea', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', userSelect: 'none', overflow: 'hidden', transition: 'background-color 0.1s, box-shadow 0.1s', zIndex: 5 },
  wordBlockSelected: { backgroundColor: '#9333ea', border: '2px solid #a855f7', boxShadow: '0 2px 8px rgba(168, 85, 247, 0.5)' },
  wordBlockCurrent: { backgroundColor: '#22c55e', border: '2px solid #4ade80' },
  resizeHandle: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', backgroundColor: 'transparent' },
  wordText: { fontSize: '11px', fontWeight: '600', color: '#fff', padding: '0 8px', whiteSpace: 'nowrap' },
  inlineEditInput: { width: '100%', height: '100%', padding: '0 4px', backgroundColor: '#1f1f2e', border: 'none', borderRadius: '2px', fontSize: '11px', fontWeight: '600', color: '#fff', textAlign: 'center', outline: 'none' },
  bottomSections: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1px', backgroundColor: '#1f1f2e', flex: 1, overflow: 'hidden', minHeight: '200px' },
  linePreviewSection: { backgroundColor: '#111118', padding: '16px 20px', overflow: 'auto' },
  sectionTitle: { margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#e5e7eb' },
  linesContainer: { display: 'flex', flexDirection: 'column', gap: '8px' },
  lineRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  wordChip: { display: 'inline-block', padding: '6px 10px', backgroundColor: '#1f1f2e', borderRadius: '4px', fontSize: '13px', fontWeight: '500', color: '#e5e7eb', transition: 'all 0.1s', border: '1px solid #2d2d3d' },
  wordChipActive: { backgroundColor: '#22c55e', color: '#fff', border: '1px solid #4ade80', boxShadow: '0 0 0 2px rgba(34, 197, 94, 0.3)' },
  wordChipSelected: { border: '2px solid #a855f7', boxShadow: '0 0 0 2px rgba(168, 85, 247, 0.3)' },
  chipEditInput: { width: '60px', padding: '0', backgroundColor: 'transparent', border: 'none', fontSize: '13px', fontWeight: '500', color: '#fff', textAlign: 'center', outline: 'none' },
  noWords: { color: '#6b7280', fontSize: '13px', fontStyle: 'italic' },
  wordEditorSection: { backgroundColor: '#111118', padding: '16px 20px', borderLeft: '1px solid #1f1f2e', display: 'flex', flexDirection: 'column' },
  wordEditorContent: { flex: 1, display: 'flex', flexDirection: 'column' },
  livePreview: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80px', marginBottom: '16px', backgroundColor: '#0a0a0f', borderRadius: '12px' },
  livePreviewText: { fontSize: '32px', fontWeight: '600', color: '#fff', textAlign: 'center' },
  livePreviewInput: { fontSize: '32px', fontWeight: '600', color: '#fff', textAlign: 'center', backgroundColor: 'transparent', border: '2px solid #7c3aed', borderRadius: '8px', padding: '8px 16px', outline: 'none', width: '80%' },
  noActiveWord: { color: '#6b7280', fontSize: '14px', textAlign: 'center', padding: '40px 0' },
  multiSelectInfo: { padding: '8px 12px', backgroundColor: 'rgba(139, 92, 246, 0.2)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '6px', fontSize: '12px', fontWeight: '500', color: '#a78bfa', marginBottom: '8px', textAlign: 'center' },
  wordEditForm: { display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1f1f2e', paddingTop: '12px' },
  wordEditRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  wordEditLabel: { width: '60px', fontSize: '12px', color: '#9ca3af' },
  wordEditInput: { flex: 1, padding: '6px 10px', backgroundColor: '#0a0a0f', border: '1px solid #2d2d3d', borderRadius: '6px', fontSize: '12px', color: '#fff', outline: 'none' },
  footer: { display: 'flex', justifyContent: 'flex-end', padding: '16px 20px', borderTop: '1px solid #1f1f2e', backgroundColor: '#0a0a0f' },
  saveButton: { padding: '10px 20px', backgroundColor: '#7c3aed', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', color: '#fff', cursor: 'pointer' },
  // Delete confirmation dialog
  confirmOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 },
  confirmDialog: { backgroundColor: '#1a1a2e', borderRadius: '12px', padding: '24px', maxWidth: '320px', textAlign: 'center' },
  confirmTitle: { margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: '#fff' },
  confirmMessage: { margin: '0 0 20px 0', fontSize: '14px', color: '#9ca3af' },
  confirmButtons: { display: 'flex', gap: '12px', justifyContent: 'center' },
  confirmCancel: { padding: '8px 16px', backgroundColor: '#2d2d3d', border: 'none', borderRadius: '6px', fontSize: '13px', color: '#e5e7eb', cursor: 'pointer' },
  confirmDelete: { padding: '8px 16px', backgroundColor: '#ef4444', border: 'none', borderRadius: '6px', fontSize: '13px', color: '#fff', cursor: 'pointer' }
};

export default WordTimeline;
