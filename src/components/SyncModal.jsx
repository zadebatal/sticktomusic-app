/**
 * SyncModal — Reusable modal for "Sync from STM Server".
 *
 * Used from Settings when the user wants to re-sync cloud media to their local drive.
 * 4 states: scanning → ready → syncing → complete
 * Same scan/select/sync flow as DesktopOnboarding but in a modal (no welcome/folder-select state).
 */

import { FeatherX } from '@subframe/core';
import React, { useCallback, useEffect, useState } from 'react';
import { formatBytes, scanForSync, syncArtistMedia } from '../services/syncService';
import { Button } from '../ui/components/Button';
import { IconButton } from '../ui/components/IconButton';

const STATES = {
  SCANNING: 'scanning',
  READY: 'ready',
  SYNCING: 'syncing',
  COMPLETE: 'complete',
};

// Inject keyframes for spinner animation
if (typeof document !== 'undefined') {
  const styleId = 'sync-modal-keyframes';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(styleEl);
  }
}

const SyncModal = ({ db, artists, onClose }) => {
  const [state, setState] = useState(STATES.SCANNING);
  const [scanResults, setScanResults] = useState([]);
  const [selectedArtists, setSelectedArtists] = useState(new Set());
  const [syncProgress, setSyncProgress] = useState({}); // { artistId: { current, total, fileName } }
  const [syncResults, setSyncResults] = useState({ synced: 0, failed: 0, skipped: 0 });
  const [error, setError] = useState(null);

  // Start scanning on mount
  useEffect(() => {
    let cancelled = false;

    async function runScan() {
      try {
        const results = await scanForSync(db, artists);
        if (cancelled) return;
        setScanResults(results);
        const needSync = new Set(results.filter((r) => r.needsSync > 0).map((r) => r.artistId));
        setSelectedArtists(needSync);
        setState(STATES.READY);
      } catch (err) {
        if (cancelled) return;
        setError(`Scan failed: ${err.message}`);
        setState(STATES.READY);
      }
    }

    runScan();
    return () => {
      cancelled = true;
    };
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

  // --- Syncing ---
  const handleStartSync = useCallback(async () => {
    setState(STATES.SYNCING);
    setError(null);

    const artistsToSync = scanResults.filter((r) => selectedArtists.has(r.artistId));
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

  const handleRunInBackground = useCallback(() => {
    // Close modal — sync continues in the background
    onClose?.();
  }, [onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal */}
      <div
        className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border border-neutral-200 bg-[#111111] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <span className="text-body-bold font-body-bold text-[#ffffffff]">
            Sync from STM Server
          </span>
          <IconButton icon={<FeatherX />} size="small" onClick={onClose} />
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          {/* STATE: SCANNING */}
          {state === STATES.SCANNING && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
                padding: '32px 0',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  border: '2px solid #6366f1',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span style={{ fontSize: 14, color: '#ccc' }}>Checking your cloud library...</span>
            </div>
          )}

          {/* STATE: READY */}
          {state === STATES.READY && (
            <>
              {/* Select all / deselect all */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={selectAll}
                  className="text-caption font-caption text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}
                >
                  Select All
                </button>
                <span className="text-neutral-600">|</span>
                <button
                  onClick={deselectAll}
                  className="text-caption font-caption text-neutral-400 hover:text-neutral-300 cursor-pointer"
                  style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}
                >
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
                    <div
                      key={result.artistId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 0',
                        borderBottom: '1px solid #222',
                      }}
                    >
                      {/* Checkbox */}
                      <div
                        onClick={() => toggleArtist(result.artistId)}
                        style={{
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
                        }}
                      >
                        {checked ? '\u2713' : ''}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>
                          {result.artistName}
                        </div>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          {breakdown.join(', ') || 'No files'}
                          {result.localCount > 0 && (
                            <span style={{ color: '#16a34a', marginLeft: 8 }}>
                              {result.localCount} already local
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        style={{ fontSize: 12, color: '#666', minWidth: 60, textAlign: 'right' }}
                      >
                        {formatBytes(result.totalSize)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  borderTop: '1px solid #333',
                }}
              >
                <span style={{ fontSize: 13, color: '#ccc', fontWeight: 500 }}>
                  {totalFiles} file{totalFiles !== 1 ? 's' : ''} to sync
                </span>
                <span style={{ fontSize: 13, color: '#ccc' }}>{formatBytes(totalSize)}</span>
              </div>

              {error && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    borderRadius: 8,
                    border: '1px solid rgba(127, 29, 29, 0.5)',
                    backgroundColor: 'rgba(69, 10, 10, 0.3)',
                    padding: '10px 12px',
                  }}
                >
                  <span style={{ fontSize: 12, color: '#fca5a5' }}>{error}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="neutral-secondary" size="medium" onClick={onClose}>
                  Cancel
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
            </>
          )}

          {/* STATE: SYNCING */}
          {state === STATES.SYNCING && (
            <>
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {scanResults
                  .filter((r) => selectedArtists.has(r.artistId))
                  .map((result) => {
                    const p = syncProgress[result.artistId];
                    const pct = p ? Math.round((p.current / p.total) * 100) : 0;

                    return (
                      <div
                        key={result.artistId}
                        style={{
                          padding: '12px 0',
                          borderBottom: '1px solid #222',
                        }}
                      >
                        <div
                          style={{ fontSize: 14, fontWeight: 500, color: '#fff', marginBottom: 8 }}
                        >
                          {result.artistName}
                        </div>
                        <div
                          style={{
                            width: '100%',
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: '#1a1a1a',
                            overflow: 'hidden',
                            marginBottom: 6,
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              borderRadius: 3,
                              backgroundColor: '#6366f1',
                              width: `${pct}%`,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, color: '#888' }}>
                            {p ? `${p.current} / ${p.total} files` : 'Waiting...'}
                          </span>
                          <span style={{ fontSize: 12, color: '#888' }}>{pct}%</span>
                        </div>
                        {p?.fileName && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#666',
                              marginTop: 2,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {p.fileName}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* Overall progress */}
              <div style={{ paddingTop: 12, borderTop: '1px solid #333' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#ccc', fontWeight: 500 }}>Overall</span>
                  <span style={{ fontSize: 13, color: '#ccc' }}>{overallSyncProgress}%</span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#1a1a1a',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 3,
                      backgroundColor: '#6366f1',
                      width: `${overallSyncProgress}%`,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button variant="neutral-secondary" size="medium" onClick={handleRunInBackground}>
                  Run in Background
                </Button>
              </div>
            </>
          )}

          {/* STATE: COMPLETE */}
          {state === STATES.COMPLETE && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  backgroundColor: '#16a34a22',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  margin: '0 auto 16px',
                }}
              >
                <span style={{ color: '#16a34a' }}>{'\u2713'}</span>
              </div>
              <h2
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: '#fff',
                  margin: '0 0 8px',
                  textAlign: 'center',
                }}
              >
                Sync Complete
              </h2>
              <p
                style={{
                  fontSize: 14,
                  color: '#999',
                  textAlign: 'center',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {syncResults.synced} file{syncResults.synced !== 1 ? 's' : ''} synced
                {syncResults.failed > 0 && `, ${syncResults.failed} failed`}
                {syncResults.skipped > 0 && `, ${syncResults.skipped} skipped`}
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  marginTop: 24,
                }}
              >
                <Button variant="brand-primary" size="medium" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SyncModal;
