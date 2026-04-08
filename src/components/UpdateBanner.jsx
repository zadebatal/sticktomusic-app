/**
 * UpdateBanner — DaVinci-style non-intrusive update notification.
 *
 * States:
 * - hidden: no update available
 * - available: "Version X.Y.Z available" with Update/Dismiss buttons
 * - downloading: progress bar
 * - ready: "Restart to apply" button
 * - installing: FULL-SCREEN overlay + spinner + countdown. Required because
 *   electron-updater's quitAndInstall() yanks the app down before any React
 *   state flip can render. Without flushSync + a small defer + a prominent
 *   overlay, the user clicks Restart and stares at an unchanged UI for
 *   20-40 seconds wondering if anything happened.
 *
 * Only renders when running in Electron (window.electronAPI?.isElectron).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';

const UpdateBanner = () => {
  const [state, setState] = useState('hidden'); // hidden | available | downloading | ready | installing
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [installSeconds, setInstallSeconds] = useState(0);

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

  // Tick a counter while installing so the user sees something moving and
  // can mentally calibrate against the "20-40 seconds" estimate.
  useEffect(() => {
    if (state !== 'installing') return;
    setInstallSeconds(0);
    const interval = setInterval(() => {
      setInstallSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [state]);

  const handleDownload = useCallback(() => {
    setState('downloading');
    window.electronAPI?.downloadUpdate();
  }, []);

  const handleInstall = useCallback(() => {
    // flushSync forces React to render the installing overlay BEFORE the
    // event handler returns. Without this, React 18 batching defers the
    // state update past the IPC call, which means quitAndInstall gets a
    // chance to start tearing the app down before the spinner ever paints.
    flushSync(() => {
      setState('installing');
    });
    // Then defer the IPC call by ~600ms so the overlay actually paints
    // and the user gets at least a beat of visible feedback before the
    // bundle swap starts. quitAndInstall is destructive — once it fires,
    // the renderer freezes immediately and ShipIt takes over.
    setTimeout(() => {
      window.electronAPI?.installUpdate();
    }, 600);
  }, []);

  const handleDismiss = useCallback(() => {
    setState('hidden');
  }, []);

  if (state === 'hidden') return null;

  // Full-screen installing overlay — separate render path because the
  // bottom-corner banner is too easy to miss when the app is about to die.
  if (state === 'installing') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999999,
          backgroundColor: 'rgba(8, 8, 18, 0.92)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
            padding: '48px 64px',
            backgroundColor: '#0f0f1f',
            border: '1px solid #2d2d44',
            borderRadius: 16,
            boxShadow: '0 24px 96px rgba(0,0,0,0.7)',
            maxWidth: 480,
          }}
        >
          {/* Big spinner */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              border: '4px solid #2d2d44',
              borderTopColor: '#22c55e',
              animation: 'stm-update-spin 0.9s linear infinite',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 22, color: '#22c55e', fontWeight: 700 }}>
              Installing update…
            </span>
            <span
              style={{
                fontSize: 14,
                color: '#a5b4fc',
                textAlign: 'center',
                lineHeight: 1.5,
                maxWidth: 360,
              }}
            >
              The new version is being unpacked. The app will restart automatically when it's done —
              typically 20–40 seconds.
            </span>
            <span
              style={{
                fontSize: 13,
                color: '#888',
                textAlign: 'center',
                marginTop: 8,
              }}
            >
              {installSeconds}s elapsed · please don't quit StickToMusic
            </span>
          </div>
        </div>
        <style>{`
          @keyframes stm-update-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

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
    </div>
  );
};

export default UpdateBanner;
