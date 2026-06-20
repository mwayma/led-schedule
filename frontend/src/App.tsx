import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Trash2, 
  Plus, 
  Save, 
  Clock, 
  Webhook, 
  Trophy, 
  Settings, 
  Calendar, 
  LogOut, 
  Activity, 
  Wifi, 
  Cpu, 
  ArrowDown, 
  Copy, 
  Check, 
  Layers, 
  Circle,
  Eye,
  Sliders,
  Sparkles,
  Zap,
  Info,
  Pause,
  RefreshCw,
  Edit2
} from 'lucide-react';
import { CanvasPreview } from './components/CanvasPreview';
import type { Flow, Action, Trigger, LEDCanvas, SystemSettings, ActionType, TriggerType, StartEffectAction } from './types';

// API Base URL (assumes same host in dev/production proxy, but fallback to port 5000 in dev)
const API_BASE = '';

// Helper to get offset minutes for a timezone today
const getTzOffsetMinutes = (date: Date, tz: string) => {
  try {
    const tzStr = date.toLocaleString('en-US', { timeZone: tz, hour12: false });
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
    const tzDate = new Date(tzStr);
    const utcDate = new Date(utcStr);
    return Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
  } catch (e) {
    return -date.getTimezoneOffset(); // fallback to local browser offset
  }
};

// Convert a time string and optionally shift days of week
const convertTimeAndDays = (
  timeStr: string,
  daysOfWeek: number[] | undefined,
  fromTz: string,
  toTz: string
): { time: string; daysOfWeek?: number[] } => {
  if (!timeStr) return { time: '' };
  
  const fromTzClean = fromTz || 'UTC';
  const toTzClean = toTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  if (fromTzClean === toTzClean) {
    return { time: timeStr, daysOfWeek };
  }
  
  const [hours, minutes] = timeStr.split(':').map(Number);
  const now = new Date();
  
  const fromOffset = getTzOffsetMinutes(now, fromTzClean);
  const toOffset = getTzOffsetMinutes(now, toTzClean);
  const shiftMinutes = toOffset - fromOffset;
  
  let totalMinutes = hours * 60 + minutes + shiftMinutes;
  let dayShift = 0;
  
  if (totalMinutes >= 1440) {
    dayShift = 1;
  } else if (totalMinutes < 0) {
    dayShift = -1;
  }
  
  totalMinutes = (totalMinutes % 1440 + 1440) % 1440;
  const shiftedHours = Math.floor(totalMinutes / 60);
  const shiftedMinutes = totalMinutes % 60;
  
  const newTimeStr = `${shiftedHours.toString().padStart(2, '0')}:${shiftedMinutes.toString().padStart(2, '0')}`;
  
  if (daysOfWeek && daysOfWeek.length > 0 && dayShift !== 0) {
    const newDays = daysOfWeek.map(d => (d + dayShift + 7) % 7).sort();
    return { time: newTimeStr, daysOfWeek: newDays };
  }
  
  return { time: newTimeStr, daysOfWeek };
};

const prepareFlowForEdit = (flow: Flow, systemTz: string): Flow => {
  if (flow.trigger.type !== 'time') return flow;
  
  const triggerProps = flow.trigger.properties as any;
  if (triggerProps.startTime === undefined) return flow; // simple cron
  
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const systemTzClean = systemTz || 'UTC';
  
  const convertedStart = convertTimeAndDays(
    triggerProps.startTime,
    triggerProps.daysOfWeek,
    systemTzClean,
    browserTz
  );
  
  const convertedEnd = convertTimeAndDays(
    triggerProps.endTime,
    undefined,
    systemTzClean,
    browserTz
  );
  
  return {
    ...flow,
    trigger: {
      ...flow.trigger,
      properties: {
        ...triggerProps,
        startTime: convertedStart.time,
        endTime: convertedEnd.time,
        daysOfWeek: convertedStart.daysOfWeek || triggerProps.daysOfWeek
      }
    }
  };
};

const prepareFlowForSave = (flow: Flow, systemTz: string): Flow => {
  if (flow.trigger.type !== 'time') return flow;
  
  const triggerProps = flow.trigger.properties as any;
  if (triggerProps.startTime === undefined) return flow; // simple cron
  
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const systemTzClean = systemTz || 'UTC';
  
  // Convert browser timezone back to system timezone
  const convertedStart = convertTimeAndDays(
    triggerProps.startTime,
    triggerProps.daysOfWeek,
    browserTz,
    systemTzClean
  );
  
  const convertedEnd = convertTimeAndDays(
    triggerProps.endTime,
    undefined,
    browserTz,
    systemTzClean
  );
  
  return {
    ...flow,
    trigger: {
      ...flow.trigger,
      properties: {
        ...triggerProps,
        startTime: convertedStart.time,
        endTime: convertedEnd.time,
        daysOfWeek: convertedStart.daysOfWeek || triggerProps.daysOfWeek
      }
    }
  };
};

const getDisplayScheduleText = (flow: Flow, systemTz: string) => {
  if (flow.trigger.type !== 'time') return '';
  const triggerProps = flow.trigger.properties as any;
  const isGranular = triggerProps.startTime !== undefined;
  
  if (!isGranular) {
    return `Cron: ${triggerProps.cron}`;
  }
  
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const systemTzClean = systemTz || 'UTC';
  
  const convertedStart = convertTimeAndDays(
    triggerProps.startTime,
    triggerProps.daysOfWeek,
    systemTzClean,
    browserTz
  );
  
  const convertedEnd = convertTimeAndDays(
    triggerProps.endTime,
    undefined,
    systemTzClean,
    browserTz
  );
  
  const daysList = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNames = (convertedStart.daysOfWeek || [])
    .map(d => daysList[d])
    .join(', ');
    
  const dateRangeStr = triggerProps.startDate 
    ? ` (${triggerProps.startDate} to ${triggerProps.endDate})` 
    : '';
    
  let tzAbbrev = '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: browserTz }).formatToParts(new Date());
    tzAbbrev = ' ' + (parts.find(p => p.type === 'timeZoneName')?.value || '');
  } catch (e) {}

  return `${convertedStart.time} - ${convertedEnd.time}${tzAbbrev}${dayNames ? ` on [${dayNames}]` : ''}${dateRangeStr}`;
};

// Helper to parse standard cron expressions into visual UI selections
const parseCron = (cronStr: string) => {
  const parts = (cronStr || '0 18 * * *').split(' ');
  let timeType = 'cron';
  let hour = 18;
  let minute = 0;
  let days: number[] = [];
  let period = 15;

  if (parts.length === 5) {
    if (parts[0].startsWith('*/') && parts[1] === '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      timeType = 'minutes';
      period = parseInt(parts[0].replace('*/', ''), 10) || 15;
    } else if (parts[0] === '0' && parts[1].startsWith('*/') && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      timeType = 'hours';
      period = parseInt(parts[1].replace('*/', ''), 10) || 2;
    } else if (parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      timeType = 'daily';
      minute = parseInt(parts[0], 10) || 0;
      hour = parseInt(parts[1], 10) || 0;
    } else if (parts[2] === '*' && parts[3] === '*' && parts[4] !== '*') {
      timeType = 'weekly';
      minute = parseInt(parts[0], 10) || 0;
      hour = parseInt(parts[1], 10) || 0;
      days = parts[4].split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    }
  }
  return { timeType, hour, minute, days, period };
};

// Helper to build cron strings from visual UI selections
const buildCron = (type: string, hour: number, minute: number, days: number[], period: number, customVal: string) => {
  if (type === 'minutes') return `*/${period} * * * *`;
  if (type === 'hours') return `0 */${period} * * *`;
  if (type === 'daily') return `${minute} ${hour} * * *`;
  if (type === 'weekly') return `${minute} ${hour} * * ${days.length > 0 ? days.join(',') : '*'}`;
  return customVal;
};

// Helper to parse MM-DD
const parseMonthDay = (mdStr?: string) => {
  if (!mdStr) return { month: '12', day: '01' };
  const parts = mdStr.split('-');
  return { month: parts[0] || '12', day: parts[1] || '01' };
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const rgbToHex = (col: any): string => {
  if (!col) return '#000000';
  if (typeof col === 'string') {
    if (col.startsWith('#')) return col;
    return '#000000';
  }
  const r = Math.min(255, Math.max(0, typeof col.r === 'number' ? col.r : 0));
  const g = Math.min(255, Math.max(0, typeof col.g === 'number' ? col.g : 0));
  const b = Math.min(255, Math.max(0, typeof col.b === 'number' ? col.b : 0));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  if (!hex || typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
  const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
  const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
  return { r, g, b };
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Settings
  const [settings, setSettings] = useState<SystemSettings>({ ndscppHostname: '192.168.1.100', ndscppPort: 7777 });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsHost, setSettingsHost] = useState('');
  const [settingsPort, setSettingsPort] = useState(7777);
  const [settingsTimezone, setSettingsTimezone] = useState('');

  // Flows
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);
  const [activeNav, setActiveNav] = useState<'schedules' | 'canvases'>('schedules');
  const [isCopied, setIsCopied] = useState<string | null>(null);

  // C++ Server Status
  const [canvases, setCanvases] = useState<LEDCanvas[]>([]);
  const [isServerConnected, setIsServerConnected] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);

  // Preview State
  const [previewEffect, setPreviewEffect] = useState<any | null>(null);
  const [previewWidth, setPreviewWidth] = useState(144);
  const [previewHeight, setPreviewHeight] = useState(1);

  // CRUD Canvas/Feature States
  const [showAddCanvasModal, setShowAddCanvasModal] = useState(false);
  const [editingCanvasId, setEditingCanvasId] = useState<number | null>(null);
  const [canvasName, setCanvasName] = useState('');
  const [canvasWidth, setCanvasWidth] = useState('144');
  const [canvasHeight, setCanvasHeight] = useState('1');
  const [canvasFps, setCanvasFps] = useState('30');

  const [showAddFeatureModal, setShowAddFeatureModal] = useState(false);
  const [editingFeatureId, setEditingFeatureId] = useState<number | null>(null);
  const [selectedCanvasIdForFeature, setSelectedCanvasIdForFeature] = useState<number | null>(null);
  const [featFriendlyName, setFeatFriendlyName] = useState('');
  const [featHostName, setFeatHostName] = useState('');
  const [featPort, setFeatPort] = useState('49152');
  const [featWidth, setFeatWidth] = useState('144');
  const [featHeight, setFeatHeight] = useState('1');
  const [featOffsetX, setFeatOffsetX] = useState('0');
  const [featOffsetY, setFeatOffsetY] = useState('0');
  const [featReversed, setFeatReversed] = useState(false);
  const [featChannel, setFeatChannel] = useState('0');
  const [featRedGreenSwap, setFeatRedGreenSwap] = useState(false);
  const [featBufferCount, setFeatBufferCount] = useState('8');

  // ==========================================
  // API Calls
  // ==========================================

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
      // Poll server status every 10 seconds
      const timer = setInterval(loadServerStatus, 10000);
      return () => clearInterval(timer);
    }
  }, [isAuthenticated]);

  const checkAuthStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/status`);
      const data = await res.json();
      setIsAuthenticated(data.authenticated);
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAuthenticated(true);
        setLoginPassword('');
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (err) {
      setLoginError('Could not reach backend server');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
      setIsAuthenticated(false);
      setSelectedFlow(null);
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = async () => {
    try {
      // Load settings
      const settingsRes = await fetch(`${API_BASE}/api/settings`);
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        setSettings(settingsData);
        setSettingsHost(settingsData.ndscppHostname);
        setSettingsPort(settingsData.ndscppPort);
        setSettingsTimezone(settingsData.timezone || '');
      }

      // Load flows
      const flowsRes = await fetch(`${API_BASE}/api/flows`);
      if (flowsRes.ok) {
        const flowsData = await flowsRes.json();
        setFlows(flowsData);
      }

      await loadServerStatus();
    } catch (err) {
      console.error('Failed to load system data:', err);
    }
  };

  const loadServerStatus = async () => {
    setServerLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/config/canvases`);
      if (res.ok) {
        const data = await res.json();
        setCanvases(data);
        const isConnected = res.headers.get('X-Server-Connected') === 'true';
        setIsServerConnected(isConnected);
      } else {
        setIsServerConnected(false);
      }
    } catch (err) {
      setIsServerConnected(false);
    } finally {
      setServerLoading(false);
    }
  };

  const handleAddCanvasClick = () => {
    setEditingCanvasId(null);
    setCanvasName('');
    setCanvasWidth('144');
    setCanvasHeight('1');
    setCanvasFps('30');
    setShowAddCanvasModal(true);
  };

  const handleEditCanvasClick = (canvas: LEDCanvas) => {
    setEditingCanvasId(canvas.id);
    setCanvasName(canvas.name);
    setCanvasWidth(canvas.width.toString());
    setCanvasHeight(canvas.height.toString());
    setCanvasFps((canvas.fps || canvas.effectsManager?.fps || 30).toString());
    setShowAddCanvasModal(true);
  };

  const handleSaveCanvas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canvasName) {
      alert('Canvas name is required');
      return;
    }
    try {
      setServerLoading(true);
      if (editingCanvasId !== null) {
        // Update existing canvas
        const res = await fetch(`${API_BASE}/api/config/canvases/${editingCanvasId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: canvasName,
            width: parseInt(canvasWidth) || 1,
            height: parseInt(canvasHeight) || 1,
            fps: parseInt(canvasFps) || 30
          })
        });
        if (res.ok) {
          setShowAddCanvasModal(false);
          await loadServerStatus();
          alert('Canvas Target updated successfully!');
        } else {
          const errText = await res.text();
          alert(`Failed to update Canvas: ${errText}`);
        }
      } else {
        // Create new canvas
        const nextId = canvases.length > 0 ? Math.max(...canvases.map(c => c.id)) + 1 : 1;
        const res = await fetch(`${API_BASE}/api/config/canvases`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: nextId,
            name: canvasName,
            width: parseInt(canvasWidth) || 1,
            height: parseInt(canvasHeight) || 1,
            fps: parseInt(canvasFps) || 30
          })
        });
        if (res.ok) {
          setShowAddCanvasModal(false);
          await loadServerStatus();
          alert('Canvas Target created successfully!');
        } else {
          const errText = await res.text();
          alert(`Failed to create Canvas: ${errText}`);
        }
      }
    } catch (err: any) {
      alert(`Error saving Canvas: ${err.message}`);
    } finally {
      setServerLoading(false);
    }
  };

  const handleImportCanvasToLocal = async (canvas: LEDCanvas) => {
    try {
      setServerLoading(true);
      const res = await fetch(`${API_BASE}/api/config/canvases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: canvas.id,
          name: canvas.name,
          width: canvas.width,
          height: canvas.height,
          fps: canvas.fps || canvas.effectsManager?.fps || 30,
          features: canvas.features || []
        })
      });
      if (res.ok) {
        await loadServerStatus();
        alert('Canvas Target imported to local configuration successfully!');
      } else {
        const errText = await res.text();
        alert(`Failed to import Canvas: ${errText}`);
      }
    } catch (err: any) {
      alert(`Error importing Canvas: ${err.message}`);
    } finally {
      setServerLoading(false);
    }
  };

  const handleDeleteCanvas = async (canvasId: number) => {
    if (!confirm(`Are you sure you want to delete Canvas Target ID ${canvasId}?`)) return;
    try {
      setServerLoading(true);
      const res = await fetch(`${API_BASE}/api/config/canvases/${canvasId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await loadServerStatus();
        alert('Canvas Target deleted successfully!');
      } else {
        const errText = await res.text();
        alert(`Failed to delete Canvas: ${errText}`);
      }
    } catch (err: any) {
      alert(`Error deleting Canvas: ${err.message}`);
    } finally {
      setServerLoading(false);
    }
  };

  const handleAddFeatureClick = (canvasId: number) => {
    setSelectedCanvasIdForFeature(canvasId);
    setEditingFeatureId(null);
    setFeatFriendlyName('');
    setFeatHostName('');
    setFeatPort('49152');
    setFeatWidth('144');
    setFeatHeight('1');
    setFeatOffsetX('0');
    setFeatOffsetY('0');
    setFeatReversed(false);
    setFeatChannel('0');
    setFeatRedGreenSwap(false);
    setFeatBufferCount('8');
    setShowAddFeatureModal(true);
  };

  const handleEditFeatureClick = (canvasId: number, feature: any) => {
    setSelectedCanvasIdForFeature(canvasId);
    setEditingFeatureId(feature.id);
    setFeatFriendlyName(feature.friendlyName);
    setFeatHostName(feature.hostName);
    setFeatPort(feature.port.toString());
    setFeatWidth(feature.width.toString());
    setFeatHeight(feature.height.toString());
    setFeatOffsetX(feature.offsetX.toString());
    setFeatOffsetY(feature.offsetY.toString());
    setFeatReversed(!!feature.reversed);
    setFeatChannel(feature.channel.toString());
    setFeatRedGreenSwap(!!feature.redGreenSwap);
    setFeatBufferCount(feature.clientBufferCount.toString());
    setShowAddFeatureModal(true);
  };

  const handleSaveFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCanvasIdForFeature === null) return;
    if (!featFriendlyName || !featHostName) {
      alert('Friendly name and Host name are required');
      return;
    }
    
    const featureBody = {
      friendlyName: featFriendlyName,
      hostName: featHostName,
      port: parseInt(featPort) || 49152,
      width: parseInt(featWidth) || 1,
      height: parseInt(featHeight) || 1,
      offsetX: parseInt(featOffsetX) || 0,
      offsetY: parseInt(featOffsetY) || 0,
      reversed: featReversed,
      channel: parseInt(featChannel) || 0,
      redGreenSwap: featRedGreenSwap,
      clientBufferCount: parseInt(featBufferCount) || 8
    };

    try {
      setServerLoading(true);
      
      if (editingFeatureId !== null) {
        // Update feature
        const res = await fetch(`${API_BASE}/api/config/canvases/${selectedCanvasIdForFeature}/features/${editingFeatureId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(featureBody)
        });
        if (res.ok) {
          setShowAddFeatureModal(false);
          await loadServerStatus();
          alert('LED Feature Strip updated successfully!');
        } else {
          const errText = await res.text();
          alert(`Failed to update LED Feature Strip: ${errText}`);
        }
      } else {
        // Create feature
        const res = await fetch(`${API_BASE}/api/config/canvases/${selectedCanvasIdForFeature}/features`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(featureBody)
        });
        if (res.ok) {
          setShowAddFeatureModal(false);
          await loadServerStatus();
          alert('LED Feature Strip added successfully!');
        } else {
          const errText = await res.text();
          alert(`Failed to add LED Feature Strip: ${errText}`);
        }
      }
    } catch (err: any) {
      alert(`Error saving LED Feature Strip: ${err.message}`);
    } finally {
      setServerLoading(false);
    }
  };

  const handleDeleteFeature = async (canvasId: number, featureId: number) => {
    if (!confirm(`Are you sure you want to delete LED Feature Strip ID ${featureId} from Canvas ID ${canvasId}?`)) return;
    try {
      setServerLoading(true);
      const res = await fetch(`${API_BASE}/api/config/canvases/${canvasId}/features/${featureId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await loadServerStatus();
        alert('LED Feature Strip deleted successfully!');
      } else {
        const errText = await res.text();
        alert(`Failed to delete LED Feature Strip: ${errText}`);
      }
    } catch (err: any) {
      alert(`Error deleting LED Feature Strip: ${err.message}`);
    } finally {
      setServerLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ndscppHostname: settingsHost, ndscppPort: settingsPort, timezone: settingsTimezone })
      });
      if (res.ok) {
        setSettings({ ndscppHostname: settingsHost, ndscppPort: settingsPort, timezone: settingsTimezone });
        setShowSettingsModal(false);
        loadServerStatus();
      }
    } catch (err) {
      alert('Failed to save settings');
    }
  };

  const handleSaveFlow = async (flow: Flow) => {
    try {
      const flowToSave = prepareFlowForSave(flow, settings.timezone || 'UTC');
      const res = await fetch(`${API_BASE}/api/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flowToSave)
      });
      if (res.ok) {
        await res.json();
        // Update list
        setFlows(prev => {
          const idx = prev.findIndex(f => f.id === flowToSave.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = flowToSave;
            return updated;
          }
          return [...prev, flowToSave];
        });
        
        // Flash success
        alert('Flow saved and active!');
      }
    } catch (err) {
      alert('Failed to save flow');
    }
  };

  const handleDeleteFlow = async (id: string) => {
    if (!confirm('Are you sure you want to delete this flow?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/flows/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setFlows(prev => prev.filter(f => f.id !== id));
        if (selectedFlow?.id === id) {
          setSelectedFlow(null);
        }
      }
    } catch (err) {
      alert('Failed to delete flow');
    }
  };

  const handleRunFlow = async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/flows/${id}/run`, { method: 'POST' });
      alert('Flow manually triggered!');
    } catch (err) {
      alert('Failed to run flow');
    }
  };

  const handleTriggerScoreboardAction = async (canvasId: number) => {
    // Quickly flash green/gold on real lights for debugging
    try {
      await fetch(`${API_BASE}/api/canvases/${canvasId}/effects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: "13PaletteEffect",
          name: "Test Celebration",
          ledScrollSpeed: 12.0,
          palette: {
            blend: true,
            colors: [{ r: 0, g: 255, b: 0 }, { r: 255, g: 220, b: 0 }]
          }
        })
      });
      await fetch(`${API_BASE}/api/canvases/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvasIds: [canvasId] })
      });
      alert('Real lights triggered with celebration!');
    } catch (err) {
      alert('Failed to trigger server lights');
    }
  };

  // ==========================================
  // Flow Editor Logic
  // ==========================================

  const createNewFlow = () => {
    const newFlow: Flow = {
      id: `flow_${Date.now()}`,
      name: 'New Schedule Flow',
      enabled: true,
      trigger: {
        type: 'time',
        properties: {
          cron: '0 18 * * *' // Default to 6 PM daily
        }
      },
      actions: []
    };
    setSelectedFlow(newFlow);
  };

  const updateFlowTrigger = (type: TriggerType, properties: any) => {
    if (!selectedFlow) return;
    setSelectedFlow({
      ...selectedFlow,
      trigger: {
        type,
        properties
      } as Trigger
    });
  };

  const handleSwitchToCron = () => {
    if (!selectedFlow) return;
    setSelectedFlow({
      ...selectedFlow,
      trigger: {
        type: 'time',
        properties: {
          cron: '0 18 * * *'
        }
      } as Trigger
    });
  };

  const handleSwitchToGranular = () => {
    if (!selectedFlow) return;
    setSelectedFlow({
      ...selectedFlow,
      trigger: {
        type: 'time',
        properties: {
          cron: '',
          startTime: '18:00',
          endTime: '22:00',
          startDate: '12-01',
          endDate: '12-31',
          daysOfWeek: []
        }
      } as Trigger
    });
  };

  const addActionToFlow = (type: ActionType) => {
    if (!selectedFlow) return;
    
    let defaultProperties: any = {};
    const defaultCanvasId = canvases[0]?.id || 0;

    switch (type) {
      case 'start_effect':
        defaultProperties = {
          canvasId: defaultCanvasId,
          effect: {
            type: '15ColorWaveEffect',
            name: 'Pulsing Colors',
            speed: 0.5,
            waveFrequency: 8.0
          }
        };
        break;
      case 'stop_effect':
        defaultProperties = {
          canvasId: defaultCanvasId
        };
        break;
      case 'delay':
        defaultProperties = {
          durationSeconds: 10
        };
        break;
      case 'call_api':
        defaultProperties = {
          url: 'http://',
          method: 'GET',
          headers: {},
          body: ''
        };
        break;
    }

    const newAction: Action = {
      id: `act_${Date.now()}`,
      type,
      properties: defaultProperties
    } as Action;

    setSelectedFlow({
      ...selectedFlow,
      actions: [...selectedFlow.actions, newAction]
    });
  };

  const updateActionProperties = (actionId: string, properties: any) => {
    if (!selectedFlow) return;
    const updated = selectedFlow.actions.map(act => {
      if (act.id === actionId) {
        return {
          ...act,
          properties: {
            ...act.properties,
            ...properties
          }
        };
      }
      return act;
    });
    setSelectedFlow({
      ...selectedFlow,
      actions: updated as Action[]
    });
  };

  const removeActionFromFlow = (actionId: string) => {
    if (!selectedFlow) return;
    setSelectedFlow({
      ...selectedFlow,
      actions: selectedFlow.actions.filter(act => act.id !== actionId)
    });
  };

  const addEndActionToFlow = (type: ActionType) => {
    if (!selectedFlow) return;
    
    let defaultProperties: any = {};
    const defaultCanvasId = canvases[0]?.id || 0;

    switch (type) {
      case 'start_effect':
        defaultProperties = {
          canvasId: defaultCanvasId,
          effect: {
            type: '15ColorWaveEffect',
            name: 'Pulsing Colors',
            speed: 0.5,
            waveFrequency: 8.0
          }
        };
        break;
      case 'stop_effect':
        defaultProperties = {
          canvasId: defaultCanvasId
        };
        break;
      case 'delay':
        defaultProperties = {
          durationSeconds: 10
        };
        break;
      case 'call_api':
        defaultProperties = {
          url: 'http://',
          method: 'GET',
          headers: {},
          body: ''
        };
        break;
    }

    const newAction: Action = {
      id: `act_${Date.now()}`,
      type,
      properties: defaultProperties
    } as Action;

    setSelectedFlow({
      ...selectedFlow,
      endActions: [...(selectedFlow.endActions || []), newAction]
    });
  };

  const updateEndActionProperties = (actionId: string, properties: any) => {
    if (!selectedFlow) return;
    const updated = (selectedFlow.endActions || []).map(act => {
      if (act.id === actionId) {
        return {
          ...act,
          properties: {
            ...act.properties,
            ...properties
          }
        };
      }
      return act;
    });
    setSelectedFlow({
      ...selectedFlow,
      endActions: updated as Action[]
    });
  };

  const removeEndActionFromFlow = (actionId: string) => {
    if (!selectedFlow) return;
    setSelectedFlow({
      ...selectedFlow,
      endActions: (selectedFlow.endActions || []).filter(act => act.id !== actionId)
    });
  };

  const triggerPreview = (action: StartEffectAction) => {
    const canvas = canvases.find(c => c.id === action.properties.canvasId);
    setPreviewWidth(canvas?.width || 144);
    setPreviewHeight(canvas?.height || 1);
    setPreviewEffect(action.properties.effect);
  };

  const renderActionInputs = (actionsList: Action[], isEndActions: boolean) => {
    const updateFn = isEndActions ? updateEndActionProperties : updateActionProperties;
    const removeFn = isEndActions ? removeEndActionFromFlow : removeActionFromFlow;
    const addFn = isEndActions ? addEndActionToFlow : addActionToFlow;

    return (
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
        {actionsList.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '8px', width: '100%', color: 'var(--text-muted)', fontSize: '13px' }}>
            No actions defined.
          </div>
        ) : (
          actionsList.map((action, index) => {
            return (
              <React.Fragment key={action.id}>
                <div className="glass-panel" style={{ width: '100%', padding: '20px', borderLeft: `4px solid ${isEndActions ? 'var(--color-danger)' : 'var(--color-accent)'}` }}>
                  
                  {/* Action Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div style={{ background: isEndActions ? 'rgba(239, 68, 68, 0.15)' : 'var(--color-accent-glow)', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: '11px', fontWeight: '800', color: isEndActions ? 'var(--color-danger)' : 'var(--color-accent)' }}>{index + 1}</span>
                      </div>
                      <div>
                        <h4 style={{ fontSize: '14px', color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                          Action: {action.type.replace('_', ' ')}
                        </h4>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>ID: {action.id}</span>
                      </div>
                    </div>
                    <button className="btn-icon danger" onClick={() => removeFn(action.id)} title="Remove action">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Action Inputs */}
                  <div style={{ background: 'rgba(0,0,0,0.15)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    
                    {/* START_EFFECT ACTION */}
                    {action.type === 'start_effect' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <div>
                            <label>Canvas Target</label>
                            <select 
                              value={action.properties.canvasId}
                              onChange={e => updateFn(action.id, { canvasId: parseInt(e.target.value, 10) })}
                            >
                              {canvases.map(c => (
                                <option key={c.id} value={c.id}>ID {c.id} - {c.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Effect Type</label>
                            <select 
                              value={action.properties.effect.type}
                              onChange={e => {
                                const type = e.target.value;
                                let effectProps: any = { type, name: action.properties.effect.name };
                                if (type.includes('ColorWaveEffect')) {
                                  effectProps.speed = 0.5;
                                  effectProps.waveFrequency = 8.0;
                                } else if (type.includes('BouncingBallEffect')) {
                                  effectProps.ballCount = 5;
                                  effectProps.ballSize = 1;
                                  effectProps.mirrored = true;
                                  effectProps.erase = true;
                                } else if (type.includes('SolidColorFill')) {
                                  effectProps.color = { r: 0, g: 242, b: 254 };
                                } else if (type.includes('PaletteEffect')) {
                                  effectProps.ledScrollSpeed = 5.0;
                                  effectProps.palette = {
                                    blend: true,
                                    colors: [
                                      { r: 79, g: 172, b: 254 },
                                      { r: 0, g: 242, b: 254 },
                                      { r: 217, g: 70, b: 239 }
                                    ]
                                  };
                                }
                                updateFn(action.id, { effect: effectProps });
                              }}
                            >
                              <option value="15ColorWaveEffect">Color Wave (1D/2D)</option>
                              <option value="18BouncingBallEffect">Bouncing Balls (1D)</option>
                              <option value="13PaletteEffect">Color Palette Loop</option>
                              <option value="14SolidColorFill">Solid Color Fill</option>
                              <option value="15StarfieldEffect">Starfield Space</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label>Custom Name</label>
                          <input 
                            type="text"
                            value={action.properties.effect.name}
                            onChange={e => updateFn(action.id, { 
                              effect: { ...action.properties.effect, name: e.target.value } 
                            })}
                            placeholder="Celebrate, Night Wave, etc."
                          />
                        </div>

                        {/* Effect Specific Fields */}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Sliders size={12} /> EFFECT PARAMETERS
                          </span>

                          {action.properties.effect.type.includes('ColorWaveEffect') && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                              <div>
                                <label>Speed ({action.properties.effect.speed})</label>
                                <input 
                                  type="range" min="0" max="3" step="0.1"
                                  value={action.properties.effect.speed || 0.5}
                                  onChange={e => updateFn(action.id, {
                                    effect: { ...action.properties.effect, speed: parseFloat(e.target.value) }
                                  })}
                                />
                              </div>
                              <div>
                                <label>Frequency ({action.properties.effect.waveFrequency})</label>
                                <input 
                                  type="range" min="1" max="30" step="1"
                                  value={action.properties.effect.waveFrequency || 10}
                                  onChange={e => updateFn(action.id, {
                                    effect: { ...action.properties.effect, waveFrequency: parseInt(e.target.value, 10) }
                                  })}
                                />
                              </div>
                            </div>
                          )}

                          {action.properties.effect.type.includes('BouncingBallEffect') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                  <label>Ball Count ({action.properties.effect.ballCount})</label>
                                  <input 
                                    type="range" min="1" max="15" step="1"
                                    value={action.properties.effect.ballCount || 5}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, ballCount: parseInt(e.target.value, 10) }
                                    })}
                                  />
                                </div>
                                <div>
                                  <label>Ball Size ({action.properties.effect.ballSize || 1})</label>
                                  <input 
                                    type="range" min="1" max="10" step="1"
                                    value={action.properties.effect.ballSize || 1}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, ballSize: parseInt(e.target.value, 10) }
                                    })}
                                  />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '20px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                                  <input 
                                    type="checkbox"
                                    checked={action.properties.effect.mirrored !== false}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, mirrored: e.target.checked }
                                    })}
                                  />
                                  Mirrored
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                                  <input 
                                    type="checkbox"
                                    checked={action.properties.effect.erase !== false}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, erase: e.target.checked }
                                    })}
                                  />
                                  Erase Path
                                </label>
                              </div>
                            </div>
                          )}

                          {action.properties.effect.type.includes('SolidColorFill') && (
                            <div>
                              <label>Fill Color (Hex)</label>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input 
                                  type="color"
                                  value={rgbToHex(action.properties.effect.color || '#00f2fe')}
                                  onChange={e => updateFn(action.id, {
                                    effect: { ...action.properties.effect, color: hexToRgb(e.target.value) }
                                  })}
                                  style={{ width: '40px', height: '36px', padding: '2px', cursor: 'pointer' }}
                                />
                                <input 
                                  type="text"
                                  value={rgbToHex(action.properties.effect.color || '#00f2fe')}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val.startsWith('#') && val.length === 7) {
                                      updateFn(action.id, {
                                        effect: { ...action.properties.effect, color: hexToRgb(val) }
                                      });
                                    }
                                  }}
                                  placeholder="#00f2fe"
                                />
                              </div>
                            </div>
                          )}

                          {action.properties.effect.type.includes('PaletteEffect') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                  <label>Scroll Speed ({action.properties.effect.ledScrollSpeed})</label>
                                  <input 
                                    type="range" min="0" max="25" step="0.5"
                                    value={action.properties.effect.ledScrollSpeed || 0}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, ledScrollSpeed: parseFloat(e.target.value) }
                                    })}
                                  />
                                </div>
                                <div>
                                  <label>Color Scroll Speed ({action.properties.effect.ledColorPerSecond})</label>
                                  <input 
                                    type="range" min="0" max="10" step="0.25"
                                    value={action.properties.effect.ledColorPerSecond || 0}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, ledColorPerSecond: parseFloat(e.target.value) }
                                    })}
                                  />
                                </div>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                <div>
                                  <label>Density ({action.properties.effect.density || 1})</label>
                                  <input 
                                    type="range" min="0.01" max="10" step="0.01"
                                    value={action.properties.effect.density || 1}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, density: parseFloat(e.target.value) }
                                    })}
                                  />
                                </div>
                                <div>
                                  <label>Dot Spacing (everyNth) ({action.properties.effect.everyNthDot || 1})</label>
                                  <input 
                                    type="range" min="1" max="50" step="1"
                                    value={action.properties.effect.everyNthDot || 1}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, everyNthDot: parseFloat(e.target.value) }
                                    })}
                                  />
                                </div>
                                <div>
                                  <label>Dot Size ({action.properties.effect.dotSize || 1})</label>
                                  <input 
                                    type="range" min="1" max="20" step="1"
                                    value={action.properties.effect.dotSize || 1}
                                    onChange={e => updateFn(action.id, {
                                      effect: { ...action.properties.effect, dotSize: parseInt(e.target.value, 10) }
                                    })}
                                  />
                                </div>
                              </div>

                              <div>
                                <label>Brightness ({action.properties.effect.brightness || 1})</label>
                                <input 
                                  type="range" min="0" max="1" step="0.05"
                                  value={action.properties.effect.brightness !== undefined ? action.properties.effect.brightness : 1}
                                  onChange={e => updateFn(action.id, {
                                    effect: { ...action.properties.effect, brightness: parseFloat(e.target.value) }
                                  })}
                                />
                              </div>
                              <div>
                                <label>Colors in Palette</label>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                  {action.properties.effect.palette?.colors?.map((col: any, cIdx: number) => (
                                    <div key={cIdx} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px' }}>
                                      <input 
                                        type="color"
                                        value={rgbToHex(col)}
                                        onChange={e => {
                                          const updatedCols = [...action.properties.effect.palette.colors];
                                          updatedCols[cIdx] = hexToRgb(e.target.value);
                                          updateFn(action.id, {
                                            effect: {
                                              ...action.properties.effect,
                                              palette: { ...action.properties.effect.palette, colors: updatedCols }
                                            }
                                          });
                                        }}
                                        style={{ width: '22px', height: '22px', padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
                                      />
                                      <button 
                                        className="btn-icon danger" 
                                        style={{ width: '18px', height: '18px' }}
                                        onClick={() => {
                                          const updatedCols = action.properties.effect.palette.colors.filter((_: any, idx: number) => idx !== cIdx);
                                          updateFn(action.id, {
                                            effect: {
                                              ...action.properties.effect,
                                              palette: { ...action.properties.effect.palette, colors: updatedCols }
                                            }
                                          });
                                        }}
                                      >
                                        <Trash2 size={10} />
                                      </button>
                                    </div>
                                  ))}
                                  <button 
                                    className="btn-secondary" 
                                    style={{ padding: '4px 8px', fontSize: '11px', height: '30px' }}
                                    onClick={() => {
                                      const updatedCols = [...(action.properties.effect.palette?.colors || []), { r: 255, g: 0, b: 0 }];
                                      updateFn(action.id, {
                                        effect: {
                                          ...action.properties.effect,
                                          palette: { ...action.properties.effect.palette, colors: updatedCols }
                                        }
                                      });
                                    }}
                                  >
                                    + Color
                                  </button>
                                </div>
                              </div>
                                <div style={{ display: 'flex', gap: '20px' }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                                    <input 
                                      type="checkbox"
                                      checked={action.properties.effect.palette?.blend !== false}
                                      onChange={e => updateFn(action.id, {
                                        effect: {
                                          ...action.properties.effect,
                                          palette: { ...action.properties.effect.palette, blend: e.target.checked }
                                        }
                                      })}
                                    />
                                    Smooth Blend
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                                    <input 
                                      type="checkbox"
                                      checked={action.properties.effect.mirrored === true}
                                      onChange={e => updateFn(action.id, {
                                        effect: { ...action.properties.effect, mirrored: e.target.checked }
                                      })}
                                    />
                                    Mirrored
                                  </label>
                                </div>
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                          <button 
                            className="btn-secondary" 
                            style={{ padding: '8px 14px', fontSize: '12px', flex: 1, justifyContent: 'center' }}
                            onClick={() => triggerPreview(action as StartEffectAction)}
                          >
                            <Eye size={12} /> Local Preview
                          </button>
                          <button 
                            className="btn-secondary pulse-glow-hover" 
                            style={{ padding: '8px 14px', fontSize: '12px', flex: 1, justifyContent: 'center', borderColor: 'rgba(16,185,129,0.3)', color: '#a7f3d0' }}
                            onClick={() => handleTriggerScoreboardAction(action.properties.canvasId)}
                          >
                            <Sparkles size={12} style={{ color: 'var(--color-success)' }} /> Force Real Lights
                          </button>
                        </div>
                      </div>
                    )}

                    {/* STOP_EFFECT ACTION */}
                    {action.type === 'stop_effect' && (
                      <div>
                        <label>Canvas Target</label>
                        <select 
                          value={action.properties.canvasId}
                          onChange={e => updateFn(action.id, { canvasId: parseInt(e.target.value, 10) })}
                        >
                          {canvases.map(c => (
                            <option key={c.id} value={c.id}>ID {c.id} - {c.name}</option>
                          ))}
                        </select>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
                          Stops the animation runner on the specified canvas, shutting off the LEDs.
                        </span>
                      </div>
                    )}

                    {/* DELAY ACTION */}
                    {action.type === 'delay' && (
                      <div>
                        <label>Delay Duration (Seconds)</label>
                        <input 
                          type="number" 
                          min="1" max="3600"
                          value={action.properties.durationSeconds}
                          onChange={e => updateFn(action.id, { durationSeconds: parseInt(e.target.value, 10) || 5 })}
                        />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
                          Pauses flow execution. Useful for holding goal celebrations before reverting to default patterns.
                        </span>
                      </div>
                    )}

                    {/* CALL_API ACTION */}
                    {action.type === 'call_api' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
                          <div>
                            <label>Method</label>
                            <select 
                              value={action.properties.method}
                              onChange={e => updateFn(action.id, { method: e.target.value })}
                            >
                              <option value="GET">GET</option>
                              <option value="POST">POST</option>
                              <option value="PUT">PUT</option>
                              <option value="DELETE">DELETE</option>
                            </select>
                          </div>
                          <div>
                            <label>API URL</label>
                            <input 
                              type="text"
                              value={action.properties.url}
                              onChange={e => updateFn(action.id, { url: e.target.value })}
                              placeholder="http://my-home-assistant/api/..."
                            />
                          </div>
                        </div>
                        <div>
                          <label>Headers (JSON String)</label>
                          <input 
                            type="text"
                            value={typeof action.properties.headers === 'string' ? action.properties.headers : JSON.stringify(action.properties.headers || {})}
                            onChange={e => {
                              try {
                                updateFn(action.id, { headers: JSON.parse(e.target.value) });
                              } catch (err) {
                                updateFn(action.id, { headers: e.target.value });
                              }
                            }}
                            placeholder='{"Authorization": "Bearer token"}'
                          />
                        </div>
                        <div>
                          <label>Body (JSON String)</label>
                          <textarea 
                            rows={2}
                            value={action.properties.body || ''}
                            onChange={e => updateFn(action.id, { body: e.target.value })}
                            placeholder='{"state": "celebrating"}'
                          />
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {/* Arrow Connector between steps */}
                {index < actionsList.length - 1 && (
                  <ArrowDown size={20} style={{ color: 'var(--text-muted)' }} />
                )}
              </React.Fragment>
            );
          })
        )}

        {/* Arrow Connector to Add button */}
        <ArrowDown size={20} style={{ color: 'var(--text-muted)' }} />

        {/* Add Action Controls */}
        <div className="glass-panel" style={{ width: '100%', padding: '16px', display: 'flex', justifyContent: 'center', gap: '10px', background: 'rgba(0,0,0,0.1)' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', marginRight: '10px' }}>
            + ADD ACTION:
          </span>
          <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => addFn('start_effect')}>
            <Sparkles size={12} /> Start Effect
          </button>
          <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => addFn('stop_effect')}>
            <Pause size={12} /> Stop Effect
          </button>
          <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => addFn('delay')}>
            <Clock size={12} /> Delay
          </button>
          <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => addFn('call_api')}>
            <Activity size={12} /> External API
          </button>
        </div>
      </div>
    );
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(id);
    setTimeout(() => setIsCopied(null), 2000);
  };

  // Render Loading Screen
  if (isAuthenticated === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
        <Activity className="text-glow" size={48} style={{ color: 'var(--color-primary)', animation: 'pulseGlow 2s infinite' }} />
        <span style={{ fontFamily: 'var(--font-display)', color: 'var(--text-secondary)' }}>Loading System Dashboard...</span>
      </div>
    );
  }

  // Render Login Screen
  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', padding: '16px' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ background: 'var(--color-primary-glow)', width: '56px', height: '56px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', border: '1px solid var(--color-primary)' }}>
              <Zap size={24} style={{ color: 'var(--color-primary)' }} />
            </div>
            <h1 style={{ fontSize: '28px', color: 'var(--text-primary)' }}>Antigravity LED</h1>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Secure Orchestrator Dashboard</span>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label htmlFor="password">Administrator Password</label>
              <input
                id="password"
                type="password"
                placeholder="Enter password..."
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                autoFocus
              />
            </div>
            {loginError && (
              <span style={{ color: 'var(--color-danger)', fontSize: '12px', fontWeight: '500' }}>
                {loginError}
              </span>
            )}
            <button type="submit" className="btn-primary" style={{ justifyContent: 'center', width: '100%' }}>
              Unlock Dashboard
            </button>
          </form>
          
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
            <Info size={12} />
            <span>Connection to local ESP32 / NDSCPP is private.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      {/* ==========================================
          Sidebar
          ========================================== */}
      <aside style={{ background: 'rgba(8, 14, 25, 0.9)', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '24px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Zap size={18} style={{ color: 'var(--color-primary)', filter: 'drop-shadow(0 0 4px var(--color-primary))' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: '700', fontSize: '18px', color: 'var(--text-primary)' }}>
              LED Control
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn-icon" onClick={() => {
              setSettingsHost(settings.ndscppHostname);
              setSettingsPort(settings.ndscppPort);
              setSettingsTimezone(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
              setShowSettingsModal(true);
            }} title="Settings">
              <Settings size={16} />
            </button>
            <button className="btn-icon" onClick={handleLogout} title="Log Out">
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {/* Server Status Ribbon */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Server Status:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Circle 
              size={8} 
              fill={isServerConnected ? 'var(--color-success)' : 'var(--color-danger)'}
              style={{ color: isServerConnected ? 'var(--color-success)' : 'var(--color-danger)' }}
            />
            <span style={{ fontWeight: '600', color: isServerConnected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {isServerConnected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Main Navigation */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px', borderBottom: '1px solid var(--border-color)' }}>
          <button 
            className={`btn-nav ${activeNav === 'schedules' ? 'active' : ''}`}
            onClick={() => {
              setActiveNav('schedules');
              setSelectedFlow(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: activeNav === 'schedules' ? 'rgba(0, 242, 254, 0.08)' : 'transparent',
              color: activeNav === 'schedules' ? 'var(--color-primary)' : 'var(--text-secondary)',
              fontWeight: '600',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <Calendar size={16} />
            Schedules Dashboard
          </button>
          
          <button 
            className={`btn-nav ${activeNav === 'canvases' ? 'active' : ''}`}
            onClick={() => {
              setActiveNav('canvases');
              setSelectedFlow(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: activeNav === 'canvases' ? 'rgba(0, 242, 254, 0.08)' : 'transparent',
              color: activeNav === 'canvases' ? 'var(--color-primary)' : 'var(--text-secondary)',
              fontWeight: '600',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <Layers size={16} />
            LED Canvases & Features
          </button>
        </div>

        {/* Dynamic Lists */}
        <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, overflowY: 'auto' }}>
          {activeNav === 'schedules' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                  SCHEDULE FLOWS
                </span>
                <button className="btn-icon" onClick={createNewFlow} title="Create new flow">
                  <Plus size={16} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {flows.length === 0 ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                    No flows defined. Create one!
                  </span>
                ) : (
                  flows.map(flow => {
                    const isSelected = selectedFlow?.id === flow.id;
                    return (
                      <div 
                        key={flow.id}
                        className="glass-panel"
                        onClick={() => setSelectedFlow(prepareFlowForEdit(flow, settings.timezone || 'UTC'))}
                        style={{ 
                          padding: '12px 14px', 
                          cursor: 'pointer',
                          borderColor: isSelected ? 'var(--color-primary-glow)' : 'var(--border-color)',
                          background: isSelected ? 'rgba(0, 242, 254, 0.04)' : 'var(--bg-card)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                            {flow.name}
                          </span>
                          <Circle 
                            size={6} 
                            fill={flow.enabled ? 'var(--color-success)' : 'var(--text-muted)'} 
                            style={{ color: flow.enabled ? 'var(--color-success)' : 'var(--text-muted)' }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                          <span style={{ textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {flow.trigger.type === 'time' && <Clock size={10} />}
                            {flow.trigger.type === 'webhook' && <Webhook size={10} />}
                            {flow.trigger.type === 'sports_score' && <Trophy size={10} />}
                            {flow.trigger.type.replace('_', ' ')}
                          </span>
                          <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                            <button className="btn-icon" onClick={() => handleRunFlow(flow.id)} title="Run flow now" style={{ width: '22px', height: '22px' }}>
                              <Play size={10} />
                            </button>
                            <button className="btn-icon danger" onClick={() => handleDeleteFlow(flow.id)} title="Delete flow" style={{ width: '22px', height: '22px' }}>
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                  CANVAS TARGETS
                </span>
                <button className="btn-icon" onClick={() => setShowAddCanvasModal(true)} title="Add Canvas">
                  <Plus size={16} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {canvases.length === 0 ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                    No canvases configured.
                  </span>
                ) : (
                  canvases.map(canvas => (
                    <div 
                      key={canvas.id}
                      className="glass-panel"
                      style={{ 
                        padding: '12px 14px', 
                        borderColor: 'var(--border-color)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={canvas.name}>
                          {canvas.name}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>ID {canvas.id}</span>
                      </div>

                      {canvas.unconfigured && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', gap: '8px' }}>
                          <span style={{ fontSize: '10px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', padding: '1px 6px', borderRadius: '4px', color: '#f59e0b', fontWeight: '500' }}>
                            Unconfigured
                          </span>
                          <button
                            className="btn-primary"
                            onClick={() => handleImportCanvasToLocal(canvas)}
                            style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '4px', whiteSpace: 'nowrap' }}
                          >
                            Import Layout
                          </button>
                        </div>
                      )}

                      {canvas.currentEffectName && (() => {
                        const effectsMgr = canvas.effectsManager;
                        const activeEffIdx = effectsMgr?.currentEffectIndex ?? -1;
                        const activeEffect = effectsMgr?.effects && activeEffIdx >= 0 ? effectsMgr.effects[activeEffIdx] : null;

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '6px' }}>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <Circle 
                                size={5} 
                                fill={effectsMgr?.running ? "var(--color-primary)" : "var(--text-muted)"} 
                                style={{ 
                                  color: effectsMgr?.running ? "var(--color-primary)" : "var(--text-muted)", 
                                  animation: effectsMgr?.running ? 'pulseGlow 2s infinite' : 'none' 
                                }} 
                              />
                              <span style={{ 
                                fontSize: '11px', 
                                color: effectsMgr?.running ? 'var(--color-primary)' : 'var(--text-muted)', 
                                fontWeight: '600', 
                                overflow: 'hidden', 
                                textOverflow: 'ellipsis', 
                                whiteSpace: 'nowrap' 
                              }}>
                                {effectsMgr?.running ? `Running: ${canvas.currentEffectName}` : `Stopped: ${canvas.currentEffectName}`}
                              </span>
                            </div>
                            {activeEffect && (
                              <button
                                className="btn-secondary"
                                style={{ padding: '2px 6px', fontSize: '9px', gap: '2px', borderRadius: '4px', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center' }}
                                onClick={() => {
                                  setPreviewWidth(canvas.width);
                                  setPreviewHeight(canvas.height);
                                  setPreviewEffect(activeEffect);
                                }}
                              >
                                <Eye size={9} /> Preview Live
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer info */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>Host: {settings.ndscppHostname}:{settings.ndscppPort}</span>
          <span>Workspace Version: v1.0.0</span>
        </div>
      </aside>

      {/* ==========================================
          Main Content Window
          ========================================== */}
      <main style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', height: '100vh' }}>
        {selectedFlow ? (
          /* ==========================================
             Visual Pipeline Flow Editor
             ========================================== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Flow Header */}
            <div className="glass-panel" style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input
                  type="text"
                  value={selectedFlow.name}
                  onChange={e => setSelectedFlow({ ...selectedFlow, name: e.target.value })}
                  style={{ 
                    fontSize: '22px', 
                    fontWeight: '700', 
                    border: 'none', 
                    background: 'transparent',
                    padding: 0,
                    borderRadius: 0,
                    width: 'auto',
                    minWidth: '300px',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-display)'
                  }}
                  placeholder="Enter flow name..."
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Flow ID: {selectedFlow.id}</span>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={selectedFlow.enabled}
                    onChange={e => setSelectedFlow({ ...selectedFlow, enabled: e.target.checked })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>Enable Flow</span>
                </label>
                <button 
                  className="btn-secondary" 
                  onClick={() => setSelectedFlow(null)}
                  style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'var(--border-color)' }}
                >
                  Cancel
                </button>
                <button 
                  className="btn-primary" 
                  onClick={() => handleSaveFlow(selectedFlow)}
                  title="Save changes and load into orchestrator"
                >
                  <Save size={16} /> Save & Apply
                </button>
              </div>
            </div>

            {/* Pipeline Configuration Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' }}>
              
              {/* Left Column: Visual Pipeline */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                
                {/* 1. Trigger Card */}
                <div className="glass-panel" style={{ width: '100%', padding: '24px', borderLeft: '4px solid var(--color-primary)' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ background: 'var(--color-primary-glow)', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Activity size={16} style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '16px', color: 'var(--text-primary)' }}>1. Pipeline Trigger</h3>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>What initiates this LED schedule?</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '20px', alignItems: 'start' }}>
                    <div>
                      <label>Trigger Type</label>
                      <select 
                        value={selectedFlow.trigger.type}
                        onChange={e => {
                          const val = e.target.value as TriggerType;
                          let props: any = {};
                          if (val === 'time') props = { cron: '0 18 * * *' };
                          else if (val === 'webhook') props = { token: Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2) };
                          else if (val === 'sports_score') props = { sport: 'football', league: 'nfl', team: 'Green Bay Packers', scheduleMode: 'auto', manualSchedule: [] };
                          updateFlowTrigger(val, props);
                        }}
                      >
                        <option value="time">Time (Cron)</option>
                        <option value="webhook">Webhook Link</option>
                        <option value="sports_score">Sports Score (Live)</option>
                      </select>
                    </div>

                    {/* Trigger Properties Form */}
                    <div style={{ background: 'rgba(0,0,0,0.15)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                      {selectedFlow.trigger.type === 'time' && (() => {
                        const triggerProps = selectedFlow.trigger.properties as any;
                        const isGranular = triggerProps.startTime !== undefined;
                        
                        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                        let tzAbbrev = '';
                        try {
                          const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone: browserTz }).formatToParts(new Date());
                          tzAbbrev = ' (' + (parts.find(p => p.type === 'timeZoneName')?.value || '') + ')';
                        } catch (e) {}

                        if (!isGranular) {
                          // Simple/Legacy Cron Frequency UI
                          const cronStr = triggerProps.cron || '0 18 * * *';
                          const { timeType, hour, minute, days, period } = parseCron(cronStr);

                          const updateCronValue = (updates: { type?: string; hour?: number; minute?: number; days?: number[]; period?: number; custom?: string }) => {
                            const t = updates.type !== undefined ? updates.type : timeType;
                            const h = updates.hour !== undefined ? updates.hour : hour;
                            const m = updates.minute !== undefined ? updates.minute : minute;
                            const d = updates.days !== undefined ? updates.days : days;
                            const p = updates.period !== undefined ? updates.period : period;
                            const c = updates.custom !== undefined ? updates.custom : cronStr;
                            
                            const newCron = buildCron(t, h, m, d, p, c);
                            updateFlowTrigger('time', { cron: newCron });
                          };

                          const handleDayToggle = (dayNum: number) => {
                            const newDays = days.includes(dayNum)
                              ? days.filter(d => d !== dayNum)
                              : [...days, dayNum].sort();
                            updateCronValue({ days: newDays });
                          };

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                                <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-primary)' }}>Schedule Mode</span>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={handleSwitchToGranular}
                                >
                                  Switch to Date & Time Range
                                </button>
                              </div>

                              <div>
                                <label>Execution Frequency</label>
                                <select 
                                  value={timeType} 
                                  onChange={e => {
                                    const t = e.target.value;
                                    updateCronValue({ type: t, days: t === 'weekly' && days.length === 0 ? [1, 2, 3, 4, 5] : days });
                                  }}
                                >
                                  <option value="minutes">Every N Minutes</option>
                                  <option value="hours">Every N Hours</option>
                                  <option value="daily">Daily (At specific time)</option>
                                  <option value="weekly">Weekly (On specific days)</option>
                                  <option value="cron">Custom Cron Expression</option>
                                </select>
                              </div>

                              {timeType === 'minutes' && (
                                <div>
                                  <label>Interval (Minutes): Every {period} minute(s)</label>
                                  <input 
                                    type="range" min="1" max="59" step="1"
                                    value={period}
                                    onChange={e => updateCronValue({ period: parseInt(e.target.value, 10) })}
                                  />
                                </div>
                              )}

                              {timeType === 'hours' && (
                                <div>
                                  <label>Interval (Hours): Every {period} hour(s)</label>
                                  <input 
                                    type="range" min="1" max="23" step="1"
                                    value={period}
                                    onChange={e => updateCronValue({ period: parseInt(e.target.value, 10) })}
                                  />
                                </div>
                              )}

                              {(timeType === 'daily' || timeType === 'weekly') && (
                                <div>
                                  <label>Execution Time</label>
                                  <input 
                                    type="time" 
                                    value={`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`}
                                    onChange={e => {
                                      const [hStr, mStr] = e.target.value.split(':');
                                      updateCronValue({ 
                                        hour: parseInt(hStr || '18', 10), 
                                        minute: parseInt(mStr || '0', 10) 
                                      });
                                    }}
                                    style={{ maxWidth: '150px' }}
                                  />
                                </div>
                              )}

                              {timeType === 'weekly' && (
                                <div>
                                  <label>Days of the Week</label>
                                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dName, dIdx) => {
                                      const isChecked = days.includes(dIdx);
                                      return (
                                        <button
                                          key={dIdx}
                                          type="button"
                                          className="btn-secondary"
                                          style={{ 
                                            padding: '6px 10px', 
                                            fontSize: '11px', 
                                            borderRadius: '6px',
                                            background: isChecked ? 'var(--color-primary-glow)' : 'rgba(255,255,255,0.03)',
                                            borderColor: isChecked ? 'var(--color-primary)' : 'var(--border-color)',
                                            color: isChecked ? 'var(--color-primary)' : 'var(--text-secondary)'
                                          }}
                                          onClick={() => handleDayToggle(dIdx)}
                                        >
                                          {dName}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {timeType === 'cron' && (
                                <div>
                                  <label>Raw Cron Pattern</label>
                                  <input 
                                    type="text" 
                                    value={cronStr}
                                    onChange={e => updateCronValue({ custom: e.target.value })}
                                    placeholder="e.g. */5 18-22 * * 1-5"
                                  />
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
                                    Standard 5-field cron: [minute] [hour] [day-of-month] [month] [day-of-week]
                                  </span>
                                </div>
                              )}

                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.1)', padding: '8px 12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.02)' }}>
                                <strong>Active Cron:</strong> <code>{cronStr}</code>
                              </div>
                            </div>
                          );
                        } else {
                          // Granular Date & Time Range UI
                          const startTime = triggerProps.startTime || '18:00';
                          const endTime = triggerProps.endTime || '22:00';
                          const hasDateRange = triggerProps.startDate !== undefined && triggerProps.endDate !== undefined;
                          const startMD = parseMonthDay(triggerProps.startDate);
                          const endMD = parseMonthDay(triggerProps.endDate);
                          const daysOfWeek = triggerProps.daysOfWeek || [];

                          const updateGranularProperties = (updates: any) => {
                            updateFlowTrigger('time', {
                              ...triggerProps,
                              ...updates
                            });
                          };

                          const handleDayToggle = (dayNum: number) => {
                            const newDays = daysOfWeek.includes(dayNum)
                              ? daysOfWeek.filter((d: number) => d !== dayNum)
                              : [...daysOfWeek, dayNum].sort();
                            updateGranularProperties({ daysOfWeek: newDays });
                          };

                          const handleDateRangeToggle = (checked: boolean) => {
                            if (checked) {
                              updateGranularProperties({
                                startDate: '12-01',
                                endDate: '12-31'
                              });
                            } else {
                              const copy = { ...triggerProps };
                              delete copy.startDate;
                              delete copy.endDate;
                              updateFlowTrigger('time', copy);
                            }
                          };

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                                <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-primary)' }}>Schedule Mode</span>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={handleSwitchToCron}
                                >
                                  Switch to Simple Frequency
                                </button>
                              </div>

                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                  <label>Start Time (ON){tzAbbrev}</label>
                                  <input
                                    type="time"
                                    value={startTime}
                                    onChange={e => updateGranularProperties({ startTime: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label>End Time (OFF){tzAbbrev}</label>
                                  <input
                                    type="time"
                                    value={endTime}
                                    onChange={e => updateGranularProperties({ endTime: e.target.value })}
                                  />
                                </div>
                              </div>

                              {/* Date Restriction Toggler */}
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: '8px 0 0 0' }}>
                                <input
                                  type="checkbox"
                                  checked={hasDateRange}
                                  onChange={e => handleDateRangeToggle(e.target.checked)}
                                  style={{ width: '15px', height: '15px' }}
                                />
                                <span style={{ fontSize: '13px', fontWeight: '600' }}>Restrict to specific Date Range</span>
                              </label>

                              {hasDateRange && (
                                <div style={{ background: 'rgba(0,0,0,0.1)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  {/* Start Date */}
                                  <div>
                                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Start Date (Repeating Yearly)</label>
                                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                      <select
                                        value={startMD.month}
                                        onChange={e => updateGranularProperties({ startDate: `${e.target.value}-${startMD.day}` })}
                                        style={{ flex: 2, height: '36px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '0 8px' }}
                                      >
                                        {MONTH_NAMES.map((name, idx) => (
                                          <option key={idx} value={(idx + 1).toString().padStart(2, '0')}>{name}</option>
                                        ))}
                                      </select>
                                      <select
                                        value={startMD.day}
                                        onChange={e => updateGranularProperties({ startDate: `${startMD.month}-${e.target.value}` })}
                                        style={{ flex: 1, height: '36px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '0 8px' }}
                                      >
                                        {Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0')).map(d => (
                                          <option key={d} value={d}>{parseInt(d, 10)}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>

                                  {/* End Date */}
                                  <div>
                                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>End Date (Repeating Yearly)</label>
                                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                                      <select
                                        value={endMD.month}
                                        onChange={e => updateGranularProperties({ endDate: `${e.target.value}-${endMD.day}` })}
                                        style={{ flex: 2, height: '36px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '0 8px' }}
                                      >
                                        {MONTH_NAMES.map((name, idx) => (
                                          <option key={idx} value={(idx + 1).toString().padStart(2, '0')}>{name}</option>
                                        ))}
                                      </select>
                                      <select
                                        value={endMD.day}
                                        onChange={e => updateGranularProperties({ endDate: `${endMD.month}-${e.target.value}` })}
                                        style={{ flex: 1, height: '36px', background: 'rgba(0,0,0,0.3)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '0 8px' }}
                                      >
                                        {Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0')).map(d => (
                                          <option key={d} value={d}>{parseInt(d, 10)}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Days of Week */}
                              <div>
                                <label>Days of the Week (Optional)</label>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dName, dIdx) => {
                                    const isChecked = daysOfWeek.includes(dIdx);
                                    return (
                                      <button
                                        key={dIdx}
                                        type="button"
                                        className="btn-secondary"
                                        style={{ 
                                          padding: '6px 10px', 
                                          fontSize: '11px', 
                                          borderRadius: '6px',
                                          background: isChecked ? 'var(--color-primary-glow)' : 'rgba(255,255,255,0.03)',
                                          borderColor: isChecked ? 'var(--color-primary)' : 'var(--border-color)',
                                          color: isChecked ? 'var(--color-primary)' : 'var(--text-secondary)'
                                        }}
                                        onClick={() => handleDayToggle(dIdx)}
                                      >
                                        {dName}
                                      </button>
                                    );
                                  })}
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                  Leave all unselected to run every day.
                                </span>
                              </div>

                            </div>
                          );
                        }
                      })()}

                      {selectedFlow.trigger.type === 'webhook' && (
                        <div>
                          <label>Public Webhook URL</label>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input 
                              type="text"
                              readOnly
                              value={`${window.location.origin}/api/v1/webhooks/trigger/${selectedFlow.trigger.properties.token}`}
                              style={{ background: 'rgba(0,0,0,0.35)', color: 'var(--text-secondary)', fontSize: '12px' }}
                            />
                            <button 
                              className="btn-secondary" 
                              onClick={() => copyToClipboard(`${window.location.origin}/api/v1/webhooks/trigger/${(selectedFlow.trigger.properties as any).token}`, 'webhook-url')}
                            >
                              {isCopied === 'webhook-url' ? <Check size={14} style={{ color: 'var(--color-success)' }} /> : <Copy size={14} />}
                            </button>
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
                            Trigger this schedule externally by making an HTTP POST request to this URL.
                          </span>
                        </div>
                      )}

                      {selectedFlow.trigger.type === 'sports_score' && (() => {
                        const sportsProps = selectedFlow.trigger.properties as any;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                              <div>
                                <label>Sport</label>
                                <select 
                                  value={sportsProps.sport}
                                  onChange={e => {
                                    const sport = e.target.value;
                                    const league = sport === 'hockey' ? 'nhl' : sport === 'basketball' ? 'nba' : sport === 'soccer' ? 'mls' : 'nfl';
                                    updateFlowTrigger('sports_score', { ...sportsProps, sport, league });
                                  }}
                                >
                                  <option value="football">Football</option>
                                  <option value="hockey">Hockey</option>
                                  <option value="basketball">Basketball</option>
                                  <option value="soccer">Soccer</option>
                                </select>
                              </div>
                              <div>
                                <label>League</label>
                                <select 
                                  value={sportsProps.league}
                                  onChange={e => updateFlowTrigger('sports_score', { ...sportsProps, league: e.target.value })}
                                >
                                  {sportsProps.sport === 'football' && (
                                    <>
                                      <option value="nfl">NFL</option>
                                      <option value="college-football">College Football</option>
                                    </>
                                  )}
                                  {sportsProps.sport === 'hockey' && (
                                    <option value="nhl">NHL</option>
                                  )}
                                  {sportsProps.sport === 'basketball' && (
                                    <>
                                      <option value="nba">NBA</option>
                                      <option value="wnba">WNBA</option>
                                    </>
                                  )}
                                  {sportsProps.sport === 'soccer' && (
                                    <>
                                      <option value="mls">MLS</option>
                                      <option value="eng.1">Premier League (England)</option>
                                      <option value="uefa.champions">Champions League</option>
                                    </>
                                  )}
                                </select>
                              </div>
                            </div>
                            <div>
                              <label>Team Name (ESPN Spelling)</label>
                              <input 
                                type="text"
                                value={sportsProps.team}
                                onChange={e => updateFlowTrigger('sports_score', { ...sportsProps, team: e.target.value })}
                                placeholder="e.g. Green Bay Packers, Chicago Blackhawks"
                              />
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                                E.g. "Green Bay Packers" or "Chicago Blackhawks". Matches display names.
                              </span>
                            </div>
                            <div>
                              <label>Schedule Mode</label>
                              <select 
                                value={sportsProps.scheduleMode || 'auto'}
                                onChange={e => updateFlowTrigger('sports_score', { ...sportsProps, scheduleMode: e.target.value as any })}
                              >
                                <option value="auto">Auto (Fetch from ESPN)</option>
                                <option value="manual">Manual (Input Game Dates)</option>
                              </select>
                            </div>
                            {(sportsProps.scheduleMode === 'manual') && (
                              <div style={{ border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '6px', padding: '12px', marginTop: '4px', background: 'rgba(0,0,0,0.1)' }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 'bold' }}>Game Schedule (Local Time)</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', marginBottom: '10px' }}>
                                  {(!sportsProps.manualSchedule || sportsProps.manualSchedule.length === 0) ? (
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No games scheduled. Add one below.</span>
                                  ) : (
                                    sportsProps.manualSchedule.map((gameStr: string, idx: number) => {
                                      const dateObj = new Date(gameStr);
                                      return (
                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.04)', padding: '6px 10px', borderRadius: '4px' }}>
                                          <span style={{ fontSize: '12px' }}>
                                            {isNaN(dateObj.getTime()) ? gameStr : dateObj.toLocaleString()}
                                          </span>
                                          <button
                                            type="button"
                                            style={{ border: 'none', background: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', padding: '2px' }}
                                            onClick={() => {
                                              const currentList = sportsProps.manualSchedule || [];
                                              const newList = currentList.filter((_: any, i: number) => i !== idx);
                                              updateFlowTrigger('sports_score', {
                                                ...sportsProps,
                                                manualSchedule: newList
                                              });
                                            }}
                                            title="Remove Game"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <input
                                    type="datetime-local"
                                    id="new-manual-game-time"
                                    style={{ flex: 1, padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.15)', background: '#1c1c1e', color: '#fff' }}
                                  />
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                    onClick={() => {
                                      const inputEl = document.getElementById('new-manual-game-time') as HTMLInputElement;
                                      if (inputEl && inputEl.value) {
                                        const isoStr = new Date(inputEl.value).toISOString();
                                        const currentList = sportsProps.manualSchedule || [];
                                        if (!currentList.includes(isoStr)) {
                                          updateFlowTrigger('sports_score', {
                                            ...sportsProps,
                                            manualSchedule: [...currentList, isoStr].sort()
                                          });
                                        }
                                        inputEl.value = '';
                                      }
                                    }}
                                  >
                                    Add Game
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {selectedFlow.trigger.type === 'time' ? (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
                    
                    {/* Start actions (ON) */}
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Play size={16} /> Actions to run at Start Time (ON)
                      </h3>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        These actions will execute when the schedule starts (at the configured Start Time).
                      </span>
                      {renderActionInputs(selectedFlow.actions, false)}
                    </div>

                    {/* Divider */}
                    <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.08)', margin: '20px 0' }} />

                    {/* End actions (OFF) */}
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Pause size={16} /> Actions to run at End Time (OFF)
                      </h3>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        These actions will execute when the schedule ends (at the configured End Time). If none are defined, the system will automatically stop the target canvas effect.
                      </span>
                      {renderActionInputs(selectedFlow.endActions || [], true)}
                    </div>

                  </div>
                ) : (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Activity size={16} /> Pipeline Actions
                    </h3>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      These actions will execute in order when the trigger conditions are met.
                    </span>
                    {renderActionInputs(selectedFlow.actions, false)}
                  </div>
                )}
              </div>

              {/* Right Column: Sticky Preview Sidebar */}
              <div style={{ position: 'sticky', top: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <CanvasPreview 
                  width={previewWidth}
                  height={previewHeight}
                  effect={previewEffect}
                  fps={(() => {
                    const matchingCanvas = canvases.find(c => c.width === previewWidth && c.height === previewHeight);
                    return matchingCanvas?.fps || matchingCanvas?.effectsManager?.fps || 30;
                  })()}
                />
                
                <div className="glass-panel" style={{ padding: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <h4 style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Info size={14} style={{ color: 'var(--color-primary)' }} /> Editor Instructions
                  </h4>
                  <ol style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <li>Select or edit the <strong>Trigger</strong> parameters.</li>
                    <li>Add <strong>Actions</strong> to chain effects sequentially.</li>
                    <li>Use <strong>Local Preview</strong> to verify speed and color settings in real-time.</li>
                    <li>Use <strong>Force Real Lights</strong> to push live configurations to the target ESP32 cluster.</li>
                    <li>Click <strong>Save & Apply</strong> to load the schedule into the background orchestrator.</li>
                  </ol>
                </div>
              </div>

            </div>
          </div>
        ) : activeNav === 'schedules' ? (
          /* ==========================================
             Schedules Dashboard View
             ========================================== */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' }}>
            
            {/* Left Column: Schedules Overview & Grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Top Welcome Card */}
              <div className="glass-panel" style={{ padding: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(14,22,38,0.7) 0%, rgba(30,27,75,0.4) 100%)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h1 style={{ fontSize: '32px', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    Schedules Dashboard
                  </h1>
                  <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
                    Manage and run your scheduling flows. Create low-code automations to drive your lights automatically.
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Target Server: {settings.ndscppHostname}:{settings.ndscppPort} (unauthenticated internal proxy)
                  </span>
                </div>
                <button className="btn-primary" onClick={createNewFlow}>
                  <Plus size={16} /> Create Schedule Flow
                </button>
              </div>

              {/* Grid of existing flows */}
              <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '20px' }}>
                  <Clock size={18} style={{ color: 'var(--color-primary)' }} />
                  <h2 style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
                    Configured Schedule Flows
                  </h2>
                </div>

                {flows.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', border: '1px dashed rgba(255, 255, 255, 0.1)', borderRadius: '8px' }}>
                    <Calendar size={32} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
                    <h3 style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '4px' }}>No Flows Configured</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      Click "Create Schedule Flow" above to start building your first automation.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                    {flows.map(flow => (
                      <div 
                        key={flow.id} 
                        className="glass-panel" 
                        style={{ 
                          padding: '20px', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          justifyContent: 'space-between',
                          gap: '16px',
                          borderLeft: `4px solid ${flow.enabled ? 'var(--color-primary)' : 'var(--text-muted)'}`,
                          background: 'rgba(17, 28, 48, 0.3)'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={flow.name}>
                              {flow.name}
                            </h3>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0, flexShrink: 0 }}>
                              <input
                                type="checkbox"
                                checked={flow.enabled}
                                onChange={async (e) => {
                                  const updatedFlow = { ...flow, enabled: e.target.checked };
                                  await handleSaveFlow(updatedFlow);
                                }}
                                style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '11px', fontWeight: '600', color: flow.enabled ? 'var(--color-success)' : 'var(--text-muted)' }}>
                                {flow.enabled ? 'ACTIVE' : 'DISABLED'}
                              </span>
                            </label>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.15)', padding: '10px 12px', borderRadius: '6px', marginTop: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Trigger:</span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textTransform: 'capitalize', fontWeight: '500' }}>
                                {flow.trigger.type === 'time' && <Clock size={12} />}
                                {flow.trigger.type === 'webhook' && <Webhook size={12} />}
                                {flow.trigger.type === 'sports_score' && <Trophy size={12} />}
                                {flow.trigger.type.replace('_', ' ')}
                              </span>
                            </div>
                            
                            {flow.trigger.type === 'time' && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                                <span>{getDisplayScheduleText(flow, settings.timezone || 'UTC')}</span>
                              </div>
                            )}

                            {flow.trigger.type === 'sports_score' && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                                <span>ESPN: <strong>{(flow.trigger.properties as any).team}</strong> ({(flow.trigger.properties as any).league?.toUpperCase()}) - Mode: <strong>{(flow.trigger.properties as any).scheduleMode || 'auto'}</strong></span>
                              </div>
                            )}

                            {flow.trigger.type === 'webhook' && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span>Token: <code>{(flow.trigger.properties as any).token}</code></span>
                              </div>
                            )}

                            <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                              <span>• {flow.actions.length} Action(s)</span>
                              <span>• {(flow.endActions || []).length} End Action(s)</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '12px' }}>
                          <button 
                            className="btn-secondary" 
                            style={{ flex: 1, padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }} 
                            onClick={() => setSelectedFlow(prepareFlowForEdit(flow, settings.timezone || 'UTC'))}
                          >
                            Edit Flow
                          </button>
                          <button 
                            className="btn-secondary pulse-glow-hover" 
                            style={{ padding: '6px 10px', fontSize: '12px', borderColor: 'rgba(16,185,129,0.3)', color: '#a7f3d0' }}
                            onClick={() => handleRunFlow(flow.id)}
                            title="Run Flow Now"
                          >
                            <Play size={12} />
                          </button>
                          <button 
                            className="btn-icon danger" 
                            style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                            onClick={() => handleDeleteFlow(flow.id)}
                            title="Delete Flow"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Sticky Preview Sidebar */}
            <div style={{ position: 'sticky', top: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <CanvasPreview 
                width={previewWidth}
                height={previewHeight}
                effect={previewEffect}
                fps={(() => {
                  const matchingCanvas = canvases.find(c => c.width === previewWidth && c.height === previewHeight);
                  return matchingCanvas?.fps || matchingCanvas?.effectsManager?.fps || 30;
                })()}
              />
              
              <div className="glass-panel" style={{ padding: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <h4 style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={14} style={{ color: 'var(--color-primary)' }} /> Quick Guide
                </h4>
                <p style={{ margin: 0, lineHeight: '1.4' }}>
                  Schedule flows connect input triggers (dates, scores, times, webhooks) with action pipelines (running animation effects, calling APIs, or adding delays).
                </p>
                <p style={{ margin: '8px 0 0 0', lineHeight: '1.4' }}>
                  Manage canvases and LED strip features under the <strong>LED Canvases & Features</strong> tab.
                </p>
              </div>
            </div>

          </div>
        ) : (
          /* ==========================================
             LED Canvases & Features View
             ========================================== */
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' }}>
            
            {/* Left Column: Layout Configuration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Top Welcome Card */}
              <div className="glass-panel" style={{ padding: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, rgba(14,22,38,0.7) 0%, rgba(30,27,75,0.4) 100%)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <h1 style={{ fontSize: '32px', color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    LED Canvases & Features
                  </h1>
                  <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
                    Define target canvases and map them to physical ESP32 controllers. Configured targets can be driven by any schedule flow.
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Target Server: {settings.ndscppHostname}:{settings.ndscppPort} (unauthenticated internal proxy)
                  </span>
                </div>
                <button className="btn-primary" onClick={handleAddCanvasClick}>
                  <Plus size={16} /> Add Canvas Target
                </button>
              </div>

              {/* NDSCPP Layout Monitor */}
              <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Layers size={18} style={{ color: 'var(--color-primary)' }} />
                    <h2 style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
                      C++ Server LED Layout Monitor
                    </h2>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      className="btn-primary" 
                      onClick={handleAddCanvasClick}
                      style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Plus size={12} /> Add Canvas
                    </button>
                    <button 
                      className="btn-secondary" 
                      onClick={loadServerStatus}
                      disabled={serverLoading}
                      style={{ padding: '6px 12px', fontSize: '12px' }}
                    >
                      <RefreshCw size={12} className={serverLoading ? 'spin' : ''} /> Refresh Layout
                    </button>
                  </div>
                </div>

                {!isServerConnected ? (
                  <div style={{ padding: '40px', textAlign: 'center', background: 'rgba(239, 68, 68, 0.05)', border: '1px dashed rgba(239, 68, 68, 0.2)', borderRadius: '8px' }}>
                    <Wifi size={32} style={{ color: 'var(--color-danger)', marginBottom: '12px' }} />
                    <h3 style={{ fontSize: '15px', color: '#fca5a5', marginBottom: '4px' }}>Could Not Connect to C++ Server</h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      Check that the NDSCPP container is running and hostname <strong>{settings.ndscppHostname}</strong> is reachable from the cluster.
                    </p>
                  </div>
                ) : canvases.length === 0 ? (
                  <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No canvases configured on the C++ server. Configure them via the server dashboard.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {canvases.map(canvas => (
                      <div 
                        key={canvas.id}
                        style={{ 
                          background: 'rgba(0,0,0,0.2)', 
                          padding: '20px', 
                          borderRadius: '12px', 
                          border: '1px solid rgba(255,255,255,0.04)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px'
                        }}
                      >
                        {/* Canvas Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                          <div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
                                {canvas.name}
                              </span>
                              <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                                Canvas ID: {canvas.id}
                              </span>
                              {canvas.unconfigured && (
                                <span style={{ fontSize: '11px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 8px', borderRadius: '12px', color: '#f59e0b', fontWeight: '600' }}>
                                  Server Only (Unconfigured Locally)
                                </span>
                              )}
                              {!canvas.unconfigured ? (
                                <>
                                  <button
                                    className="btn-icon"
                                    onClick={() => handleEditCanvasClick(canvas)}
                                    style={{ 
                                      padding: '2px', 
                                      color: 'var(--text-secondary)', 
                                      borderColor: 'transparent',
                                      background: 'transparent',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer'
                                    }}
                                    title="Edit Canvas Target"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button
                                    className="btn-icon"
                                    onClick={() => handleDeleteCanvas(canvas.id)}
                                    style={{ 
                                      padding: '2px', 
                                      color: 'var(--color-danger)', 
                                      borderColor: 'transparent',
                                      background: 'transparent',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer'
                                    }}
                                    title="Delete Canvas Target"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="btn-primary"
                                  onClick={() => handleImportCanvasToLocal(canvas)}
                                  style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', borderRadius: '4px' }}
                                >
                                  Import Layout config
                                </button>
                              )}
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                              Resolution: {canvas.width}x{canvas.height} LEDs | Configured Rate: {canvas.fps || canvas.effectsManager?.fps || 30} FPS
                            </span>
                          </div>
                          
                          {canvas.currentEffectName && (() => {
                            const effectsMgr = canvas.effectsManager;
                            const activeEffIdx = effectsMgr?.currentEffectIndex ?? -1;
                            const activeEffect = effectsMgr?.effects && activeEffIdx >= 0 ? effectsMgr.effects[activeEffIdx] : null;

                            const handleImportActiveEffect = () => {
                              if (!activeEffect) return;

                              const newAction: Action = {
                                id: `act_${Date.now()}`,
                                type: 'start_effect',
                                properties: {
                                  canvasId: canvas.id,
                                  effect: JSON.parse(JSON.stringify(activeEffect))
                                }
                              } as Action;

                              const currentFlow = selectedFlow as Flow | null;
                              if (currentFlow) {
                                setSelectedFlow({
                                  ...currentFlow,
                                  actions: [...currentFlow.actions, newAction]
                                });
                                alert(`Imported active effect "${activeEffect.name}" into your active flow!`);
                              } else {
                                const newFlow: Flow = {
                                  id: `flow_${Date.now()}`,
                                  name: `Imported Flow (${activeEffect.name})`,
                                  enabled: true,
                                  trigger: {
                                    type: 'time',
                                    properties: {
                                      cron: '0 18 * * *'
                                    }
                                  },
                                  actions: [newAction]
                                };
                                setSelectedFlow(newFlow);
                                setActiveNav('schedules'); // Switch user to the flows dashboard
                                alert(`Created new flow with imported active effect "${activeEffect.name}"!`);
                              }
                            };

                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                                <div style={{ 
                                   display: 'flex', 
                                   gap: '6px', 
                                   alignItems: 'center', 
                                   background: effectsMgr?.running ? 'rgba(0, 242, 254, 0.08)' : 'rgba(255, 255, 255, 0.03)', 
                                   border: effectsMgr?.running ? '1px solid rgba(0, 242, 254, 0.2)' : '1px solid rgba(255, 255, 255, 0.08)', 
                                   padding: '6px 12px', 
                                   borderRadius: '20px' 
                                 }}>
                                   <Circle 
                                     size={6} 
                                     fill={effectsMgr?.running ? "var(--color-primary)" : "var(--text-muted)"} 
                                     style={{ 
                                       color: effectsMgr?.running ? "var(--color-primary)" : "var(--text-muted)", 
                                       animation: effectsMgr?.running ? 'pulseGlow 2s infinite' : 'none' 
                                     }} 
                                   />
                                   <span style={{ 
                                     fontSize: '12px', 
                                     color: effectsMgr?.running ? 'var(--color-primary)' : 'var(--text-muted)', 
                                     fontWeight: '600' 
                                   }}>
                                     {effectsMgr?.running ? `Running: ${canvas.currentEffectName}` : `Stopped: ${canvas.currentEffectName}`}
                                   </span>
                                 </div>
                                {activeEffect && (
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                      className="btn-secondary"
                                      style={{ padding: '4px 8px', fontSize: '10px', gap: '4px', borderRadius: '4px' }}
                                      onClick={() => {
                                        setPreviewWidth(canvas.width);
                                        setPreviewHeight(canvas.height);
                                        setPreviewEffect(activeEffect);
                                      }}
                                    >
                                      <Eye size={10} /> Preview Live
                                    </button>
                                    <button
                                      className="btn-secondary pulse-glow-hover"
                                      style={{ padding: '4px 8px', fontSize: '10px', gap: '4px', borderRadius: '4px', borderColor: 'rgba(168,85,247,0.3)', color: '#d8b4fe' }}
                                      onClick={handleImportActiveEffect}
                                      title={selectedFlow ? "Import this effect into the active flow" : "Import this effect and create a new flow"}
                                    >
                                      <Plus size={10} /> Import to Flow
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Canvas Features (ESP32 controllers) */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                              CONNECTED LED CONTROLLERS (FEATURES)
                            </span>
                            {!canvas.unconfigured && (
                              <button
                                className="btn-secondary"
                                onClick={() => handleAddFeatureClick(canvas.id)}
                                style={{ padding: '3px 8px', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '3px', borderRadius: '4px' }}
                              >
                                <Plus size={10} /> Add Feature
                              </button>
                            )}
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                            {canvas.features?.map(feat => {
                              const stats = feat.lastClientResponse;
                              const isFeatConnected = feat.isConnected !== false;
                              
                              return (
                                <div 
                                  key={feat.id} 
                                  style={{ 
                                    background: 'rgba(255,255,255,0.02)', 
                                    border: '1px solid rgba(255,255,255,0.04)',
                                    borderRadius: '8px',
                                    padding: '12px 14px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                        {feat.friendlyName}
                                      </span>
                                      {!canvas.unconfigured && (
                                        <>
                                          <button
                                            className="btn-icon"
                                            onClick={() => handleEditFeatureClick(canvas.id, feat)}
                                            style={{ 
                                              padding: '2px', 
                                              color: 'var(--text-secondary)', 
                                              borderColor: 'transparent',
                                              background: 'transparent',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              cursor: 'pointer'
                                            }}
                                            title="Edit Feature Segment"
                                          >
                                            <Edit2 size={11} />
                                          </button>
                                          <button
                                            className="btn-icon"
                                            onClick={() => handleDeleteFeature(canvas.id, feat.id)}
                                            style={{ 
                                              padding: '2px', 
                                              color: 'var(--color-danger)', 
                                              borderColor: 'transparent',
                                              background: 'transparent',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              cursor: 'pointer'
                                            }}
                                            title="Delete Feature Segment"
                                          >
                                            <Trash2 size={11} />
                                          </button>
                                        </>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                                      <Circle 
                                        size={6} 
                                        fill={isFeatConnected ? 'var(--color-success)' : 'var(--color-danger)'}
                                        style={{ color: isFeatConnected ? 'var(--color-success)' : 'var(--color-danger)' }}
                                      />
                                      <span style={{ color: isFeatConnected ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                                        {isFeatConnected ? 'Online' : 'Offline'}
                                      </span>
                                    </div>
                                  </div>

                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    <span>IP Host: {feat.hostName}:{feat.port}</span>
                                    <span>Segment: LEDs {feat.offsetX} to {feat.offsetX + feat.width}</span>
                                  </div>

                                  {isFeatConnected && stats && (
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px', marginTop: '2px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Wifi size={10} /> RSSI: {stats.wifiSignal} dBm
                                      </span>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Cpu size={10} /> Draw FPS: {stats.fpsDrawing}
                                      </span>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Zap size={10} style={{ color: 'var(--color-warning)' }} /> Watts: {stats.watts} W
                                      </span>
                                      <span>Seq: {stats.sequenceNumber}</span>
                                    </div>
                                  )}

                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Sticky Preview Sidebar */}
            <div style={{ position: 'sticky', top: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <CanvasPreview 
                width={previewWidth}
                height={previewHeight}
                effect={previewEffect}
                fps={(() => {
                  const matchingCanvas = canvases.find(c => c.width === previewWidth && c.height === previewHeight);
                  return matchingCanvas?.fps || matchingCanvas?.effectsManager?.fps || 30;
                })()}
              />
              
              <div className="glass-panel" style={{ padding: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <h4 style={{ fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={14} style={{ color: 'var(--color-primary)' }} /> Live View Monitor
                </h4>
                <p style={{ margin: 0, lineHeight: '1.4' }}>
                  Use the <strong>Preview Live</strong> buttons on running canvases to capture and simulate active styles in the web dashboard.
                </p>
                <p style={{ margin: '8px 0 0 0', lineHeight: '1.4' }}>
                  Click <strong>Import to Flow</strong> to copy these active server effects straight into your scheduling flow builder.
                </p>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* ==========================================
          Settings Modal
          ========================================== */}
      {showSettingsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(4,6,10,0.85)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '16px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={18} style={{ color: 'var(--color-primary)' }} /> C++ Server Settings
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Configure the connection settings for the NightDriver C++ server API. In Kubernetes, this should target the internal service name.
            </span>

            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label htmlFor="settings-host">Hostname / IP Address</label>
                <input
                  id="settings-host"
                  type="text"
                  value={settingsHost}
                  onChange={e => setSettingsHost(e.target.value)}
                  placeholder="e.g. 192.168.1.100 or ndscpp-service"
                  required
                />
              </div>

              <div>
                <label htmlFor="settings-port">API Port</label>
                <input
                  id="settings-port"
                  type="number"
                  value={settingsPort}
                  onChange={e => setSettingsPort(parseInt(e.target.value, 10) || 7777)}
                  placeholder="e.g. 7777"
                  required
                />
              </div>

              <div>
                <label htmlFor="settings-timezone">System Timezone</label>
                <input
                  id="settings-timezone"
                  type="text"
                  list="timezone-list"
                  value={settingsTimezone}
                  onChange={e => setSettingsTimezone(e.target.value)}
                  placeholder="e.g. America/Chicago, UTC"
                  required
                />
                <datalist id="timezone-list">
                  <option value="UTC" />
                  <option value="America/New_York" />
                  <option value="America/Chicago" />
                  <option value="America/Denver" />
                  <option value="America/Los_Angeles" />
                  <option value="Europe/London" />
                  <option value="Europe/Paris" />
                  <option value="Asia/Tokyo" />
                  <option value="Australia/Sydney" />
                </datalist>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                  Used to evaluate schedule triggers. Defaults to the browser's timezone.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowSettingsModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================
          Add Canvas Modal
          ========================================== */}
      {showAddCanvasModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(4,6,10,0.85)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '16px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={18} style={{ color: 'var(--color-primary)' }} /> {editingCanvasId ? 'Edit Canvas Target' : 'Add Canvas Target'}
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {editingCanvasId ? 'Update the selected drawing canvas target.' : 'Create a new drawing canvas target on the C++ server.'}
            </span>

            <form onSubmit={handleSaveCanvas} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label htmlFor="canvas-name">Canvas Name</label>
                <input
                  id="canvas-name"
                  type="text"
                  value={canvasName}
                  onChange={e => setCanvasName(e.target.value)}
                  placeholder="e.g. Living Room Canvas"
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="canvas-width">Width (Pixels)</label>
                  <input
                    id="canvas-width"
                    type="number"
                    value={canvasWidth}
                    onChange={e => setCanvasWidth(e.target.value)}
                    min="1"
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="canvas-height">Height (Pixels)</label>
                  <input
                    id="canvas-height"
                    type="number"
                    value={canvasHeight}
                    onChange={e => setCanvasHeight(e.target.value)}
                    min="1"
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="canvas-fps">Target FPS</label>
                  <input
                    id="canvas-fps"
                    type="number"
                    value={canvasFps}
                    onChange={e => setCanvasFps(e.target.value)}
                    min="1"
                    max="120"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddCanvasModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={serverLoading}>
                  {editingCanvasId ? 'Save Canvas' : 'Create Canvas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================
          Add LED Feature Strip Modal
          ========================================== */}
      {showAddFeatureModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(4,6,10,0.85)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '16px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={18} style={{ color: 'var(--color-primary)' }} /> {editingFeatureId ? 'Edit LED Feature Strip' : 'Add LED Feature Strip'}
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {editingFeatureId ? 'Update the configuration for this LED controller.' : 'Configure a physical LED strip connection mapped to this canvas target.'}
            </span>

            <form onSubmit={handleSaveFeature} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label htmlFor="feat-friendly-name">Friendly Name</label>
                <input
                  id="feat-friendly-name"
                  type="text"
                  value={featFriendlyName}
                  onChange={e => setFeatFriendlyName(e.target.value)}
                  placeholder="e.g. Mantle LED Strip"
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 2 }}>
                  <label htmlFor="feat-host-name">Host / IP Address</label>
                  <input
                    id="feat-host-name"
                    type="text"
                    value={featHostName}
                    onChange={e => setFeatHostName(e.target.value)}
                    placeholder="e.g. 192.168.1.186"
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="feat-port">Port</label>
                  <input
                    id="feat-port"
                    type="number"
                    value={featPort}
                    onChange={e => setFeatPort(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="feat-width">Width (Pixels)</label>
                  <input
                    id="feat-width"
                    type="number"
                    value={featWidth}
                    onChange={e => setFeatWidth(e.target.value)}
                    min="1"
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="feat-height">Height (Pixels)</label>
                  <input
                    id="feat-height"
                    type="number"
                    value={featHeight}
                    onChange={e => setFeatHeight(e.target.value)}
                    min="1"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="feat-offset-x">Offset X</label>
                  <input
                    id="feat-offset-x"
                    type="number"
                    value={featOffsetX}
                    onChange={e => setFeatOffsetX(e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="feat-offset-y">Offset Y</label>
                  <input
                    id="feat-offset-y"
                    type="number"
                    value={featOffsetY}
                    onChange={e => setFeatOffsetY(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="feat-channel">Channel</label>
                  <input
                    id="feat-channel"
                    type="number"
                    value={featChannel}
                    onChange={e => setFeatChannel(e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="feat-buffer-count">Buffer Count</label>
                  <input
                    id="feat-buffer-count"
                    type="number"
                    value={featBufferCount}
                    onChange={e => setFeatBufferCount(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '20px', margin: '4px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={featReversed}
                    onChange={e => setFeatReversed(e.target.checked)}
                    style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                  />
                  Reversed Direction
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    checked={featRedGreenSwap}
                    onChange={e => setFeatRedGreenSwap(e.target.checked)}
                    style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                  />
                  Red-Green Swap (GRB)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddFeatureModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={serverLoading}>
                  {editingFeatureId ? 'Save Feature' : 'Add Feature'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
