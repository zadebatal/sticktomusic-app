/**
 * DraggableTextOverlay — Click-to-select, drag-to-move, handle-to-resize single text overlay.
 * Position and width are expressed as percentages of the preview container.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';

const DraggableTextOverlay = ({
  text = '',
  textStyle = {},
  color = '#6366f1', // ring/selection color (indigo default)
  position = { x: 50, y: 50, width: 80 },
  onPositionChange,
  onTextChange, // optional — called with new text on inline edit
  containerRef,
  isSelected: isSelectedProp, // optional — controlled selection from parent
  onSelect, // optional — called when overlay is clicked/selected
}) => {
  const [selectedInternal, setSelectedInternal] = useState(false);
  const selected = isSelectedProp !== undefined ? isSelectedProp : selectedInternal;
  const [dragging, setDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const overlayRef = useRef(null);
  const inputRef = useRef(null);
  const dragStartRef = useRef(null);

  // Sync editText when text prop changes (e.g. switching slides)
  const prevTextRef = useRef(text);
  useEffect(() => {
    if (text !== prevTextRef.current) {
      prevTextRef.current = text;
      setEditText(text);
      setIsEditing(false);
    }
  }, [text]);

  const ts = textStyle;
  const widthScale = (position.width || 80) / 80;
  const scaledSize = Math.round((ts.fontSize || 48) * 0.35 * widthScale);
  const textTransform = ts.textCase === 'upper' ? 'uppercase' : ts.textCase === 'lower' ? 'lowercase' : 'none';
  const textShadow = ts.outline
    ? `0 0 4px ${ts.outlineColor || '#000'}, 1px 1px 2px ${ts.outlineColor || '#000'}, -1px -1px 2px ${ts.outlineColor || '#000'}`
    : 'none';

  const getContainerRect = useCallback(() => {
    const el = containerRef?.current || overlayRef.current?.parentElement;
    return el ? el.getBoundingClientRect() : null;
  }, [containerRef]);

  // Focus input and auto-size when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      // Auto-size textarea to fit content
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  // Click outside to deselect (and exit editing) — only when managing own state
  useEffect(() => {
    if (!selected) return;
    const handler = (e) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target)) {
        if (isEditing) {
          setIsEditing(false);
          if (onTextChange && editText !== text) onTextChange(editText);
        }
        if (isSelectedProp === undefined) setSelectedInternal(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [selected, isSelectedProp, isEditing, editText, text, onTextChange]);

  // Drag to move
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSelectedProp === undefined) setSelectedInternal(true);
    if (onSelect) onSelect();
    setDragging(true);
    const rect = getContainerRect();
    if (!rect) return;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position.x,
      startY: position.y,
      containerW: rect.width,
      containerH: rect.height,
    };

    const moveHandler = (moveEvt) => {
      const s = dragStartRef.current;
      if (!s) return;
      const dx = ((moveEvt.clientX - s.mouseX) / s.containerW) * 100;
      const dy = ((moveEvt.clientY - s.mouseY) / s.containerH) * 100;
      const newX = Math.max(0, Math.min(100, s.startX + dx));
      const newY = Math.max(0, Math.min(100, s.startY + dy));
      if (onPositionChange) onPositionChange({ ...position, x: newX, y: newY });
    };

    const upHandler = () => {
      setDragging(false);
      dragStartRef.current = null;
      document.removeEventListener('pointermove', moveHandler);
      document.removeEventListener('pointerup', upHandler);
    };

    document.addEventListener('pointermove', moveHandler);
    document.addEventListener('pointerup', upHandler);
  }, [position, getContainerRect, onPositionChange]);

  // Resize via corner handle
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = getContainerRect();
    if (!rect) return;
    dragStartRef.current = {
      mouseX: e.clientX,
      startWidth: position.width || 80,
      containerW: rect.width,
    };

    const moveHandler = (moveEvt) => {
      const s = dragStartRef.current;
      if (!s) return;
      const dx = ((moveEvt.clientX - s.mouseX) / s.containerW) * 100;
      const newWidth = Math.max(20, Math.min(300, s.startWidth + dx * 2));
      if (onPositionChange) onPositionChange({ ...position, width: newWidth });
    };

    const upHandler = () => {
      dragStartRef.current = null;
      document.removeEventListener('pointermove', moveHandler);
      document.removeEventListener('pointerup', upHandler);
    };

    document.addEventListener('pointermove', moveHandler);
    document.addEventListener('pointerup', upHandler);
  }, [position, getContainerRect, onPositionChange]);

  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditText(text);
  }, [text]);

  const handleEditKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      setIsEditing(false);
      if (onTextChange && editText !== text) onTextChange(editText);
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditText(text);
    }
  }, [editText, text, onTextChange]);

  if (!text && !editText) return null;

  return (
    <div
      ref={overlayRef}
      className={`absolute z-[6] flex flex-col items-center gap-0.5 ${
        isEditing ? 'cursor-text' : dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -50%)',
        width: `${position.width || 80}%`,
        maxWidth: '95%',
        padding: '4px',
        borderRadius: 4,
        background: selected ? `${color}1a` : 'transparent',
        outline: selected ? `1px solid ${color}` : 'none',
      }}
      onPointerDown={isEditing ? undefined : handleDragStart}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={handleDoubleClick}
    >
      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editText}
          onChange={e => {
            setEditText(e.target.value);
            // Auto-resize on input
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onKeyDown={handleEditKeyDown}
          style={{
            fontFamily: ts.fontFamily || 'Inter, sans-serif',
            fontSize: scaledSize,
            fontWeight: ts.fontWeight || '600',
            color: ts.color || '#ffffff',
            textAlign: 'center',
            textTransform,
            textShadow,
            lineHeight: 1.2,
            minWidth: '60px',
            background: 'rgba(0,0,0,0.5)',
            border: `1px solid ${color}`,
            borderRadius: 3,
            outline: 'none',
            resize: 'none',
            padding: '2px 4px',
            overflow: 'hidden',
          }}
          rows={1}
        />
      ) : (
        <div style={{
          fontFamily: ts.fontFamily || 'Inter, sans-serif',
          fontSize: scaledSize,
          fontWeight: ts.fontWeight || '600',
          color: ts.color || '#ffffff',
          textAlign: 'center',
          textTransform,
          textShadow,
          lineHeight: 1.2,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          pointerEvents: 'none',
          userSelect: 'none',
        }}>
          {editText || text}
        </div>
      )}

      {/* Resize handle — bottom-right corner */}
      {selected && (
        <div
          className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white cursor-se-resize z-10"
          style={{ backgroundColor: color }}
          onPointerDown={handleResizeStart}
        />
      )}
    </div>
  );
};

export default DraggableTextOverlay;
