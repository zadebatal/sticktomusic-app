import React, { useState, useCallback, useRef, useEffect } from 'react';
import VideoPreview from './VideoPreview';
import ClipTimeline from './ClipTimeline';
import WordTimeline from './WordTimeline';
import TextControls from './TextControls';
import ContentLibrary from './ContentLibrary';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { VIDEO_STATUS } from '../../utils/status';

const VideoEditor = ({
  onSave,
  onExport,
  initialProject = null,
  contentLibraries = [],
  onClose
}) => {
  // Project state
  const [projectName, setProjectName] = useState(initialProject?.name || 'Untitled Project');
  const [status, setStatus] = useState(VIDEO_STATUS.DRAFT);

  // Media state
  const [videoFile, setVideoFile] = useState(initialProject?.videoSource?.url || null);
  const [audioFile, setAudioFile] = useState(initialProject?.audioSource?.url || null);
  const [videoDuration, setVideoDuration] = useState(initialProject?.videoSource?.duration || 0);
  const [audioDuration, setAudioDuration] = useState(initialProject?.audioSource?.duration || 0);

  // Playback state
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Editor state
  const [clips, setClips] = useState(initialProject?.clips || []);
  const [words, setWords] = useState(initialProject?.words || []);
  const [selectedClipIndex, setSelectedClipIndex] = useState(null);
  const [activeTab, setActiveTab] = useState('clips'); // clips | words | library

  // Text styling
  const [textStyle, setTextStyle] = useState(initialProject?.textStyle || {
    fontSize: 60,
    fontFamily: 'sans-serif',
    color: '#ffffff',
    outline: true,
    outlineColor: '#000000',
    outlineWidth: 2,
    textCase: 'default',
    layout: 'word',
    position: { x: 'center', y: 'center' }
  });

  // Beat detection
  const { beats, bpm, isAnalyzing, analyzeAudio } = useBeatDetection();

  // Refs
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);

  // Handle video upload
  const handleVideoUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(url);

      // Get video duration
      const video = document.createElement('video');
      video.src = url;
      video.onloadedmetadata = () => {
        setVideoDuration(video.duration);

        // Create initial clip from full video
        setClips([{
          id: `clip_${Date.now()}`,
          source: url,
          startTime: 0,
          duration: video.duration,
          thumbnail: null,
          libraryId: null
        }]);
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
        setAudioDuration(audio.duration);
      };

      // Analyze beats
      try {
        await analyzeAudio(file);
      } catch (err) {
        console.error('Beat analysis failed:', err);
      }
    }
  }, [analyzeAudio]);

  // Cut clips by beat
  const handleCutByBeat = useCallback(() => {
    if (!beats.length || !clips.length) return;

    const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);
    const newClips = [];
    let clipIndex = 0;
    let clipStartTime = 0;

    for (let i = 0; i < beats.length; i++) {
      const beatTime = beats[i];
      const nextBeatTime = beats[i + 1] || totalDuration;
      const beatDuration = nextBeatTime - beatTime;

      // Find which source clip this beat falls into
      while (clipIndex < clips.length && clipStartTime + clips[clipIndex].duration < beatTime) {
        clipStartTime += clips[clipIndex].duration;
        clipIndex++;
      }

      if (clipIndex < clips.length) {
        newClips.push({
          id: `clip_${Date.now()}_${i}`,
          source: clips[clipIndex].source,
          startTime: beatTime,
          duration: beatDuration,
          thumbnail: clips[clipIndex].thumbnail,
          libraryId: clips[clipIndex].libraryId
        });
      }
    }

    setClips(newClips);
  }, [beats, clips]);

  // Cut clips by word timing
  const handleCutByWord = useCallback(() => {
    if (!words.length || !clips.length) return;

    const newClips = words.map((word, i) => {
      const duration = word.endTime - word.startTime;
      const sourceClip = clips[i % clips.length]; // Cycle through available clips

      return {
        id: `clip_${Date.now()}_${i}`,
        source: sourceClip.source,
        startTime: word.startTime,
        duration: duration,
        thumbnail: sourceClip.thumbnail,
        libraryId: sourceClip.libraryId
      };
    });

    setClips(newClips);
  }, [words, clips]);

  // Reroll - replace selected clip with random one from library
  const handleReroll = useCallback((clipIndex, libraryClips) => {
    if (!libraryClips?.length) return;

    const randomClip = libraryClips[Math.floor(Math.random() * libraryClips.length)];
    const newClips = [...clips];
    newClips[clipIndex] = {
      ...newClips[clipIndex],
      source: randomClip.url,
      thumbnail: randomClip.thumbnail,
      libraryId: randomClip.libraryId
    };
    setClips(newClips);
  }, [clips]);

  // Import lyrics from text
  const handleImportLyrics = useCallback((text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const wordsPerSecond = 2; // Average words per second
    let currentTime = 0;

    const newWords = [];
    lines.forEach(line => {
      const lineWords = line.split(/\s+/);
      lineWords.forEach(word => {
        if (word.trim()) {
          const duration = 0.5; // Default duration per word
          newWords.push({
            text: word.trim(),
            startTime: currentTime,
            endTime: currentTime + duration
          });
          currentTime += duration;
        }
      });
      currentTime += 0.3; // Line break pause
    });

    setWords(newWords);
  }, []);

  // Get visible words at current time
  const getVisibleWords = useCallback(() => {
    return words.filter(w => currentTime >= w.startTime && currentTime <= w.endTime);
  }, [words, currentTime]);

  // Save project
  const handleSave = useCallback(() => {
    const project = {
      name: projectName,
      status,
      videoSource: { url: videoFile, duration: videoDuration },
      audioSource: { url: audioFile, duration: audioDuration, bpm, beats },
      clips,
      words,
      textStyle,
      updatedAt: new Date().toISOString()
    };
    onSave?.(project);
  }, [projectName, status, videoFile, videoDuration, audioFile, audioDuration, bpm, beats, clips, words, textStyle, onSave]);

  // Export/render video
  const handleExport = useCallback(() => {
    setStatus(VIDEO_STATUS.RENDERING);
    const project = {
      name: projectName,
      videoSource: { url: videoFile, duration: videoDuration },
      audioSource: { url: audioFile, duration: audioDuration },
      clips,
      words,
      textStyle
    };
    onExport?.(project);
  }, [projectName, videoFile, videoDuration, audioFile, audioDuration, clips, words, textStyle, onExport]);

  return (
    <div className="video-editor" style={styles.container}>
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
        </div>
        <div style={styles.headerRight}>
          <span style={styles.statusBadge}>{status}</span>
          {bpm && <span style={styles.bpmBadge}>{bpm} BPM</span>}
          <button onClick={handleSave} style={styles.saveButton}>Save</button>
          <button onClick={handleExport} style={styles.exportButton}>Export Video</button>
        </div>
      </div>

      {/* Main Editor Area */}
      <div style={styles.mainArea}>
        {/* Left Panel - Preview */}
        <div style={styles.previewPanel}>
          {videoFile ? (
            <VideoPreview
              videoSrc={videoFile}
              audioSrc={audioFile}
              currentTime={currentTime}
              onTimeUpdate={setCurrentTime}
              isPlaying={isPlaying}
              onPlayPause={() => setIsPlaying(!isPlaying)}
              visibleWords={getVisibleWords()}
              textStyle={textStyle}
            />
          ) : (
            <div style={styles.uploadPrompt}>
              <div style={styles.uploadIcon}>🎬</div>
              <p>Upload a video to get started</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={styles.uploadButton}
              >
                Choose Video
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleVideoUpload}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {videoFile && !audioFile && (
            <div style={styles.audioUploadPrompt}>
              <button
                onClick={() => audioInputRef.current?.click()}
                style={styles.audioButton}
              >
                🎵 Add Audio Track
              </button>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                onChange={handleAudioUpload}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {isAnalyzing && (
            <div style={styles.analyzingOverlay}>
              <div style={styles.spinner}></div>
              <p>Analyzing beats...</p>
            </div>
          )}
        </div>

        {/* Right Panel - Controls */}
        <div style={styles.controlsPanel}>
          {/* Text Style Controls */}
          <TextControls
            textStyle={textStyle}
            onChange={setTextStyle}
          />

          {/* Tab Switcher */}
          <div style={styles.tabs}>
            <button
              style={activeTab === 'clips' ? styles.activeTab : styles.tab}
              onClick={() => setActiveTab('clips')}
            >
              Clips
            </button>
            <button
              style={activeTab === 'words' ? styles.activeTab : styles.tab}
              onClick={() => setActiveTab('words')}
            >
              Lyrics
            </button>
            <button
              style={activeTab === 'library' ? styles.activeTab : styles.tab}
              onClick={() => setActiveTab('library')}
            >
              Library
            </button>
          </div>

          {/* Tab Content */}
          <div style={styles.tabContent}>
            {activeTab === 'clips' && (
              <div>
                <div style={styles.clipActions}>
                  <button
                    onClick={handleCutByBeat}
                    disabled={!beats.length}
                    style={styles.actionButton}
                  >
                    Cut by Beat
                  </button>
                  <button
                    onClick={handleCutByWord}
                    disabled={!words.length}
                    style={styles.actionButton}
                  >
                    Cut by Word
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'words' && (
              <div>
                <textarea
                  placeholder="Paste lyrics here..."
                  style={styles.lyricsInput}
                  onBlur={(e) => handleImportLyrics(e.target.value)}
                />
              </div>
            )}

            {activeTab === 'library' && (
              <ContentLibrary
                libraries={contentLibraries}
                onSelectClip={(clip) => {
                  if (selectedClipIndex !== null) {
                    handleReroll(selectedClipIndex, [clip]);
                  } else {
                    setClips([...clips, {
                      id: `clip_${Date.now()}`,
                      source: clip.url,
                      startTime: clips.reduce((sum, c) => sum + c.duration, 0),
                      duration: clip.duration || 3,
                      thumbnail: clip.thumbnail,
                      libraryId: clip.libraryId
                    }]);
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Panel - Timelines */}
      <div style={styles.timelinePanel}>
        {/* Clip Timeline */}
        <ClipTimeline
          clips={clips}
          onClipsChange={setClips}
          totalDuration={Math.max(videoDuration, audioDuration)}
          currentTime={currentTime}
          onSeek={setCurrentTime}
          selectedIndex={selectedClipIndex}
          onSelect={setSelectedClipIndex}
          beats={beats}
        />

        {/* Word Timeline */}
        {words.length > 0 && (
          <WordTimeline
            words={words}
            onWordsChange={setWords}
            totalDuration={Math.max(videoDuration, audioDuration)}
            currentTime={currentTime}
            onSeek={setCurrentTime}
          />
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#1a1a2e',
    color: 'white',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: '#16213e',
    borderBottom: '1px solid #0f3460'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  backButton: {
    padding: '8px 12px',
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: '1px solid #334155',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  projectNameInput: {
    padding: '8px 12px',
    backgroundColor: '#1e293b',
    color: 'white',
    border: '1px solid #334155',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600'
  },
  statusBadge: {
    padding: '4px 10px',
    backgroundColor: '#334155',
    borderRadius: '12px',
    fontSize: '12px',
    textTransform: 'capitalize'
  },
  bpmBadge: {
    padding: '4px 10px',
    backgroundColor: '#7c3aed',
    borderRadius: '12px',
    fontSize: '12px'
  },
  saveButton: {
    padding: '8px 16px',
    backgroundColor: '#334155',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  exportButton: {
    padding: '8px 16px',
    backgroundColor: '#7c3aed',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600'
  },
  mainArea: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },
  previewPanel: {
    flex: '0 0 400px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    backgroundColor: '#0f0f23',
    position: 'relative'
  },
  uploadPrompt: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '40px',
    border: '2px dashed #334155',
    borderRadius: '12px',
    color: '#94a3b8'
  },
  uploadIcon: {
    fontSize: '48px'
  },
  uploadButton: {
    padding: '12px 24px',
    backgroundColor: '#7c3aed',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600'
  },
  audioUploadPrompt: {
    marginTop: '16px'
  },
  audioButton: {
    padding: '10px 20px',
    backgroundColor: '#1e293b',
    color: 'white',
    border: '1px solid #334155',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  analyzingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px'
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
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '20px',
    backgroundColor: '#16213e',
    overflow: 'auto'
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginTop: '20px',
    marginBottom: '16px'
  },
  tab: {
    padding: '8px 16px',
    backgroundColor: '#1e293b',
    color: '#94a3b8',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  activeTab: {
    padding: '8px 16px',
    backgroundColor: '#7c3aed',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  tabContent: {
    flex: 1,
    overflow: 'auto'
  },
  clipActions: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px'
  },
  actionButton: {
    padding: '8px 12px',
    backgroundColor: '#334155',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  lyricsInput: {
    width: '100%',
    height: '200px',
    padding: '12px',
    backgroundColor: '#1e293b',
    color: 'white',
    border: '1px solid #334155',
    borderRadius: '8px',
    resize: 'vertical',
    fontFamily: 'monospace'
  },
  timelinePanel: {
    height: '200px',
    backgroundColor: '#0f0f23',
    borderTop: '1px solid #334155',
    padding: '12px',
    overflow: 'auto'
  }
};

export default VideoEditor;
