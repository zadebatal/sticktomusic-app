import React, { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { Loader } from '../../ui/components/Loader';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { FeatherX } from '@subframe/core';
import { useLyricAnalyzer } from '../../hooks/useLyricAnalyzer';
import { getStoredApiKey } from '../../services/whisperService';
import { loadLyricTemplate, saveLyricTemplate } from '../../services/storageService';

/**
 * LyricAnalyzer - AI-powered lyric transcription with caching
 * Checks for cached lyrics before re-analyzing the same song
 * Supports trimming audio to a specific section before transcription
 */
const LyricAnalyzer = ({ audioFile, audioUrl, startTime, endTime, onComplete, onClose }) => {
  const { theme } = useTheme();
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [cachedLyrics, setCachedLyrics] = useState(null);
  const [isTrimming, setIsTrimming] = useState(false);
  const { analyze, isAnalyzing, progress, error, hasApiKey } = useLyricAnalyzer();

  // Check if we need to trim
  const needsTrimming = typeof startTime === 'number' || typeof endTime === 'number';

  // Format time as mm:ss
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine best audio source:
  // 1. File object (direct upload) - always preferred
  // 2. HTTPS URL (Firebase Storage) - can be fetched
  // 3. Blob URL - NOT supported (expires)
  const getValidAudioSource = () => {
    // Prefer File object if available
    if (audioFile instanceof File || audioFile instanceof Blob) {
      return audioFile;
    }

    // Check if URL is valid (not blob)
    if (typeof audioUrl === 'string') {
      if (audioUrl.startsWith('blob:')) {
        return null; // Blob URLs expire, not supported
      }
      if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        return audioUrl;
      }
    }

    return null;
  };

  const audioSource = getValidAudioSource();
  const isBlobUrl = typeof audioUrl === 'string' && audioUrl.startsWith('blob:') && !audioFile;

  // Check for cached lyrics on mount, and try shared key if no personal key
  useEffect(() => {
    const storedKey = getStoredApiKey();
    if (storedKey) {
      setApiKey(storedKey);
    } else {
      // BUG-011: Use 'team' sentinel to route through server proxy
      // instead of fetching the actual API key to the browser
      (async () => {
        try {
          const { getAuth } = await import('firebase/auth');
          const auth = getAuth();
          const user = auth.currentUser;
          if (user) {
            const token = await user.getIdToken();
            const baseUrl = window.location.hostname === 'localhost'
              ? `http://localhost:${window.location.port}`
              : '';
            const response = await fetch(`${baseUrl}/api/whisper?action=status`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
              const data = await response.json();
              if (data.configured) {
                setApiKey('team'); // Proxy will add the real key server-side
                return;
              }
            }
          }
        } catch (err) {
          console.warn('Could not check shared OpenAI key status:', err.message);
        }
        setShowApiKeyInput(true);
      })();
    }

    // Check if we have cached lyrics for this audio file
    if (audioSource) {
      const cached = loadLyricTemplate(audioSource);
      if (cached) {
        setCachedLyrics(cached);
      }
    }
  }, [audioSource]);

  // Trim audio to the specified section using Web Audio API
  const trimAudio = async (source, start, end) => {
    setIsTrimming(true);
    try {
      // Fetch the audio data
      let arrayBuffer;
      if (source instanceof File || source instanceof Blob) {
        arrayBuffer = await source.arrayBuffer();
      } else if (typeof source === 'string') {
        const response = await fetch(source);
        arrayBuffer = await response.arrayBuffer();
      } else {
        throw new Error('Invalid audio source');
      }

      // Decode the audio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Calculate sample positions
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor((start || 0) * sampleRate);
      const endSample = end ? Math.floor(end * sampleRate) : audioBuffer.length;
      const duration = endSample - startSample;

      // Create a new buffer for the trimmed audio
      const trimmedBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        duration,
        sampleRate
      );

      // Copy the relevant portion
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const destData = trimmedBuffer.getChannelData(channel);
        for (let i = 0; i < duration; i++) {
          destData[i] = sourceData[startSample + i];
        }
      }

      // Convert to WAV blob
      const wavBlob = audioBufferToWav(trimmedBuffer);
      audioContext.close();

      return new File([wavBlob], 'trimmed-audio.wav', { type: 'audio/wav' });
    } finally {
      setIsTrimming(false);
    }
  };

  // Convert AudioBuffer to WAV format
  const audioBufferToWav = (buffer) => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  const handleAnalyze = async () => {
    if (!apiKey && !hasApiKey) {
      setShowApiKeyInput(true);
      return;
    }
    try {
      // If we have trim times, trim the audio first
      let sourceToAnalyze = audioSource;
      if (needsTrimming && audioSource) {
        sourceToAnalyze = await trimAudio(audioSource, startTime, endTime);
      }

      const result = await analyze(sourceToAnalyze, apiKey || undefined);

      // Save the analyzed lyrics as a template for future use
      if (result && result.words && result.words.length > 0) {
        saveLyricTemplate(audioSource, result.text, result.words);
      }

      onComplete?.(result);
    } catch (err) {
      // Show API key input on authentication errors (401) or if key is required
      if (err.message === 'API_KEY_REQUIRED' || err.message?.includes('401')) {
        setShowApiKeyInput(true);
        setApiKey(''); // Clear invalid key so user can enter a new one
      }
    }
  };

  const handleUseCached = () => {
    if (cachedLyrics) {
      onComplete?.({
        text: cachedLyrics.lyrics,
        words: cachedLyrics.words
      });
    }
  };

  const handleClearCache = () => {
    setCachedLyrics(null);
  };

  const styles = {
    overlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: theme.overlay.heavy,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1200
    },
    modal: {
      width: '90%',
      maxWidth: '520px',
      backgroundColor: theme.bg.input,
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 24px',
      borderBottom: `1px solid ${theme.bg.surface}`
    },
    title: {
      margin: 0,
      fontSize: '18px',
      fontWeight: '600',
      color: theme.text.primary
    },
    content: {
      padding: '24px'
    },
    audioInfo: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '16px',
      backgroundColor: theme.bg.page,
      borderRadius: '12px',
      marginBottom: '20px'
    },
    audioIcon: {
      fontSize: '28px',
      width: '48px',
      height: '48px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent.primary,
      borderRadius: '10px'
    },
    audioName: {
      margin: 0,
      fontWeight: '600',
      color: theme.text.primary,
      fontSize: '14px'
    },
    audioSize: {
      margin: '4px 0 0',
      fontSize: '12px',
      color: theme.text.muted
    },
    cachedSection: {
      backgroundColor: '#0f2a1f',
      border: '1px solid #22c55e',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '20px'
    },
    cachedHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '12px'
    },
    cachedIcon: {
      fontSize: '24px'
    },
    cachedTitle: {
      margin: 0,
      fontSize: '15px',
      fontWeight: '600',
      color: '#22c55e'
    },
    cachedInfo: {
      margin: '4px 0 0',
      fontSize: '12px',
      color: '#86efac'
    },
    cachedPreview: {
      padding: '12px',
      backgroundColor: theme.overlay.light,
      borderRadius: '8px',
      fontSize: '13px',
      color: theme.text.secondary,
      fontStyle: 'italic',
      marginBottom: '12px',
      maxHeight: '60px',
      overflow: 'hidden'
    },
    cachedActions: {
      display: 'flex',
      gap: '8px'
    },
    apiKeySection: {
      marginBottom: '20px'
    },
    label: {
      display: 'block',
      fontWeight: '600',
      marginBottom: '8px',
      color: theme.text.primary,
      fontSize: '14px'
    },
    hint: {
      display: 'block',
      fontSize: '12px',
      fontWeight: '400',
      color: theme.text.muted,
      marginTop: '4px'
    },
    link: {
      color: theme.accent.primary
    },
    input: {
      width: '100%',
      padding: '12px 16px',
      backgroundColor: theme.bg.page,
      border: `1px solid ${theme.bg.elevated}`,
      borderRadius: '8px',
      fontSize: '14px',
      color: theme.text.primary,
      boxSizing: 'border-box',
      outline: 'none'
    },
    cost: {
      margin: '10px 0 0',
      fontSize: '12px',
      color: '#22c55e'
    },
    progress: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px',
      padding: '32px'
    },
    progressText: {
      color: theme.text.secondary,
      fontSize: '14px',
      margin: 0
    },
    error: {
      padding: '16px',
      backgroundColor: '#2a0f0f',
      border: '1px solid #dc2626',
      borderRadius: '8px',
      color: '#fca5a5',
      textAlign: 'center',
      fontSize: '14px'
    },
    info: {
      padding: '16px',
      backgroundColor: theme.bg.page,
      borderRadius: '12px'
    },
    infoTitle: {
      margin: '0 0 8px 0',
      fontSize: '14px',
      fontWeight: '600',
      color: theme.text.primary
    },
    steps: {
      margin: '0',
      paddingLeft: '20px',
      lineHeight: '1.8',
      color: theme.text.secondary,
      fontSize: '13px'
    },
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      padding: '16px 24px',
      borderTop: `1px solid ${theme.bg.surface}`,
      backgroundColor: theme.bg.page
    },
    // UI-40: Empty state styles
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center'
    },
    emptyIcon: {
      fontSize: '48px',
      marginBottom: '16px'
    },
    emptyTitle: {
      margin: '0 0 8px 0',
      fontSize: '16px',
      fontWeight: '600',
      color: theme.text.primary
    },
    emptyText: {
      margin: 0,
      fontSize: '13px',
      color: theme.text.muted
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>🎤 Lyric Analyzer</h2>
          <IconButton icon={<FeatherX />} onClick={onClose} />
        </div>

        <div style={styles.content}>
          {/* UI-40: Empty state when no audio or blob URL issue */}
          {!audioSource ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>{isBlobUrl ? '⚠️' : '🎵'}</div>
              <h4 style={styles.emptyTitle}>
                {isBlobUrl ? 'Audio Session Expired' : 'No Audio Selected'}
              </h4>
              <p style={styles.emptyText}>
                {isBlobUrl
                  ? 'The audio needs to be re-uploaded. Please close this and add the audio file again.'
                  : 'Select an audio track to analyze lyrics with word-level timestamps.'}
              </p>
            </div>
          ) : (
          <>
          {/* Audio Info */}
          <div style={styles.audioInfo}>
            <div style={styles.audioIcon}>🎵</div>
            <div>
              <p style={styles.audioName}>{audioFile?.name || (typeof audioUrl === 'string' ? audioUrl.split('/').pop() : 'Audio file')}</p>
              <p style={styles.audioSize}>
                {needsTrimming ? (
                  <>✂️ Trimmed: {formatTime(startTime || 0)} - {formatTime(endTime || 0)}</>
                ) : audioFile ? (
                  `${(audioFile.size / (1024 * 1024)).toFixed(2)} MB`
                ) : ''}
              </p>
            </div>
          </div>

          {/* Cached Lyrics Found */}
          {cachedLyrics && !isAnalyzing && (
            <div style={styles.cachedSection}>
              <div style={styles.cachedHeader}>
                <span style={styles.cachedIcon}>✅</span>
                <div>
                  <h4 style={styles.cachedTitle}>Cached Lyrics Found!</h4>
                  <p style={styles.cachedInfo}>
                    Analyzed on {new Date(cachedLyrics.createdAt).toLocaleDateString()} • {cachedLyrics.words?.length || 0} words
                  </p>
                </div>
              </div>
              <div style={styles.cachedPreview}>
                {cachedLyrics.lyrics?.slice(0, 150)}...
              </div>
              <div style={styles.cachedActions}>
                <Button variant="brand-primary" size="small" onClick={handleUseCached}>Use Cached Lyrics</Button>
                <Button variant="neutral-secondary" size="small" onClick={handleClearCache}>Re-analyze Instead</Button>
              </div>
            </div>
          )}

          {/* API Key Input (show if no key, error occurred, or user wants to change) */}
          {(showApiKeyInput || error) && !cachedLyrics && (
            <div style={styles.apiKeySection}>
              <label style={styles.label}>
                OpenAI API Key
                <span style={styles.hint}>
                  Get yours at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" style={styles.link}>platform.openai.com</a>
                </span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key..."
                style={styles.input}
              />
              <p style={styles.cost}>✅ Whisper API • Max 25MB • ~$0.006/min</p>
            </div>
          )}
          {/* Show button to change API key if one is stored but input is hidden */}
          {!showApiKeyInput && !error && !cachedLyrics && apiKey && (
            <Button variant="neutral-tertiary" size="small" onClick={() => setShowApiKeyInput(true)}>Change API Key</Button>
          )}

          {/* Progress */}
          {(isAnalyzing || isTrimming) && (
            <div style={styles.progress}>
              <Loader size="large" />
              <p style={styles.progressText}>
                {isTrimming ? '✂️ Trimming audio to selected section...' : progress}
              </p>
            </div>
          )}

          {/* Error */}
          {error && <div style={styles.error}>❌ {error}</div>}

          {/* How it works (only if no cache) */}
          {!isAnalyzing && !error && !cachedLyrics && (
            <div style={styles.info}>
              <h4 style={styles.infoTitle}>How it works:</h4>
              <ol style={styles.steps}>
                <li>Your audio is sent to OpenAI Whisper</li>
                <li>AI transcribes lyrics with word-level timestamps</li>
                <li>Words load into the Word Timeline editor</li>
                <li>Results are cached for future use</li>
              </ol>
            </div>
          )}
          </>
          )}
        </div>

        <div style={styles.footer}>
          <Button variant="neutral-secondary" onClick={onClose}>Cancel</Button>
          {audioSource && !cachedLyrics && (
            <Button variant="brand-primary" onClick={handleAnalyze} disabled={isAnalyzing || (!apiKey && !hasApiKey)} loading={isAnalyzing}>
              {isAnalyzing ? 'Analyzing...' : 'Analyze Lyrics'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LyricAnalyzer;
