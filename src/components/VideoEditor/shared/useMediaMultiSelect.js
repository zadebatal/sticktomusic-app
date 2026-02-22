import { useState, useRef, useCallback } from 'react';

/**
 * useMediaMultiSelect — Reusable hook for rubber-band multi-select in media grids.
 *
 * Extracted from ProjectWorkspace. Provides:
 *   - Rubber-band (Mac Finder-style) drag-to-select
 *   - Shift-click range select
 *   - Select All / Deselect All toggle
 *   - Draggable props for selected items
 *
 * Usage:
 *   const { selectedIds, gridRef, gridMouseHandlers, rubberBand, ... } = useMediaMultiSelect(items);
 *   Attach gridRef + gridMouseHandlers to the scrollable grid container.
 *   Each grid item needs `data-media-id={item.id}`.
 *
 * @param {Array} items — array of objects with `.id` field
 */
const useMediaMultiSelect = (items) => {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [rubberBand, setRubberBand] = useState(null);
  const [draggingIds, setDraggingIds] = useState(null);

  const gridRef = useRef(null);
  const dragSelectStart = useRef(null);
  const dragSelectPrior = useRef(new Set());

  // Toggle single item (with shift-click range support)
  const toggleSelect = useCallback((id, e) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (e?.shiftKey && prev.size > 0) {
        const ids = items.map(m => m.id);
        const lastSelected = [...prev].pop();
        const startIdx = ids.indexOf(lastSelected);
        const endIdx = ids.indexOf(id);
        if (startIdx >= 0 && endIdx >= 0) {
          const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
        }
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [items]);

  // Select All / Deselect All toggle
  const selectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map(m => m.id));
    });
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Rubber-band mouse handlers
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0 || !gridRef.current) return;
    // Don't start rubber-band if dragging an already-selected item
    const mediaEl = e.target.closest('[data-media-id]');
    if (mediaEl && selectedIds.has(mediaEl.getAttribute('data-media-id'))) return;
    e.preventDefault();
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + gridRef.current.scrollTop;
    dragSelectStart.current = { x, y };
    dragSelectPrior.current = e.shiftKey ? new Set(selectedIds) : new Set();
    setIsDragSelecting(true);
    setRubberBand(null);
    if (!e.shiftKey) setSelectedIds(new Set());
  }, [selectedIds]);

  const onMouseMove = useCallback((e) => {
    if (!isDragSelecting || !gridRef.current || !dragSelectStart.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top + gridRef.current.scrollTop;
    const startX = dragSelectStart.current.x;
    const startY = dragSelectStart.current.y;

    const scrollTop = gridRef.current.scrollTop;
    setRubberBand({
      left: Math.min(startX, curX),
      top: Math.min(startY, curY) - scrollTop,
      width: Math.abs(curX - startX),
      height: Math.abs(curY - startY),
    });

    // Hit-test items against rubber-band
    const minX = Math.min(startX, curX);
    const maxX = Math.max(startX, curX);
    const minY = Math.min(startY, curY);
    const maxY = Math.max(startY, curY);
    const els = gridRef.current.querySelectorAll('[data-media-id]');
    const next = new Set(dragSelectPrior.current);
    els.forEach(el => {
      const elLeft = el.offsetLeft;
      const elTop = el.offsetTop;
      const elRight = elLeft + el.offsetWidth;
      const elBottom = elTop + el.offsetHeight;
      if (elRight >= minX && elLeft <= maxX && elBottom >= minY && elTop <= maxY) {
        next.add(el.getAttribute('data-media-id'));
      }
    });
    setSelectedIds(next);
  }, [isDragSelecting]);

  const onMouseUp = useCallback(() => {
    setIsDragSelecting(false);
    setRubberBand(null);
    dragSelectStart.current = null;
  }, []);

  const gridMouseHandlers = {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave: onMouseUp,
  };

  // Make draggable props for a single item
  const makeDraggableProps = useCallback((id) => ({
    draggable: selectedIds.has(id),
    onDragStart: () => {
      if (selectedIds.has(id) && selectedIds.size > 0) {
        setDraggingIds([...selectedIds]);
      } else {
        setDraggingIds([id]);
      }
    },
    onDragEnd: () => setDraggingIds(null),
  }), [selectedIds]);

  return {
    selectedIds,
    setSelectedIds,
    isDragSelecting,
    rubberBand,
    gridRef,
    gridMouseHandlers,
    toggleSelect,
    selectAll,
    clearSelection,
    draggingIds,
    setDraggingIds,
    makeDraggableProps,
  };
};

export default useMediaMultiSelect;
