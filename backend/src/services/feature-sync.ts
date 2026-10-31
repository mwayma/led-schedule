import axios from 'axios';
import type { LEDFeatureConfig } from '../types';

const featureFields = ['friendlyName', 'hostName', 'port', 'channel', 'width', 'height',
  'offsetX', 'offsetY', 'redGreenSwap', 'reversed', 'clientBufferCount'] as const;

export function featurePayload(feature: LEDFeatureConfig): Record<string, unknown> {
  return Object.fromEntries(featureFields.map(key => [key, feature[key]]));
}

// Feature IDs in NDSCPP are allocated at runtime, independently of manifest IDs.
export function findServerFeature(local: LEDFeatureConfig, serverFeatures: any[]): any | undefined {
  const endpoint = serverFeatures.filter(server => server.hostName === local.hostName &&
    server.port === local.port && server.channel === local.channel);
  const exact = endpoint.filter(server => ['width', 'height', 'offsetX', 'offsetY'].every(key =>
    server[key] === (local as any)[key]));
  if (exact.length === 1) return exact[0];
  const named = endpoint.filter(server => server.friendlyName === local.friendlyName);
  if (named.length === 1) return named[0];
  if (endpoint.length === 1) return endpoint[0];
  if (endpoint.length > 1) throw new Error(`Ambiguous server feature for ${local.friendlyName}; refusing to change another segment.`);
  return undefined;
}

export function mergeFeatureTelemetry(local: LEDFeatureConfig, serverFeatures: any[]): LEDFeatureConfig & Record<string, unknown> {
  const server = findServerFeature(local, serverFeatures);
  return { ...local, serverFeatureId: server?.id,
    isConnected: server?.isConnected, lastClientResponse: server?.lastClientResponse };
}

// Current NDSCPP has POST/DELETE feature routes, but no feature PUT route.
export async function replaceServerFeature(baseUrl: string, canvasId: number,
  before: LEDFeatureConfig, after?: LEDFeatureConfig): Promise<void> {
  const url = `${baseUrl}/api/canvases/${canvasId}`;
  let canvas: any;
  try {
    canvas = (await axios.get(url, { timeout: 5000 })).data;
  } catch (err: any) {
    if (err.response?.status === 404 && !after) return;
    throw err;
  }
  const existing = findServerFeature(before, canvas.features || []);
  if (existing) await axios.delete(`${url}/features/${existing.id}`, { timeout: 5000 });
  if (!after) return;
  try {
    await axios.post(`${url}/features`, featurePayload(after), { timeout: 5000 });
  } catch (err) {
    // Keep the saved manifest unchanged; attempt to restore the old live segment.
    if (existing) {
      try { await axios.post(`${url}/features`, featurePayload(existing), { timeout: 5000 }); }
      catch (restoreError) { console.error('Could not restore server feature after failed edit:', restoreError); }
    }
    throw err;
  }
}

export async function ensureServerFeature(baseUrl: string, canvasId: number,
  desired: LEDFeatureConfig, serverFeatures: any[]): Promise<void> {
  const existing = findServerFeature(desired, serverFeatures);
  if (!existing) {
    await axios.post(`${baseUrl}/api/canvases/${canvasId}/features`, featurePayload(desired), { timeout: 5000 });
  } else if (featureFields.some(key => existing[key] !== desired[key])) {
    await replaceServerFeature(baseUrl, canvasId, desired, desired);
  }
}

export async function moveServerFeature(baseUrl: string, sourceId: number, targetId: number,
  before: LEDFeatureConfig, after: LEDFeatureConfig): Promise<void> {
  const sourceUrl = `${baseUrl}/api/canvases/${sourceId}`;
  const targetUrl = `${baseUrl}/api/canvases/${targetId}`;
  const [source, target] = await Promise.all([
    axios.get(sourceUrl, { timeout: 5000 }), axios.get(targetUrl, { timeout: 5000 })
  ]);
  if (findServerFeature(after, target.data.features || [])) throw new Error('This controller segment already exists on the destination canvas.');
  const existing = findServerFeature(before, source.data.features || []);
  if (existing) await axios.delete(`${sourceUrl}/features/${existing.id}`, { timeout: 5000 });
  try {
    await axios.post(`${targetUrl}/features`, featurePayload(after), { timeout: 5000 });
  } catch (err) {
    if (existing) {
      try { await axios.post(`${sourceUrl}/features`, featurePayload(existing), { timeout: 5000 }); }
      catch (restoreError) { console.error('Could not restore moved feature:', restoreError); }
    }
    throw err;
  }
}
