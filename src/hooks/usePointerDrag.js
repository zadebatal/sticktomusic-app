import { useRef, useCallback } from 'react';

/**
 * Unified pointer-event drag handler that works with mouse AND touch.
 * Replaces mousedown/mousemove/mouseup patterns for panning, resizing, scrubbing.
 *
 * Usage:
 *   const { getPointerProps } = usePointerDrag({
 *     onDragStart(e, startPos) { ... },
 *     onDragMove(e, pos, delta, startPos) { ... },
 *     onDragEnd(e, pos, startPos) { ... },
 *   });
 *   <div {...getPointerProps()} />
 */
export default function usePointerDrag({ onDragStart, onDragMove, onDragEnd } = {}) {
  const dragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const lastPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e) => {
    dragging.current = true;
    const pos = { x: e.clientX, y: e.clientY };
    startPos.current = pos;
    lastPos.current = pos;
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragStart?.(e, pos);
  }, [onDragStart]);

  const handlePointerMove = useCallback((e) => {
    if (!dragging.current) return;
    const pos = { x: e.clientX, y: e.clientY };
    const delta = {
      x: pos.x - lastPos.current.x,
      y: pos.y - lastPos.current.y,
    };
    lastPos.current = pos;
    onDragMove?.(e, pos, delta, startPos.current);
  }, [onDragMove]);

  const handlePointerUp = useCallback((e) => {
    if (!dragging.current) return;
    dragging.current = false;
    const pos = { x: e.clientX, y: e.clientY };
    onDragEnd?.(e, pos, startPos.current);
  }, [onDragEnd]);

  const getPointerProps = useCallback(() => ({
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    style: { touchAction: 'none' },
  }), [handlePointerDown, handlePointerMove, handlePointerUp]);

  return { getPointerProps, isDragging: dragging };
}
