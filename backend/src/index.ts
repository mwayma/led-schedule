import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import path from 'path';
import { storageService } from './services/storage.service';
import { orchestratorService } from './services/orchestrator.service';
import { authMiddleware, AuthenticatedRequest, COOKIE_NAME, JWT_SECRET } from './middleware/auth';
import { Flow, LEDCanvasConfig, LEDFeatureConfig } from './types';

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: true, // Allow frontend request
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Password handling configuration
const getAdminVerifier = (): ((password: string) => boolean) => {
  const envHash = process.env.ADMIN_PASSWORD_HASH;
  const envPlain = process.env.ADMIN_PASSWORD;

  if (envHash) {
    console.log('Admin password security: Using ADMIN_PASSWORD_HASH from environment.');
    return (password: string) => bcrypt.compareSync(password, envHash);
  } else if (envPlain) {
    console.log('Admin password security: Using ADMIN_PASSWORD plain-text from environment.');
    let decodedPlain = envPlain;
    try {
      // Decode if it looks like a valid base64-encoded string
      if (/^[A-Za-z0-9+/=]+$/.test(envPlain) && envPlain.length % 4 === 0) {
        const decoded = Buffer.from(envPlain, 'base64').toString('utf8');
        // Sanity check to ensure decoded value is printable ASCII/whitespace
        if (/^[\x20-\x7E\s]*$/.test(decoded)) {
          decodedPlain = decoded;
        }
      }
    } catch (e) {}
    return (password: string) => password === envPlain || password === decodedPlain;
  } else {
    console.warn('================================================================');
    console.warn('[WARNING] No ADMIN_PASSWORD or ADMIN_PASSWORD_HASH environment');
    console.warn('variable specified. Defaulting to insecure password "admin".');
    console.warn('Please secure this before running in production!');
    console.warn('================================================================');
    const defaultHash = bcrypt.hashSync('admin', 10);
    return (password: string) => bcrypt.compareSync(password, defaultHash);
  }
};

const verifyPassword = getAdminVerifier();

// ==========================================
// Authentication Endpoints
// ==========================================

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (verifyPassword(password)) {
    // Issue JWT cookie
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.json({ success: true, message: 'Logged in successfully' });
  }

  return res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME);
  return res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/auth/status', (req: Request, res: Response) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    jwt.verify(token, JWT_SECRET);
    return res.json({ authenticated: true });
  } catch (err) {
    res.clearCookie(COOKIE_NAME);
    return res.json({ authenticated: false });
  }
});

// ==========================================
// Webhook Endpoint (Publicly Accessible)
// ==========================================

app.post('/api/v1/webhooks/trigger/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  
  if (!token) {
    return res.status(400).json({ error: 'Webhook token is required' });
  }

  const flows = storageService.getFlows();
  const flow = flows.find(f => 
    f.enabled && 
    f.trigger.type === 'webhook' && 
    f.trigger.properties.token === token
  );

  if (!flow) {
    return res.status(404).json({ error: 'Flow not found or webhook token is invalid' });
  }

  console.log(`Received public webhook trigger for flow: ${flow.name}`);
  // Run flow in background asynchronously so webhook request returns immediately
  orchestratorService.executeFlow(flow.id).catch(err => {
    console.error(`Error background executing flow ${flow.name} from webhook:`, err);
  });

  return res.json({ success: true, message: `Triggered flow: ${flow.name}` });
});

// ==========================================
// Settings Endpoints (Authenticated)
// ==========================================

app.get('/api/settings', authMiddleware, (req: Request, res: Response) => {
  const settings = storageService.getSettings();
  return res.json(settings);
});

app.post('/api/settings', authMiddleware, (req: Request, res: Response) => {
  const { ndscppHostname, ndscppPort } = req.body;

  if (!ndscppHostname || typeof ndscppPort !== 'number') {
    return res.status(400).json({ error: 'Invalid settings configuration' });
  }

  const newSettings = storageService.updateSettings({ ndscppHostname, ndscppPort });
  orchestratorService.reloadAllTriggers();
  
  return res.json({ success: true, settings: newSettings });
});

// ==========================================
// Flows Endpoints (Authenticated)
// ==========================================

app.get('/api/flows', authMiddleware, (req: Request, res: Response) => {
  const flows = storageService.getFlows();
  return res.json(flows);
});

app.post('/api/flows', authMiddleware, (req: Request, res: Response) => {
  const flow = req.body as Flow;

  if (!flow.id || !flow.name || !flow.trigger || !Array.isArray(flow.actions)) {
    return res.status(400).json({ error: 'Invalid flow object structure' });
  }

  storageService.saveFlow(flow);
  orchestratorService.reloadAllTriggers();

  return res.json({ success: true, flow });
});

app.delete('/api/flows/:id', authMiddleware, (req: Request, res: Response) => {
  const { id } = req.params;
  const success = storageService.deleteFlow(id);
  
  if (success) {
    orchestratorService.reloadAllTriggers();
    return res.json({ success: true, message: 'Flow deleted successfully' });
  }

  return res.status(404).json({ error: 'Flow not found' });
});

app.post('/api/flows/:id/run', authMiddleware, (req: Request, res: Response) => {
  const { id } = req.params;
  const flow = storageService.getFlow(id);

  if (!flow) {
    return res.status(404).json({ error: 'Flow not found' });
  }

  console.log(`Manual execution requested for flow: ${flow.name}`);
  orchestratorService.executeFlow(flow.id).catch(err => {
    console.error(`Error executing flow ${flow.name} manually:`, err);
  });

  return res.json({ success: true, message: `Manually started flow: ${flow.name}` });
});

// ==========================================
// NDSCPP Server Proxy Helper (Authenticated)
// ==========================================

const proxyNDSCPP = async (req: Request, res: Response, path: string, method: string = 'GET') => {
  const settings = storageService.getSettings();
  const url = `http://${settings.ndscppHostname}:${settings.ndscppPort}${path}`;

  try {
    const response = await axios({
      url,
      method,
      data: req.body,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    console.error(`Error proxying to C++ server (${url}):`, error.message);
    return res.status(502).json({ error: `Bad Gateway: Could not reach C++ server at ${url}` });
  }
};

// Helper function to sync local canvas layout configuration to the C++ server dynamically
const syncCanvasToServer = async (canvas: LEDCanvasConfig) => {
  const settings = storageService.getSettings();
  const baseUrl = `http://${settings.ndscppHostname}:${settings.ndscppPort}`;
  try {
    // Check if canvas exists on C++ server
    let serverCanvas: any = null;
    try {
      const getRes = await axios.get(`${baseUrl}/api/canvases/${canvas.id}`, { timeout: 2000 });
      serverCanvas = getRes.data;
    } catch (getErr: any) {
      if (getErr.response?.status !== 404) {
        throw getErr;
      }
    }

    const localFps = canvas.fps || 30;
    const serverFps = serverCanvas?.effectsManager?.fps || 30;

    if (!serverCanvas || 
        serverCanvas.name !== canvas.name || 
        serverCanvas.width !== canvas.width || 
        serverCanvas.height !== canvas.height ||
        serverFps !== localFps) {
      
      if (serverCanvas) {
        console.log(`[Sync] Canvas ${canvas.id} properties changed (Name: ${serverCanvas.name} -> ${canvas.name}, Width: ${serverCanvas.width} -> ${canvas.width}, Height: ${serverCanvas.height} -> ${canvas.height}, FPS: ${serverFps} -> ${localFps}). Deleting and recreating on C++ server.`);
        try {
          await axios.delete(`${baseUrl}/api/canvases/${canvas.id}`, { timeout: 2000 });
        } catch (delErr: any) {
          console.warn(`[Sync] Failed to delete canvas ${canvas.id} before recreate:`, delErr.message);
        }
      }

      // Recreate canvas on C++ server
      const postCanvasPayload = {
        id: canvas.id,
        name: canvas.name,
        width: canvas.width,
        height: canvas.height,
        effectsManager: {
          fps: localFps
        }
      };
      await axios.post(`${baseUrl}/api/canvases`, postCanvasPayload, { timeout: 2000 });

      // Add all features back since they were deleted
      if (canvas.features) {
        for (const feat of canvas.features) {
          await axios.post(`${baseUrl}/api/canvases/${canvas.id}/features`, feat, { timeout: 2000 });
        }
      }
    } else {
      // Just ensure any missing features are present
      const serverFeatures = serverCanvas.features || [];
      if (canvas.features) {
        for (const feat of canvas.features) {
          const exists = serverFeatures.some((sf: any) => sf.friendlyName === feat.friendlyName || sf.hostName === feat.hostName);
          if (!exists) {
            await axios.post(`${baseUrl}/api/canvases/${canvas.id}/features`, feat, { timeout: 2000 });
          }
        }
      }
    }

    console.log(`[Sync] Successfully synced canvas layout for ID ${canvas.id} (${canvas.name}) to C++ server`);
  } catch (err: any) {
    console.error(`[Sync] Failed to sync canvas layout for ID ${canvas.id} to C++ server:`, err.message);
  }
};

// ==========================================
// Decoupled Canvas Layout Config Endpoints (Authenticated)
// ==========================================

app.get('/api/config/canvases', authMiddleware, async (req: Request, res: Response) => {
  const localCanvases = storageService.getCanvases();
  const settings = storageService.getSettings();
  const baseUrl = `http://${settings.ndscppHostname}:${settings.ndscppPort}`;

  try {
    const response = await axios.get(`${baseUrl}/api/canvases`, { timeout: 2000 });
    const serverCanvases = response.data;

    const merged = localCanvases.map(local => {
      const server = serverCanvases.find((c: any) => c.id === local.id);
      if (server) {
        return {
          ...local,
          currentEffectName: server.currentEffectName,
          effectsManager: server.effectsManager,
          features: local.features.map(localFeat => {
            const serverFeat = server.features?.find((sf: any) => sf.friendlyName === localFeat.friendlyName || sf.hostName === localFeat.hostName);
            return {
              ...localFeat,
              id: serverFeat?.id ?? localFeat.id,
              isConnected: serverFeat?.isConnected,
              lastClientResponse: serverFeat?.lastClientResponse
            };
          })
        };
      } else {
        // Sync in background
        syncCanvasToServer(local).catch(() => {});
        return {
          ...local,
          currentEffectName: undefined,
          features: local.features.map(f => ({ ...f, isConnected: false }))
        };
      }
    });

    // Merge unconfigured server canvases
    const localIds = new Set(localCanvases.map(c => c.id));
    const unconfiguredServerCanvases = serverCanvases.filter((c: any) => !localIds.has(c.id));

    for (const server of unconfiguredServerCanvases) {
      merged.push({
        id: server.id,
        name: server.name || `Server Canvas ${server.id}`,
        width: server.width || 144,
        height: server.height || 1,
        currentEffectName: server.currentEffectName,
        effectsManager: server.effectsManager,
        unconfigured: true,
        features: (server.features || []).map((sf: any) => ({
          id: sf.id,
          friendlyName: sf.friendlyName || `Feature ${sf.id}`,
          hostName: sf.hostName || '',
          port: sf.port || 49152,
          width: sf.width || 144,
          height: sf.height || 1,
          offsetX: sf.offsetX || 0,
          offsetY: sf.offsetY || 0,
          reversed: sf.reversed || false,
          channel: sf.channel || 0,
          redGreenSwap: sf.redGreenSwap || false,
          clientBufferCount: sf.clientBufferCount || 8,
          isConnected: sf.isConnected,
          lastClientResponse: sf.lastClientResponse
        }))
      });
    }

    res.setHeader('X-Server-Connected', 'true');
    return res.json(merged);
  } catch (error) {
    // Server offline, return offline local config
    const offlineData = localCanvases.map(local => ({
      ...local,
      features: local.features.map(f => ({ ...f, isConnected: false }))
    }));
    res.setHeader('X-Server-Connected', 'false');
    return res.json(offlineData);
  }
});

app.post('/api/config/canvases', authMiddleware, async (req: Request, res: Response) => {
  const { id, name, width, height, fps, features } = req.body;
  if (typeof id !== 'number' || !name || typeof width !== 'number' || typeof height !== 'number') {
    return res.status(400).json({ error: 'Invalid canvas target fields' });
  }

  const canvas: LEDCanvasConfig = {
    id,
    name,
    width,
    height,
    fps: typeof fps === 'number' ? fps : undefined,
    features: Array.isArray(features) ? features : []
  };

  storageService.saveCanvas(canvas);
  
  // Try to sync to C++ server
  syncCanvasToServer(canvas).catch(() => {});

  return res.json({ success: true, canvas });
});

app.delete('/api/config/canvases/:id', authMiddleware, async (req: Request, res: Response) => {
  const canvasId = parseInt(req.params.id, 10);
  if (isNaN(canvasId)) {
    return res.status(400).json({ error: 'Invalid Canvas ID' });
  }

  const deletedLocally = storageService.deleteCanvas(canvasId);

  // Attempt to delete on C++ server
  const settings = storageService.getSettings();
  const baseUrl = `http://${settings.ndscppHostname}:${settings.ndscppPort}`;
  try {
    await axios.delete(`${baseUrl}/api/canvases/${canvasId}`, { timeout: 2000 });
  } catch (err: any) {
    console.warn(`Failed to delete canvas ${canvasId} from C++ server during delete config:`, err.message);
  }

  return res.json({ success: true });
});

app.put('/api/config/canvases/:id', authMiddleware, async (req: Request, res: Response) => {
  const canvasId = parseInt(req.params.id, 10);
  if (isNaN(canvasId)) {
    return res.status(400).json({ error: 'Invalid Canvas ID' });
  }

  const canvas = storageService.getCanvas(canvasId);
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found locally' });
  }

  const { name, width, height, fps } = req.body;
  
  if (name !== undefined) canvas.name = name;
  if (width !== undefined) canvas.width = width;
  if (height !== undefined) canvas.height = height;
  if (fps !== undefined) canvas.fps = fps;

  storageService.saveCanvas(canvas);

  // Try to sync to C++ server
  syncCanvasToServer(canvas).catch(() => {});

  return res.json({ success: true, canvas });
});


app.post('/api/config/canvases/:id/features', authMiddleware, async (req: Request, res: Response) => {
  const canvasId = parseInt(req.params.id, 10);
  if (isNaN(canvasId)) {
    return res.status(400).json({ error: 'Invalid Canvas ID' });
  }

  const canvas = storageService.getCanvas(canvasId);
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found locally' });
  }

  const { friendlyName, hostName, port, channel, width, height, offsetX, offsetY, redGreenSwap, reversed, clientBufferCount } = req.body;

  const nextFeatId = canvas.features.length > 0 ? Math.max(...canvas.features.map(f => f.id)) + 1 : 0;

  const feature: LEDFeatureConfig = {
    id: nextFeatId,
    friendlyName,
    hostName,
    port: port || 49152,
    channel: channel || 0,
    width,
    height: height || 1,
    offsetX: offsetX || 0,
    offsetY: offsetY || 0,
    redGreenSwap: !!redGreenSwap,
    reversed: !!reversed,
    clientBufferCount: clientBufferCount || 8
  };

  canvas.features.push(feature);
  storageService.saveCanvas(canvas);

  // Try to sync to C++ server
  syncCanvasToServer(canvas).catch(() => {});

  return res.json({ success: true, feature });
});

app.delete('/api/config/canvases/:id/features/:fid', authMiddleware, async (req: Request, res: Response) => {
  const canvasId = parseInt(req.params.id, 10);
  const featureId = parseInt(req.params.fid, 10);

  if (isNaN(canvasId) || isNaN(featureId)) {
    return res.status(400).json({ error: 'Invalid Canvas or Feature ID' });
  }

  const canvas = storageService.getCanvas(canvasId);
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found locally' });
  }

  const initialLength = canvas.features.length;
  canvas.features = canvas.features.filter(f => f.id !== featureId);

  if (canvas.features.length === initialLength) {
    return res.status(404).json({ error: 'Feature not found locally' });
  }

  storageService.saveCanvas(canvas);

  // Try to delete from C++ server
  const settings = storageService.getSettings();
  const baseUrl = `http://${settings.ndscppHostname}:${settings.ndscppPort}`;
  try {
    await axios.delete(`${baseUrl}/api/canvases/${canvasId}/features/${featureId}`, { timeout: 2000 });
  } catch (err: any) {
    console.warn(`Failed to delete feature ${featureId} from canvas ${canvasId} on C++ server:`, err.message);
  }

  return res.json({ success: true });
});

app.put('/api/config/canvases/:id/features/:fid', authMiddleware, async (req: Request, res: Response) => {
  const canvasId = parseInt(req.params.id, 10);
  const featureId = parseInt(req.params.fid, 10);

  if (isNaN(canvasId) || isNaN(featureId)) {
    return res.status(400).json({ error: 'Invalid Canvas or Feature ID' });
  }

  const canvas = storageService.getCanvas(canvasId);
  if (!canvas) {
    return res.status(404).json({ error: 'Canvas not found locally' });
  }

  const featureIndex = canvas.features.findIndex(f => f.id === featureId);
  if (featureIndex === -1) {
    return res.status(404).json({ error: 'Feature not found locally' });
  }

  const { friendlyName, hostName, port, channel, width, height, offsetX, offsetY, redGreenSwap, reversed, clientBufferCount } = req.body;

  if (friendlyName !== undefined) canvas.features[featureIndex].friendlyName = friendlyName;
  if (hostName !== undefined) canvas.features[featureIndex].hostName = hostName;
  if (port !== undefined) canvas.features[featureIndex].port = port;
  if (channel !== undefined) canvas.features[featureIndex].channel = channel;
  if (width !== undefined) canvas.features[featureIndex].width = width;
  if (height !== undefined) canvas.features[featureIndex].height = height;
  if (offsetX !== undefined) canvas.features[featureIndex].offsetX = offsetX;
  if (offsetY !== undefined) canvas.features[featureIndex].offsetY = offsetY;
  if (redGreenSwap !== undefined) canvas.features[featureIndex].redGreenSwap = !!redGreenSwap;
  if (reversed !== undefined) canvas.features[featureIndex].reversed = !!reversed;
  if (clientBufferCount !== undefined) canvas.features[featureIndex].clientBufferCount = clientBufferCount;

  storageService.saveCanvas(canvas);

  // Try to sync to C++ server
  syncCanvasToServer(canvas).catch(() => {});

  return res.json({ success: true, feature: canvas.features[featureIndex] });
});


// Proxy Routes
app.get('/api/canvases', authMiddleware, (req, res) => proxyNDSCPP(req, res, '/api/canvases', 'GET'));
app.post('/api/canvases', authMiddleware, (req, res) => proxyNDSCPP(req, res, '/api/canvases', 'POST'));
app.get('/api/canvases/:id', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/canvases/${req.params.id}`, 'GET'));
app.delete('/api/canvases/:id', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/canvases/${req.params.id}`, 'DELETE'));
app.post('/api/canvases/start', authMiddleware, (req, res) => proxyNDSCPP(req, res, '/api/canvases/start', 'POST'));
app.post('/api/canvases/stop', authMiddleware, (req, res) => proxyNDSCPP(req, res, '/api/canvases/stop', 'POST'));

app.post('/api/canvases/:id/features', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/canvases/${req.params.id}/features`, 'POST'));
app.delete('/api/canvases/:id/features/:fid', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/canvases/${req.params.id}/features/${req.params.fid}`, 'DELETE'));

app.post('/api/canvases/:id/effects', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/canvases/${req.params.id}/effects`, 'POST'));
app.put('/api/canvases/:id/effects', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/canvases/${req.params.id}/effects`, 'PUT'));
app.post('/api/canvases/:id/features/:fid/reversed', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/canvases/${req.params.id}/features/${req.params.fid}/reversed`, 'POST'));

app.get('/api/sockets', authMiddleware, (req, res) => proxyNDSCPP(req, res, '/api/sockets', 'GET'));
app.get('/api/sockets/:id', authMiddleware, (req, res) => proxyNDSCPP(req, res, `/api/sockets/${req.params.id}`, 'GET'));
app.get('/api/controller', authMiddleware, (req, res) => proxyNDSCPP(req, res, '/api/controller', 'GET'));

// Serve frontend static files in production
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Catch-all to serve index.html for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  orchestratorService.init();
});
