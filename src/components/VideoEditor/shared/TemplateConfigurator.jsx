/**
 * TemplateConfigurator — Saveable named templates with format-specific editor settings.
 * Shared between VideoNicheContent and SlideshowNicheContent right panels.
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Button } from '../../../ui/components/Button';
import { IconButton } from '../../../ui/components/IconButton';
import { Badge } from '../../../ui/components/Badge';
import { ToggleGroup } from '../../../ui/components/ToggleGroup';
import {
  FeatherPlay, FeatherSave, FeatherTrash2, FeatherPlus,
  FeatherChevronDown, FeatherCheck, FeatherX, FeatherArrowRight,
  FeatherMusic, FeatherUpload, FeatherScissors, FeatherMic,
} from '@subframe/core';
import {
  saveNicheTemplate,
  deleteNicheTemplate,
  setNicheActiveTemplate,
  getDefaultTemplateSettings,
} from '../../../services/libraryService';

const generateTemplateId = () =>
  `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const FONT_OPTIONS = [
  { label: 'Inter', value: "'Inter', sans-serif" },
  { label: 'TikTok Sans', value: "'TikTok Sans', sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier', value: "'Courier New', monospace" },
  { label: 'Impact', value: 'Impact, sans-serif' },
];

const WEIGHT_OPTIONS = [
  { label: 'Normal', value: '400' },
  { label: 'Medium', value: '500' },
  { label: 'Semi', value: '600' },
  { label: 'Bold', value: '700' },
  { label: 'Black', value: '900' },
];

const CASE_OPTIONS = [
  { label: 'Aa', value: 'default' },
  { label: 'AA', value: 'upper' },
  { label: 'aa', value: 'lower' },
];

const SPEED_OPTIONS = [
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2 },
];

const TRANSITION_OPTIONS = [
  { label: 'Cut', value: 'cut' },
  { label: 'Fade', value: 'fade' },
  { label: 'Slide', value: 'slide' },
  { label: 'Zoom', value: 'zoom' },
];

const ASPECT_RATIOS = [
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: '1:1', value: '1:1' },
  { label: '4:5', value: '4:5' },
];

const ASPECT_CSS = {
  '9:16': '9/16',
  '16:9': '16/9',
  '1:1': '1/1',
  '4:5': '4/5',
};

const TEXT_POSITION_OPTIONS = [
  { label: 'Top', value: 'top' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom', value: 'bottom' },
];

const TemplateConfigurator = ({
  niche,
  activeFormat,
  artistId,
  db,
  previewContent,
  onPreviewClick,
  createCount,
  onCreateCountChange,
  onCreateClick,
  createLabel,
  selectedAudio,
  projectAudio = [],
  onSelectAudio,
  onUploadAudio,
  onTrimAudio,
  onAutoTranscribe,
  isTranscribing = false,
  draftCount = 0,
  onOpenLatestDraft,
  onViewDrafts,
  onSettingsChange,
}) => {
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  const formatId = activeFormat?.id;

  // ── Template state ──
  const templates = niche?.templates || [];
  const activeTemplateId = niche?.activeTemplateId || null;
  const activeTemplate = templates.find(t => t.id === activeTemplateId) || null;

  // Settings state (initialized from active template or defaults)
  const defaults = useMemo(() => getDefaultTemplateSettings(formatId), [formatId]);
  const [settings, setSettings] = useState(() =>
    activeTemplate?.settings ? { ...defaults, ...activeTemplate.settings } : { ...defaults }
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const dropdownRef = useRef(null);

  // Track if settings differ from saved template
  const isModified = useMemo(() => {
    if (!activeTemplate) return true; // No template selected = always "unsaved"
    return JSON.stringify(settings) !== JSON.stringify({ ...defaults, ...activeTemplate.settings });
  }, [settings, activeTemplate, defaults]);

  // Sync settings when niche or active template changes
  const prevNicheIdRef = useRef(niche?.id);
  const prevTemplateIdRef = useRef(activeTemplateId);
  useEffect(() => {
    if (prevNicheIdRef.current !== niche?.id || prevTemplateIdRef.current !== activeTemplateId) {
      prevNicheIdRef.current = niche?.id;
      prevTemplateIdRef.current = activeTemplateId;
      const tmpl = (niche?.templates || []).find(t => t.id === (niche?.activeTemplateId || null));
      const def = getDefaultTemplateSettings(formatId);
      setSettings(tmpl?.settings ? { ...def, ...tmpl.settings } : { ...def });
      setSavePromptOpen(false);
    }
  }, [niche?.id, activeTemplateId, formatId, niche?.templates, niche?.activeTemplateId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // ── Settings updater ──
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      if (onSettingsChange) onSettingsChange(next);
      return next;
    });
  }, [onSettingsChange]);

  const updateTextStyle = useCallback((key, value) => {
    setSettings(prev => {
      const next = { ...prev, textStyle: { ...prev.textStyle, [key]: value } };
      if (onSettingsChange) onSettingsChange(next);
      return next;
    });
  }, [onSettingsChange]);

  // ── Template actions ──
  const handleSelectTemplate = useCallback((tmplId) => {
    setNicheActiveTemplate(artistId, niche.id, tmplId, db);
    setDropdownOpen(false);
  }, [artistId, niche, db]);

  const handleNewTemplate = useCallback(() => {
    setNicheActiveTemplate(artistId, niche.id, null, db);
    setSettings({ ...getDefaultTemplateSettings(formatId) });
    setDropdownOpen(false);
  }, [artistId, niche, formatId, db]);

  const handleDeleteTemplate = useCallback((tmplId, e) => {
    e.stopPropagation();
    deleteNicheTemplate(artistId, niche.id, tmplId, db);
  }, [artistId, niche, db]);

  const handleSaveTemplate = useCallback((name) => {
    const id = activeTemplate?.id || generateTemplateId();
    const tmpl = {
      id,
      name: name || activeTemplate?.name || 'Untitled Template',
      settings: { ...settings },
    };
    saveNicheTemplate(artistId, niche.id, tmpl, db);
    setSavePromptOpen(false);
    setTemplateName('');
  }, [settings, activeTemplate, artistId, niche, db]);

  const handleSaveExisting = useCallback(() => {
    if (!activeTemplate) return;
    handleSaveTemplate(activeTemplate.name);
  }, [activeTemplate, handleSaveTemplate]);

  // ── Create click — check if template needs saving ──
  const handleCreateClick = useCallback(() => {
    if (!activeTemplate && !isModified) {
      // Defaults, no template — just create
      onCreateClick(settings);
      return;
    }
    if (activeTemplate && !isModified) {
      // Saved template, unmodified — just create
      onCreateClick(settings);
      return;
    }
    // Unsaved or modified — show save prompt
    setSavePromptOpen(true);
  }, [activeTemplate, isModified, settings, onCreateClick]);

  const handleCreateWithoutSaving = useCallback(() => {
    setSavePromptOpen(false);
    onCreateClick(settings);
  }, [settings, onCreateClick]);

  const handleSaveAndCreate = useCallback(() => {
    const name = templateName.trim() || activeTemplate?.name || 'Untitled Template';
    handleSaveTemplate(name);
    onCreateClick(settings);
  }, [templateName, activeTemplate, handleSaveTemplate, settings, onCreateClick]);

  // ── Derived ──
  const templateLabel = activeTemplate
    ? (isModified ? `${activeTemplate.name} (modified)` : activeTemplate.name)
    : 'Unsaved Template';

  const ts = settings.textStyle || {};

  return (
    <>
      {/* Template selector */}
      <div className="flex w-full flex-col gap-2 border-b border-solid border-neutral-800 px-4 py-3" ref={dropdownRef}>
        <div className="flex w-full items-center gap-2">
          <button
            className="flex flex-1 items-center gap-2 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-3 py-2 hover:bg-[#262626] transition text-left min-w-0"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className="text-caption font-caption text-neutral-400 flex-none">Template:</span>
            <span className="text-caption-bold font-caption-bold text-[#ffffffff] truncate flex-1">{templateLabel}</span>
            <FeatherChevronDown
              className="text-neutral-400 flex-none transition-transform"
              style={{ width: 14, height: 14, transform: dropdownOpen ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {activeTemplate && isModified && (
            <IconButton variant="brand-tertiary" size="small" icon={<FeatherSave />} aria-label="Save template" onClick={handleSaveExisting} />
          )}
        </div>

        {dropdownOpen && (
          <div className="flex flex-col gap-0.5 rounded-lg border border-neutral-700 bg-[#111111] px-2 py-2 max-h-48 overflow-y-auto shadow-xl z-20">
            {templates.map(tmpl => (
              <div
                key={tmpl.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition ${
                  tmpl.id === activeTemplateId ? 'bg-indigo-600' : 'hover:bg-neutral-800'
                }`}
                onClick={() => handleSelectTemplate(tmpl.id)}
              >
                <span className="text-caption font-caption text-[#ffffffff] truncate flex-1">{tmpl.name}</span>
                {tmpl.id === activeTemplateId && <FeatherCheck className="text-indigo-300 flex-none" style={{ width: 12, height: 12 }} />}
                <button
                  className="text-neutral-500 hover:text-red-400 bg-transparent border-none cursor-pointer p-0 opacity-0 group-hover:opacity-100 flex-none"
                  style={{ opacity: 1 }}
                  onClick={(e) => handleDeleteTemplate(tmpl.id, e)}
                  aria-label="Delete template"
                >
                  <FeatherTrash2 style={{ width: 11, height: 11 }} />
                </button>
              </div>
            ))}
            <button
              className="flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition hover:bg-neutral-800 border-t border-neutral-800 mt-1 pt-2"
              onClick={handleNewTemplate}
            >
              <FeatherPlus className="text-indigo-400 flex-none" style={{ width: 12, height: 12 }} />
              <span className="text-caption font-caption text-indigo-400">New Template</span>
            </button>
          </div>
        )}
      </div>

      {/* Preview area — layout handled by preview component */}
      {previewContent && (
        <div className="flex w-full flex-col items-center px-4 py-4">
          {previewContent}
        </div>
      )}

      {/* Slide Duration — right after preview */}
      {settings.slideDuration !== undefined && (
        <div className="flex w-full items-center justify-between border-t border-solid border-neutral-800 px-4 py-3">
          <span className="text-caption font-caption text-neutral-400">Slide Duration</span>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0.5} max={10} step={0.5}
              value={settings.slideDuration}
              onChange={e => updateSetting('slideDuration', parseFloat(e.target.value))}
              className="w-20 accent-indigo-500"
            />
            <span className="text-caption font-caption text-[#ffffffff] w-8 text-right">{settings.slideDuration}s</span>
          </div>
        </div>
      )}

      {/* Format-specific controls (non-slide-duration) */}
      {(settings.textDisplayMode !== undefined || settings.transition !== undefined || settings.speed !== undefined) && (
        <div className="flex w-full flex-col gap-3 border-t border-solid border-neutral-800 px-4 py-3">
          {/* Solo Clip: text display mode */}
          {settings.textDisplayMode !== undefined && (
            <div className="flex w-full items-center justify-between">
              <span className="text-caption font-caption text-neutral-400">Text Display</span>
              <ToggleGroup value={settings.textDisplayMode} onValueChange={(val) => { if (val) updateSetting('textDisplayMode', val); }}>
                <ToggleGroup.Item value="word">Word</ToggleGroup.Item>
                <ToggleGroup.Item value="line">Line</ToggleGroup.Item>
                <ToggleGroup.Item value="full">Full</ToggleGroup.Item>
              </ToggleGroup>
            </div>
          )}

          {/* Transition — shown for multi_clip + photo_montage */}
          {settings.transition !== undefined && (
            <div className="flex w-full items-center justify-between">
              <span className="text-caption font-caption text-neutral-400">Transition</span>
              <ToggleGroup value={settings.transition} onValueChange={(val) => { if (val) updateSetting('transition', val); }}>
                {TRANSITION_OPTIONS.map(t => (
                  <ToggleGroup.Item key={t.value} value={t.value}>{t.label}</ToggleGroup.Item>
                ))}
              </ToggleGroup>
            </div>
          )}

          {/* Photo Montage: speed, ken burns, beat sync */}
          {settings.speed !== undefined && (
            <>
              <div className="flex w-full items-center justify-between">
                <span className="text-caption font-caption text-neutral-400">Speed</span>
                <ToggleGroup value={String(settings.speed)} onValueChange={(val) => { if (val) updateSetting('speed', parseFloat(val)); }}>
                  {SPEED_OPTIONS.map(s => (
                    <ToggleGroup.Item key={s.value} value={String(s.value)}>{s.label}</ToggleGroup.Item>
                  ))}
                </ToggleGroup>
              </div>
              <div className="flex w-full items-center justify-between">
                <span className="text-caption font-caption text-neutral-400">Ken Burns</span>
                <button
                  className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors cursor-pointer ${settings.kenBurns ? 'bg-indigo-600' : 'bg-neutral-700'}`}
                  onClick={() => updateSetting('kenBurns', !settings.kenBurns)}
                >
                  <div className={`h-4 w-4 rounded-full bg-white transition-transform ${settings.kenBurns ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="flex w-full items-center justify-between">
                <span className="text-caption font-caption text-neutral-400">Beat Sync</span>
                <button
                  className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors cursor-pointer ${settings.beatSync ? 'bg-indigo-600' : 'bg-neutral-700'}`}
                  onClick={() => updateSetting('beatSync', !settings.beatSync)}
                >
                  <div className={`h-4 w-4 rounded-full bg-white transition-transform ${settings.beatSync ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Audio + Create section */}
      <div className="flex w-full flex-col items-start gap-3 border-t border-solid border-neutral-800 px-4 py-4">
        {/* Audio — dropdown + tools */}
        <div className="flex w-full flex-col gap-2">
          <span className="text-caption font-caption text-neutral-400">Audio</span>
          <div className="relative">
            <button
              className="flex w-full items-center gap-2 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-3 py-2 hover:bg-[#262626] transition"
              onClick={() => setAudioPickerOpen(!audioPickerOpen)}
            >
              <FeatherMusic className="text-indigo-400 flex-none" style={{ width: 14, height: 14 }} />
              <span className="text-caption font-caption text-[#ffffffff] truncate grow text-left">
                {selectedAudio?.name || 'No audio'}
              </span>
              <FeatherChevronDown
                className="text-neutral-400 flex-none transition-transform"
                style={{ width: 14, height: 14, transform: audioPickerOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>
            {audioPickerOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 flex flex-col gap-0.5 px-2 py-2 bg-[#111111] border border-neutral-700 rounded-lg max-h-48 overflow-y-auto shadow-xl z-20">
                {projectAudio.length === 0 && (
                  <span className="text-caption font-caption text-neutral-500 px-2 py-1">No audio uploaded</span>
                )}
                {onUploadAudio && (
                  <button
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition hover:bg-neutral-800 border-b border-neutral-800 mb-0.5"
                    onClick={() => { setAudioPickerOpen(false); onUploadAudio(); }}
                  >
                    <FeatherUpload className="text-indigo-400 flex-none" style={{ width: 10, height: 10 }} />
                    <span className="text-caption font-caption text-indigo-400">Upload Audio</span>
                  </button>
                )}
                {projectAudio.map(audio => {
                  const isActive = selectedAudio?.id === audio.id;
                  return (
                    <button
                      key={audio.id}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                        isActive ? 'bg-indigo-600' : 'hover:bg-neutral-800'
                      }`}
                      onClick={() => { onSelectAudio(audio.id); setAudioPickerOpen(false); }}
                    >
                      <FeatherPlay className="text-neutral-300 flex-none" style={{ width: 10, height: 10 }} />
                      <span className="text-caption font-caption text-[#ffffffff] truncate grow">{audio.name}</span>
                      {isActive && <FeatherCheck className="text-indigo-300 flex-none" style={{ width: 12, height: 12 }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {selectedAudio && (onTrimAudio || onAutoTranscribe) && (
            <div className="flex items-center gap-2">
              {onTrimAudio && (
                <Button variant="neutral-secondary" size="small" icon={<FeatherScissors />} onClick={onTrimAudio}>
                  Trim
                </Button>
              )}
              {onAutoTranscribe && (
                <Button variant="neutral-secondary" size="small" icon={<FeatherMic />} onClick={onAutoTranscribe} disabled={isTranscribing}>
                  {isTranscribing ? 'Transcribing...' : 'Auto Transcribe'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Save-as-template prompt */}
        {savePromptOpen && (
          <div className="flex w-full flex-col gap-2 rounded-lg border border-solid border-indigo-500/30 bg-indigo-500/5 p-3">
            <span className="text-caption-bold font-caption-bold text-indigo-300">Save as template?</span>
            {!activeTemplate && (
              <input
                className="w-full rounded-md border border-solid border-neutral-800 bg-black px-2.5 py-1.5 text-caption font-caption text-white outline-none placeholder-neutral-500"
                placeholder="Template name..."
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveAndCreate(); }}
                autoFocus
              />
            )}
            <div className="flex items-center gap-2">
              <Button className="flex-1" variant="brand-primary" size="small" onClick={handleSaveAndCreate}>
                {activeTemplate ? 'Save & Create' : 'Save & Create'}
              </Button>
              <Button className="flex-1" variant="neutral-secondary" size="small" onClick={handleCreateWithoutSaving}>
                Skip
              </Button>
              <IconButton variant="neutral-tertiary" size="small" icon={<FeatherX />} aria-label="Cancel" onClick={() => setSavePromptOpen(false)} />
            </div>
          </div>
        )}

        {/* Create button with embedded count */}
        {!savePromptOpen && (
          <div className="flex w-full items-center gap-0">
            <Button className="h-auto flex-1" variant="brand-primary" size="medium" icon={<FeatherPlay />}
              onClick={handleCreateClick}>
              {`Create`}
            </Button>
            <input
              type="number" min={1} max={50} value={createCount}
              onChange={e => onCreateCountChange(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-12 h-10 rounded-r-md border border-solid border-neutral-600 bg-neutral-700 px-1 py-1 text-center text-body font-body text-white outline-none -ml-1"
            />
          </div>
        )}
      </div>

      {/* Text Style section */}
      <div className="flex w-full flex-col gap-3 border-t border-solid border-neutral-800 px-4 py-4">
        <div className="flex w-full flex-col gap-2">
          <span className="text-caption-bold font-caption-bold text-neutral-300">Text Style</span>

          {/* Position */}
          <div className="flex w-full items-center justify-between">
            <span className="text-caption font-caption text-neutral-400">Position</span>
            <ToggleGroup value={settings.textPosition || 'center'} onValueChange={(val) => { if (val) updateSetting('textPosition', val); }}>
              {TEXT_POSITION_OPTIONS.map(tp => (
                <ToggleGroup.Item key={tp.value} value={tp.value}>{tp.label}</ToggleGroup.Item>
              ))}
            </ToggleGroup>
          </div>

          {/* Font */}
          <div className="flex w-full items-center justify-between">
            <span className="text-caption font-caption text-neutral-400">Font</span>
            <select
              className="rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-2 py-1 text-caption font-caption text-white outline-none cursor-pointer"
              value={ts.fontFamily || "'Inter', sans-serif"}
              onChange={e => updateTextStyle('fontFamily', e.target.value)}
            >
              {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          {/* Size + Weight */}
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-caption font-caption text-neutral-400">Size</span>
            <input
              type="number" min={12} max={120} step={2}
              value={ts.fontSize || 48}
              onChange={e => updateTextStyle('fontSize', parseInt(e.target.value) || 48)}
              className="w-14 rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-2 py-1 text-center text-caption font-caption text-white outline-none"
            />
            <span className="text-caption font-caption text-neutral-400">Weight</span>
            <select
              className="rounded-md border border-solid border-neutral-800 bg-[#1a1a1aff] px-2 py-1 text-caption font-caption text-white outline-none cursor-pointer"
              value={ts.fontWeight || '600'}
              onChange={e => updateTextStyle('fontWeight', e.target.value)}
            >
              {WEIGHT_OPTIONS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </div>

          {/* Color + Case */}
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-caption font-caption text-neutral-400">Color</span>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={ts.color || '#ffffff'}
                onChange={e => updateTextStyle('color', e.target.value)}
                className="h-6 w-6 rounded border border-neutral-700 cursor-pointer bg-transparent"
              />
              <span className="text-caption font-caption text-neutral-500 w-14">{ts.color || '#ffffff'}</span>
            </div>
            <span className="text-caption font-caption text-neutral-400">Case</span>
            <ToggleGroup value={ts.textCase || 'default'} onValueChange={(val) => { if (val) updateTextStyle('textCase', val); }}>
              {CASE_OPTIONS.map(c => (
                <ToggleGroup.Item key={c.value} value={c.value}>{c.label}</ToggleGroup.Item>
              ))}
            </ToggleGroup>
          </div>

          {/* Outline */}
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-caption font-caption text-neutral-400">Outline</span>
            <button
              className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors cursor-pointer ${ts.outline ? 'bg-indigo-600' : 'bg-neutral-700'}`}
              onClick={() => updateTextStyle('outline', !ts.outline)}
            >
              <div className={`h-4 w-4 rounded-full bg-white transition-transform ${ts.outline ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            {ts.outline && (
              <>
                <span className="text-caption font-caption text-neutral-400">Color</span>
                <input
                  type="color"
                  value={ts.outlineColor || '#000000'}
                  onChange={e => updateTextStyle('outlineColor', e.target.value)}
                  className="h-6 w-6 rounded border border-neutral-700 cursor-pointer bg-transparent"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Drafts row */}
      <div className="flex w-full items-center justify-between border-t border-solid border-neutral-800 px-4 py-3">
        <span className="text-caption font-caption text-neutral-400">
          {draftCount} draft{draftCount !== 1 ? 's' : ''}
        </span>
        {draftCount > 0 && onOpenLatestDraft && (
          <button
            className="flex items-center gap-1 text-caption font-caption text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer"
            onClick={onOpenLatestDraft}
          >
            Open Latest
            <FeatherArrowRight style={{ width: 12, height: 12 }} />
          </button>
        )}
        {draftCount > 0 && !onOpenLatestDraft && onViewDrafts && (
          <Button className="h-auto w-auto flex-none" variant="neutral-tertiary" size="small" iconRight={<FeatherArrowRight />}
            onClick={onViewDrafts}>
            View Drafts
          </Button>
        )}
      </div>
    </>
  );
};

export default TemplateConfigurator;
