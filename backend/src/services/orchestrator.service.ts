import axios from 'axios';
import * as cron from 'node-cron';
import { storageService } from './storage.service';
import { scoreboardService } from './scoreboard.service';
import { Flow, Action, StartEffectAction, CallApiAction, TimeTrigger } from '../types';
import { normalizeEffect } from './effect-config';

export class OrchestratorService {
  private cronTasks: Map<string, cron.ScheduledTask> = new Map();
  private activeExecutions: Map<string, AbortController> = new Map(); // Prevent re-entry or cancel existing execution for same flow
  private minuteTicker: cron.ScheduledTask | null = null;
  private previewUntil = new Map<number, number>();
  private stoppingCanvases = new Set<number>();
  private startingCanvases = new Set<number>();
  private sportsOwners = new Map<number, AbortController>();
  private activeCanvasActions = new Map<number, StartEffectAction>();

  public async previewEffect(canvasId: number, effect: StartEffectAction['properties']['effect']): Promise<void> {
    await this.handleStartEffect({ id: 'live-preview', type: 'start_effect', properties: { canvasId, effect } });
    this.previewUntil.set(canvasId, Date.now() + 5 * 60 * 1000);
  }

  constructor() {}

  public init(): void {
    console.log('Initializing Orchestrator Service...');
    this.reloadAllTriggers();
    this.startMinuteTicker();
    this.checkTimeTriggerTick().catch(err => console.error('Initial layout restoration failed:', err));
  }

  public reloadAllTriggers(): void {
    // Clean up existing cron schedules
    for (const [flowId, task] of this.cronTasks.entries()) {
      task.stop();
      this.cronTasks.delete(flowId);
    }

    // Update sports registrations without discarding per-game score checkpoints.
    scoreboardService.syncFlows(storageService.getFlows(), flow => { void this.executeFlow(flow.id); });

    // Load flows from storage
    const flows = storageService.getFlows();
    for (const [flowId, controller] of this.activeExecutions) {
      if (!flows.some(flow => flow.id === flowId && flow.enabled)) controller.abort();
    }
    for (const flow of flows) {
      if (!flow.enabled) {
        continue;
      }

      const trigger = flow.trigger;
      if (trigger.type === 'time') {
        const timeTrigger = trigger as TimeTrigger;
        
        // Only register node-cron if startTime is NOT defined (legacy cron pattern mode)
        if (!timeTrigger.properties.startTime && timeTrigger.properties.cron) {
          try {
            const task = cron.schedule(timeTrigger.properties.cron, () => {
              console.log(`Legacy time trigger fired for flow: ${flow.name} (${flow.id})`);
              this.executeFlow(flow.id);
            });
            this.cronTasks.set(flow.id, task);
            console.log(`Scheduled legacy cron trigger for flow '${flow.name}' with cron: ${timeTrigger.properties.cron}`);
          } catch (err) {
            console.error(`Invalid cron pattern for flow '${flow.name}':`, err);
          }
        } else if (timeTrigger.properties.startTime) {
          console.log(`Scheduled granular time range trigger for flow '${flow.name}' from ${timeTrigger.properties.startTime} to ${timeTrigger.properties.endTime || 'No end time'}`);
        }
      } else if (trigger.type === 'sports_score') {
        // Sports registrations are synchronized above without clearing score checkpoints.
      } else if (trigger.type === 'webhook') {
        console.log(`Webhook trigger active for flow '${flow.name}' (Token: ${trigger.properties.token})`);
      }
    }
  }

  public async executeFlow(flowId: string): Promise<void> {
    if (this.activeExecutions.has(flowId)) {
      console.log(`Flow ${flowId} is already running. Cancelling previous execution to restart flow...`);
      const oldController = this.activeExecutions.get(flowId);
      oldController?.abort();
      this.activeExecutions.delete(flowId);
    }

    const flow = storageService.getFlow(flowId);
    if (!flow) {
      console.error(`Flow ${flowId} not found for execution.`);
      return;
    }

    if (!flow.enabled) {
      console.log(`Flow ${flow.name} is disabled. Skipping execution.`);
      return;
    }

    const controller = new AbortController();
    this.activeExecutions.set(flowId, controller);
    console.log(`Starting execution of flow: ${flow.name}`);

    const sports = flow.trigger.type === 'sports_score';
    const targets = sports ? [...new Set(flow.actions.filter(a => a.type === 'start_effect').map(a => (a.properties as any).canvasId as number))] : [];
    for (const id of targets) { this.sportsOwners.get(id)?.abort(); this.sportsOwners.set(id, controller); }
    try {
      const repeating = flow.repeatUntilEnd && flow.trigger.type === 'time' &&
        flow.trigger.properties.startTime && flow.trigger.properties.endTime;
      if (repeating && !flow.actions.some(action => action.type === 'delay' && action.properties.durationSeconds > 0)) {
        throw new Error('Repeating flows require a positive delay between cycles.');
      }
      do {
        await this.runActions(flow.actions, controller.signal, sports ? controller : undefined);
      } while (repeating && !controller.signal.aborted);
      console.log(`Successfully completed execution of flow: ${flow.name}`);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Aborted') {
        console.log(`Flow ${flow.name} execution was aborted.`);
      } else {
        console.error(`Error executing flow ${flow.name}:`, err.message || err);
      }
    } finally {
      for (const id of targets) {
        if (this.sportsOwners.get(id) !== controller) continue;
        this.sportsOwners.delete(id);
        const scheduled = storageService.getFlows().some(f => f.enabled && f.trigger.type === 'time' && this.activeExecutions.has(f.id) && f.actions.some(a => a.type === 'start_effect' && a.properties.canvasId === id));
        const held = this.activeCanvasActions.get(id);
        if (scheduled && held) await this.handleStartEffect(held);
        else { await this.handleStopEffect(id); await this.checkTimeTriggerTick(); }
      }
      if (this.activeExecutions.get(flowId) === controller) {
        this.activeExecutions.delete(flowId);
      }
    }
  }

  private async runActions(actions: Action[], signal: AbortSignal, sportsOwner?: AbortController): Promise<void> {
    for (const action of actions) {
      if (signal.aborted) {
        throw new Error('Aborted');
      }

      console.log(`Executing action: ${action.id} (${action.type})`);
      
      switch (action.type) {
        case 'start_effect':
          if (!sportsOwner) this.activeCanvasActions.set(action.properties.canvasId, action as StartEffectAction);
          if (this.sportsOwners.has(action.properties.canvasId) && this.sportsOwners.get(action.properties.canvasId) !== sportsOwner) break;
          await this.handleStartEffect(action as StartEffectAction);
          break;
        case 'stop_effect':
          if (this.sportsOwners.has(action.properties.canvasId) && this.sportsOwners.get(action.properties.canvasId) !== sportsOwner) break;
          await this.handleStopEffect(action.properties.canvasId);
          break;
        case 'delay':
          const duration = action.properties.durationSeconds || 5;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              signal.removeEventListener('abort', onAbort);
              resolve();
            }, duration * 1000);

            const onAbort = () => {
              clearTimeout(timer);
              reject(new Error('Aborted'));
            };

            signal.addEventListener('abort', onAbort);
          });
          break;
        case 'call_api':
          await this.handleCallApi(action as CallApiAction);
          break;
        default:
          console.warn(`Unknown action type: ${(action as any).type}`);
      }
    }
  }

  private getNDSCPPUrl(): string {
    const settings = storageService.getSettings();
    return `http://${settings.ndscppHostname}:${settings.ndscppPort}`;
  }

  private async ensureCanvasOnServer(canvasId: number): Promise<number> {
    const baseUrl = this.getNDSCPPUrl();
    
    // 1. Fetch all canvases from C++ server
    let serverCanvases: any[] = [];
    try {
      const res = await axios.get(`${baseUrl}/api/canvases`, { timeout: 2000 });
      serverCanvases = res.data || [];
    } catch (err: any) {
      console.warn(`[Orchestrator] Failed to fetch canvases from C++ server: ${err.message}. Assuming server is offline or empty.`);
    }

    // 2. Check if a canvas with canvasId exists on the server
    const exactMatch = serverCanvases.find((c: any) => c.id === canvasId);
    if (exactMatch) {
      return canvasId; // Canvas exists, all good
    }

    // 3. Canvas not found by ID. Let's find local canvas config
    const localCanvas = storageService.getCanvas(canvasId);
    if (!localCanvas) {
      throw new Error(`Canvas ID ${canvasId} is not configured locally.`);
    }

    // 4. Try matching by name on C++ server
    const nameMatch = serverCanvases.find((c: any) => c.name === localCanvas.name);
    if (nameMatch) {
      const serverId = nameMatch.id;
      console.log(`[Orchestrator] Canvas '${localCanvas.name}' found on server with ID ${serverId} (expected ${canvasId}). Reconciling locally...`);
      storageService.reconcileCanvasId(canvasId, serverId);
      return serverId;
    }

    // 5. Not found by name either. Recreate canvas on C++ server
    console.log(`[Orchestrator] Canvas '${localCanvas.name}' (ID ${canvasId}) is missing on C++ server. Recreating...`);
    try {
      const createRes = await axios.post(`${baseUrl}/api/canvases`, {
        id: localCanvas.id,
        name: localCanvas.name,
        width: localCanvas.width,
        height: localCanvas.height,
        effectsManager: { fps: localCanvas.fps || 30 },
        features: localCanvas.features || []
      }, { timeout: 2000 });

      const newServerId = createRes.data.id;
      console.log(`[Orchestrator] Recreated canvas on server. New ID is ${newServerId}. Adding features...`);

      // Reconcile ID in storage and active configs
      if (canvasId !== newServerId) storageService.reconcileCanvasId(canvasId, newServerId);
      return newServerId;
    } catch (err: any) {
      const errMsg = err.response?.data ? (typeof err.response.data === 'object' ? JSON.stringify(err.response.data) : err.response.data) : err.message;
      console.error(`[Orchestrator] Failed to recreate canvas on server: ${errMsg}`);
      throw new Error(`Failed to recreate canvas on C++ server: ${errMsg}`);
    }
  }

  private async handleStartEffect(action: StartEffectAction): Promise<void> {
    const canvasId = action.properties.canvasId;
    this.startingCanvases.add(canvasId);
    try { await this.startEffectOnServer(action); }
    finally { this.startingCanvases.delete(canvasId); }
  }

  private async startEffectOnServer(action: StartEffectAction): Promise<void> {
    const baseUrl = this.getNDSCPPUrl();
    const originalCanvasId = action.properties.canvasId;
    const effect = normalizeEffect(action.properties.effect);

    // Ensure canvas exists and reconcile its ID
    const canvasId = await this.ensureCanvasOnServer(originalCanvasId);
    const localCanvas = storageService.getCanvas(originalCanvasId);

    try {
      // Try the in-memory PUT endpoint first to avoid socket reset
      try {
        const putUrl = `${baseUrl}/api/canvases/${canvasId}/effects`;
        // Start() returns early for an already-running manager. Stop first so
        // effects with initialization (e.g. Starfield) receive Start(canvas).
        await axios.post(`${baseUrl}/api/canvases/stop`, { canvasIds: [canvasId] }, { timeout: 5000 });
        await axios.put(putUrl, effect, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });

        // Explicitly start effects manager on this canvas
        const startUrl = `${baseUrl}/api/canvases/start`;
        await axios.post(startUrl, { canvasIds: [canvasId] }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000
        });

        console.log(`Successfully started effect '${effect.name}' on canvas ${canvasId} (in-memory update)`);
        return;
      } catch (putErr: any) {
        if (putErr.response?.status === 404 || putErr.response?.status === 405) {
          console.warn(`[Orchestrator] C++ server does not support in-memory PUT /effects. Falling back to delete/recreate canvas. Please update the C++ server!`);
        } else {
          throw putErr;
        }
      }

      // Fallback: Fetch, delete, recreate canvas
      // 1. Fetch current canvas config
      const getUrl = `${baseUrl}/api/canvases/${canvasId}`;
      const getRes = await axios.get(getUrl, { timeout: 5000 });
      const canvasConfig = getRes.data;

      if (!canvasConfig) {
        throw new Error(`Failed to fetch config for canvas ${canvasId}`);
      }

      // Check if the effect is already running with the same parameters to avoid recreation
      const effectsMgr = canvasConfig.effectsManager;
      const activeEffIdx = effectsMgr?.currentEffectIndex ?? -1;
      const activeEffect = effectsMgr?.effects && activeEffIdx >= 0 ? effectsMgr.effects[activeEffIdx] : null;
      if (activeEffect && effectsMgr?.running) {
        const keysToCompare = Object.keys(effect);
        const isMatch = keysToCompare.every(key => {
          if (key === 'palette') {
            return JSON.stringify(activeEffect.palette) === JSON.stringify(effect.palette);
          }
          return JSON.stringify(activeEffect[key]) === JSON.stringify(effect[key]);
        });
        if (isMatch) {
          // Only log occasionally to avoid spamming the console during reconciliation
          if (Math.random() < 0.05) {
            console.log(`[Orchestrator] Effect '${effect.name}' is already running on canvas ${canvasId} with same parameters. Skipping recreate.`);
          }
          return;
        }
      }

      // 2. Modify canvas config
      // Replace the effects manager configuration
      canvasConfig.effectsManager = {
        fps: localCanvas?.fps || canvasConfig.effectsManager?.fps || 30,
        running: true,
        currentEffectIndex: 0,
        effects: [
          {
            ...effect
          }
        ]
      };

      // 3. Delete current canvas
      const deleteUrl = `${baseUrl}/api/canvases/${canvasId}`;
      await axios.delete(deleteUrl, { timeout: 5000 });

      // 4. Create new canvas with updated effect list
      const postUrl = `${baseUrl}/api/canvases`;
      const postRes = await axios.post(postUrl, canvasConfig, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      const newCanvasId = postRes.data.id;

      // Update local storage and references in active flows
      storageService.reconcileCanvasId(canvasId, newCanvasId);

      // 5. Explicitly start effects manager on this canvas
      const startUrl = `${baseUrl}/api/canvases/start`;
      await axios.post(startUrl, { canvasIds: [newCanvasId] }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });

      console.log(`Successfully started effect '${effect.name}' on canvas ${newCanvasId} (fallback delete-recreate)`);
    } catch (err: any) {
      const errMsg = err.response?.data ? (typeof err.response.data === 'object' ? JSON.stringify(err.response.data) : err.response.data) : err.message;
      console.error(`Failed to start effect on canvas ${canvasId}: ${errMsg}`, err.message || err);
      throw err;
    }
  }

  private async handleStopEffect(originalCanvasId: number): Promise<void> {
    if (this.stoppingCanvases.has(originalCanvasId)) return;
    this.stoppingCanvases.add(originalCanvasId);
    const baseUrl = this.getNDSCPPUrl();
    try {
      const canvasId = await this.ensureCanvasOnServer(originalCanvasId);
      this.previewUntil.delete(originalCanvasId);
      this.activeCanvasActions.delete(originalCanvasId);
      // Stopping frames alone leaves ESP32s displaying their last frame.
      // Stream black long enough to drain the configured client buffers first.
      await this.handleStartEffect({ id: 'blackout', type: 'start_effect', properties: {
        canvasId, effect: { type: '14SolidColorFill', name: 'Lights Off', color: { r: 0, g: 0, b: 0 } }
      } });
      const localCanvas = storageService.getCanvas(canvasId);
      const bufferCount = Math.max(4, ...(localCanvas?.features || []).map(feature => feature.clientBufferCount || 4));
      const drainMs = Math.max(500, Math.min(5000, ((bufferCount + 3) / (localCanvas?.fps || 15)) * 1000));
      await new Promise(resolve => setTimeout(resolve, drainMs));
      const stopUrl = `${baseUrl}/api/canvases/stop`;
      await axios.post(stopUrl, { canvasIds: [canvasId] }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });
      console.log(`Successfully stopped effects on canvas ${canvasId}`);
    } catch (err: any) {
      console.error(`Failed to stop effect on canvas ${originalCanvasId}:`, err.message || err);
      throw err;
    } finally {
      this.stoppingCanvases.delete(originalCanvasId);
    }
  }

  private async handleCallApi(action: CallApiAction): Promise<void> {
    const { url, method, headers, body } = action.properties;
    try {
      await axios({
        url,
        method,
        headers: headers ? JSON.parse(JSON.stringify(headers)) : {},
        data: body ? (typeof body === 'string' ? JSON.parse(body) : body) : undefined,
        timeout: 5000
      });
      console.log(`Successfully executed API call to ${url}`);
    } catch (err: any) {
      console.error(`API call action failed to ${url}:`, err.message || err);
      throw err;
    }
  }

  private startMinuteTicker(): void {
    if (this.minuteTicker) return;
    this.minuteTicker = cron.schedule('* * * * *', () => {
      this.checkTimeTriggerTick().catch(err => console.error('Scheduler tick failed:', err));
    });
    console.log('Started granular minute ticker scheduler.');
  }

  private async checkTimeTriggerTick(): Promise<void> {
    const now = new Date();
    let localYear = now.getFullYear();
    let localHour: string;
    let localMinute: string;
    let currentDateStr: string;
    let currentDayOfWeek: number;

    const tz = storageService.getSettings().timezone;
    if (tz) {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hourCycle: 'h23'
        });
        const parts = formatter.formatToParts(now);
        localYear = Number(parts.find(p => p.type === 'year')?.value || localYear);
        
        const hour = parts.find(p => p.type === 'hour')?.value || '00';
        const minute = parts.find(p => p.type === 'minute')?.value || '00';
        const month = parts.find(p => p.type === 'month')?.value || '01';
        const day = parts.find(p => p.type === 'day')?.value || '01';
        
        localHour = hour.padStart(2, '0');
        localMinute = minute.padStart(2, '0');
        currentDateStr = `${month}-${day}`;
        
        const weekdayShort = now.toLocaleString('en-US', { timeZone: tz, weekday: 'short' });
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        currentDayOfWeek = days.indexOf(weekdayShort);
        if (currentDayOfWeek === -1) {
          currentDayOfWeek = now.getDay();
        }
      } catch (err) {
        console.error(`Invalid timezone configured: ${tz}. Falling back to server local time.`, err);
        localHour = now.getHours().toString().padStart(2, '0');
        localMinute = now.getMinutes().toString().padStart(2, '0');
        currentDateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
        currentDayOfWeek = now.getDay();
      }
    } else {
      localHour = now.getHours().toString().padStart(2, '0');
      localMinute = now.getMinutes().toString().padStart(2, '0');
      currentDateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
      currentDayOfWeek = now.getDay();
    }

    const currentTimeStr = `${localHour}:${localMinute}`;
    const [localMonth, localDay] = currentDateStr.split('-').map(Number);
    const previousDate = new Date(Date.UTC(localYear, localMonth - 1, localDay - 1));
    const previousDateStr = `${(previousDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${previousDate.getUTCDate().toString().padStart(2, '0')}`;
    const previousDayOfWeek = (currentDayOfWeek + 6) % 7;

    // NDSCPP may deliberately boot empty. Restore saved layout even outside an
    // active schedule and without a browser polling /api/config/canvases.
    for (const canvas of storageService.getCanvases()) {
      try { await this.ensureCanvasOnServer(canvas.id); }
      catch (err: any) { console.warn(`Could not restore canvas ${canvas.id}:`, err.message); }
    }

    const flows = storageService.getFlows();
    for (const flow of flows) {
      if (!flow.enabled || flow.trigger.type !== 'time') continue;

      const trigger = flow.trigger as TimeTrigger;
      const { startDate, endDate, startTime, endTime, daysOfWeek } = trigger.properties;

      // Only evaluate if startTime or endTime is defined
      if (!startTime && !endTime) continue;

      const eligible = (date: string, day: number) =>
        (!startDate || !endDate || this.isDateInRange(date, startDate, endDate)) &&
        (!daysOfWeek?.length || daysOfWeek.includes(day));
      const overnight = !!startTime && !!endTime && startTime > endTime;

      // 3. Start Time Check
      if (startTime && currentTimeStr === startTime && eligible(currentDateStr, currentDayOfWeek)) {
        console.log(`[Granular Scheduler] START Time reached for flow '${flow.name}' (${currentTimeStr}). Running actions...`);
        this.executeFlow(flow.id).catch(err => {
          console.error(`Error running start actions for flow '${flow.name}':`, err);
        });
      }

      // 4. End Time Check
      if (endTime && currentTimeStr === endTime && eligible(
        overnight ? previousDateStr : currentDateStr,
        overnight ? previousDayOfWeek : currentDayOfWeek
      )) {
        console.log(`[Granular Scheduler] END Time reached for flow '${flow.name}' (${currentTimeStr}). Running endActions...`);
        
        // Abort the active start execution if any!
        if (this.activeExecutions.has(flow.id)) {
          console.log(`[Granular Scheduler] Aborting active start execution for flow '${flow.name}' on end time.`);
          this.activeExecutions.get(flow.id)?.abort();
          this.activeExecutions.delete(flow.id);
        }

        if (flow.endActions && flow.endActions.length > 0) {
          const endAbortController = new AbortController();
          this.runActions(flow.endActions, endAbortController.signal).catch(err => {
            console.error(`Error running end actions for flow '${flow.name}':`, err);
          });
        } else {
          // Default to stopping canvas 0 or the first canvas if no endActions are specified
          const defaultCanvasId = (flow.actions[0]?.properties as any)?.canvasId ?? 2;
          console.log(`No endActions defined. Stopping default canvas ${defaultCanvasId}`);
          this.handleStopEffect(defaultCanvasId).catch(err => {
            console.error(`Error stopping default canvas on end time for flow '${flow.name}':`, err);
          });
        }
      }

      // 5. Enforce State (Reconciliation against configuration drift)
      // Done outside the loop once to prevent per-flow redundant fetches
    }

    // Closed-loop dynamic drift reconciliation for all canvases
    const baseUrl = this.getNDSCPPUrl();
    axios.get(`${baseUrl}/api/canvases`, { timeout: 2000 })
      .then(res => {
        const serverCanvases = res.data || [];
        const localCanvases = storageService.getCanvases();

        for (const canvas of localCanvases) {
          if (this.sportsOwners.has(canvas.id)) continue;
          // Explicit live tests temporarily override the date/time reconciler.
          if ((this.previewUntil.get(canvas.id) ?? 0) > Date.now()) continue;
          this.previewUntil.delete(canvas.id);
          // Find all enabled flows targeting this canvas
          const flowsTargetingCanvas = flows.filter(f => 
            f.enabled && 
            f.trigger.type === 'time' &&
            f.actions.some(act => act.type === 'start_effect' && (act.properties as any).canvasId === canvas.id)
          );

          let activeFlow: Flow | null = null;
          let activeStartAction: StartEffectAction | null = null;

          for (const flow of flowsTargetingCanvas) {
            const trigger = flow.trigger as TimeTrigger;
            const { startDate, endDate, startTime, endTime, daysOfWeek } = trigger.properties;

            let flowIsActiveRange = false;
            if (startTime && endTime) {
              const afterMidnight = startTime > endTime && currentTimeStr < endTime;
              const occurrenceDate = afterMidnight ? previousDateStr : currentDateStr;
              const occurrenceDay = afterMidnight ? previousDayOfWeek : currentDayOfWeek;
              const dateMatch = !startDate || !endDate || this.isDateInRange(occurrenceDate, startDate, endDate);
              const dayMatch = !daysOfWeek || daysOfWeek.length === 0 || daysOfWeek.includes(occurrenceDay);
              const timeMatch = this.isTimeInRange(currentTimeStr, startTime, endTime);
              flowIsActiveRange = dateMatch && dayMatch && timeMatch;
            } else {
              // Legacy cron flow: active if currently executing
              flowIsActiveRange = this.activeExecutions.has(flow.id);
            }

            if (flowIsActiveRange) {
              activeFlow = flow;
              activeStartAction = flow.actions.find(act => act.type === 'start_effect' && (act.properties as any).canvasId === canvas.id) as StartEffectAction;
              break; // Stop at first active flow targeting this canvas
            }
          }

          const serverCanvas = serverCanvases.find((c: any) => c.id === canvas.id);
          const isCurrentlyRunning = serverCanvas?.effectsManager?.running ?? false;

          if (activeStartAction) {
            if (this.startingCanvases.has(canvas.id) || this.stoppingCanvases.has(canvas.id)) continue;
            if (activeFlow && this.activeExecutions.has(activeFlow.id)) {
              if (!isCurrentlyRunning) {
                const currentAction = this.activeCanvasActions.get(canvas.id) || activeStartAction;
                this.handleStartEffect(currentAction).catch(err => console.error('Could not restore active scene after renderer reset:', err));
              }
              continue;
            }
            if (activeFlow?.repeatUntilEnd && !this.activeExecutions.has(activeFlow.id)) {
              this.executeFlow(activeFlow.id);
              continue;
            }
            // Desired state: RUNNING
            if (!isCurrentlyRunning) {
              console.log(`[Reconciliation] Canvas ${canvas.id} (${canvas.name}) should be RUNNING under flow '${activeFlow!.name}', but is stopped on server. Restoring effect...`);
              this.handleStartEffect(activeStartAction).catch(err => {
                console.error(`[Reconciliation] Failed to restore effect on canvas ${canvas.id}:`, err.message);
              });
            }
          } else {
            // Desired state: STOPPED
            if (isCurrentlyRunning) {
              console.log(`[Reconciliation] Canvas ${canvas.id} (${canvas.name}) should be STOPPED (no active schedule flows), but is running on server. Stopping effect...`);
              this.handleStopEffect(canvas.id).catch(err => {
                console.error(`[Reconciliation] Failed to stop effect on canvas ${canvas.id}:`, err.message);
              });
            }
          }
        }
      })
      .catch(err => {
        console.warn(`[Reconciliation] Failed to fetch server canvases for drift correction: ${err.message}`);
      });
  }

  private isDateInRange(currentDate: string, startDate: string, endDate: string): boolean {
    if (startDate <= endDate) {
      return currentDate >= startDate && currentDate <= endDate;
    } else {
      // Wraps year (e.g. Dec 15 to Jan 15 -> "12-15" to "01-15")
      return currentDate >= startDate || currentDate <= endDate;
    }
  }

  private isTimeInRange(currentTime: string, startTime: string, endTime: string): boolean {
    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime < endTime;
    } else {
      // Wraps over midnight (e.g. 20:00 to 02:00)
      return currentTime >= startTime || currentTime < endTime;
    }
  }
}

// Export singleton instance
export const orchestratorService = new OrchestratorService();

