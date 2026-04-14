import { AnimatePresence, motion } from 'framer-motion';
import React, { useState } from 'react';
import lateApi from '../services/lateApiService';
import { removeArtistLateKey, setArtistLateKey } from '../services/lateService';
import log from '../utils/logger';

export default function LateConnectModal({
  isOpen,
  onClose,
  artistName,
  currentArtistId,
  onConnected,
  showToast,
}) {
  const [lateApiKeyInput, setLateApiKeyInput] = useState('');
  const [connectingLate, setConnectingLate] = useState(false);

  const handleClose = () => {
    onClose();
    setLateApiKeyInput('');
  };

  const handleConnect = async () => {
    if (!lateApiKeyInput.trim()) {
      showToast('Please enter an API key', 'error');
      return;
    }
    setConnectingLate(true);
    try {
      // Save the key first
      await setArtistLateKey(currentArtistId, lateApiKeyInput.trim());
      // Validate it by fetching accounts — if Late.co rejects (401), the key is bad
      const validation = await lateApi.fetchAccounts(currentArtistId);
      if (!validation.success) {
        // Key rejected by Late.co — remove it so status reverts to unconfigured
        try {
          await removeArtistLateKey(currentArtistId);
        } catch (e) {
          console.warn('Silent catch:', e.message || e);
        }
        showToast(
          'Invalid API key — Late.co rejected it. Please check the key and try again.',
          'error',
        );
        return;
      }
      showToast('Sync enabled successfully!', 'success');
      onConnected();
      handleClose();
    } catch (error) {
      log.error('Error connecting Late:', error);
      showToast(`Failed to connect: ${error.message}`, 'error');
    } finally {
      setConnectingLate(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          onClick={handleClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
          >
            <div className="p-4 sm:p-6 border-b border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg sm:text-xl font-bold">Enable Sync</h2>
              <button onClick={handleClose} className="text-zinc-500 hover:text-white text-2xl">
                ✕
              </button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <p className="text-zinc-400 text-sm">
                Enter the API key for{' '}
                <strong className="text-white">{artistName || 'this artist'}</strong> to enable
                social media sync.
              </p>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Sync API Key</label>
                <input
                  type="password"
                  value={lateApiKeyInput}
                  onChange={(e) => setLateApiKeyInput(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono"
                  placeholder="Enter API key"
                  autoFocus
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Get your API key from{' '}
                  <a
                    href="https://getlate.dev/settings/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:underline"
                  >
                    your account settings
                  </a>
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-semibold hover:bg-zinc-700 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connectingLate || !lateApiKeyInput.trim()}
                  className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-500 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {connectingLate ? (
                    <>
                      <span className="animate-spin">⟳</span>
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
