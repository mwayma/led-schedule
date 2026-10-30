import type { StartEffectAction } from '../types';

type Effect = StartEffectAction['properties']['effect'];

// NDSCPP's palette deserializer requires every field, including false/zero values.
export function normalizeEffect(effect: Effect): Effect {
  if (effect.type !== '13PaletteEffect') return { ...effect };
  const defaults = {
    ledColorPerSecond: 0, ledScrollSpeed: 5, density: 1,
    everyNthDot: 1, dotSize: 1, rampedColor: false,
    brightness: 1, mirrored: false,
  };
  const normalized: Effect = { ...effect };
  for (const [key, value] of Object.entries(defaults)) {
    normalized[key] = effect[key] ?? value;
  }
  normalized.palette = {
    ...effect.palette,
    blend: effect.palette?.blend ?? true,
    colors: effect.palette?.colors ?? [{ r: 112, g: 0, b: 176 }, { r: 32, g: 176, b: 0 }],
  };
  return normalized;
}
