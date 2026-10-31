const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const feature = (changes = {}) => ({ id: 0, friendlyName: 'Front Door', hostName: '192.168.1.186',
  port: 49152, channel: 0, width: 144, height: 1, offsetX: 0, offsetY: 0,
  redGreenSwap: false, reversed: false, clientBufferCount: 4, ...changes });

function setup({ failPost = false, features = [feature({ id: 37 })] } = {}) {
  const requests = [];
  let failed = false;
  const axios = {
    get: async url => ({ data: { features: url.endsWith('/0') ? [feature({ id: 55, hostName: '192.168.1.185' })] : features } }),
    delete: async url => requests.push({ method: 'DELETE', url }),
    post: async (url, body) => {
      requests.push({ method: 'POST', url, body });
      if (failPost && !failed) { failed = true; throw new Error('rejected'); }
      return { data: { id: 99 } };
    },
  };
  const code = stripTypeScriptTypes(fs.readFileSync(`${__dirname}/../src/services/feature-sync.ts`, 'utf8'))
    .replace(/^import .*;\s*$/gm, '').replace(/export /g, '');
  const api = vm.runInNewContext(`${code}\n({ findServerFeature, mergeFeatureTelemetry, replaceServerFeature, ensureServerFeature, moveServerFeature })`, { axios, console });
  return { ...api, requests };
}

test('telemetry retains manifest ID when NDSCPP allocates a different runtime ID', () => {
  const { mergeFeatureTelemetry } = setup();
  const merged = mergeFeatureTelemetry(feature(), [feature({ id: 37, isConnected: true })]);
  assert.equal(merged.id, 0);
  assert.equal(merged.serverFeatureId, 37);
  assert.equal(merged.isConnected, true);
});

test('buffer edits replace the actual runtime segment and omit manifest IDs', async () => {
  const { replaceServerFeature, requests } = setup();
  await replaceServerFeature('http://nds', 1, feature(), feature({ clientBufferCount: 24 }));
  assert.equal(requests[0].url, 'http://nds/api/canvases/1/features/37');
  assert.equal(requests[1].body.clientBufferCount, 24);
  assert.equal(requests[1].body.id, undefined);
  assert.equal(requests.length, 2);
});

test('delete uses server identity rather than the local ID', async () => {
  const { replaceServerFeature, requests } = setup();
  await replaceServerFeature('http://nds', 1, feature());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://nds/api/canvases/1/features/37');
});

test('failed edits restore the original segment and report failure', async () => {
  const { replaceServerFeature, requests } = setup({ failPost: true });
  await assert.rejects(replaceServerFeature('http://nds', 1, feature(), feature({ clientBufferCount: 24 })), /rejected/);
  assert.equal(requests[2].body.clientBufferCount, 4);
  assert.equal(requests[2].url, 'http://nds/api/canvases/1/features');
});

test('segments on the same controller are matched by their geometry', () => {
  const { findServerFeature } = setup();
  const segments = [feature({ id: 20, offsetX: 0, width: 72 }), feature({ id: 21, offsetX: 72, width: 72 })];
  assert.equal(findServerFeature(feature({ offsetX: 72, width: 72 }), segments).id, 21);
  assert.throws(() => findServerFeature(feature({ offsetX: 144, width: 72 }), segments), /Ambiguous/);
});

test('existing features with changed settings are synchronized instead of silently skipped', async () => {
  const { ensureServerFeature, requests } = setup();
  await ensureServerFeature('http://nds', 1, feature({ clientBufferCount: 24 }), [feature({ id: 37 })]);
  assert.equal(requests[1].body.clientBufferCount, 24);
});

test('moving a controller transfers it to the target canvas with its requested buffer', async () => {
  const { moveServerFeature, requests } = setup();
  const before = feature({ hostName: '192.168.1.185' });
  await moveServerFeature('http://nds', 0, 1, before, { ...before, id: 1, clientBufferCount: 500 });
  assert.equal(requests[0].url, 'http://nds/api/canvases/0/features/55');
  assert.equal(requests[1].url, 'http://nds/api/canvases/1/features');
  assert.equal(requests[1].body.clientBufferCount, 500);
});
