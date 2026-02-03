import React, { useState, useCallback, useRef, useEffect } from 'react';
import VideoPreview from './VideoPreview';
import EnhancedTimeline from './EnhancedTimeline';
import ContentBankManager from './ContentBankManager';
import LyricEditor from './LyricEditor';
import TemplateSelector from './TemplateSelector';
import BatchExport from './BatchExport';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { LYRIC_TEMPLATES, getTemplate } from './LyricTemplates';
import { PROJECT_TEMPLATES, createProjectFromTemplate, getProjectTemplate } from './ProjectTemplates';
import {
  generateClipsFromBeats,
  rerollSingleClip,
  rerollAllClips,
  shuffleClipOrder,
  toggleClipLock,
  generateAutoRemix,
  parseLyrics
} from './AutoRemixEngine';

console.log('🎬🎬🎬 VideoEditorV2.jsx MODULE LOADED! 🎬🎬🎬');

/**
 * VideoEditor V2 - Full-featured video editor with auto-remix capabilities
 *
 * ⚠️ LEGACY COMPONENT - DO NOT USE FOR NEW FEATURES ⚠️
 *
 * TIME WINDOW VIOLATION: This editor does NOT support audio trim boundaries.
 * All timestamps are in GLOBAL time (full audio file), violating the
 * LOCAL_TIME_INVARIANT defined in docs/DOMAIN_INVARIANTS.md
 *
 * For trim-aware editing, use VideoEditorModal instead, which:
 * - Supports audio trim boundaries (startTime/endTime)
 * - Normalizes all timestamps to LOCAL time (0 = trim start)
 * - Uses the timelineNormalization utility
 * - Properly invalidates data when trim changes
 *
 * @deprecated Use VideoEditorModal for all new development
 * @see VideoEditorModal for the production workflow
 * @see src/utils/timelineNormalization.js for the normalization architecture
 * @see docs/DOMAIN_INVARIANTS.md Section A for time window rules
 */
const VideoEditorV2 = ({
  onSave,
  onExport,
  onClose,
  initialProject = null,
  artists = [
    { id: 'boon', name: 'Boon' }
  ]
}) => {
  // ============ DEPRECATION WARNING ============
  useEffect(() => {
    console.warn(
      '[DEPRECATED] VideoEditorV2 is deprecated and violates TIME_WINDOW_INVARIANT.\n' +
      'Use VideoEditorModal instead, which supports audio trim boundaries.\n' +
      'See docs/DOMAIN_INVARIANTS.md Section A for details.'
    );
  }, []);

  // ============ STATE ============

  // Project state
  const [projectName, setProjectName] = useState(initialProject?.name || 'Untitled Project');
  const [status, setStatus] = useState('draft');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Artist & Content Bank state
  const [selectedArtist, setSelectedArtist] = useState(artists[0] || null);
  const [contentBanks, setContentBanks] = useState([]);
  const [selectedBank, setSelectedBank] = useState(null);

  // Media state
  const [videoFile, setVideoFile] = useState(null);
  const [audioFile, setAudioFile] = useState(null);
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [duration, setDuration] = useState(30);

  // Playback state
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Editor state
  const [clips, setClips] = useState([]);
  const [words, setWords] = useState([]);
  const [lyrics, setLyrics] = useState('');
  const [selectedClipIndex, setSelectedClipIndex] = useState(null);
  const [activePanel, setActivePanel] = useState('library'); // library, lyrics, style
  const [displayMode, setDisplayMode] = useState('word');
  const [zoom, setZoom] = useState(1);

  // Text styling
  const [textStyle, setTextStyle] = useState({
    fontSize: 60,
    fontFamily: 'sans-serif',
    fontWeight: '500',
    color: '#ffffff',
    outline: true,
    outlineColor: '#000000',
    outlineWidth: 2,
    textCase: 'default',
    letterSpacing: '0',
    position: { x: 'center', y: 'center' },
    animation: 'fade',
    animationDuration: 200
  });

  // Modal state
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showBatchExport, setShowBatchExport] = useState(false);
  const [templateSelectorMode, setTemplateSelectorMode] = useState('project');

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Refs
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const autoSaveTimer = useRef(null);

  // ============ EFFECTS ============

  // Auto-save every 30 seconds
  useEffect(() => {
    if (hasUnsavedChanges) {
      autoSaveTimer.current = setTimeout(() => {
        handleSave(true); // Silent auto-save
      }, 30000);
    }
    return () => clearTimeout(autoSaveTimer.current);
  }, [hasUnsavedChanges, clips, words, textStyle]);

  // Mark as unsaved when changes happen
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [clips, words, textStyle, lyrics, projectName]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Space - Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(prev => !prev);
      }

      // R - Reroll selected or all
      if (e.code === 'KeyR' && !e.shiftKey) {
        e.preventDefault();
        if (selectedClipIndex !== null) {
          handleRerollClip(selectedClipIndex);
        }
      }

      // Shift+R - Reroll all
      if (e.code === 'KeyR' && e.shiftKey) {
        e.preventDefault();
        handleRerollAll();
      }

      // L - Lock/unlock selected clip
      if (e.code === 'KeyL') {
        e.preventDefault();
        if (selectedClipIndex !== null) {
          handleLockClip(selectedClipIndex);
        }
      }

      // S - Shuffle order
      if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleShuffleOrder();
      }

      // Cmd/Ctrl + S - Save
      if (e.code === 'KeyS' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }

      // G - Generate
      if (e.code === 'KeyG') {
        e.preventDefault();
        handleGenerate();
      }

      // Delete/Backspace - Delete selected clip
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedClipIndex !== null) {
        e.preventDefault();
        handleDeleteClip(selectedClipIndex);
      }

      // Arrow keys - Navigate clips
      if (e.code === 'ArrowLeft' && selectedClipIndex !== null && selectedClipIndex > 0) {
        e.preventDefault();
        setSelectedClipIndex(selectedClipIndex - 1);
      }
      if (e.code === 'ArrowRight' && selectedClipIndex !== null && selectedClipIndex < clips.length - 1) {
        e.preventDefault();
        setSelectedClipIndex(selectedClipIndex + 1);
      }

      // +/- Zoom
      if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        setZoom(prev => Math.min(prev + 0.25, 4));
      }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        setZoom(prev => Math.max(prev - 0.25, 0.5));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIndex, clips]);

  // ============ HANDLERS ============

  // Handle video upload
  const handleVideoUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(url);

      const video = document.createElement('video');
      video.src = url;
      video.onloadedmetadata = () => {
        setDuration(video.duration);
      };
    }
  }, []);

  // Handle audio upload
  const handleAudioUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioFile(url);

      // Get audio duration
      const audio = document.createElement('audio');
      audio.src = url;
      audio.onloadedmetadata = () => {
        setDuration(audio.duration);
      };

      // Analyze beats
      try {
        await analyzeAudio(file);

        // Also decode for waveform
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        setAudioBuffer(buffer);
      } catch (err) {
        console.error('Audio analysis error:', err);
      }
    }
  }, [analyzeAudio]);

  // Handle template selection
  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);

    if (templateSelectorMode === 'project') {
      // Apply project template
      setTextStyle(template.textStyle);
      setDisplayMode(template.displayMode);

      // Try to find and select the content bank
      const bankId = template.contentBank;
      const bank = contentBanks.find(b => b.id === bankId);
      if (bank) {
        setSelectedBank(bank);
      }

      setProjectName(`${template.artistName} - ${template.categoryName} - Untitled`);
    } else {
      // Apply lyric template
      setTextStyle(template.textStyle);
      setDisplayMode(template.displayMode);
    }

    setShowTemplateSelector(false);
  };

  // Generate content
  const handleGenerate = useCallback(() => {
    if (!selectedBank?.clips?.length) {
      alert('Please select a content bank with clips first');
      return;
    }

    if (beats.length === 0) {
      alert('Please upload audio and wait for beat analysis');
      return;
    }

    const beatsPerCut = selectedTemplate?.settings?.beatsPerCut || 2;
    const newClips = generateClipsFromBeats(beats, selectedBank, {
      beatsPerCut,
      duration
    });

    setClips(newClips);
    setSelectedClipIndex(null);
  }, [selectedBank, beats, duration, selectedTemplate]);

  // Reroll single clip
  const handleRerollClip = useCallback((index) => {
    if (!selectedBank) return;
    const newClips = rerollSingleClip(clips, index, selectedBank);
    setClips(newClips);
  }, [clips, selectedBank]);

  // Reroll all clips
  const handleRerollAll = useCallback(() => {
    if (!selectedBank) return;
    const newClips = rerollAllClips(clips, selectedBank);
    setClips(newClips);
  }, [clips, selectedBank]);

  // Shuffle order
  const handleShuffleOrder = useCallback(() => {
    const newClips = shuffleClipOrder(clips);
    setClips(newClips);
  }, [clips]);

  // Lock/unlock clip
  const handleLockClip = useCallback((index) => {
    const newClips = toggleClipLock(clips, index);
    setClips(newClips);
  }, [clips]);

  // Delete clip
  const handleDeleteClip = useCallback((index) => {
    setClips(clips.filter((_, i) => i !== index));
    setSelectedClipIndex(null);
  }, [clips]);

  // Create content bank
  const handleCreateBank = useCallback((bank) => {
    setContentBanks([...contentBanks, bank]);
    setSelectedBank(bank);
  }, [contentBanks]);

  // Upload clips to bank
  const handleUploadClips = useCallback((newClips) => {
    if (!selectedBank) return;

    setContentBanks(contentBanks.map(bank =>
      bank.id === selectedBank.id
        ? { ...bank, clips: [...(bank.clips || []), ...newClips] }
        : bank
    ));

    setSelectedBank(prev => ({
      ...prev,
      clips: [...(prev.clips || []), ...newClips]
    }));
  }, [contentBanks, selectedBank]);

  // Delete clip from bank
  const handleDeleteBankClip = useCallback((clipId) => {
    if (!selectedBank) return;

    setContentBanks(contentBanks.map(bank =>
      bank.id === selectedBank.id
        ? { ...bank, clips: bank.clips.filter(c => c.id !== clipId) }
        : bank
    ));

    setSelectedBank(prev => ({
      ...prev,
      clips: prev.clips.filter(c => c.id !== clipId)
    }));
  }, [contentBanks, selectedBank]);

  // Toggle never use
  const handleToggleNeverUse = useCallback((clipId) => {
    if (!selectedBank) return;

    setContentBanks(contentBanks.map(bank =>
      bank.id === selectedBank.id
        ? {
            ...bank,
            clips: bank.clips.map(c =>
              c.id === clipId ? { ...c, neverUse: !c.neverUse } : c
            )
          }
        : bank
    ));

    setSelectedBank(prev => ({
      ...prev,
      clips: prev.clips.map(c =>
        c.id === clipId ? { ...c, neverUse: !c.neverUse } : c
      )
    }));
  }, [contentBanks, selectedBank]);

  // Save project
  const handleSave = useCallback(async (silent = false) => {
    const project = {
      name: projectName,
      clips,
      words,
      lyrics,
      textStyle,
      displayMode,
      template: selectedTemplate?.id,
      artistId: selectedArtist?.id,
      bankId: selectedBank?.id,
      duration,
      bpm
    };

    try {
      await onSave?.(project);
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      if (!silent) {
        // Show save confirmation somehow
      }
    } catch (error) {
      console.error('Save error:', error);
      if (!silent) {
        alert('Failed to save project');
      }
    }
  }, [projectName, clips, words, lyrics, textStyle, displayMode, selectedTemplate, selectedArtist, selectedBank, duration, bpm, onSave]);

  // Export project
  const handleExport = useCallback(async () => {
    const project = {
      name: projectName,
      clips,
      words,
      lyrics,
      textStyle,
      displayMode,
      videoFile,
      audioFile,
      duration,
      bpm
    };

    try {
      await onExport?.(project);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export video');
    }
  }, [projectName, clips, words, lyrics, textStyle, displayMode, videoFile, audioFile, duration, bpm, onExport]);

  // Get visible words for current time
  const getVisibleWords = useCallback(() => {
    if (displayMode === 'word') {
      return words.filter(w =>
        currentTime >= w.startTime && currentTime < w.startTime + w.duration
      );
    } else if (displayMode === 'buildLine') {
      // Show all words up to current time
      return words.filter(w => currentTime >= w.startTime);
    } else if (displayMode === 'fullLine') {
      // Show entire line when first word hits
      // For now, same as word mode
      return words.filter(w =>
        currentTime >= w.startTime && currentTime < w.startTime + w.duration
      );
    }
    return [];
  }, [words, currentTime, displayMode]);

  // ============ RENDER ============

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={onClose} style={styles.backButton}>← Back</button>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            style={styles.projectNameInput}
          />
          {hasUnsavedChanges && <span style={styles.unsavedIndicator}>●</span>}
        </div>
        <div style={styles.headerCenter}>
          <button
            style={styles.templateButton}
            onClick={() => {
              setTemplateSelectorMode('project');
              setShowTemplateSelector(true);
            }}
          >
            {selectedTemplate ? `📋 ${selectedTemplate.categoryName}` : '📋 Template'}
          </button>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.statusBadge}>{status}</span>
          {bpm && <span style={styles.bpmBadge}>{bpm} BPM</span>}
          <button onClick={() => handleSave()} style={styles.saveButton}>
            Save
          </button>
          <button onClick={() => setShowBatchExport(true)} style={styles.batchButton}>
            📦 Batch
          </button>
          <button onClick={handleExport} style={styles.exportButton}>
            Export
          </button>
        </div>
      </div>

      {/* Keyboard Shortcuts Help */}
      <div style={styles.shortcutsBar}>
        <span style={styles.shortcut}><kbd>Space</kbd> Play/Pause</span>
        <span style={styles.shortcut}><kbd>R</kbd> Reroll</span>
        <span style={styles.shortcut}><kbd>⇧R</kbd> Reroll All</span>
        <span style={styles.shortcut}><kbd>L</kbd> Lock</span>
        <span style={styles.shortcut}><kbd>S</kbd> Shuffle</span>
        <span style={styles.shortcut}><kbd>G</kbd> Generate</span>
      </div>

      {/* Main Editor Area */}
      <div style={styles.mainArea}>
        {/* Left Panel - Preview */}
        <div style={styles.previewPanel}>
          {videoFile || audioFile ? (
            <VideoPreview
              videoSrc={videoFile}
              audioSrc={audioFile}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              isPlaying={isPlaying}
              onPlayPause={() => setIsPlaying(!isPlaying)}
              visibleWords={getVisibleWords()}
              textStyle={textStyle}
              clips={clips}
              videoRef={videoRef}
              audioRef={audioRef}
            />
          ) : (
            <div style={styles.uploadPrompt}>
              <div style={styles.uploadIcon}>🎬</div>
              <p style={styles.uploadText}>Upload video or audio to get started</p>
              <div style={styles.uploadButtons}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.uploadButton}
                >
                  🎬 Choose Video
                </button>
                <button
                  onClick={() => audioInputRef.current?.click()}
                  style={styles.uploadButtonAlt}
                >
                  🎵 Choose Audio
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleVideoUpload}
                style={{ display: 'none' }}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                onChange={handleAudioUpload}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {/* Generate Button */}
          {(videoFile || audioFile) && selectedBank?.clips?.length > 0 && beats.length > 0 && (
            <button
              onClick={handleGenerate}
              style={styles.generateButton}
            >
              ⚡ Auto-Generate
            </button>
          )}

          {isAnalyzing && (
            <div style={styles.analyzingOverlay}>
              <div style={styles.spinner} />
              <p>Analyzing beats...</p>
            </div>
          )}
        </div>

        {/* Right Panel - Controls */}
        <div style={styles.controlsPanel}>
          {/* Panel Tabs */}
          <div style={styles.panelTabs}>
            <button
              style={activePanel === 'library' ? styles.panelTabActive : styles.panelTab}
              onClick={() => setActivePanel('library')}
            >
              📁 Library
            </button>
            <button
              style={activePanel === 'lyrics' ? styles.panelTabActive : styles.panelTab}
              onClick={() => setActivePanel('lyrics')}
            >
              📝 Lyrics
            </button>
            <button
              style={activePanel === 'style' ? styles.panelTabActive : styles.panelTab}
              onClick={() => setActivePanel('style')}
            >
              🎨 Style
            </button>
          </div>

          {/* Panel Content */}
          <div style={styles.panelContent}>
            {activePanel === 'library' && (
              <ContentBankManager
                artists={artists}
                banks={contentBanks}
                selectedArtist={selectedArtist}
                selectedBank={selectedBank}
                onSelectArtist={setSelectedArtist}
                onSelectBank={setSelectedBank}
                onCreateBank={handleCreateBank}
                onUploadClips={handleUploadClips}
                onDeleteClip={handleDeleteBankClip}
                onToggleNeverUse={handleToggleNeverUse}
              />
            )}

            {activePanel === 'lyrics' && (
              <LyricEditor
                words={words}
                lyrics={lyrics}
                beats={beats}
                currentTime={currentTime}
                displayMode={displayMode}
                onWordsChange={setWords}
                onLyricsChange={setLyrics}
                onDisplayModeChange={setDisplayMode}
                isPlaying={isPlaying}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                audioRef={audioRef}
              />
            )}

            {activePanel === 'style' && (
              <div style={styles.stylePanel}>
                <button
                  style={styles.styleTemplateButton}
                  onClick={() => {
                    setTemplateSelectorMode('lyric');
                    setShowTemplateSelector(true);
                  }}
                >
                  🎨 Choose Style Template
                </button>

                {/* Manual style controls */}
                <div style={styles.styleControls}>
                  <label style={styles.styleLabel}>
                    Font Size
                    <input
                      type="range"
                      min="24"
                      max="120"
                      value={textStyle.fontSize}
                      onChange={(e) => setTextStyle({...textStyle, fontSize: parseInt(e.target.value)})}
                      style={styles.slider}
                    />
                    <span>{textStyle.fontSize}px</span>
                  </label>

                  <label style={styles.styleLabel}>
                    Color
                    <input
                      type="color"
                      value={textStyle.color}
                      onChange={(e) => setTextStyle({...textStyle, color: e.target.value})}
                      style={styles.colorInput}
                    />
                  </label>

                  <label style={styles.styleLabel}>
                    Outline
                    <input
                      type="checkbox"
                      checked={textStyle.outline}
                      onChange={(e) => setTextStyle({...textStyle, outline: e.target.checked})}
                    />
                    {textStyle.outline && (
                      <input
                        type="color"
                        value={textStyle.outlineColor}
                        onChange={(e) => setTextStyle({...textStyle, outlineColor: e.target.value})}
                        style={styles.colorInput}
                      />
                    )}
                  </label>

                  <label style={styles.styleLabel}>
                    Case
                    <select
                      value={textStyle.textCase}
                      onChange={(e) => setTextStyle({...textStyle, textCase: e.target.value})}
                      style={styles.select}
                    >
                      <option value="default">Default</option>
                      <option value="upper">UPPERCASE</option>
                      <option value="lower">lowercase</option>
                    </select>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <EnhancedTimeline
        clips={clips}
        words={words}
        beats={beats}
        duration={duration}
        currentTime={currentTime}
        zoom={zoom}
        onTimeChange={setCurrentTime}
        onClipClick={setSelectedClipIndex}
        onClipReroll={handleRerollClip}
        onClipLock={handleLockClip}
        onClipDelete={handleDeleteClip}
        onRerollAll={handleRerollAll}
        onShuffleOrder={handleShuffleOrder}
        selectedClipIndex={selectedClipIndex}
        audioBuffer={audioBuffer}
      />

      {/* Modals */}
      {showTemplateSelector && (
        <TemplateSelector
          mode={templateSelectorMode}
          selectedTemplate={selectedTemplate}
          selectedArtist={selectedArtist}
          onSelectTemplate={handleSelectTemplate}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}

      {showBatchExport && (
        <BatchExport
          project={{ name: projectName, clips, words, textStyle }}
          contentBank={selectedBank}
          onExportAll={handleExport}
          onClose={() => setShowBatchExport(false)}
        />
      )}
    </div>
  );
};

// ============ STYLES ============
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#0f172a',
    color: 'white',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  backButton: {
    padding: '8px 12px',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  projectNameInput: {
    padding: '8px 12px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    width: '200px'
  },
  unsavedIndicator: {
    color: '#f59e0b',
    fontSize: '20px'
  },
  templateButton: {
    padding: '8px 16px',
    backgroundColor: '#334155',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '13px',
    cursor: 'pointer'
  },
  statusBadge: {
    padding: '4px 10px',
    backgroundColor: '#334155',
    borderRadius: '12px',
    fontSize: '12px',
    color: '#94a3b8',
    textTransform: 'capitalize'
  },
  bpmBadge: {
    padding: '4px 10px',
    backgroundColor: '#7c3aed',
    borderRadius: '12px',
    fontSize: '12px',
    color: 'white'
  },
  saveButton: {
    padding: '8px 16px',
    backgroundColor: '#334155',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  batchButton: {
    padding: '8px 16px',
    backgroundColor: '#334155',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  exportButton: {
    padding: '8px 20px',
    backgroundColor: '#7c3aed',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  },
  shortcutsBar: {
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
    padding: '6px 16px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
    fontSize: '11px',
    color: '#64748b'
  },
  shortcut: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  mainArea: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden'
  },
  previewPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    backgroundColor: '#000',
    position: 'relative'
  },
  uploadPrompt: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '40px',
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    textAlign: 'center'
  },
  uploadIcon: {
    fontSize: '48px'
  },
  uploadText: {
    color: '#94a3b8',
    fontSize: '16px',
    margin: 0
  },
  uploadButtons: {
    display: 'flex',
    gap: '12px'
  },
  uploadButton: {
    padding: '12px 24px',
    backgroundColor: '#7c3aed',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  uploadButtonAlt: {
    padding: '12px 24px',
    backgroundColor: '#334155',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  generateButton: {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '14px 32px',
    backgroundColor: '#22c55e',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600',
    boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)'
  },
  analyzingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    color: 'white'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #334155',
    borderTopColor: '#7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  controlsPanel: {
    width: '350px',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#1e293b',
    borderLeft: '1px solid #334155'
  },
  panelTabs: {
    display: 'flex',
    borderBottom: '1px solid #334155'
  },
  panelTab: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#64748b',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  panelTabActive: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#0f172a',
    border: 'none',
    borderBottom: '2px solid #7c3aed',
    color: 'white',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: '600'
  },
  panelContent: {
    flex: 1,
    overflow: 'auto',
    padding: '16px'
  },
  stylePanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  styleTemplateButton: {
    padding: '14px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  styleControls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '16px',
    backgroundColor: '#0f172a',
    borderRadius: '8px'
  },
  styleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '13px',
    color: '#e2e8f0'
  },
  slider: {
    flex: 1
  },
  colorInput: {
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  select: {
    padding: '6px 12px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '4px',
    color: 'white',
    fontSize: '13px'
  }
};

// Add keyframes for spinner
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  kbd {
    display: inline-block;
    padding: 2px 6px;
    background: #334155;
    border-radius: 3px;
    font-family: monospace;
    font-size: 10px;
  }
`;
document.head.appendChild(styleSheet);

export default VideoEditorV2;
