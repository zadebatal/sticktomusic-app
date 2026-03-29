/**
 * LyricBankSection — Reusable collapsible lyric bank UI for editor sidebars and niche content views.
 *
 * Shows saved lyrics with "Timed" badges when they have word timings.
 * Clicking any lyric triggers onApplyLyric to load it into WordTimeline.
 * "+ Add Lyrics" triggers the transcription flow.
 */
import React, { useState } from 'react';
import { IconButton } from '../../../ui/components/IconButton';
import { Badge } from '../../../ui/components/Badge';
import { Button } from '../../../ui/components/Button';
import { FeatherPlus, FeatherTrash2, FeatherMusic } from '@subframe/core';

const LyricBankSection = ({
  lyrics = [],
  onAddNew,
  onApplyLyric,
  onApplyToTimeline,
  onDeleteLyric,
  hasAudio = true,
  isTranscribing = false,
}) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  return (
    <div className="flex flex-col gap-3">
      {/* Saved lyrics list */}
      {lyrics.length > 0 ? (
        <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
          {lyrics.map((lyric) => {
            const hasTiming = lyric.words?.length > 0;
            const wordCount = lyric.words?.length || 0;
            const title = lyric.title || 'Untitled';
            const isConfirming = confirmDeleteId === lyric.id;

            return (
              <div
                key={lyric.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors group cursor-pointer ${
                  hasTiming
                    ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10'
                    : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100'
                }`}
                onClick={() => {
                  if (onApplyLyric) onApplyLyric(lyric);
                }}
                title={
                  hasTiming ? 'Click to edit in Word Timeline' : 'Click to open in Word Timeline'
                }
              >
                <FeatherMusic
                  className={hasTiming ? 'text-green-400 flex-none' : 'text-neutral-500 flex-none'}
                  style={{ width: 12, height: 12 }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-white truncate">{title}</div>
                  <div className="text-[11px] text-neutral-500">
                    {hasTiming ? `${wordCount} words` : 'No timings'}
                  </div>
                </div>
                {hasTiming && (
                  <>
                    <Badge variant="success" className="flex-none text-[10px]">
                      Timed
                    </Badge>
                    {onApplyToTimeline && (
                      <button
                        className="flex-none text-[11px] text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded px-1.5 py-0.5 cursor-pointer transition-colors"
                        title="Apply lyrics to timeline — creates clips cut to each word"
                        onClick={(e) => {
                          e.stopPropagation();
                          onApplyToTimeline(lyric);
                        }}
                      >
                        + Timeline
                      </button>
                    )}
                  </>
                )}
                {isConfirming ? (
                  <div className="flex gap-1 flex-none" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="text-[11px] text-red-400 bg-transparent border-none cursor-pointer px-1"
                      onClick={() => {
                        onDeleteLyric?.(lyric.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      className="text-[11px] text-neutral-500 bg-transparent border-none cursor-pointer px-1"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <IconButton
                    variant="neutral-tertiary"
                    size="small"
                    icon={<FeatherTrash2 />}
                    aria-label="Delete lyric"
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(lyric.id);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[13px] text-neutral-400 py-3 text-center">
          No lyrics saved yet. Add lyrics by transcribing audio.
        </div>
      )}

      {/* Add Lyrics button */}
      <Button
        variant="neutral-secondary"
        size="small"
        icon={<FeatherPlus />}
        onClick={() => onAddNew?.()}
        className="w-full"
        disabled={!hasAudio || isTranscribing}
        loading={isTranscribing}
      >
        {isTranscribing ? 'Transcribing...' : 'Add Lyrics'}
      </Button>
      {!hasAudio && (
        <div className="text-[11px] text-neutral-500 text-center -mt-1">Upload audio first</div>
      )}
    </div>
  );
};

export default LyricBankSection;
