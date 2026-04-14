import { FeatherX } from '@subframe/core';
import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useLyricAnalyzer } from '../../hooks/useLyricAnalyzer';
import {
  fetchSyncedLyrics,
  lrcToWordTimeline,
  parseLRC,
  recognizeSong,
} from '../../services/lyricsLookupService';
import { loadLyricTemplate, saveLyricTemplate } from '../../services/storageService';
import { getStoredApiKey } from '../../services/whisperService';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { Loader } from '../../ui/components/Loader';
import { trimAudio } from '../../utils/audioSnippet';
import log from '../../utils/logger';

/**
 * Status step component — shows spinner → checkmark/x for each pipeline step.
 */
const StatusStep = ({ status, label, theme }) => {
  const icon =
    status === 'pending'
      ? '○'
      : status === 'active'
        ? null
        : status === 'success'
          ? '✓'
          : status === 'skipped'
            ? '—'
            : '✗';

  const color =
    status === 'pending'
      ? theme.text.muted
      : status === 'active'
        ? theme.accent.primary
        : status === 'success'
          ? '#22c55e'
          : status === 'skipped'
            ? theme.text.muted
            : '#ef4444';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0' }}>
      <div style={{ width: '20px', display: 'flex', justifyContent: 'center' }}>
        {status === 'active' ? (
          <Loader size="small" />
        ) : (
          <span style={{ color, fontSize: '14px', fontWeight: '600' }}>{icon}</span>
        )}
      </div>
      <span style={{ color, fontSize: '13px' }}>{label}</span>
    </div>
  );
};

/**
 * LyricAnalyzer - Smart lyric transcription with song recognition + synced lyrics
 *
 * Flow: recognize song (AudD) → fetch synced lyrics (LRCLIB) → fall back to Whisper
 * Checks cache first. Output format is identical regardless of source.
 */
const LyricAnalyzer = ({ audioFile, audioUrl, startTime, endTime, onComplete, onClose }) => {
  const { theme } = useTheme();
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [cachedLyrics, setCachedLyrics] = useState(null);
  const [isTrimming, setIsTrimming] = useState(false);
  const { analyze, isAnalyzing, progress, error, hasApiKey } = useLyricAnalyzer();

  // Smart lyrics pipeline state
  const [isRunning, setIsRunning] = useState(false);
  const [recognitionStatus, setRecognitionStatus] = useState('idle'); // idle | active | found | not_found | error
  const [recognizedSong, setRecognizedSong] = useState(null);
  const [lrcStatus, setLrcStatus] = useState('idle'); // idle | active | found | not_found
  const [lrcLineCount, setLrcLineCount] = useState(0);
  const [whisperStatus, setWhisperStatus] = useState('idle'); // idle | active | done
  const [pipelineError, setPipelineError] = useState(null);

  const needsTrimming = typeof startTime === 'number' || typeof endTime === 'number';

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getValidAudioSource = () => {
    if (audioFile instanceof File || audioFile instanceof Blob) return audioFile;
    if (typeof audioUrl === 'string') {
      if (audioUrl.startsWith('blob:')) return null;
      if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) return audioUrl;
    }
    return null;
  };

  const audioSource = getValidAudioSource();
  const isBlobUrl = typeof audioUrl === 'string' && audioUrl.startsWith('blob:') && !audioFile;

  // Check for cached lyrics + API key on mount
  useEffect(() => {
    const storedKey = getStoredApiKey();
    if (storedKey) {
      setApiKey(storedKey);
    } else {
      (async () => {
        try {
          const { getAuth } = await import('firebase/auth');
          const auth = getAuth();
          const user = auth.currentUser;
          if (user) {
            const token = await user.getIdToken();
            const baseUrl =
              window.location.hostname === 'localhost'
                ? `http://localhost:${window.location.port}`
                : '';
            const response = await fetch(`${baseUrl}/api/whisper?action=status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (response.ok) {
              const data = await response.json();
              if (data.configured) {
                setApiKey('team');
                return;
              }
            }
          }
        } catch (err) {
          log.warn('Could not check shared OpenAI key status:', err.message);
        }
        setShowApiKeyInput(true);
      })();
    }

    if (audioSource) {
      const cached = loadLyricTemplate(audioSource);
      if (cached) setCachedLyrics(cached);
    }
  }, [audioSource]);

  // Run Whisper as fallback
  const runWhisper = useCallback(
    async (source, key) => {
      setWhisperStatus('active');
      let sourceToAnalyze = source;
      if (needsTrimming && source) {
        setIsTrimming(true);
        try {
          sourceToAnalyze = await trimAudio(source, startTime, endTime);
        } finally {
          setIsTrimming(false);
        }
      }
      const result = await analyze(sourceToAnalyze, key || undefined);
      setWhisperStatus('done');
      return result;
    },
    [analyze, needsTrimming, startTime, endTime],
  );

  const handleAnalyze = async () => {
    if (!apiKey && !hasApiKey) {
      setShowApiKeyInput(true);
      return;
    }

    setIsRunning(true);
    setPipelineError(null);
    setRecognitionStatus('idle');
    setLrcStatus('idle');
    setWhisperStatus('idle');
    setRecognizedSong(null);
    setLrcLineCount(0);

    try {
      let result = null;

      // Step 1: Try song recognition (skip if trimming — user selected a section, not a full song)
      if (!needsTrimming && audioSource) {
        setRecognitionStatus('active');
        try {
          const recognition = await recognizeSong(audioSource);
          if (recognition.found) {
            setRecognitionStatus('found');
            setRecognizedSong(recognition);

            // Step 2: Fetch synced lyrics from LRCLIB
            setLrcStatus('active');
            const lyrics = await fetchSyncedLyrics(recognition.artist, recognition.title);

            if (lyrics?.syncedLyrics) {
              const { lines } = parseLRC(lyrics.syncedLyrics);
              setLrcLineCount(lines.length);
              setLrcStatus('found');

              // Get audio duration for last-line endTime calculation
              let duration = 0;
              try {
                if (audioSource instanceof File || audioSource instanceof Blob) {
                  const ctx = new (window.AudioContext || window.webkitAudioContext)();
                  const buf = await ctx.decodeAudioData(await audioSource.arrayBuffer());
                  duration = buf.duration;
                  ctx.close();
                } else if (typeof audioSource === 'string') {
                  const resp = await fetch(audioSource);
                  const ctx = new (window.AudioContext || window.webkitAudioContext)();
                  const buf = await ctx.decodeAudioData(await resp.arrayBuffer());
                  duration = buf.duration;
                  ctx.close();
                }
              } catch {
                // Duration fallback: use last line endTime
                duration = lines.length > 0 ? lines[lines.length - 1].endTime + 5 : 0;
              }

              result = lrcToWordTimeline(lines, duration);
            } else {
              setLrcStatus('not_found');
              // Fall through to Whisper
            }
          } else {
            setRecognitionStatus('not_found');
          }
        } catch (err) {
          log.warn('Song recognition failed, falling back to Whisper:', err.message);
          setRecognitionStatus('error');
        }
      } else if (needsTrimming) {
        // Skip recognition for trimmed sections
        setRecognitionStatus('idle');
      }

      // Step 3: Whisper fallback (if no LRC result)
      if (!result) {
        result = await runWhisper(audioSource, apiKey);
      }

      // Cache + deliver result
      if (result && result.words && result.words.length > 0) {
        saveLyricTemplate(audioSource, result.text, result.words);
      }

      onComplete?.(result);
    } catch (err) {
      if (err.message === 'API_KEY_REQUIRED' || err.message?.includes('401')) {
        setShowApiKeyInput(true);
        setApiKey('');
      }
      setPipelineError(err.message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleUseCached = () => {
    if (cachedLyrics) {
      onComplete?.({ text: cachedLyrics.lyrics, words: cachedLyrics.words });
    }
  };

  const handleClearCache = () => {
    setCachedLyrics(null);
  };

  const isProcessing = isRunning || isAnalyzing || isTrimming;

  // Determine step labels for the status feed
  const getRecognitionLabel = () => {
    if (recognitionStatus === 'active') return 'Identifying song...';
    if (recognitionStatus === 'found' && recognizedSong)
      return `Found: ${recognizedSong.title} \u2014 ${recognizedSong.artist}`;
    if (recognitionStatus === 'not_found') return 'Song not in database';
    if (recognitionStatus === 'error') return 'Recognition unavailable';
    return 'Identify song';
  };

  const getLrcLabel = () => {
    if (lrcStatus === 'active') return 'Fetching synced lyrics...';
    if (lrcStatus === 'found') return `Loaded ${lrcLineCount} synced lines`;
    if (lrcStatus === 'not_found') return 'No synced lyrics available';
    return 'Fetch synced lyrics';
  };

  const getWhisperLabel = () => {
    if (whisperStatus === 'active')
      return isTrimming ? 'Trimming audio...' : progress || 'Transcribing with AI...';
    if (whisperStatus === 'done') return 'Transcription complete';
    return 'Transcribe with AI';
  };

  const styles = {
    overlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: theme.overlay.heavy,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1200,
    },
    modal: {
      width: '90%',
      maxWidth: '520px',
      backgroundColor: theme.bg.input,
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 24px',
      borderBottom: `1px solid ${theme.bg.surface}`,
    },
    title: {
      margin: 0,
      fontSize: '18px',
      fontWeight: '600',
      color: theme.text.primary,
    },
    content: {
      padding: '24px',
    },
    audioInfo: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '16px',
      backgroundColor: theme.bg.page,
      borderRadius: '12px',
      marginBottom: '20px',
    },
    audioIcon: {
      fontSize: '28px',
      width: '48px',
      height: '48px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent.primary,
      borderRadius: '10px',
    },
    audioName: {
      margin: 0,
      fontWeight: '600',
      color: theme.text.primary,
      fontSize: '14px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '350px',
    },
    cachedSection: {
      backgroundColor: '#0f2a1f',
      border: '1px solid #22c55e',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '20px',
    },
    cachedHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '12px',
    },
    cachedIcon: {
      fontSize: '24px',
    },
    cachedTitle: {
      margin: 0,
      fontSize: '15px',
      fontWeight: '600',
      color: '#22c55e',
    },
    cachedInfo: {
      margin: '4px 0 0',
      fontSize: '12px',
      color: '#86efac',
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
      overflow: 'hidden',
    },
    cachedActions: {
      display: 'flex',
      gap: '8px',
    },
    apiKeySection: {
      marginBottom: '20px',
    },
    label: {
      display: 'block',
      fontWeight: '600',
      marginBottom: '8px',
      color: theme.text.primary,
      fontSize: '14px',
    },
    hint: {
      display: 'block',
      fontSize: '12px',
      fontWeight: '400',
      color: theme.text.muted,
      marginTop: '4px',
    },
    link: {
      color: theme.accent.primary,
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
      outline: 'none',
    },
    cost: {
      margin: '10px 0 0',
      fontSize: '12px',
      color: '#22c55e',
    },
    statusFeed: {
      padding: '16px',
      backgroundColor: theme.bg.page,
      borderRadius: '12px',
      marginBottom: '16px',
    },
    error: {
      padding: '16px',
      backgroundColor: '#2a0f0f',
      border: '1px solid #dc2626',
      borderRadius: '8px',
      color: '#fca5a5',
      textAlign: 'center',
      fontSize: '14px',
    },
    info: {
      padding: '16px',
      backgroundColor: theme.bg.page,
      borderRadius: '12px',
    },
    infoTitle: {
      margin: '0 0 8px 0',
      fontSize: '14px',
      fontWeight: '600',
      color: theme.text.primary,
    },
    steps: {
      margin: '0',
      paddingLeft: '20px',
      lineHeight: '1.8',
      color: theme.text.secondary,
      fontSize: '13px',
    },
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      padding: '16px 24px',
      borderTop: `1px solid ${theme.bg.surface}`,
      backgroundColor: theme.bg.page,
    },
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
    },
    emptyIcon: {
      fontSize: '48px',
      marginBottom: '16px',
    },
    emptyTitle: {
      margin: '0 0 8px 0',
      fontSize: '16px',
      fontWeight: '600',
      color: theme.text.primary,
    },
    emptyText: {
      margin: 0,
      fontSize: '13px',
      color: theme.text.muted,
    },
  };

  // Map status values to StatusStep status prop
  const stepStatus = (s) => {
    if (s === 'idle') return 'pending';
    if (s === 'active') return 'active';
    if (s === 'found' || s === 'done') return 'success';
    if (s === 'not_found') return 'skipped';
    if (s === 'error') return 'skipped';
    return 'pending';
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Auto Transcribe</h2>
          <IconButton icon={<FeatherX />} onClick={onClose} aria-label="Close" />
        </div>

        <div style={styles.content}>
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={styles.audioName}>
                    {(() => {
                      const raw =
                        audioFile?.name ||
                        (typeof audioUrl === 'string'
                          ? decodeURIComponent(audioUrl.split('/').pop().split('?')[0])
                          : 'Audio file');
                      return raw;
                    })()}
                  </p>
                </div>
              </div>

              {/* Cached Lyrics Found */}
              {cachedLyrics && !isProcessing && (
                <div style={styles.cachedSection}>
                  <div style={styles.cachedHeader}>
                    <span style={styles.cachedIcon}>✅</span>
                    <div>
                      <h4 style={styles.cachedTitle}>Cached Lyrics Found!</h4>
                      <p style={styles.cachedInfo}>
                        Analyzed on {new Date(cachedLyrics.createdAt).toLocaleDateString()} •{' '}
                        {cachedLyrics.words?.length || 0} words
                      </p>
                    </div>
                  </div>
                  <div style={styles.cachedPreview}>{cachedLyrics.lyrics?.slice(0, 150)}...</div>
                  <div style={styles.cachedActions}>
                    <Button variant="brand-primary" size="small" onClick={handleUseCached}>
                      Use Cached Lyrics
                    </Button>
                    <Button variant="neutral-secondary" size="small" onClick={handleClearCache}>
                      Re-analyze Instead
                    </Button>
                  </div>
                </div>
              )}

              {/* API Key Input */}
              {(showApiKeyInput || error) && !cachedLyrics && !isProcessing && (
                <div style={styles.apiKeySection}>
                  <label style={styles.label}>
                    OpenAI API Key
                    <span style={styles.hint}>
                      Get yours at{' '}
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        platform.openai.com
                      </a>
                    </span>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your API key..."
                    style={styles.input}
                  />
                  <p style={styles.cost}>Needed as fallback for Whisper transcription</p>
                </div>
              )}
              {!showApiKeyInput && !error && !cachedLyrics && apiKey && !isProcessing && (
                <Button
                  variant="neutral-tertiary"
                  size="small"
                  onClick={() => setShowApiKeyInput(true)}
                >
                  Change API Key
                </Button>
              )}

              {/* Live Status Feed — replaces "How it works" during processing */}
              {isProcessing && (
                <div style={styles.statusFeed}>
                  {!needsTrimming && (
                    <>
                      <StatusStep
                        status={stepStatus(recognitionStatus)}
                        label={getRecognitionLabel()}
                        theme={theme}
                      />
                      {(recognitionStatus === 'found' || lrcStatus !== 'idle') && (
                        <StatusStep
                          status={stepStatus(lrcStatus)}
                          label={getLrcLabel()}
                          theme={theme}
                        />
                      )}
                    </>
                  )}
                  {whisperStatus !== 'idle' && (
                    <StatusStep
                      status={stepStatus(whisperStatus)}
                      label={getWhisperLabel()}
                      theme={theme}
                    />
                  )}
                </div>
              )}

              {/* Error */}
              {(error || pipelineError) && <div style={styles.error}>{error || pipelineError}</div>}

              {/* Spacer when idle — keeps modal from collapsing */}
            </>
          )}
        </div>

        <div style={styles.footer}>
          <Button variant="neutral-secondary" onClick={onClose}>
            Cancel
          </Button>
          {audioSource && !cachedLyrics && (
            <Button
              variant="brand-primary"
              onClick={handleAnalyze}
              disabled={isProcessing || (!apiKey && !hasApiKey)}
              loading={isProcessing}
            >
              {isProcessing ? 'Working...' : 'Analyze Lyrics'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LyricAnalyzer;
