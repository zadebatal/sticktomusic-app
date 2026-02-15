import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useBeatDetection } from '../../hooks/useBeatDetection';
import { Button } from '../../ui/components/Button';
import { IconButton } from '../../ui/components/IconButton';
import { TextField } from '../../ui/components/TextField';
import { Badge } from '../../ui/components/Badge';
import { ToggleGroup } from '../../ui/components/ToggleGroup';
import {
  FeatherArrowLeft, FeatherChevronDown,
  FeatherDatabase, FeatherDownload, FeatherMusic,
  FeatherPlay, FeatherPlus, FeatherRefreshCw,
  FeatherSave, FeatherSkipBack, FeatherSkipForward,
  FeatherUpload, FeatherX, FeatherZoomIn, FeatherZoomOut,
  FeatherMic
} from '@subframe/core';

/**
 * BeatSyncEditor — Beat-synchronized video editor.
 *
 * Detects BPM from uploaded audio, lets user choose a sync pattern
 * (every beat, every 2nd, 3rd, 4th), assigns lyrics to beat segments,
 * and generates videos with cuts on beats.
 *
 * Layout: Top Bar | Preview+Controls (left) + Sidebar (right) | Timeline (bottom)
 */

const BeatSyncEditor = ({
  db,
  artistId,
  category,
  existingVideo = null,
  onSave,
  onClose,
  onSchedulePost,
  initialAudio = null,
  initialLyrics = '',
}) => {
  // Beat detection hook
  const {
    beats, bpm, isAnalyzing,
    analyzeAudio, getLocalBeats
  } = useBeatDetection();

  // Editor state
  const [name, setName] = useState(existingVideo?.name || 'Untitled Video');
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioName, setAudioName] = useState('');
  const [trimStart, setTrimStart] = useState('0:00');
  const [trimEnd, setTrimEnd] = useState('0:45');
  const [syncPattern, setSyncPattern] = useState('every'); // 'every' | 'every2nd' | 'every3rd' | 'every4th'
  const [lyrics, setLyrics] = useState(initialLyrics);
  const [generateCount, setGenerateCount] = useState('10');

  // Text style
  const [fontFamily, setFontFamily] = useState('Inter');
  const [fontSize, setFontSize] = useState(48);
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [outlineColor, setOutlineColor] = useState('#000000');
  const [outlineWidth, setOutlineWidth] = useState(2);
  const [animation, setAnimation] = useState('None');

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(45);
  const audioRef = useRef(null);

  // Sidebar sections collapse
  const [collapsedSections, setCollapsedSections] = useState(new Set());

  const toggleSection = (section) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // Audio upload handler
  const audioInputRef = useRef(null);
  const handleAudioUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioName(file.name);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    analyzeAudio(file);
  }, [analyzeAudio]);

  // Load initial audio on mount
  const initialAudioLoadedRef = useRef(false);
  useEffect(() => {
    if (initialAudioLoadedRef.current) return;
    if (initialAudio?.url) {
      initialAudioLoadedRef.current = true;
      setAudioUrl(initialAudio.url);
      setAudioName(initialAudio.name || 'Audio');
      analyzeAudio(initialAudio.url);
    }
  }, [initialAudio, analyzeAudio]);

  // Playback controls
  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const skipBack = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
  }, []);

  const skipForward = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
  }, [duration]);

  // Audio time update
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => {
      if (audio.duration && isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audioUrl]);

  // Format time helper
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Progress percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Filter beats by sync pattern
  const filteredBeats = beats.filter((_, i) => {
    if (syncPattern === 'every') return true;
    if (syncPattern === 'every2nd') return i % 2 === 0;
    if (syncPattern === 'every3rd') return i % 3 === 0;
    return i % 4 === 0;
  });

  // Save handler
  const handleSave = useCallback(() => {
    onSave?.({
      name,
      lyrics,
      syncPattern,
      beats: filteredBeats,
      bpm,
      textStyle: { fontFamily, fontSize, textColor, outlineColor, outlineWidth, animation },
      trimStart,
      trimEnd,
    });
  }, [name, lyrics, syncPattern, filteredBeats, bpm, fontFamily, fontSize, textColor, outlineColor, outlineWidth, animation, trimStart, trimEnd, onSave]);

  return (
    <div className="flex h-full w-full flex-col bg-black">
      {/* Hidden audio element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleAudioUpload}
      />

      {/* ═══ TOP BAR ═══ */}
      <div className="flex w-full items-center justify-between border-b border-solid border-neutral-800 bg-black px-6 py-4">
        <div className="flex items-center gap-4">
          <IconButton
            variant="neutral-tertiary"
            size="medium"
            icon={<FeatherArrowLeft />}
            onClick={onClose}
          />
          <TextField className="w-80" variant="filled" label="" helpText="">
            <TextField.Input
              placeholder="Untitled Video"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </TextField>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="neutral-secondary"
            size="medium"
            icon={<FeatherSave />}
            onClick={handleSave}
          >
            Save
          </Button>
          <Button
            variant="brand-primary"
            size="medium"
            icon={<FeatherDownload />}
          >
            Export
          </Button>
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex grow shrink-0 basis-0 self-stretch overflow-hidden">

        {/* LEFT: Preview + Controls */}
        <div className="flex grow shrink-0 basis-0 flex-col items-center justify-center bg-black px-12">
          <div className="flex w-full max-w-[448px] grow flex-col items-center gap-4 py-6">

            {/* Video Preview */}
            <div className="flex grow w-full items-center justify-center rounded-lg bg-[#1a1a1aff] border border-solid border-neutral-800">
              <span className="text-body font-body text-neutral-500">Video Preview</span>
            </div>

            {/* Generation Controls */}
            <div className="flex w-full items-center gap-2">
              <Button variant="neutral-secondary" size="medium">Template</Button>
              <TextField className="w-16" variant="filled" label="" helpText="">
                <TextField.Input
                  placeholder="10"
                  value={generateCount}
                  onChange={(e) => setGenerateCount(e.target.value)}
                />
              </TextField>
              <Button variant="brand-primary" size="medium" icon={<FeatherPlus />}>
                Generate
              </Button>
            </div>

            {/* Re-roll */}
            <Button className="h-8 w-full" variant="neutral-tertiary" size="medium" icon={<FeatherRefreshCw />}>
              Re-roll
            </Button>

            {/* Playback Controls */}
            <div className="flex items-center gap-4">
              <IconButton variant="neutral-secondary" size="large" icon={<FeatherSkipBack />} onClick={skipBack} />
              <IconButton
                variant="brand-primary"
                size="large"
                icon={<FeatherPlay />}
                onClick={togglePlay}
              />
              <IconButton variant="neutral-secondary" size="large" icon={<FeatherSkipForward />} onClick={skipForward} />
            </div>

            {/* Progress Bar */}
            <div className="flex w-full items-center gap-3">
              <span className="text-caption font-caption text-neutral-400 w-10 text-right">{formatTime(currentTime)}</span>
              <div
                className="flex-1 h-1 rounded-full bg-neutral-800 relative cursor-pointer"
                onClick={(e) => {
                  if (!audioRef.current || !duration) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  audioRef.current.currentTime = pct * duration;
                }}
              >
                <div className="h-1 rounded-full bg-brand-600" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-caption font-caption text-neutral-400 w-10">{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Sidebar */}
        <div className="flex w-96 flex-none flex-col items-start self-stretch border-l border-solid border-neutral-800 bg-[#1a1a1aff] overflow-auto">
          <div className="flex w-full flex-col items-start gap-6 px-6 py-6">

            {/* ═══ AUDIO SECTION ═══ */}
            <div className="flex w-full flex-col items-start gap-3">
              <div
                className="flex w-full items-center justify-between cursor-pointer"
                onClick={() => toggleSection('audio')}
              >
                <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Audio</span>
                <IconButton
                  variant="neutral-tertiary"
                  size="small"
                  icon={<FeatherChevronDown className={`transition-transform ${!collapsedSections.has('audio') ? 'rotate-180' : ''}`} />}
                />
              </div>
              {!collapsedSections.has('audio') && (
                <div className="flex w-full flex-col items-start gap-3">
                  {/* Track name */}
                  <div className="flex w-full items-center gap-2 rounded-md border border-solid border-neutral-800 bg-black px-3 py-2">
                    <FeatherMusic className={audioName ? 'text-neutral-400' : 'text-neutral-500'} style={{ width: 16, height: 16 }} />
                    <span className={`text-body font-body truncate ${audioName ? 'text-[#ffffffff]' : 'text-neutral-500'}`}>
                      {audioName || 'No audio selected'}
                    </span>
                  </div>

                  {/* Waveform visualization */}
                  <div className="flex w-full items-end justify-center gap-px h-16 rounded-md border border-solid border-neutral-800 bg-black px-2 py-2">
                    {audioUrl ? (
                      Array.from({ length: 48 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-1 rounded-full flex-shrink-0"
                          style={{
                            height: `${20 + Math.sin(i * 0.7) * 40 + Math.abs(Math.sin(i * 1.3)) * 20}%`,
                            backgroundColor: '#22c55e'
                          }}
                        />
                      ))
                    ) : (
                      <span className="text-caption font-caption text-neutral-600">Upload audio to see waveform</span>
                    )}
                  </div>

                  {/* Trim controls */}
                  <div className="flex w-full items-center gap-2">
                    <TextField className="grow" variant="filled" label="Start" helpText="">
                      <TextField.Input placeholder="0:00" value={trimStart} onChange={(e) => setTrimStart(e.target.value)} />
                    </TextField>
                    <TextField className="grow" variant="filled" label="End" helpText="">
                      <TextField.Input placeholder="0:45" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} />
                    </TextField>
                  </div>

                  {/* Change Audio */}
                  <Button
                    className="h-10 w-full"
                    variant="neutral-secondary"
                    size="medium"
                    icon={<FeatherUpload />}
                    onClick={() => audioInputRef.current?.click()}
                  >
                    {audioName ? 'Change Audio' : 'Upload Audio'}
                  </Button>
                </div>
              )}
            </div>

            {/* ═══ BEAT PATTERN SECTION ═══ */}
            <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 pt-6">
              <div
                className="flex w-full items-center justify-between cursor-pointer"
                onClick={() => toggleSection('beats')}
              >
                <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Beat Pattern</span>
                <IconButton
                  variant="neutral-tertiary"
                  size="small"
                  icon={<FeatherChevronDown className={`transition-transform ${!collapsedSections.has('beats') ? 'rotate-180' : ''}`} />}
                />
              </div>
              {!collapsedSections.has('beats') && (
                <div className="flex w-full flex-col items-start gap-3">
                  {/* BPM display */}
                  <div className="flex items-center gap-2">
                    <span className="text-caption font-caption text-neutral-400">Detected BPM:</span>
                    {isAnalyzing ? (
                      <Badge variant="neutral">Analyzing...</Badge>
                    ) : bpm ? (
                      <Badge variant="success">{bpm} BPM</Badge>
                    ) : (
                      <Badge variant="neutral">—</Badge>
                    )}
                  </div>

                  {/* Sync Pattern — 2 rows per Subframe design */}
                  <div className="flex w-full flex-col items-start gap-2">
                    <span className="text-caption font-caption text-neutral-400">Sync Pattern</span>
                    <ToggleGroup value={syncPattern} onValueChange={(v) => v && setSyncPattern(v)}>
                      <ToggleGroup.Item value="every">Every Beat</ToggleGroup.Item>
                      <ToggleGroup.Item value="every2nd">Every 2nd</ToggleGroup.Item>
                    </ToggleGroup>
                    <ToggleGroup value={syncPattern} onValueChange={(v) => v && setSyncPattern(v)}>
                      <ToggleGroup.Item value="every3rd">Every 3rd</ToggleGroup.Item>
                      <ToggleGroup.Item value="every4th">Every 4th</ToggleGroup.Item>
                    </ToggleGroup>
                  </div>

                  {/* Beat count info */}
                  {beats.length > 0 && (
                    <span className="text-caption font-caption text-neutral-500">
                      {filteredBeats.length} cut points from {beats.length} detected beats
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ═══ LYRICS SECTION ═══ */}
            <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 pt-6">
              <div
                className="flex w-full items-center justify-between cursor-pointer"
                onClick={() => toggleSection('lyrics')}
              >
                <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Lyrics</span>
                <IconButton
                  variant="neutral-tertiary"
                  size="small"
                  icon={<FeatherChevronDown className={`transition-transform ${!collapsedSections.has('lyrics') ? 'rotate-180' : ''}`} />}
                />
              </div>
              {!collapsedSections.has('lyrics') && (
                <div className="flex w-full flex-col items-start gap-3">
                  <textarea
                    className="w-full rounded-md border border-solid border-neutral-800 bg-black px-3 py-2 text-sm text-white placeholder-neutral-500 resize-y outline-none focus:border-brand-600"
                    style={{ minHeight: 80 }}
                    placeholder="Enter or paste lyrics here..."
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    rows={4}
                  />
                  <div className="flex w-full items-center gap-2">
                    <Button className="grow" variant="neutral-secondary" size="small" icon={<FeatherDatabase />}>
                      Load from Bank
                    </Button>
                    <Button className="grow" variant="neutral-secondary" size="small" icon={<FeatherMic />}>
                      AI Transcribe
                    </Button>
                  </div>
                  {lyrics && (
                    <Button
                      className="h-10 w-full"
                      variant="neutral-tertiary"
                      size="small"
                      icon={<FeatherX />}
                      onClick={() => setLyrics('')}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* ═══ TEXT STYLE SECTION ═══ */}
            <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 pt-6">
              <div
                className="flex w-full items-center justify-between cursor-pointer"
                onClick={() => toggleSection('textStyle')}
              >
                <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Text Style</span>
                <IconButton
                  variant="neutral-tertiary"
                  size="small"
                  icon={<FeatherChevronDown className={`transition-transform ${!collapsedSections.has('textStyle') ? 'rotate-180' : ''}`} />}
                />
              </div>
              {!collapsedSections.has('textStyle') && (
                <div className="flex w-full flex-col items-start gap-3">
                  {/* Font Family */}
                  <TextField className="w-full" variant="filled" label="Font Family" helpText="">
                    <TextField.Input
                      placeholder="Inter"
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                    />
                  </TextField>

                  {/* Font Size */}
                  <div className="flex w-full flex-col items-start gap-1">
                    <span className="text-caption font-caption text-neutral-400">Font Size</span>
                    <div className="flex w-full items-center gap-3">
                      <input
                        type="range"
                        min="12"
                        max="120"
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, #4f46e5 ${((fontSize - 12) / 108) * 100}%, #262626 ${((fontSize - 12) / 108) * 100}%)` }}
                      />
                      <span className="text-caption font-caption text-[#ffffffff] w-8 text-right">{fontSize}</span>
                    </div>
                  </div>

                  {/* Colors */}
                  <div className="flex w-full items-center gap-2">
                    <div className="flex grow flex-col items-start gap-1">
                      <span className="text-caption font-caption text-neutral-400">Text Color</span>
                      <label className="flex h-10 w-full items-center gap-2 rounded-md border border-solid border-neutral-800 bg-black px-3 cursor-pointer">
                        <input
                          type="color"
                          value={textColor}
                          onChange={(e) => setTextColor(e.target.value)}
                          className="w-6 h-6 rounded-md border-0 p-0 cursor-pointer"
                        />
                        <span className="text-caption font-caption text-neutral-400">{textColor}</span>
                      </label>
                    </div>
                    <div className="flex grow flex-col items-start gap-1">
                      <span className="text-caption font-caption text-neutral-400">Outline</span>
                      <label className="flex h-10 w-full items-center gap-2 rounded-md border border-solid border-neutral-800 bg-black px-3 cursor-pointer">
                        <input
                          type="color"
                          value={outlineColor}
                          onChange={(e) => setOutlineColor(e.target.value)}
                          className="w-6 h-6 rounded-md border-0 p-0 cursor-pointer"
                        />
                        <span className="text-caption font-caption text-neutral-400">{outlineColor}</span>
                      </label>
                    </div>
                  </div>

                  {/* Outline Width */}
                  <div className="flex w-full flex-col items-start gap-1">
                    <span className="text-caption font-caption text-neutral-400">Outline Width</span>
                    <div className="flex w-full items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="10"
                        value={outlineWidth}
                        onChange={(e) => setOutlineWidth(Number(e.target.value))}
                        className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, #4f46e5 ${(outlineWidth / 10) * 100}%, #262626 ${(outlineWidth / 10) * 100}%)` }}
                      />
                      <span className="text-caption font-caption text-[#ffffffff] w-8 text-right">{outlineWidth}</span>
                    </div>
                  </div>

                  {/* Animation */}
                  <TextField className="w-full" variant="filled" label="Animation" helpText="">
                    <TextField.Input
                      placeholder="None"
                      value={animation}
                      onChange={(e) => setAnimation(e.target.value)}
                    />
                  </TextField>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ TIMELINE ═══ */}
      <div className="flex w-full flex-col items-start border-t border-solid border-neutral-800 bg-[#1a1a1aff] px-6 py-4">
        {/* Header */}
        <div className="flex w-full items-center justify-between mb-3">
          <span className="text-heading-3 font-heading-3 text-[#ffffffff]">Timeline</span>
          <div className="flex items-center gap-1">
            <IconButton variant="neutral-tertiary" size="small" icon={<FeatherZoomOut />} />
            <IconButton variant="neutral-tertiary" size="small" icon={<FeatherZoomIn />} />
          </div>
        </div>

        {/* 3 Track Lanes */}
        <div className="flex w-full flex-col items-start gap-2">
          {/* Text Track */}
          <div className="flex w-full items-center gap-3">
            <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Text</span>
            <div className="flex flex-1 items-center gap-1 h-12 rounded-md border border-solid border-neutral-800 bg-black px-2 overflow-hidden">
              {filteredBeats.length > 0 ? (
                filteredBeats.slice(0, 12).map((t, i) => (
                  <div
                    key={i}
                    className="h-8 rounded-md bg-[#3b82f6] shrink-0"
                    style={{ width: Math.max(16, 80 / Math.max(1, filteredBeats.length / 4)) }}
                  />
                ))
              ) : (
                <span className="text-caption font-caption text-neutral-600">No beats detected</span>
              )}
            </div>
          </div>

          {/* Video Clips Track */}
          <div className="flex w-full items-center gap-3">
            <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Clips</span>
            <div className="flex flex-1 items-center gap-1 h-12 rounded-md border border-solid border-neutral-800 bg-black px-2">
              <span className="text-caption font-caption text-neutral-600">Clip regions appear after generation</span>
            </div>
          </div>

          {/* Audio Track */}
          <div className="flex w-full items-center gap-3">
            <span className="w-20 text-caption font-caption text-neutral-400 text-right shrink-0">Audio</span>
            <div className="flex flex-1 items-end gap-px h-12 rounded-md border border-solid border-neutral-800 bg-black px-1 py-1 overflow-hidden">
              {audioUrl ? (
                Array.from({ length: 60 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full flex-shrink-0"
                    style={{
                      height: `${15 + Math.sin(i * 0.5) * 45 + Math.abs(Math.sin(i * 1.3)) * 15}%`,
                      backgroundColor: '#22c55e'
                    }}
                  />
                ))
              ) : (
                <span className="text-caption font-caption text-neutral-600 px-1">No audio</span>
              )}
            </div>
          </div>
        </div>

        {/* Playhead Scrubber */}
        <div className="flex w-full items-center gap-3 mt-2" style={{ paddingLeft: 92 }}>
          <span className="text-caption font-caption text-neutral-400">{formatTime(currentTime)}</span>
          <div className="flex-1 h-1 rounded-full bg-neutral-800 relative">
            <div
              className="absolute top-0 left-0 h-1 rounded-full bg-brand-600"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute rounded-full bg-brand-600"
              style={{ left: `${progress}%`, top: -4, height: 12, width: 2 }}
            />
          </div>
          <span className="text-caption font-caption text-neutral-400">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
};

export default BeatSyncEditor;
