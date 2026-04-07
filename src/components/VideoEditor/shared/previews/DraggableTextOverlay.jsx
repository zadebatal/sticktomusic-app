/**
 * DraggableTextOverlay — Click-to-select, drag-to-move, handle-to-resize single text overlay.
 * Position and width are expressed as percentages of the preview container.
 * Used across all editors (Slideshow, MultiClip, Solo, PhotoMontage, VideoEditorModal).
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';

const DraggableTextOverlay = ({
  text = '',
  textStyle = {},
  color = '#6366f1', // ring/selection color (indigo default)
  position = { x: 50, y: 50, width: 80 },
  onPositionChange,
  onTextChange, // optional — called with new text on inline edit
  onDelete, // optional — renders delete button when selected
  onSaveToBank, // optional — renders save-to-bank button when selected
  onDragEnd, // optional — called after drag/resize completes (for undo history)
  containerRef,
  isSelected: isSelectedProp, // optional — controlled selection from parent
  onSelect, // optional — called when overlay is clicked/selected
  hasSource = false, // whether this overlay has a bank source (shows save button)
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
  // Support both textCase (new) and textTransform (legacy/slideshow) formats
  const textTransform =
    ts.textCase === 'upper'
      ? 'uppercase'
      : ts.textCase === 'lower'
        ? 'lowercase'
        : ts.textTransform || 'none';
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
  const handleDragStart = useCallback(
    (e) => {
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
        document.removeEventListener('pointercancel', upHandler);
        if (onDragEnd) onDragEnd();
      };

      document.addEventListener('pointermove', moveHandler);
      document.addEventListener('pointerup', upHandler);
      document.addEventListener('pointercancel', upHandler);
    },
    [position, getContainerRect, onPositionChange, onDragEnd, isSelectedProp, onSelect],
  );

  // Resize via right-edge handle (horizontal only)
  const handleResizeStart = useCallback(
    (e) => {
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
        const newWidth = Math.max(15, Math.min(100, s.startWidth + dx * 2));
        if (onPositionChange) onPositionChange({ ...position, width: newWidth });
      };

      const upHandler = () => {
        dragStartRef.current = null;
        document.removeEventListener('pointermove', moveHandler);
        document.removeEventListener('pointerup', upHandler);
        document.removeEventListener('pointercancel', upHandler);
        if (onDragEnd) onDragEnd();
      };

      document.addEventListener('pointermove', moveHandler);
      document.addEventListener('pointerup', upHandler);
      document.addEventListener('pointercancel', upHandler);
    },
    [position, getContainerRect, onPositionChange, onDragEnd],
  );

  const handleDoubleClick = useCallback(
    (e) => {
      e.stopPropagation();
      setIsEditing(true);
      setEditText(text);
    },
    [text],
  );

  const handleEditKeyDown = useCallback(
    (e) => {
      // Shift+Enter confirms edit; plain Enter adds a newline (natural typing)
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        setIsEditing(false);
        if (onTextChange && editText !== text) onTextChange(editText);
      }
      if (e.key === 'Escape') {
        setIsEditing(false);
        setEditText(text);
      }
    },
    [editText, text, onTextChange],
  );

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
        padding: '4px 8px',
        borderRadius: 4,
        background: selected ? `${color}1a` : 'transparent',
        border: selected ? `1px dashed ${color}` : '1px dashed transparent',
        transition: dragging ? 'none' : 'border-color 0.15s',
        boxSizing: 'border-box',
        overflow: 'hidden',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
      onPointerDown={isEditing ? undefined : handleDragStart}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={handleDoubleClick}
    >
      {/* Hint label above selected overlay */}
      {selected && !isEditing && (
        <div
          style={{
            position: 'absolute',
            top: -20,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 9,
            color: 'rgba(255,255,255,0.6)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}
        >
          drag to move · double-click to edit
        </div>
      )}

      {isEditing ? (
        <textarea
          ref={inputRef}
          value={editText}
          onChange={(e) => {
            setEditText(e.target.value);
            // Auto-resize on input
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onKeyDown={handleEditKeyDown}
          onBlur={() => {
            setIsEditing(false);
            if (onTextChange && editText !== text) onTextChange(editText);
          }}
          style={{
            fontFamily: ts.fontFamily || "'TikTok Sans', sans-serif",
            fontSize: scaledSize,
            fontWeight: ts.fontWeight || '600',
            fontStyle: ts.fontStyle || 'normal',
            color: ts.color || '#ffffff',
            textAlign: ts.textAlign || 'center',
            textTransform,
            textShadow,
            WebkitTextStroke: ts.textStroke || undefined,
            lineHeight: 1.2,
            minWidth: '60px',
            background: 'rgba(0,0,0,0.5)',
            border: `1px solid ${color}`,
            borderRadius: 3,
            outline: 'none',
            resize: 'none',
            padding: '2px 4px',
            overflow: 'hidden',
            width: '100%',
          }}
          rows={Math.max(1, (editText || '').split('\n').length)}
        />
      ) : (
        <div
          style={{
            fontFamily: ts.fontFamily || "'TikTok Sans', sans-serif",
            fontSize: scaledSize,
            fontWeight: ts.fontWeight || '600',
            fontStyle: ts.fontStyle || 'normal',
            color: ts.color || '#ffffff',
            textAlign: ts.textAlign || 'center',
            textTransform,
            textShadow,
            WebkitTextStroke: ts.textStroke || undefined,
            lineHeight: 1.2,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {editText || text}
        </div>
      )}

      {/* Action buttons — shown when selected but not editing */}
      {selected && !isEditing && (
        <div
          style={{
            position: 'absolute',
            top: -20,
            right: 0,
            display: 'flex',
            gap: 2,
            zIndex: 10,
          }}
        >
          {/* Save to bank — only if overlay has a source bank */}
          {onSaveToBank && hasSource && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSaveToBank();
              }}
              title="Update text in bank"
              style={{
                width: 18,
                height: 18,
                borderRadius: 3,
                border: 'none',
                backgroundColor: 'rgba(34, 197, 94, 0.9)',
                color: '#fff',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          )}
          {/* Delete overlay */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete text"
              style={{
                width: 18,
                height: 18,
                borderRadius: 3,
                border: 'none',
                backgroundColor: 'rgba(239, 68, 68, 0.9)',
                color: '#fff',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Resize handle — right edge (horizontal only) */}
      {selected && !isEditing && (
        <div
          style={{
            position: 'absolute',
            right: -4,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 8,
            height: 24,
            cursor: 'ew-resize',
            zIndex: 10,
            borderRadius: 4,
            backgroundColor: color,
            border: '1px solid rgba(255,255,255,0.5)',
          }}
          onPointerDown={handleResizeStart}
        />
      )}
    </div>
  );
};

export default DraggableTextOverlay;
