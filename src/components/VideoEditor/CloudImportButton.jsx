import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../ui';
import googleDriveService, { initGoogleDrive } from '../../services/googleDriveService';
import dropboxService, { initDropbox } from '../../services/dropboxService';

const DRIVE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const DRIVE_API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;
const DROPBOX_APP_KEY = process.env.REACT_APP_DROPBOX_APP_KEY;

/**
 * CloudImportButton — Shared cloud import for Drive + Dropbox
 *
 * @param {string} artistId — current artist for settings
 * @param {function} onImportMedia — callback with array of { name, file, url, type }
 * @param {'video'|'audio'|'image'|'all'} mediaType — filter files by type
 * @param {boolean} compact — smaller button style
 * @param {object} db — Firestore instance for settings
 */
const CloudImportButton = ({ artistId, onImportMedia, mediaType = 'all', compact = false, db }) => {
  const { theme } = useTheme();
  const toast = useToast();
  const [showMenu, setShowMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, source: '' });
  const menuRef = useRef(null);

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const getExtensionFilter = () => {
    switch (mediaType) {
      case 'video': return ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
      case 'audio': return ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
      case 'image': return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
      default: return null; // all files
    }
  };

  const matchesFilter = (fileName) => {
    const exts = getExtensionFilter();
    if (!exts) return true;
    const lower = fileName.toLowerCase();
    return exts.some(ext => lower.endsWith(ext));
  };

  // ── Google Drive Import ──
  const handleDriveImport = async () => {
    setShowMenu(false);
    if (!DRIVE_CLIENT_ID || !DRIVE_API_KEY) {
      toast.error('Google Drive not configured. Missing API keys.');
      return;
    }
    try {
      await initGoogleDrive(DRIVE_CLIENT_ID, DRIVE_API_KEY);
      if (!googleDriveService.isAuthenticated()) {
        await googleDriveService.authenticate();
      }
    } catch (err) {
      toast.error('Google Drive authentication failed: ' + err.message);
      return;
    }
    setImporting(true);
    setProgress({ current: 0, total: 0, source: 'Drive' });
    try {
      const files = await googleDriveService.listFiles();
      const filtered = files.filter(f => matchesFilter(f.name));
      if (filtered.length === 0) {
        toast.info('No matching files found in Google Drive');
        setImporting(false);
        return;
      }
      setProgress({ current: 0, total: filtered.length, source: 'Drive' });
      const imported = [];
      for (let i = 0; i < filtered.length; i++) {
        setProgress({ current: i + 1, total: filtered.length, source: 'Drive' });
        try {
          const blob = await googleDriveService.downloadFile(filtered[i].id);
          const localUrl = URL.createObjectURL(blob);
          imported.push({
            name: filtered[i].name,
            file: blob,
            url: localUrl,
            localUrl,
            type: mediaType === 'all' ? detectType(filtered[i].name) : mediaType,
            source: 'google_drive'
          });
        } catch (err) {
          console.warn(`Failed to download ${filtered[i].name}:`, err.message);
        }
      }
      if (imported.length > 0) {
        onImportMedia?.(imported);
        toast.success(`Imported ${imported.length} file${imported.length > 1 ? 's' : ''} from Drive`);
      }
    } catch (err) {
      console.error('Drive import error:', err);
      toast.error('Failed to import from Google Drive');
    }
    setImporting(false);
  };

  // ── Dropbox Import ──
  const handleDropboxImport = async () => {
    setShowMenu(false);
    if (!DROPBOX_APP_KEY) {
      toast.error('Dropbox not configured. Missing app key.');
      return;
    }
    try {
      initDropbox(DROPBOX_APP_KEY);
      if (!dropboxService.isAuthenticated()) {
        await dropboxService.authenticate();
      }
    } catch (err) {
      toast.error('Dropbox authentication failed: ' + err.message);
      return;
    }
    setImporting(true);
    setProgress({ current: 0, total: 0, source: 'Dropbox' });
    try {
      const result = await dropboxService.listFiles('');
      const files = (result.entries || result || []).filter(f =>
        f['.tag'] === 'file' && matchesFilter(f.name)
      );
      if (files.length === 0) {
        toast.info('No matching files found in Dropbox');
        setImporting(false);
        return;
      }
      setProgress({ current: 0, total: files.length, source: 'Dropbox' });
      const imported = [];
      for (let i = 0; i < files.length; i++) {
        setProgress({ current: i + 1, total: files.length, source: 'Dropbox' });
        try {
          const blob = await dropboxService.downloadFile(files[i].path_lower || files[i].path_display);
          const localUrl = URL.createObjectURL(blob);
          imported.push({
            name: files[i].name,
            file: blob,
            url: localUrl,
            localUrl,
            type: mediaType === 'all' ? detectType(files[i].name) : mediaType,
            source: 'dropbox'
          });
        } catch (err) {
          console.warn(`Failed to download ${files[i].name}:`, err.message);
        }
      }
      if (imported.length > 0) {
        onImportMedia?.(imported);
        toast.success(`Imported ${imported.length} file${imported.length > 1 ? 's' : ''} from Dropbox`);
      }
    } catch (err) {
      console.error('Dropbox import error:', err);
      toast.error('Failed to import from Dropbox');
    }
    setImporting(false);
  };

  const detectType = (name) => {
    const lower = name.toLowerCase();
    if (['.mp4', '.mov', '.avi', '.webm', '.mkv'].some(e => lower.endsWith(e))) return 'video';
    if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'].some(e => lower.endsWith(e))) return 'audio';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].some(e => lower.endsWith(e))) return 'image';
    return 'other';
  };

  if (importing) {
    return (
      <span style={{ fontSize: '11px', color: theme.text.muted }}>
        {progress.source} {progress.current}/{progress.total}...
      </span>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        style={{
          background: 'none',
          border: `1px solid ${theme.border.subtle}`,
          borderRadius: '6px',
          padding: compact ? '2px 6px' : '4px 10px',
          cursor: 'pointer',
          color: theme.text.muted,
          fontSize: compact ? '11px' : '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
        title="Import from cloud"
      >
        <span style={{ fontSize: compact ? '11px' : '13px' }}>&#9729;</span>
        {!compact && <span>Cloud</span>}
      </button>
      {showMenu && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '4px',
          backgroundColor: theme.bg.input, border: `1px solid ${theme.border.subtle}`,
          borderRadius: '8px', boxShadow: theme.shadow,
          zIndex: 1000, minWidth: '180px', overflow: 'hidden'
        }}>
          <div
            onClick={handleDriveImport}
            style={{
              padding: '10px 12px', cursor: 'pointer', fontSize: '13px',
              color: theme.text.primary, display: 'flex', alignItems: 'center', gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.hover.bg}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span style={{ fontSize: '16px' }}>📁</span> Import from Drive
          </div>
          <div
            onClick={handleDropboxImport}
            style={{
              padding: '10px 12px', cursor: 'pointer', fontSize: '13px',
              color: theme.text.primary, display: 'flex', alignItems: 'center', gap: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.hover.bg}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <span style={{ fontSize: '16px' }}>📦</span> Import from Dropbox
          </div>
        </div>
      )}
    </div>
  );
};

export default CloudImportButton;
