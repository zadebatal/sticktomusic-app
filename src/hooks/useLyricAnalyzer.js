import { useState, useCallback } from 'react';
import {
  transcribeAudio,
  getStoredApiKey,
  storeApiKey,
  validateApiKey,
} from '../services/whisperService';

export function useLyricAnalyzer() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);

  const analyze = useCallback(async (audioFile, apiKey = null) => {
    setIsAnalyzing(true);
    setError(null);
    setProgress('Starting analysis...');

    try {
      // Use personal key if stored, otherwise fall back to team proxy
      // (team proxy only works on Vercel, not local CRA dev server)
      const storedKey = apiKey || getStoredApiKey();
      const key = storedKey || 'team';
      if (!storedKey && window.location.hostname === 'localhost') {
        throw new Error('API_KEY_REQUIRED');
      }

      // Skip validation for 'team' sentinel — proxy handles auth server-side
      if (key !== 'team') {
        setProgress('Validating API key...');
        const isValid = await validateApiKey(key);
        if (!isValid) throw new Error('Invalid API key format');
      }

      if (apiKey) storeApiKey(apiKey);

      const result = await transcribeAudio(audioFile, key, setProgress);
      setProgress('Complete!');
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return { analyze, isAnalyzing, progress, error, hasApiKey: true };
}
