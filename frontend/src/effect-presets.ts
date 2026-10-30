import type { StartEffectAction } from './types';

type Effect = StartEffectAction['properties']['effect'];
const palette = (name: string, colors: number[][], overrides: Record<string, unknown>): Effect => ({
  type: '13PaletteEffect', name,
  ledColorPerSecond: 0, ledScrollSpeed: 0.5, density: 0.03,
  everyNthDot: 1, dotSize: 1, rampedColor: false, brightness: 0.55, mirrored: false,
  palette: { blend: true, colors: colors.map(([r, g, b]) => ({ r, g, b })) },
  ...overrides,
});

export const halloweenPresets: Record<string, Effect> = {
  'Purple/green glow': palette('Ethereal Purple Green Glow', [[112, 0, 176], [32, 176, 0], [22, 0, 40]], {
    ledColorPerSecond: 0.25,
  }),
  'Halloween scroll': palette('Halloween Orange Purple Green Scroll', [[240, 80, 0], [112, 0, 176], [32, 176, 0]], {
    // Move the color phase, avoiding fractional one-pixel overwrite flicker in NDSCPP.
    ledScrollSpeed: 0, ledColorPerSecond: 0.5, density: 0.06, brightness: 0.65, palette: {
      blend: true, colors: [{ r: 240, g: 80, b: 0 }, { r: 112, g: 0, b: 176 }, { r: 32, g: 176, b: 0 }],
    },
  }),
  'Ghost apparitions': palette('Ghostly Apparitions', [[0, 0, 0], [180, 210, 200], [15, 50, 30], [0, 0, 0]], {
    ledScrollSpeed: 1.5, ledColorPerSecond: 0.25, density: 0.04,
    everyNthDot: 24, dotSize: 6, brightness: 0.45, mirrored: true,
  }),
};

