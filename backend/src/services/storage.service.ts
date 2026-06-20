import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Manifest, Flow, SystemSettings, LEDCanvasConfig } from '../types';

export class StorageService {
  private manifestPath: string;
  private manifestCache: Manifest | null = null;

  constructor() {
    // Determine manifest path (default to /data/manifest.yaml in container, or local manifest.yaml in dev)
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../');
    this.manifestPath = path.join(dataDir, 'manifest.yaml');
    
    // Ensure parent directory exists
    const dir = path.dirname(this.manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.loadManifest();
  }

  private getNDSCPPDefaults(): { hostname: string; port: number } {
    return {
      hostname: process.env.NDSCPP_HOST || '192.168.1.100',
      port: parseInt(process.env.NDSCPP_PORT || '7777', 10)
    };
  }

  private loadManifest(): Manifest {
    if (this.manifestCache) {
      return this.manifestCache;
    }

    if (!fs.existsSync(this.manifestPath)) {
      // Create default manifest
      const defaults = this.getNDSCPPDefaults();
      const defaultManifest: Manifest = {
        version: 'v1',
        settings: {
          ndscppHostname: defaults.hostname,
          ndscppPort: defaults.port,
          timezone: ''
        },
        flows: [],
        canvases: []
      };
      this.saveManifestDirect(defaultManifest);
      this.manifestCache = defaultManifest;
      return defaultManifest;
    }

    try {
      const fileContent = fs.readFileSync(this.manifestPath, 'utf8');
      const doc = yaml.load(fileContent) as any;
      
      // Ensure defaults if fields are missing
      const defaults = this.getNDSCPPDefaults();
      const manifest: Manifest = {
        version: doc.version || 'v1',
        settings: {
          ndscppHostname: doc.settings?.ndscppHostname || defaults.hostname,
          ndscppPort: doc.settings?.ndscppPort || defaults.port,
          timezone: doc.settings?.timezone || ''
        },
        flows: Array.isArray(doc.flows) ? doc.flows : [],
        canvases: Array.isArray(doc.canvases) ? doc.canvases : []
      };
      
      this.manifestCache = manifest;
      return manifest;
    } catch (error) {
      console.error('Failed to parse manifest YAML, reverting to default:', error);
      const defaults = this.getNDSCPPDefaults();
      const defaultManifest: Manifest = {
        version: 'v1',
        settings: {
          ndscppHostname: defaults.hostname,
          ndscppPort: defaults.port,
          timezone: ''
        },
        flows: [],
        canvases: []
      };
      return defaultManifest;
    }
  }

  private saveManifestDirect(manifest: Manifest): void {
    try {
      const yamlStr = yaml.dump(manifest, { noRefs: true, lineWidth: 120 });
      fs.writeFileSync(this.manifestPath, yamlStr, 'utf8');
      this.manifestCache = manifest;
    } catch (error) {
      console.error('Failed to write manifest YAML:', error);
      throw new Error('Failed to save configuration');
    }
  }

  public getManifest(): Manifest {
    return this.loadManifest();
  }

  public getSettings(): SystemSettings {
    return this.loadManifest().settings;
  }

  public updateSettings(settings: Partial<SystemSettings>): SystemSettings {
    const manifest = this.loadManifest();
    manifest.settings = {
      ...manifest.settings,
      ...settings
    };
    this.saveManifestDirect(manifest);
    return manifest.settings;
  }

  public getFlows(): Flow[] {
    return this.loadManifest().flows;
  }

  public getFlow(id: string): Flow | undefined {
    return this.getFlows().find(f => f.id === id);
  }

  public saveFlow(flow: Flow): void {
    const manifest = this.loadManifest();
    const index = manifest.flows.findIndex(f => f.id === flow.id);
    
    if (index >= 0) {
      manifest.flows[index] = flow;
    } else {
      manifest.flows.push(flow);
    }
    
    this.saveManifestDirect(manifest);
  }

  public deleteFlow(id: string): boolean {
    const manifest = this.loadManifest();
    const initialLength = manifest.flows.length;
    manifest.flows = manifest.flows.filter(f => f.id !== id);
    
    if (manifest.flows.length !== initialLength) {
      this.saveManifestDirect(manifest);
      return true;
    }
    return false;
  }

  public getCanvases(): LEDCanvasConfig[] {
    return this.loadManifest().canvases || [];
  }

  public getCanvas(id: number): LEDCanvasConfig | undefined {
    return this.getCanvases().find(c => c.id === id);
  }

  public saveCanvas(canvas: LEDCanvasConfig): void {
    const manifest = this.loadManifest();
    if (!manifest.canvases) {
      manifest.canvases = [];
    }
    const index = manifest.canvases.findIndex(c => c.id === canvas.id);
    
    if (index >= 0) {
      manifest.canvases[index] = canvas;
    } else {
      manifest.canvases.push(canvas);
    }
    
    this.saveManifestDirect(manifest);
  }

  public deleteCanvas(id: number): boolean {
    const manifest = this.loadManifest();
    if (!manifest.canvases) return false;
    const initialLength = manifest.canvases.length;
    manifest.canvases = manifest.canvases.filter(c => c.id !== id);
    
    if (manifest.canvases.length !== initialLength) {
      this.saveManifestDirect(manifest);
      return true;
    }
    return false;
  }

  public reconcileCanvasId(oldId: number, newId: number): void {
    const manifest = this.loadManifest();
    
    // 1. Update canvas ID in canvases list
    if (manifest.canvases) {
      const canvas = manifest.canvases.find(c => c.id === oldId);
      if (canvas) {
        canvas.id = newId;
        console.log(`[Storage] Reconciled canvas ID locally: ${oldId} -> ${newId}`);
      }
    }

    // 2. Update canvas ID in all flow actions
    for (const flow of manifest.flows) {
      if (flow.actions) {
        for (const action of flow.actions) {
          if ((action.type === 'start_effect' || action.type === 'stop_effect') && (action.properties as any).canvasId === oldId) {
            (action.properties as any).canvasId = newId;
            console.log(`[Storage] Reconciled canvas ID in flow '${flow.name}' action '${action.id}': ${oldId} -> ${newId}`);
          }
        }
      }
      if (flow.endActions) {
        for (const action of flow.endActions) {
          if ((action.type === 'start_effect' || action.type === 'stop_effect') && (action.properties as any).canvasId === oldId) {
            (action.properties as any).canvasId = newId;
            console.log(`[Storage] Reconciled canvas ID in flow '${flow.name}' endAction '${action.id}': ${oldId} -> ${newId}`);
          }
        }
      }
    }

    this.saveManifestDirect(manifest);
  }
}

// Export a singleton instance
export const storageService = new StorageService();
