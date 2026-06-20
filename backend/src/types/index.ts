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
    token: string; // Random secure token
  };
}

export interface SportsScoreTrigger extends BaseTrigger {
  type: 'sports_score';
  properties: {
    sport: string; // e.g., 'football', 'hockey'
    league: string; // e.g., 'nfl', 'nhl'
    team: string; // e.g., 'Green Bay Packers', 'Chicago Blackhawks'
    pollIntervalSeconds?: number;
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
      type: string; // e.g., '15ColorWaveEffect', '13PaletteEffect'
      name: string;
      [key: string]: any; // parameters like speed, palette, density
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
}

export interface LEDFeatureConfig {
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
  clientBufferCount: number;
}

export interface LEDCanvasConfig {
  id: number;
  name: string;
  width: number;
  height: number;
  features: LEDFeatureConfig[];
  unconfigured?: boolean;
}

export interface Manifest {
  version: string;
  settings: SystemSettings;
  flows: Flow[];
  canvases?: LEDCanvasConfig[];
}
