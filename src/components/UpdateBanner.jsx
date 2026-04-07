/**
 * UpdateBanner — DaVinci-style non-intrusive update notification.
 *
 * States:
 * - hidden: no update available
 * - available: "Version X.Y.Z available" with Update/Dismiss buttons
 * - downloading: progress bar
 * - ready: "Restart to apply" button
 * - installing: spinner + "swap in progress" message (covers the ~30s dead
 *   air between clicking Restart and the app actually relaunching). Without
 *   this, ShipIt does its thing in a background process while the user
 *   stares at an unchanged UI and assumes the click did nothing.
 *
 * Only renders when running in Electron (window.electronAPI?.isElectron).
 */
import React, { useState, useEffect, useCallback } from 'react';

const UpdateBanner = () => {
  const [state, setState] = useState('hidden'); // hidden | available | downloading | ready | installing
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.isElectron) return;

    api.onUpdateAvailable((v) => {
      setVersion(v);
      setState('available');
    });

    api.onUpdateProgress((percent) => {
      setProgress(percent);
    });

    api.onUpdateDownloaded(() => {
      setState('ready');
    });
  }, []);

  const handleDownload = useCallback(() => {
    setState('downloading');
    window.electronAPI?.downloadUpdate();
  }, []);

  const handleInstall = useCallback(() => {
    // Flip into 'installing' state IMMEDIATELY so the user gets visible
    // feedback. ShipIt then does the bundle swap in a background process
    // (~20-40 sec depending on bundle size) and relaunches the app, which
    // unmounts this whole React tree — so we don't need a timeout to clear
    // the state. If quitAndInstall errors out, the main process falls back
    // to app.relaunch() which also unmounts us.
    setState('installing');
    window.electronAPI?.installUpdate();
  }, []);

  const handleDismiss = useCallback(() => {
    setState('hidden');
  }, []);

  if (state === 'hidden') return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        backgroundColor: '#1a1a2e',
        border: '1px solid #2d2d44',
        borderRadius: 10,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        minWidth: 320,
      }}
    >
      {state === 'available' && (
        <>
          <span style={{ fontSize: 14, color: '#a5b4fc' }}>Version {version} available</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleDownload}
            style={{
              background: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '5px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Update
          </button>
          <button
            onClick={handleDismiss}
            style={{
              background: 'none',
              color: '#666',
              border: 'none',
              fontSize: 13,
              cursor: 'pointer',
              padding: '5px 8px',
            }}
          >
            Dismiss
          </button>
        </>
      )}

      {state === 'downloading' && (
        <>
          <span style={{ fontSize: 13, color: '#a5b4fc' }}>Downloading update...</span>
          <div
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: '#2d2d44',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                backgroundColor: '#6366f1',
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: '#666' }}>{Math.round(progress)}%</span>
        </>
      )}

      {state === 'ready' && (
        <>
          <span style={{ fontSize: 14, color: '#22c55e' }}>Update ready</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleInstall}
            style={{
              background: '#22c55e',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '5px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Restart to Apply
          </button>
          <button
            onClick={handleDismiss}
            style={{
              background: 'none',
              color: '#666',
              border: 'none',
              fontSize: 13,
              cursor: 'pointer',
              padding: '5px 8px',
            }}
          >
            Later
          </button>
        </>
      )}

      {state === 'installing' && (
        <>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              border: '2px solid #2d2d44',
              borderTopColor: '#22c55e',
              animation: 'stm-update-spin 0.9s linear infinite',
              flex: 'none',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>
              Installing update…
            </span>
            <span style={{ fontSize: 11, color: '#888' }}>
              This takes 20–40 seconds. The app will restart automatically — please don&apos;t quit
              it.
            </span>
          </div>
          <style>{`
            @keyframes stm-update-spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
        </>
      )}
    </div>
  );
};

export default UpdateBanner;
