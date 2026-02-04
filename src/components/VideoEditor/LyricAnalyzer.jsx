import React, { useState, useEffect } from 'react';
import { useLyricAnalyzer } from '../../hooks/useLyricAnalyzer';
import { getStoredApiKey } from '../../services/assemblyAIService';
import { loadLyricTemplate, saveLyricTemplate } from '../../services/storageService';

/**
 * LyricAnalyzer - AI-powered lyric transcription with caching
 * Checks for cached lyrics before re-analyzing the same song
 */
const LyricAnalyzer = ({ audioFile, audioUrl, onComplete, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [cachedLyrics, setCachedLyrics] = useState(null);
  const { analyze, isAnalyzing, progress, error, hasApiKey } = useLyricAnalyzer();

  const audioSource = audioFile || audioUrl;

  // Check for cached lyrics on mount
  useEffect(() => {
    const storedKey = getStoredApiKey();
    if (storedKey) setApiKey(storedKey);
    else setShowApiKeyInput(true);

    // Check if we have cached lyrics for this audio file
    if (audioSource) {
      const cached = loadLyricTemplate(audioSource);
      if (cached) {
        setCachedLyrics(cached);
      }
    }
  }, [audioSource]);

  const handleAnalyze = async () => {
    if (!apiKey && !hasApiKey) {
      setShowApiKeyInput(true);
      return;
    }
    try {
      const result = await analyze(audioSource, apiKey || undefined);

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

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>🎤 Lyric Analyzer</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div style={styles.content}>
          {/* UI-40: Empty state when no audio */}
          {!audioSource ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>🎵</div>
              <h4 style={styles.emptyTitle}>No Audio Selected</h4>
              <p style={styles.emptyText}>Select an audio track to analyze lyrics with word-level timestamps.</p>
            </div>
          ) : (
          <>
          {/* Audio Info */}
          <div style={styles.audioInfo}>
            <div style={styles.audioIcon}>🎵</div>
            <div>
              <p style={styles.audioName}>{audioFile?.name || (typeof audioUrl === 'string' ? audioUrl.split('/').pop() : 'Audio file')}</p>
              <p style={styles.audioSize}>{audioFile ? `${(audioFile.size / (1024 * 1024)).toFixed(2)} MB` : ''}</p>
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
                <button style={styles.useCachedButton} onClick={handleUseCached}>
                  ⚡ Use Cached Lyrics
                </button>
                <button style={styles.reanalyzeButton} onClick={handleClearCache}>
                  🔄 Re-analyze Instead
                </button>
              </div>
            </div>
          )}

          {/* API Key Input (show if no key, error occurred, or user wants to change) */}
          {(showApiKeyInput || error) && !cachedLyrics && (
            <div style={styles.apiKeySection}>
              <label style={styles.label}>
                AssemblyAI API Key
                <span style={styles.hint}>
                  Get yours free at <a href="https://www.assemblyai.com/dashboard/signup" target="_blank" rel="noopener noreferrer" style={styles.link}>assemblyai.com</a>
                </span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key..."
                style={styles.input}
              />
              <p style={styles.cost}>✅ Supports files up to 5GB • Free tier: 3 hours/month</p>
            </div>
          )}
          {/* Show button to change API key if one is stored but input is hidden */}
          {!showApiKeyInput && !error && !cachedLyrics && apiKey && (
            <button
              style={styles.changeKeyBtn}
              onClick={() => setShowApiKeyInput(true)}
            >
              🔑 Change API Key
            </button>
          )}

          {/* Progress */}
          {isAnalyzing && (
            <div style={styles.progress}>
              <div style={styles.spinner} />
              <p style={styles.progressText}>{progress}</p>
            </div>
          )}

          {/* Error */}
          {error && <div style={styles.error}>❌ {error}</div>}

          {/* How it works (only if no cache) */}
          {!isAnalyzing && !error && !cachedLyrics && (
            <div style={styles.info}>
              <h4 style={styles.infoTitle}>How it works:</h4>
              <ol style={styles.steps}>
                <li>Your audio is uploaded to AssemblyAI</li>
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
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          {audioSource && !cachedLyrics && (
            <button
              style={styles.analyzeBtn}
              onClick={handleAnalyze}
              disabled={isAnalyzing || (!apiKey && !hasApiKey)}
            >
              {isAnalyzing ? 'Analyzing...' : '🎵 Analyze Lyrics'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200
  },
  modal: {
    width: '90%',
    maxWidth: '520px',
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
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: '#fff'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: '#6b7280',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px'
  },
  content: {
    padding: '24px'
  },
  audioInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#0a0a0f',
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
    backgroundColor: '#7c3aed',
    borderRadius: '10px'
  },
  audioName: {
    margin: 0,
    fontWeight: '600',
    color: '#fff',
    fontSize: '14px'
  },
  audioSize: {
    margin: '4px 0 0',
    fontSize: '12px',
    color: '#6b7280'
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
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#9ca3af',
    fontStyle: 'italic',
    marginBottom: '12px',
    maxHeight: '60px',
    overflow: 'hidden'
  },
  cachedActions: {
    display: 'flex',
    gap: '8px'
  },
  useCachedButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#22c55e',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '14px'
  },
  reanalyzeButton: {
    padding: '12px 16px',
    backgroundColor: 'transparent',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '13px'
  },
  apiKeySection: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    fontWeight: '600',
    marginBottom: '8px',
    color: '#e5e7eb',
    fontSize: '14px'
  },
  hint: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '400',
    color: '#6b7280',
    marginTop: '4px'
  },
  link: {
    color: '#7c3aed'
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    backgroundColor: '#0a0a0f',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#fff',
    boxSizing: 'border-box',
    outline: 'none'
  },
  cost: {
    margin: '10px 0 0',
    fontSize: '12px',
    color: '#22c55e'
  },
  changeKeyBtn: {
    background: 'none',
    border: '1px solid #2d2d3d',
    borderRadius: '8px',
    color: '#9ca3af',
    padding: '8px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    marginBottom: '16px'
  },
  progress: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '32px'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #2d2d3d',
    borderTopColor: '#7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  progressText: {
    color: '#9ca3af',
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
    backgroundColor: '#0a0a0f',
    borderRadius: '12px'
  },
  infoTitle: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: '#e5e7eb'
  },
  steps: {
    margin: '0',
    paddingLeft: '20px',
    lineHeight: '1.8',
    color: '#9ca3af',
    fontSize: '13px'
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 24px',
    borderTop: '1px solid #1f1f2e',
    backgroundColor: '#0a0a0f'
  },
  cancelBtn: {
    padding: '10px 20px',
    backgroundColor: '#1f1f2e',
    border: 'none',
    borderRadius: '8px',
    color: '#e5e7eb',
    cursor: 'pointer',
    fontSize: '14px'
  },
  analyzeBtn: {
    padding: '10px 24px',
    backgroundColor: '#7c3aed',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '14px'
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
    color: '#fff'
  },
  emptyText: {
    margin: 0,
    fontSize: '13px',
    color: '#6b7280'
  }
};

if (typeof document !== 'undefined' && !document.getElementById('lyric-analyzer-styles')) {
  const style = document.createElement('style');
  style.id = 'lyric-analyzer-styles';
  style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

export default LyricAnalyzer;
