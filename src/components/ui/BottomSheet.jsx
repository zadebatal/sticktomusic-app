import React, { useState, useRef, useCallback, useEffect } from 'react';
import usePointerDrag from '../../hooks/usePointerDrag';

const SNAP_COLLAPSED = 60;   // toolbar height
const SNAP_HALF = 0.5;        // 50vh
const SNAP_FULL = 0.9;        // 90vh

/**
 * BottomSheet — mobile editor panel that slides up from bottom.
 * Three snap points: collapsed (60px toolbar), half (50vh), full (90vh).
 *
 * Props:
 *   open       — boolean: whether sheet is visible
 *   onClose    — callback when sheet collapses fully
 *   toolbar    — ReactNode: always-visible toolbar row (at collapsed height)
 *   children   — content visible when expanded
 *   snapPoint  — 'collapsed' | 'half' | 'full' (controlled)
 *   onSnapChange — (snapPoint) => void
 */
const BottomSheet = ({ open, onClose, toolbar, children, snapPoint = 'collapsed', onSnapChange }) => {
  const [height, setHeight] = useState(SNAP_COLLAPSED);
  const sheetRef = useRef(null);
  const startHeight = useRef(SNAP_COLLAPSED);

  // Convert snap point name to pixel height
  const snapToHeight = useCallback((snap) => {
    const vh = window.innerHeight;
    switch (snap) {
      case 'full': return vh * SNAP_FULL;
      case 'half': return vh * SNAP_HALF;
      default: return SNAP_COLLAPSED;
    }
  }, []);

  // Sync controlled snapPoint to height
  useEffect(() => {
    setHeight(snapToHeight(snapPoint));
  }, [snapPoint, snapToHeight]);

  // Find nearest snap point
  const snapToNearest = useCallback((h) => {
    const vh = window.innerHeight;
    const points = [
      { name: 'collapsed', h: SNAP_COLLAPSED },
      { name: 'half', h: vh * SNAP_HALF },
      { name: 'full', h: vh * SNAP_FULL },
    ];
    let closest = points[0];
    let minDist = Math.abs(h - closest.h);
    for (const p of points) {
      const dist = Math.abs(h - p.h);
      if (dist < minDist) { closest = p; minDist = dist; }
    }
    return closest;
  }, []);

  const { getPointerProps } = usePointerDrag({
    onDragStart: () => {
      startHeight.current = height;
    },
    onDragMove: (e, pos, delta) => {
      // Dragging up = negative delta.y = increase height
      const newH = Math.max(SNAP_COLLAPSED, Math.min(window.innerHeight * SNAP_FULL, startHeight.current - (pos.y - (window.innerHeight - startHeight.current))));
      // Simpler: just track cumulative delta from start
      const cumDeltaY = pos.y - (window.innerHeight - startHeight.current);
      const h = Math.max(SNAP_COLLAPSED, Math.min(window.innerHeight * SNAP_FULL, startHeight.current + (startHeight.current - startHeight.current) - (cumDeltaY - (window.innerHeight - startHeight.current - pos.y))));
      // Actually simplify: drag handle moves sheet
      setHeight(prev => {
        const next = prev - delta.y;
        return Math.max(SNAP_COLLAPSED, Math.min(window.innerHeight * SNAP_FULL, next));
      });
    },
    onDragEnd: () => {
      const snap = snapToNearest(height);
      setHeight(snap.h);
      onSnapChange?.(snap.name);
      if (snap.name === 'collapsed' && onClose) onClose();
    },
  });

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      {height > SNAP_COLLAPSED + 10 && (
        <div
          onClick={() => { setHeight(SNAP_COLLAPSED); onSnapChange?.('collapsed'); onClose?.(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 998,
            backgroundColor: `rgba(0,0,0,${Math.min(0.5, (height - SNAP_COLLAPSED) / (window.innerHeight * 0.5) * 0.5)})`,
            transition: 'background-color 0.15s',
          }}
        />
      )}

      {/* Sheet */}
      <div
        ref={sheetRef}
        style={{
          position: 'fixed',
          left: 0, right: 0, bottom: 0,
          height: `${height}px`,
          zIndex: 999,
          backgroundColor: '#1a1a2e',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          willChange: 'height',
          transition: 'height 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Drag handle */}
        <div
          {...getPointerProps()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 28, cursor: 'grab', flexShrink: 0,
          }}
        >
          <div style={{
            width: 36, height: 4, borderRadius: 2,
            backgroundColor: 'rgba(255,255,255,0.3)',
          }} />
        </div>

        {/* Toolbar (always visible) */}
        <div style={{ flexShrink: 0, minHeight: SNAP_COLLAPSED - 28 }}>
          {toolbar}
        </div>

        {/* Content (scrollable when expanded) */}
        <div style={{
          flex: 1, overflow: 'auto',
          opacity: height > SNAP_COLLAPSED + 20 ? 1 : 0,
          transition: 'opacity 0.15s',
        }}>
          {children}
        </div>
      </div>
    </>
  );
};

export default BottomSheet;
