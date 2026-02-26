/**
 * kenBurnsPresets — Shared Ken Burns effect definitions + CSS transform helper.
 * Extracted from photoMontageExportService.js for reuse in preview components.
 */

export const KB_EFFECTS = [
  { name: 'zoom-in', startScale: 1.0, endScale: 1.15, startX: 0, startY: 0, endX: 0, endY: 0 },
  { name: 'zoom-out', startScale: 1.15, endScale: 1.0, startX: 0, startY: 0, endX: 0, endY: 0 },
  { name: 'pan-right', startScale: 1.1, endScale: 1.1, startX: -0.05, startY: 0, endX: 0.05, endY: 0 },
  { name: 'pan-left', startScale: 1.1, endScale: 1.1, startX: 0.05, startY: 0, endX: -0.05, endY: 0 },
  { name: 'pan-up', startScale: 1.1, endScale: 1.1, startX: 0, startY: 0.05, endX: 0, endY: -0.05 },
  { name: 'pan-down', startScale: 1.1, endScale: 1.1, startX: 0, startY: -0.05, endX: 0, endY: 0.05 },
];

/**
 * Get a CSS transform string for a Ken Burns effect at a given progress (0-1).
 * Used by preview components for live CSS animation.
 */
export const getKenBurnsTransform = (effect, progress) => {
  const scale = effect.startScale + (effect.endScale - effect.startScale) * progress;
  const tx = (effect.startX + (effect.endX - effect.startX) * progress) * 100;
  const ty = (effect.startY + (effect.endY - effect.startY) * progress) * 100;
  return `scale(${scale}) translate(${tx}%, ${ty}%)`;
};
