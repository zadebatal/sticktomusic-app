/**
 * DesktopOnboarding — Full-screen overlay shown on first launch when no media folder is configured.
 *
 * 5 states: welcome → scanning → ready → syncing → complete
 * Walks the user through selecting a media folder and syncing cloud media to local drive.
 */
import React, { useCallback, useState } from 'react';
import { ensureArtistMediaFolder, setOnboardingComplete } from '../services/localMediaService';
import { formatBytes, scanForSync, syncArtistMedia } from '../services/syncService';
import { Button } from '../ui/components/Button';

const STATES = {
  WELCOME: 'welcome',
  SCANNING: 'scanning',
  READY: 'ready',
  SYNCING: 'syncing',
  COMPLETE: 'complete',
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
  },
  card: {
    maxWidth: 560,
    width: '100%',
    margin: '0 auto',
    backgroundColor: '#111111',
    border: '1px solid #222',
    borderRadius: 12,
    padding: 32,
  },
  heading: {
    fontSize: 24,
    fontWeight: 700,
    color: '#ffffff',
    margin: 0,
    marginBottom: 8,
  },
  subheading: {
    fontSize: 20,
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: '#999',
    margin: 0,
    marginBottom: 24,
    lineHeight: 1.5,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '2px solid #6366f1',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  artistRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid #222',
  },
  checkbox: (checked) => ({
    width: 20,
    height: 20,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    backgroundColor: checked ? '#6366f1' : 'transparent',
    border: checked ? '2px solid #6366f1' : '2px solid #444',
    color: checked ? '#fff' : 'transparent',
    fontSize: 12,
    fontWeight: 700,
    transition: 'all 0.15s ease',
  }),
  artistName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 500,
    color: '#fff',
  },
  fileBreakdown: {
    fontSize: 12,
    color: '#888',
  },
  sizeEstimate: {
    fontSize: 12,
    color: '#666',
    minWidth: 60,
    textAlign: 'right',
  },
  selectLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  link: {
    fontSize: 12,
    color: '#818cf8',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'inherit',
  },
  linkNeutral: {
    fontSize: 12,
    color: '#888',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'inherit',
  },
  totalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 0 0',
    borderTop: '1px solid #333',
    marginTop: 8,
  },
  totalText: {
    fontSize: 13,
    color: '#ccc',
    fontWeight: 500,
  },
  progressContainer: {
    padding: '12px 0',
    borderBottom: '1px solid #222',
  },
  progressArtistName: {
    fontSize: 14,
    fontWeight: 500,
    color: '#fff',
    marginBottom: 8,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: (pct) => ({
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#6366f1',
    width: `${pct}%`,
    transition: 'width 0.3s ease',
  }),
  progressText: {
    fontSize: 12,
    color: '#888',
  },
  progressFileName: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  overallProgress: {
    marginTop: 16,
    padding: '16px 0 0',
    borderTop: '1px solid #333',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 24,
  },
  actionsSpaceBetween: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 24,
  },
  successIcon: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    backgroundColor: '#16a34a22',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    margin: '0 auto 16px',
  },
  summaryText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    margin: 0,
    lineHeight: 1.6,
  },
  errorBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 8,
    border: '1px solid rgba(127, 29, 29, 0.5)',
    backgroundColor: 'rgba(69, 10, 10, 0.3)',
    padding: '10px 12px',
    marginTop: 12,
  },
  errorText: {
    fontSize: 12,
    color: '#fca5a5',
  },
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    padding: '32px 0',
  },
};

// Inject keyframes for spinner animation
if (typeof document !== 'undefined') {
  const styleId = 'desktop-onboarding-keyframes';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(styleEl);
  }
}

const DesktopOnboarding = ({ db, artists, onComplete }) => {
  const [state, setState] = useState(STATES.WELCOME);
  const [scanResults, setScanResults] = useState([]);
  const [selectedArtists, setSelectedArtists] = useState(new Set());
  const [syncProgress, setSyncProgress] = useState({}); // { artistId: { current, total, fileName } }
  const [syncResults, setSyncResults] = useState({ synced: 0, failed: 0, skipped: 0 });
  const [error, setError] = useState(null);

  // --- Welcome state ---
  const handleSelectFolder = useCallback(async () => {
    try {
      setError(null);
      const result = await window.electronAPI.selectMediaFolder();
      if (!result) return; // user cancelled

      // Folder selected, start scanning
      setState(STATES.SCANNING);
      try {
        const results = await scanForSync(db, artists);
        setScanResults(results);
        // Pre-select artists that need syncing
        const needSync = new Set(results.filter((r) => r.needsSync > 0).map((r) => r.artistId));
        setSelectedArtists(needSync);
        setState(STATES.READY);
      } catch (err) {
        setError(`Scan failed: ${err.message}`);
        setState(STATES.WELCOME);
      }
    } catch (err) {
      setError(`Could not select folder: ${err.message}`);
    }
  }, [db, artists]);

  // --- Ready state ---
  const toggleArtist = useCallback((artistId) => {
    setSelectedArtists((prev) => {
      const next = new Set(prev);
      if (next.has(artistId)) next.delete(artistId);
      else next.add(artistId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedArtists(new Set(scanResults.map((r) => r.artistId)));
  }, [scanResults]);

  const deselectAll = useCallback(() => {
    setSelectedArtists(new Set());
  }, []);

  const handleSkip = useCallback(async () => {
    await setOnboardingComplete(true);
    onComplete?.();
  }, [onComplete]);

  // --- Syncing state ---
  const handleStartSync = useCallback(async () => {
    setState(STATES.SYNCING);
    setError(null);

    const artistsToSync = scanResults.filter((r) => selectedArtists.has(r.artistId));

    // Ensure flat media folders exist for all artists being synced.
    // Track failures so we can warn the user instead of silently proceeding
    // into a broken sync.
    const folderCreationFailures = [];
    for (const artistResult of artistsToSync) {
      const artist = artists.find((a) => a.id === artistResult.artistId);
      if (!artist?.name) continue;
      try {
        await ensureArtistMediaFolder(artist.name);
      } catch (err) {
        folderCreationFailures.push({ artist: artist.name, error: err?.message || String(err) });
      }
    }
    if (folderCreationFailures.length > 0) {
      const names = folderCreationFailures.map((f) => f.artist).join(', ');
      setError(`Could not create media folders for: ${names}. Sync will skip these artists.`);
      // Filter them out so we don't try to sync into a missing folder
      const failed = new Set(folderCreationFailures.map((f) => f.artist));
      // eslint-disable-next-line no-param-reassign
      artistsToSync.splice(
        0,
        artistsToSync.length,
        ...artistsToSync.filter((r) => {
          const a = artists.find((aa) => aa.id === r.artistId);
          return a && !failed.has(a.name);
        }),
      );
    }

    let totalSynced = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const artistResult of artistsToSync) {
      const artist = artists.find((a) => a.id === artistResult.artistId);
      if (!artist) continue;

      try {
        const result = await syncArtistMedia(db, artist, (artistId, current, total, fileName) => {
          setSyncProgress((prev) => ({
            ...prev,
            [artistId]: { current, total, fileName },
          }));
        });

        totalSynced += result.synced;
        totalFailed += result.failed;
        totalSkipped += result.skipped;
      } catch (err) {
        totalFailed += artistResult.needsSync;
      }
    }

    setSyncResults({ synced: totalSynced, failed: totalFailed, skipped: totalSkipped });
    setState(STATES.COMPLETE);
  }, [db, artists, scanResults, selectedArtists]);

  const handleRunInBackground = useCallback(async () => {
    // Mark onboarding as done and close — sync continues in background
    await setOnboardingComplete(true);
    onComplete?.();
  }, [onComplete]);

  const handleOpenApp = useCallback(async () => {
    await setOnboardingComplete(true);
    onComplete?.();
  }, [onComplete]);

  // --- Computed values ---
  const totalFiles = scanResults.reduce(
    (sum, r) => sum + (selectedArtists.has(r.artistId) ? r.needsSync : 0),
    0,
  );
  const totalSize = scanResults.reduce(
    (sum, r) => sum + (selectedArtists.has(r.artistId) ? r.totalSize : 0),
    0,
  );

  // Overall sync progress
  const overallSyncProgress = (() => {
    const artistsToSync = scanResults.filter((r) => selectedArtists.has(r.artistId));
    let done = 0;
    let total = 0;
    for (const ar of artistsToSync) {
      const p = syncProgress[ar.artistId];
      total += ar.totalCount;
      done += p ? p.current : 0;
    }
    return total > 0 ? Math.round((done / total) * 100) : 0;
  })();

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* STATE: WELCOME */}
        {state === STATES.WELCOME && (
          <>
            <h1 style={styles.heading}>Welcome to StickToMusic Desktop</h1>
            <p style={styles.subtext}>
              Set up your media workspace. Choose a folder on your drive where media files will be
              stored.
            </p>
            <div style={styles.actions}>
              <Button variant="brand-primary" size="medium" onClick={handleSelectFolder}>
                Select Folder
              </Button>
            </div>
            {error && (
              <div style={styles.errorBox}>
                <span style={styles.errorText}>{error}</span>
              </div>
            )}
          </>
        )}

        {/* STATE: SCANNING */}
        {state === STATES.SCANNING && (
          <div style={styles.centered}>
            <div style={styles.spinner} />
            <span style={{ fontSize: 14, color: '#ccc' }}>Checking your cloud library...</span>
          </div>
        )}

        {/* STATE: READY */}
        {state === STATES.READY && (
          <>
            <h2 style={styles.subheading}>Ready to Sync</h2>
            <p style={styles.subtext}>Select which artists to sync to your local drive.</p>

            {/* Select all / deselect all */}
            <div style={styles.selectLinks}>
              <button style={styles.link} onClick={selectAll}>
                Select All
              </button>
              <span style={{ color: '#444' }}>|</span>
              <button style={styles.linkNeutral} onClick={deselectAll}>
                Deselect All
              </button>
            </div>

            {/* Artist rows */}
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {scanResults.map((result) => {
                const checked = selectedArtists.has(result.artistId);
                const breakdown = [];
                if (result.byType.video > 0)
                  breakdown.push(
                    `${result.byType.video} video${result.byType.video !== 1 ? 's' : ''}`,
                  );
                if (result.byType.image > 0)
                  breakdown.push(
                    `${result.byType.image} image${result.byType.image !== 1 ? 's' : ''}`,
                  );
                if (result.byType.audio > 0) breakdown.push(`${result.byType.audio} audio`);

                return (
                  <div key={result.artistId} style={styles.artistRow}>
                    <div
                      style={styles.checkbox(checked)}
                      onClick={() => toggleArtist(result.artistId)}
                    >
                      {checked ? '\u2713' : ''}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.artistName}>{result.artistName}</div>
                      <div style={styles.fileBreakdown}>
                        {breakdown.join(', ') || 'No files'}
                        {result.localCount > 0 && (
                          <span style={{ color: '#16a34a', marginLeft: 8 }}>
                            {result.localCount} already local
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={styles.sizeEstimate}>{formatBytes(result.totalSize)}</div>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div style={styles.totalRow}>
              <span style={styles.totalText}>
                {totalFiles} file{totalFiles !== 1 ? 's' : ''} to sync
              </span>
              <span style={styles.totalText}>{formatBytes(totalSize)}</span>
            </div>

            {/* Actions */}
            <div style={styles.actionsSpaceBetween}>
              <Button variant="neutral-secondary" size="medium" onClick={handleSkip}>
                Skip for Now
              </Button>
              <Button
                variant="brand-primary"
                size="medium"
                onClick={handleStartSync}
                disabled={selectedArtists.size === 0}
              >
                Start Sync
              </Button>
            </div>

            {error && (
              <div style={styles.errorBox}>
                <span style={styles.errorText}>{error}</span>
              </div>
            )}
          </>
        )}

        {/* STATE: SYNCING */}
        {state === STATES.SYNCING && (
          <>
            <h2 style={styles.subheading}>Syncing Media</h2>
            <p style={styles.subtext}>Downloading files to your local drive...</p>

            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {scanResults
                .filter((r) => selectedArtists.has(r.artistId))
                .map((result) => {
                  const p = syncProgress[result.artistId];
                  const pct = p ? Math.round((p.current / p.total) * 100) : 0;

                  return (
                    <div key={result.artistId} style={styles.progressContainer}>
                      <div style={styles.progressArtistName}>{result.artistName}</div>
                      <div style={styles.progressBarTrack}>
                        <div style={styles.progressBarFill(pct)} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={styles.progressText}>
                          {p ? `${p.current} / ${p.total} files` : 'Waiting...'}
                        </span>
                        <span style={styles.progressText}>{pct}%</span>
                      </div>
                      {p?.fileName && <div style={styles.progressFileName}>{p.fileName}</div>}
                    </div>
                  );
                })}
            </div>

            {/* Overall progress */}
            <div style={styles.overallProgress}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#ccc', fontWeight: 500 }}>Overall</span>
                <span style={{ fontSize: 13, color: '#ccc' }}>{overallSyncProgress}%</span>
              </div>
              <div style={styles.progressBarTrack}>
                <div style={styles.progressBarFill(overallSyncProgress)} />
              </div>
            </div>

            <div style={styles.actions}>
              <Button variant="neutral-secondary" size="medium" onClick={handleRunInBackground}>
                Run in Background
              </Button>
            </div>
          </>
        )}

        {/* STATE: COMPLETE */}
        {state === STATES.COMPLETE && (
          <div style={{ textAlign: 'center' }}>
            <div style={styles.successIcon}>
              <span style={{ color: '#16a34a' }}>{'\u2713'}</span>
            </div>
            <h2 style={{ ...styles.subheading, textAlign: 'center' }}>Sync Complete</h2>
            <p style={styles.summaryText}>
              {syncResults.synced} file{syncResults.synced !== 1 ? 's' : ''} synced
              {syncResults.failed > 0 && `, ${syncResults.failed} failed`}
              {syncResults.skipped > 0 && `, ${syncResults.skipped} skipped`}
            </p>
            <div style={{ ...styles.actions, justifyContent: 'center', marginTop: 24 }}>
              <Button variant="brand-primary" size="medium" onClick={handleOpenApp}>
                Open App
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DesktopOnboarding;
