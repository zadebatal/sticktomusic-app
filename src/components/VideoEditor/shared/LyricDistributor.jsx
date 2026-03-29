/**
 * LyricDistributor — Modal for distributing transcribed lyrics across slide banks.
 * Left column: editable textarea + parsed lines (click to select, shift-click for range).
 * Right column: slide slots (color-coded), click header to assign selected lines.
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { getBankColor } from '../../../services/libraryService';
import { Button } from '../../../ui/components/Button';
import { IconButton } from '../../../ui/components/IconButton';
import { Badge } from '../../../ui/components/Badge';
import { FeatherX, FeatherCheck, FeatherZap } from '@subframe/core';

const LyricDistributor = ({ text, slideLabels, slideCount, onConfirm, onClose }) => {
  const [editedText, setEditedText] = useState(text || '');
  const [assignments, setAssignments] = useState({}); // { bankIdx: [lineIdx, ...] }
  const [selectedLines, setSelectedLines] = useState(new Set());
  const lastClickedRef = useRef(null);

  // Parse lines from textarea
  const lines = useMemo(
    () =>
      editedText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    [editedText],
  );

  // Set of all assigned line indices
  const assignedSet = useMemo(() => {
    const s = new Set();
    Object.values(assignments).forEach((arr) => arr.forEach((i) => s.add(i)));
    return s;
  }, [assignments]);

  // Find which slot a line is assigned to (for color dot)
  const lineSlotMap = useMemo(() => {
    const map = {};
    Object.entries(assignments).forEach(([bankIdx, lineIdxs]) => {
      lineIdxs.forEach((i) => {
        map[i] = parseInt(bankIdx);
      });
    });
    return map;
  }, [assignments]);

  // Toggle line selection
  const handleLineClick = useCallback((lineIdx, e) => {
    if (e.shiftKey && lastClickedRef.current != null) {
      const start = Math.min(lastClickedRef.current, lineIdx);
      const end = Math.max(lastClickedRef.current, lineIdx);
      setSelectedLines((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) next.add(i);
        return next;
      });
    } else {
      setSelectedLines((prev) => {
        const next = new Set(prev);
        if (next.has(lineIdx)) next.delete(lineIdx);
        else next.add(lineIdx);
        return next;
      });
    }
    lastClickedRef.current = lineIdx;
  }, []);

  // Assign selected lines to a slot
  const handleAssignToSlot = useCallback(
    (bankIdx) => {
      if (selectedLines.size === 0) return;
      setAssignments((prev) => {
        // Remove selected lines from any existing slot
        const cleaned = {};
        Object.entries(prev).forEach(([k, arr]) => {
          const filtered = arr.filter((i) => !selectedLines.has(i));
          if (filtered.length > 0) cleaned[k] = filtered;
        });
        // Add to target slot
        const existing = cleaned[bankIdx] || [];
        const newIndices = [...selectedLines]
          .filter((i) => !existing.includes(i))
          .sort((a, b) => a - b);
        cleaned[bankIdx] = [...existing, ...newIndices];
        return cleaned;
      });
      setSelectedLines(new Set());
    },
    [selectedLines],
  );

  // Unassign a line from a slot
  const handleUnassign = useCallback((bankIdx, lineIdx) => {
    setAssignments((prev) => {
      const arr = (prev[bankIdx] || []).filter((i) => i !== lineIdx);
      const next = { ...prev };
      if (arr.length > 0) next[bankIdx] = arr;
      else delete next[bankIdx];
      return next;
    });
  }, []);

  // Auto-distribute: line 0 → slot 0 (Hook), rest spread evenly across slots 1+
  const handleAutoDistribute = useCallback(() => {
    const newAssignments = {};
    if (lines.length === 0) return;
    if (slideCount === 1) {
      newAssignments[0] = lines.map((_, i) => i);
    } else {
      newAssignments[0] = [0]; // First line → Hook
      const remaining = lines.slice(1).map((_, i) => i + 1);
      const slotsForRest = slideCount - 1;
      const perSlot = Math.ceil(remaining.length / slotsForRest);
      for (let s = 0; s < slotsForRest; s++) {
        const chunk = remaining.slice(s * perSlot, (s + 1) * perSlot);
        if (chunk.length > 0) newAssignments[s + 1] = chunk;
      }
    }
    setAssignments(newAssignments);
    setSelectedLines(new Set());
  }, [lines, slideCount]);

  // Confirm — resolve indices to text
  const handleConfirm = useCallback(() => {
    const result = {};
    Object.entries(assignments).forEach(([bankIdx, lineIdxs]) => {
      const texts = lineIdxs.map((i) => lines[i]).filter(Boolean);
      if (texts.length > 0) result[bankIdx] = texts;
    });
    onConfirm(result);
  }, [assignments, lines, onConfirm]);

  const totalAssigned = assignedSet.size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-4xl flex-col rounded-xl border border-neutral-200 bg-[#111111] overflow-hidden max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 flex-none">
          <div className="flex items-center gap-3">
            <span className="text-heading-2 font-heading-2 text-[#ffffffff]">
              Distribute Lyrics
            </span>
            <Badge variant="neutral">{lines.length} lines</Badge>
          </div>
          <IconButton
            variant="neutral-tertiary"
            size="medium"
            icon={<FeatherX />}
            aria-label="Close"
            onClick={onClose}
          />
        </div>

        {/* Body — two columns */}
        <div className="flex items-stretch flex-1 min-h-0 overflow-hidden">
          {/* Left — Editable text + parsed lines */}
          <div className="flex flex-1 flex-col gap-3 border-r border-neutral-200 p-4 overflow-hidden">
            <textarea
              className="w-full rounded-lg border border-solid border-neutral-200 bg-black px-3 py-2 text-body font-body text-white outline-none placeholder-neutral-500 resize-none flex-none"
              style={{ height: 100 }}
              placeholder="Paste or edit lyrics..."
              value={editedText}
              onChange={(e) => {
                setEditedText(e.target.value);
                setAssignments({});
                setSelectedLines(new Set());
              }}
            />
            <div className="flex items-center justify-between flex-none">
              <span className="text-caption font-caption text-neutral-400">
                Click lines to select, shift-click for range
              </span>
              {selectedLines.size > 0 && (
                <span className="text-caption font-caption text-indigo-400">
                  {selectedLines.size} selected
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
              {lines.map((line, idx) => {
                const isSelected = selectedLines.has(idx);
                const isAssigned = assignedSet.has(idx);
                const slotIdx = lineSlotMap[idx];
                const slotColor = slotIdx != null ? getBankColor(slotIdx).primary : null;
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 rounded-md px-3 py-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-indigo-500/20 border border-indigo-500'
                        : isAssigned
                          ? 'bg-neutral-100/50 border border-transparent'
                          : 'bg-black border border-transparent hover:bg-neutral-50'
                    }`}
                    onClick={(e) => handleLineClick(idx, e)}
                  >
                    <span className="text-caption font-caption text-neutral-500 w-5 text-right flex-none">
                      {idx + 1}
                    </span>
                    {slotColor && (
                      <span
                        className="h-2 w-2 rounded-full flex-none"
                        style={{ backgroundColor: slotColor }}
                      />
                    )}
                    <span
                      className={`text-body font-body truncate ${isAssigned ? 'text-neutral-500' : 'text-white'}`}
                    >
                      {line}
                    </span>
                  </div>
                );
              })}
              {lines.length === 0 && (
                <div className="flex items-center justify-center py-8">
                  <span className="text-body font-body text-neutral-500">
                    Edit the text above to see lines
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right — Slide slots */}
          <div className="flex w-72 flex-none flex-col gap-3 p-4 overflow-y-auto">
            <span className="text-caption-bold font-caption-bold text-neutral-300 flex-none">
              Slide Slots
            </span>
            {Array.from({ length: slideCount }).map((_, bankIdx) => {
              const label = slideLabels?.[bankIdx] || `Slide ${bankIdx + 1}`;
              const color = getBankColor(bankIdx).primary;
              const assignedIdxs = assignments[bankIdx] || [];
              return (
                <div
                  key={bankIdx}
                  className="flex flex-col gap-1 rounded-lg border border-solid border-neutral-200 overflow-hidden"
                >
                  <div
                    className="flex items-center justify-between px-3 py-2 cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: color }}
                    onClick={() => handleAssignToSlot(bankIdx)}
                    title={
                      selectedLines.size > 0
                        ? `Assign ${selectedLines.size} lines here`
                        : 'Select lines first'
                    }
                  >
                    <span className="text-caption-bold font-caption-bold text-white">{label}</span>
                    <Badge variant="neutral">{assignedIdxs.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-0.5 px-2 py-1.5 min-h-[32px] bg-[#1a1a1a]">
                    {assignedIdxs.length === 0 ? (
                      <span className="text-caption font-caption text-neutral-600 py-1">
                        No lines assigned
                      </span>
                    ) : (
                      assignedIdxs.map((lineIdx) => (
                        <div key={lineIdx} className="flex items-center gap-1.5 group">
                          <span className="text-caption font-caption text-neutral-300 truncate flex-1">
                            {lines[lineIdx]}
                          </span>
                          <button
                            className="text-neutral-600 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                            onClick={() => handleUnassign(bankIdx, lineIdx)}
                          >
                            <FeatherX style={{ width: 10, height: 10 }} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-200 px-6 py-4 flex-none">
          <Button
            variant="neutral-secondary"
            size="medium"
            icon={<FeatherZap />}
            onClick={handleAutoDistribute}
          >
            Auto-distribute
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-caption font-caption text-neutral-400">
              {totalAssigned}/{lines.length} assigned
            </span>
            <Button variant="neutral-secondary" size="medium" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="brand-primary"
              size="medium"
              icon={<FeatherCheck />}
              disabled={totalAssigned === 0}
              onClick={handleConfirm}
            >
              Add to Banks
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LyricDistributor;
