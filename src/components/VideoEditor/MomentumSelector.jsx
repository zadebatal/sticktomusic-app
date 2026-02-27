import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { FeatherX, FeatherCheck } from '@subframe/core';
import {
  computeEnergyCurve,
  detectSegments,
  detectOnsets,
  generateCutPoints,
  analyzeMomentum,
} from '../../utils/momentumAnalyzer';
import log from '../../utils/logger';

const PRESETS = [
  { id: 'hype', label: 'Hype', desc: 'Fast, aggressive cuts' },
  { id: 'chill', label: 'Chill', desc: 'Slow, phrase-based' },
  { id: 'story', label: 'Story', desc: 'Follows song structure' },
];

/**
 * MomentumSelector — "Cut to music" modal.
 * Analyzes audio energy/momentum and generates smart cut points.
 * Returns number[] to onApply — same format as BeatSelector.
 */
const MomentumSelector = ({
  audioSource,
  duration = 30,
  trimStart,
  trimEnd,
  onApply,
  onCancel,
}) => {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  const [preset, setPreset] = useState('story');
  const [analyzing, setAnalyzing] = useState(true);
  const [error, setError] = useState(null);

  // Cached analysis data (stages 1-3 — computed once)
  const [analysisData, setAnalysisData] = useState(null);
  // Current cut points (stage 4 — recomputed on preset change)
  const [cutPoints, setCutPoints] = useState([]);

  const canvasRef = useRef(null);
  const analyzedSourceRef = useRef(null);
  const analysisIdRef = useRef(0);

  // ── Run analysis on mount (ref guard prevents re-run on preset change) ────
  useEffect(() => {
    const sourceKey = `${audioSource}::${trimStart}::${trimEnd}`;
    if (analyzedSourceRef.current === sourceKey) return;
    analyzedSourceRef.current = sourceKey;

    const thisId = ++analysisIdRef.current;

    (async () => {
      try {
        setAnalyzing(true);
        setError(null);
        const result = await analyzeMomentum(audioSource, preset, { trimStart, trimEnd });
        if (analysisIdRef.current !== thisId) return;

        setAnalysisData({
          energyCurve: result.energyCurve,
          segments: result.segments,
          onsets: result.onsets,
          duration: result.duration,
        });
        setCutPoints(result.cutPoints);
      } catch (err) {
        if (analysisIdRef.current !== thisId) return;
        log.error('[MomentumSelector] Analysis failed:', err.message);
        setError(err.message);
      } finally {
        if (analysisIdRef.current === thisId) setAnalyzing(false);
      }
    })();
  }, [audioSource, trimStart, trimEnd, preset]);

  // ── Recompute cuts instantly when preset changes ──────────────────────────
  useEffect(() => {
    if (!analysisData) return;
    const { energyCurve, onsets, segments, duration: dur } = analysisData;
    const newCuts = generateCutPoints(energyCurve, onsets, segments, preset, dur);
    setCutPoints(newCuts);
  }, [preset, analysisData]);

  // ── Canvas visualization ──────────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analysisData) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const { energyCurve, segments, duration: dur } = analysisData;

    ctx.clearRect(0, 0, width, height);

    if (energyCurve.length === 0 || dur <= 0) return;

    const segmentBandH = 14;
    const curveTop = 0;
    const curveH = height - segmentBandH - 4;

    // ── Segment bands (bottom) ──────────────────────────────────────────
    for (const seg of segments) {
      const x1 = (seg.start / dur) * width;
      const x2 = (seg.end / dur) * width;
      ctx.fillStyle = seg.isHigh ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.12)';
      ctx.fillRect(x1, height - segmentBandH, x2 - x1, segmentBandH);
      // Label
      ctx.fillStyle = seg.isHigh ? 'rgba(165,180,252,0.8)' : 'rgba(165,180,252,0.4)';
      ctx.font = '9px sans-serif';
      const label = seg.isHigh ? 'HIGH' : 'LOW';
      const lw = ctx.measureText(label).width;
      if ((x2 - x1) > lw + 8) {
        ctx.fillText(label, x1 + (x2 - x1 - lw) / 2, height - 3);
      }
    }

    // ── Energy curve (filled area) ──────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(0, curveTop + curveH);
    for (let i = 0; i < energyCurve.length; i++) {
      const x = (energyCurve[i].time / dur) * width;
      const y = curveTop + curveH - energyCurve[i].energy * curveH;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, curveTop + curveH);
    ctx.closePath();

    // Gradient fill
    const grad = ctx.createLinearGradient(0, curveTop, 0, curveTop + curveH);
    grad.addColorStop(0, 'rgba(99,102,241,0.6)');
    grad.addColorStop(1, 'rgba(99,102,241,0.05)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke
    ctx.beginPath();
    for (let i = 0; i < energyCurve.length; i++) {
      const x = (energyCurve[i].time / dur) * width;
      const y = curveTop + curveH - energyCurve[i].energy * curveH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(129,140,248,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Cut markers (white lines) ───────────────────────────────────────
    for (const t of cutPoints) {
      const x = (t / dur) * width;
      ctx.beginPath();
      ctx.moveTo(x, curveTop);
      ctx.lineTo(x, curveTop + curveH);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Tick at bottom
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x - 0.5, curveTop + curveH, 1, 3);
    }
  }, [analysisData, cutPoints]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Resize observer for canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    const resize = () => {
      const w = container.clientWidth;
      const h = 94; // fixed height
      if (canvas.width !== w * 2 || canvas.height !== h * 2) {
        canvas.width = w * 2;
        canvas.height = h * 2;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        drawCanvas();
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawCanvas]);

  const effectiveDuration = useMemo(() => {
    return analysisData?.duration || duration || 30;
  }, [analysisData, duration]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerIcon}>🎵</div>
          <div>
            <h2 style={styles.title}>
              Cut to music{!analyzing && ` (${cutPoints.length} cuts)`}
            </h2>
            <p style={styles.subtitle}>
              Match cuts to the energy and flow of the song.
            </p>
          </div>
          <IconButton icon={<FeatherX />} onClick={onCancel} />
        </div>

        {/* Presets */}
        <div style={styles.presets}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              style={preset === p.id ? styles.presetActive : styles.preset}
              onClick={() => setPreset(p.id)}
              title={p.desc}
            >
              {p.label}{preset === p.id ? ' ✓' : ''}
            </button>
          ))}
        </div>

        {/* Visualization */}
        <div style={styles.vizContainer}>
          {analyzing ? (
            <div style={styles.analyzing}>
              <div style={styles.spinner} />
              <span>Analyzing audio...</span>
            </div>
          ) : error ? (
            <div style={styles.errorBox}>
              <span>Failed to analyze: {error}</span>
            </div>
          ) : (
            <div style={styles.canvasWrap}>
              <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '8px' }} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.beatCount}>
            {analyzing ? 'Analyzing...' : `${cutPoints.length} cuts · ${effectiveDuration.toFixed(0)}s`}
          </span>
          <div style={styles.footerActions}>
            <Button variant="neutral-secondary" onClick={onCancel}>Cancel</Button>
            <Button
              variant="brand-primary"
              icon={<FeatherCheck />}
              onClick={() => onApply(cutPoints)}
              disabled={analyzing || cutPoints.length === 0}
            >
              Apply {cutPoints.length} cuts
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const getStyles = (theme) => ({
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: theme.overlay.heavy,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '20px',
  },
  modal: {
    width: '100%',
    maxWidth: '600px',
    maxHeight: '80vh',
    backgroundColor: theme.bg.input,
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '20px 20px 16px',
    borderBottom: `1px solid ${theme.bg.elevated}`,
  },
  headerIcon: { fontSize: '24px' },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: theme.text.primary,
    margin: '0 0 4px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: theme.text.muted,
    margin: 0,
    maxWidth: '400px',
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '16px 20px',
    borderBottom: `1px solid ${theme.bg.elevated}`,
  },
  preset: {
    padding: '8px 16px',
    backgroundColor: theme.bg.surface,
    border: `1px solid ${theme.bg.elevated}`,
    borderRadius: '20px',
    color: theme.text.primary,
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  presetActive: {
    padding: '8px 16px',
    backgroundColor: theme.accent.primary,
    border: `1px solid ${theme.accent.primary}`,
    borderRadius: '20px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  vizContainer: {
    padding: '16px 20px',
    minHeight: '110px',
  },
  analyzing: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    height: '94px',
    color: theme.text.muted,
    fontSize: '14px',
  },
  spinner: {
    width: '18px',
    height: '18px',
    border: `2px solid ${theme.bg.elevated}`,
    borderTop: `2px solid ${theme.accent.primary}`,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '94px',
    color: '#f87171',
    fontSize: '13px',
  },
  canvasWrap: {
    width: '100%',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: theme.bg.surface,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderTop: `1px solid ${theme.bg.elevated}`,
    backgroundColor: theme.bg.page,
  },
  beatCount: {
    fontSize: '13px',
    color: theme.text.muted,
  },
  footerActions: {
    display: 'flex',
    gap: '8px',
  },
});

export default MomentumSelector;
