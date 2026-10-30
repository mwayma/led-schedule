const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function source(path) {
  return stripTypeScriptTypes(fs.readFileSync(`${__dirname}/../src/services/${path}`, 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/export /g, '');
}
const normalizeEffect = vm.runInNewContext(`${source('effect-config.ts')}\nnormalizeEffect`);

test('new palettes include every field required by NDSCPP', () => {
  const input = { type: '13PaletteEffect', name: 'New palette', palette: { colors: [{ r: 1, g: 2, b: 3 }] } };
  const effect = normalizeEffect(input);
  for (const key of ['ledColorPerSecond', 'ledScrollSpeed', 'density', 'everyNthDot', 'dotSize', 'rampedColor', 'brightness', 'mirrored']) {
    assert.notEqual(effect[key], undefined, key);
  }
  assert.equal(effect.palette.blend, true);
  assert.equal(input.rampedColor, undefined, 'stored input is not mutated');
});

test('normalization preserves explicit black, zero speeds and false flags', () => {
  const effect = normalizeEffect({ type: '13PaletteEffect', name: 'Dark', brightness: 0, ledScrollSpeed: 0,
    ledColorPerSecond: 0, rampedColor: false, mirrored: false, palette: { blend: false, colors: [] } });
  assert.equal(effect.brightness, 0);
  assert.equal(effect.ledScrollSpeed, 0);
  assert.equal(effect.palette.blend, false);
  assert.equal(effect.palette.colors.length, 0);
});

function orchestrator() {
  const requests = [];
  const canvases = [{ id: 1, name: 'Front Door', effectsManager: { running: false } }];
  const flows = [];
  const axios = {
    get: async () => ({ data: canvases }),
    post: async (url, body) => { requests.push(['POST', url, body]); return { data: {} }; },
    put: async (url, body) => { requests.push(['PUT', url, body]); return { data: {} }; },
  };
  const context = { axios, normalizeEffect, console, AbortController, setTimeout, clearTimeout,
    storageService: { getSettings: () => ({ ndscppHostname: 'ndscpp', ndscppPort: 7777, timezone: 'America/Chicago' }),
      getCanvas: () => ({ id: 1, fps: 15 }), getCanvases: () => canvases, getFlow: id => flows.find(f => f.id === id), getFlows: () => flows },
    scoreboardService: { clear() {} }, cron: {}, Date,
  };
  const service = vm.runInNewContext(`${source('orchestrator.service.ts')}\nnew OrchestratorService()`, context);
  return { service, requests, flows, context };
}

test('live preview sends the selected effect, stops first and starts only its target', async () => {
  const { service, requests } = orchestrator();
  await service.previewEffect(1, { type: '13PaletteEffect', name: 'Purple glow', palette: { colors: [] } });
  assert.equal(requests.length, 3);
  assert.equal(requests[0][1], 'http://ndscpp:7777/api/canvases/stop');
  assert.equal(requests[1][0], 'PUT');
  assert.equal(requests[1][2].name, 'Purple glow');
  assert.equal(requests[1][2].rampedColor, false);
  assert.equal(requests[2][1], 'http://ndscpp:7777/api/canvases/start');
  assert.deepEqual(Array.from(requests[0][2].canvasIds), [1]);
  assert.deepEqual(Array.from(requests[2][2].canvasIds), [1]);
});

test('repeat cycles run again and abort cleanly', async () => {
  const { service, requests, flows } = orchestrator();
  flows.push({ id: 'repeat', name: 'Repeat', enabled: true, repeatUntilEnd: true,
    trigger: { type: 'time', properties: { startTime: '17:45', endTime: '22:00' } },
    actions: [{ id: 'on', type: 'start_effect', properties: { canvasId: 1, effect: { type: '15StarfieldEffect', name: 'Ghost' } } },
      { id: 'wait', type: 'delay', properties: { durationSeconds: 0.01 } }] });
  const execution = service.executeFlow('repeat');
  await new Promise(resolve => setTimeout(resolve, 45));
  service.activeExecutions.get('repeat').abort();
  await execution;
  assert.ok(requests.filter(r => r[0] === 'PUT').length >= 2);
  const count = requests.length;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests.length, count);
});

test('disabled flows do not execute', async () => {
  const { service, requests, flows } = orchestrator();
  flows.push({ id: 'disabled', name: 'Disabled', enabled: false });
  await service.executeFlow('disabled');
  assert.equal(requests.length, 0);
});

test('October 31 window starts at 5:45 Central and runs end actions at 10 PM', async () => {
  const { service, requests, flows, context } = orchestrator();
  let current = '2026-10-31T22:45:00Z';
  context.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [current])); } };
  flows.push({ id: 'halloween', name: 'Halloween', enabled: true,
    trigger: { type: 'time', properties: { startDate: '10-31', endDate: '10-31', startTime: '17:45', endTime: '22:00' } },
    actions: [{ id: 'on', type: 'start_effect', properties: { canvasId: 1, effect: { type: '15StarfieldEffect', name: 'Ghost' } } }],
    endActions: [{ id: 'off', type: 'stop_effect', properties: { canvasId: 1 } }] });
  service.checkTimeTriggerTick();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(requests.some(r => r[0] === 'PUT' && r[2].name === 'Ghost'));
  requests.length = 0;
  current = '2026-11-01T03:00:00Z';
  service.checkTimeTriggerTick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][1], 'http://ndscpp:7777/api/canvases/stop');
  assert.deepEqual(Array.from(requests[0][2].canvasIds), [1]);
});

test('all Halloween presets satisfy the strict palette deserializer', () => {
  const code = stripTypeScriptTypes(fs.readFileSync(`${__dirname}/../../frontend/src/effect-presets.ts`, 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/export /g, '');
  const presets = vm.runInNewContext(`${code}\nhalloweenPresets`);
  for (const effect of Object.values(presets)) {
    const normalized = normalizeEffect(effect);
    assert.equal(JSON.stringify(normalized), JSON.stringify(effect));
    assert.ok(effect.palette.colors.every(c => Object.values(c).every(v => v >= 0 && v <= 255)));
  }
});
