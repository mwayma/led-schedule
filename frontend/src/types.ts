export interface NDSCPPConfig {
  hostname: string;
  port: number;
}

export type TriggerType = 'time' | 'webhook' | 'sports_score';

export interface BaseTrigger {
  type: TriggerType;
}

export interface TimeTrigger extends BaseTrigger {
  type: 'time';
  properties: {
    cron: string;
    startDate?: string; // "MM-DD"
    endDate?: string;   // "MM-DD"
    startTime?: string; // "HH:MM"
    endTime?: string;   // "HH:MM"
    daysOfWeek?: number[]; // [0-6]
  };
}

export interface WebhookTrigger extends BaseTrigger {
  type: 'webhook';
  properties: {
    token: string;
  };
}

export interface SportsScoreTrigger extends BaseTrigger {
  type: 'sports_score';
  properties: {
    sport: string;
    league: string;
    team: string;
    pollIntervalSeconds?: number;
    scheduleMode?: 'auto' | 'manual';
    manualSchedule?: string[];
  };
}

export type Trigger = TimeTrigger | WebhookTrigger | SportsScoreTrigger;

export type ActionType = 'start_effect' | 'stop_effect' | 'delay' | 'call_api';

export interface BaseAction {
  id: string;
  type: ActionType;
}

export interface StartEffectAction extends BaseAction {
  type: 'start_effect';
  properties: {
    canvasId: number;
    effect: {
      type: string; // e.g., '15ColorWaveEffect', '13PaletteEffect', '18BouncingBallEffect'
      name: string;
      [key: string]: any;
    };
  };
}

export interface StopEffectAction extends BaseAction {
  type: 'stop_effect';
  properties: {
    canvasId: number;
  };
}

export interface DelayAction extends BaseAction {
  type: 'delay';
  properties: {
    durationSeconds: number;
  };
}

export interface CallApiAction extends BaseAction {
  type: 'call_api';
  properties: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
  };
}

export type Action = StartEffectAction | StopEffectAction | DelayAction | CallApiAction;

export interface Flow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  actions: Action[];
  endActions?: Action[];
}

export interface SystemSettings {
  ndscppHostname: string;
  ndscppPort: number;
  timezone?: string;
}

// C++ Server models
export interface LEDFeature {
  id: number;
  friendlyName: string;
  hostName: string;
  port: number;
  channel: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  redGreenSwap: boolean;
  reversed: boolean;
  isConnected?: boolean;
  lastClientResponse?: {
    brightness: number;
    bufferPos: number;
    bufferSize: number;
    currentClock: number;
    flashVersion: number;
    fpsDrawing: number;
    newestPacket: number;
    oldestPacket: number;
    responseSize: number;
    sequenceNumber: number;
    watts: number;
    wifiSignal: number;
  };
}

export interface LEDCanvas {
  id: number;
  name: string;
  width: number;
  height: number;
  fps?: number;
  currentEffectName?: string;
  features: LEDFeature[];
  unconfigured?: boolean;
  effectsManager?: {
    fps: number;
    running: boolean;
    currentEffectIndex: number;
    effects: Array<{
      type: string;
      name: string;
      [key: string]: any;
    }>;
  };
}
