/**
 * useDragReorder — HTML5 drag-and-drop hook for reordering items.
 * Returns drag props per item + visual state for drop indicator.
 */
import { useState, useRef, useCallback } from 'react';

const useDragReorder = (items, onReorder) => {
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragSourceRef = useRef(null);

  const makeDragProps = useCallback(
    (index) => ({
      draggable: true,
      onDragStart: (e) => {
        dragSourceRef.current = index;
        setIsDragging(true);
        e.dataTransfer.effectAllowed = 'move';
        // Store index for cross-component compat
        e.dataTransfer.setData('text/plain', String(index));
        // Make drag image semi-transparent
        if (e.target) {
          e.target.style.opacity = '0.5';
        }
      },
      onDragEnd: (e) => {
        setIsDragging(false);
        setDragOverIndex(null);
        dragSourceRef.current = null;
        if (e.target) {
          e.target.style.opacity = '1';
        }
      },
      onDragOver: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSourceRef.current !== null && dragSourceRef.current !== index) {
          setDragOverIndex(index);
        }
      },
      onDragLeave: () => {
        setDragOverIndex((prev) => (prev === index ? null : prev));
      },
      onDrop: (e) => {
        e.preventDefault();
        const fromIndex = dragSourceRef.current;
        if (fromIndex === null || fromIndex === index) {
          setDragOverIndex(null);
          return;
        }
        // Reorder items
        const reordered = [...items];
        const [moved] = reordered.splice(fromIndex, 1);
        reordered.splice(index, 0, moved);
        onReorder(reordered);
        setDragOverIndex(null);
        dragSourceRef.current = null;
      },
    }),
    [items, onReorder],
  );

  return {
    makeDragProps,
    dragOverIndex,
    isDragging,
  };
};

export default useDragReorder;
