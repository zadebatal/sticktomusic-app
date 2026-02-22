import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../../ui/components/Button';
import { FeatherRotateCcw, FeatherRotateCw, FeatherRefreshCw, FeatherType, FeatherTrash2, FeatherMusic, FeatherDatabase, FeatherChevronDown, FeatherUpload } from '@subframe/core';

/**
 * EditorToolbar — Shared bottom toolbar for all video editors.
 * Replicates SlideshowEditor's 7-button toolbar as a reusable component.
 *
 * Each button shows/hides based on whether its callback prop is provided.
 */
const EditorToolbar = ({
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onReroll = null,
  rerollDisabled = false,
  onAddText = null,
  onDelete = null,
  audioTracks = [],
  onSelectAudio,
  onUploadAudio,
  lyrics = [],
  onSelectLyric,
  onAddNewLyrics,
  onAITranscribe = null,
  isTranscribing = false,
  onWordTimeline = null
}) => {
  // Dropdown state
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [showLyricPicker, setShowLyricPicker] = useState(false);

  // Click-outside dismiss
  const audioRef = useRef(null);
  const lyricRef = useRef(null);

  useEffect(() => {
    if (!showAudioPicker && !showLyricPicker) return;
    const handleClick = (e) => {
      if (showAudioPicker && audioRef.current && !audioRef.current.contains(e.target)) {
        setShowAudioPicker(false);
      }
      if (showLyricPicker && lyricRef.current && !lyricRef.current.contains(e.target)) {
        setShowLyricPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAudioPicker, showLyricPicker]);

  return (
    <div className="flex items-center gap-1 flex-wrap border-t border-neutral-800 px-3 py-1.5">
      {/* Undo */}
      <Button
        variant="neutral-secondary"
        size="small"
        icon={<FeatherRotateCcw />}
        disabled={!canUndo}
        onClick={onUndo}
        title="Undo (⌘Z)"
      >
        Undo
      </Button>

      {/* Redo */}
      <Button
        variant="neutral-secondary"
        size="small"
        icon={<FeatherRotateCw />}
        disabled={!canRedo}
        onClick={onRedo}
        title="Redo (⌘⇧Z)"
      >
        Redo
      </Button>

      {/* Reroll */}
      {onReroll && (
        <Button
          variant="neutral-secondary"
          size="small"
          icon={<FeatherRefreshCw />}
          disabled={rerollDisabled}
          onClick={onReroll}
          title="Replace with random clip from bank"
        >
          Reroll
        </Button>
      )}

      {/* Add Text */}
      {onAddText && (
        <Button
          variant="brand-secondary"
          size="small"
          icon={<FeatherType />}
          onClick={onAddText}
          title="Add text overlay"
        >
          Add Text
        </Button>
      )}

      {/* Delete */}
      {onDelete && (
        <Button
          variant="destructive-tertiary"
          size="small"
          icon={<FeatherTrash2 />}
          onClick={onDelete}
          title="Delete"
        >
          Delete
        </Button>
      )}

      {/* Audio dropdown */}
      {onSelectAudio && (
        <div className="relative" ref={audioRef}>
          <Button
            variant="neutral-secondary"
            size="small"
            icon={<FeatherMusic />}
            iconRight={<FeatherChevronDown />}
            onClick={() => { setShowAudioPicker(!showAudioPicker); setShowLyricPicker(false); }}
            title="Add audio"
          >
            Audio
          </Button>

          {showAudioPicker && (
            <div className="absolute bottom-full left-0 mb-1 w-56 bg-[#171717] border border-neutral-700 rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="px-3 py-2 text-[11px] font-semibold text-neutral-400 uppercase border-b border-neutral-800">
                Select Audio
              </div>
              {audioTracks.length > 0 ? (
                <div className="max-h-[150px] overflow-y-auto">
                  {audioTracks.map(audio => (
                    <div
                      key={audio.id}
                      className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#ffffffff] cursor-pointer hover:bg-neutral-800 transition-colors"
                      onClick={() => { onSelectAudio(audio); setShowAudioPicker(false); }}
                    >
                      <FeatherMusic className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                      <span className="flex-1 truncate">{audio.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-3 text-[12px] text-neutral-500 text-center">
                  No audio in library
                </div>
              )}
              <div className="h-px bg-neutral-800 mx-0 my-1" />
              {onUploadAudio && (
                <div
                  className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-brand-600 cursor-pointer hover:bg-neutral-800 border-t border-neutral-800"
                  onClick={() => { onUploadAudio(); setShowAudioPicker(false); }}
                >
                  <FeatherUpload className="w-3.5 h-3.5 flex-shrink-0" />
                  Upload New Audio
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lyrics dropdown */}
      {onSelectLyric && (
        <div className="relative" ref={lyricRef}>
          <Button
            variant="neutral-secondary"
            size="small"
            icon={<FeatherDatabase />}
            iconRight={<FeatherChevronDown />}
            onClick={() => { setShowLyricPicker(!showLyricPicker); setShowAudioPicker(false); }}
            title="Add lyrics"
          >
            Lyrics
          </Button>

          {showLyricPicker && (
            <div className="absolute bottom-full left-0 mb-1 min-w-[220px] max-h-[300px] bg-[rgba(30,27,46,0.98)] border border-[rgba(139,92,246,0.3)] rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="px-3.5 py-2.5 text-[11px] font-semibold text-[rgba(196,181,253,0.6)] tracking-wide border-b border-[rgba(139,92,246,0.2)]">
                SELECT LYRICS
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {lyrics.length === 0 ? (
                  <div className="px-3.5 py-4 text-[12px] text-[rgba(196,181,253,0.5)] text-center italic">
                    No lyrics in bank yet
                  </div>
                ) : (
                  lyrics.map((lyric) => (
                    <div
                      key={lyric.id}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-[#e9d5ff] cursor-pointer bg-[rgba(139,92,246,0.1)] border-b border-[rgba(139,92,246,0.1)] transition-colors hover:bg-[rgba(139,92,246,0.3)]"
                      onClick={() => { onSelectLyric(lyric); setShowLyricPicker(false); }}
                    >
                      <FeatherMusic className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                      <span className="truncate">
                        {lyric.title || lyric.content?.slice(0, 30) || 'Untitled'}
                      </span>
                    </div>
                  ))
                )}
              </div>
              {onAddNewLyrics && (
                <div
                  className="flex items-center gap-2.5 px-3.5 py-3 text-[13px] font-medium text-[#6ee7b7] cursor-pointer border-t border-[rgba(139,92,246,0.2)] transition-colors hover:bg-[rgba(16,185,129,0.2)]"
                  onClick={() => { onAddNewLyrics(); setShowLyricPicker(false); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  <span>Add New Lyrics</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Word Timeline */}
      {onWordTimeline && (
        <Button
          variant="neutral-secondary"
          size="small"
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
              <line x1="6" y1="4" x2="6" y2="20"/>
              <line x1="12" y1="4" x2="12" y2="20"/>
              <line x1="18" y1="4" x2="18" y2="20"/>
            </svg>
          }
          onClick={onWordTimeline}
          title="Open word timeline editor"
        >
          Word Timeline
        </Button>
      )}

      {/* AI Transcribe */}
      {onAITranscribe && (
        <Button
          variant="brand-secondary"
          size="small"
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          }
          onClick={onAITranscribe}
          disabled={isTranscribing}
          loading={isTranscribing}
          title="AI transcribe audio to add lyrics"
        >
          {isTranscribing ? 'Transcribing...' : 'AI Transcribe'}
        </Button>
      )}
    </div>
  );
};

export default EditorToolbar;
