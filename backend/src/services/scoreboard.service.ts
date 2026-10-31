import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SportsScoreTrigger, Flow } from '../types';

interface GameState { score: number; state: string; winHandled: boolean; kickoffHandled?: boolean; }
interface TrackedTeam {
  flowId: string;
  trigger: SportsScoreTrigger;
  teamId?: string;
  schedule: { id?: string; date: string }[];
  fetchedAt: number;
  executeCallback: () => void;
}

export class ScoreboardService {
  private trackedTeams = new Map<string, TrackedTeam>();
  private states: Record<string, GameState> = {};
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private nextPollAt = new Map<string, number>();
  private backoffUntil = new Map<string, number>();
  private failures = new Map<string, number>();
  private preferredDay = new Map<string, string>();
  private scheduleCache = new Map<string, { teamId: string; schedule: { id?: string; date: string }[]; fetchedAt: number }>();
  private statePath = path.join(process.env.DATA_DIR || path.join(__dirname, '../../'), 'sports-state.json');

  constructor() {
    try { this.states = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
    catch (err: any) { if (err.code !== 'ENOENT') console.warn('Could not read sports checkpoints:', err.message); }
  }

  public registerFlow(flow: Flow, executeCallback: () => void): void {
    if (flow.trigger.type !== 'sports_score') return;
    const old = this.trackedTeams.get(flow.id);
    const sameTeam = old && ['sport', 'league', 'team'].every(k => (old.trigger.properties as any)[k] === (flow.trigger.properties as any)[k]);
    this.trackedTeams.set(flow.id, { flowId: flow.id, trigger: flow.trigger, teamId: sameTeam ? old.teamId : undefined,
      schedule: sameTeam ? old.schedule : [], fetchedAt: sameTeam ? old.fetchedAt : 0, executeCallback });
    this.startPolling();
  }

  public unregisterFlow(id: string): void {
    this.trackedTeams.delete(id);
    if (!this.trackedTeams.size) this.stopPolling();
  }

  public syncFlows(flows: Flow[], callback: (flow: Flow) => void): void {
    const enabled = flows.filter(f => f.enabled && f.trigger.type === 'sports_score');
    for (const id of this.trackedTeams.keys()) if (!enabled.some(f => f.id === id)) this.unregisterFlow(id);
    for (const flow of enabled) this.registerFlow(flow, () => callback(flow));
  }

  public clear(): void { this.trackedTeams.clear(); this.stopPolling(); }
  public startPolling(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, 0);
  }
  public stopPolling(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private saveState(): void {
    // Keep recent games only; each checkpoint includes flow, team and event identity.
    const keys = Object.keys(this.states);
    for (const key of keys.slice(0, Math.max(0, keys.length - 500))) delete this.states[key];
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath + '.tmp', JSON.stringify(this.states));
    fs.renameSync(this.statePath + '.tmp', this.statePath);
  }

  private async refreshSchedule(team: TrackedTeam): Promise<void> {
    const props = team.trigger.properties;
    if (props.scheduleMode === 'manual') {
      team.schedule = (props.manualSchedule || []).filter(d => Number.isFinite(Date.parse(d))).map(date => ({ date }));
      return;
    }
    if (Date.now() - team.fetchedAt < 15 * 60 * 1000 && team.schedule.length) return;
    const cacheKey = [props.sport, props.league, props.team.trim().toLowerCase()].join('/');
    const cached = this.scheduleCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 15 * 60 * 1000) {
      Object.assign(team, cached); return;
    }
    const root = `https://site.api.espn.com/apis/site/v2/sports/${props.sport.toLowerCase()}/${props.league.toLowerCase()}`;
    if (!team.teamId) {
      const data = (await axios.get(`${root}/teams?limit=1000`, { timeout: 10000 })).data;
      const name = props.team.toLowerCase().trim();
      const match = data?.sports?.[0]?.leagues?.[0]?.teams?.find((entry: any) =>
        ['name', 'displayName', 'abbreviation', 'shortDisplayName'].some(k => entry.team?.[k]?.toLowerCase().trim() === name));
      if (!match) throw new Error(`ESPN team not found: ${props.team}`);
      team.teamId = match.team.id;
    }
    const data = (await axios.get(`${root}/teams/${team.teamId}/schedule`, { timeout: 10000 })).data;
    if (!Array.isArray(data?.events)) throw new Error('ESPN schedule has no events array');
    team.schedule = data.events.filter((e: any) => Number.isFinite(Date.parse(e.date))).map((e: any) => ({ id: e.id, date: e.date }));
    team.fetchedAt = Date.now();
    this.scheduleCache.set(cacheKey, { teamId: team.teamId!, schedule: team.schedule, fetchedAt: team.fetchedAt });
  }

  private pollDelay(events: any[], teams: TrackedTeam[]): number {
    let live = false;
    let halftime = false;
    let otherRelevant = false;
    for (const team of teams) {
      for (const event of events) {
        if (!team.schedule.some(g => g.id ? g.id === event.id : Math.abs(Date.parse(g.date) - Date.parse(event.date)) < 12 * 60 * 60 * 1000)) continue;
        const status = event.status?.type;
        if (status?.state !== 'in') { if (status?.state !== 'post') otherRelevant = true; continue; }
        if (status.name === 'STATUS_HALFTIME') { halftime = true; continue; }
        live = true;
        // Only resolved ESPN team IDs are used for possession matching.
        if (team.teamId && String(event.competitions?.[0]?.situation?.possession ?? '') === String(team.teamId)) return 15000;
      }
    }
    if (live) return 30000;
    return halftime && !otherRelevant ? 60000 : 30000;
  }

  private deferLeague(league: string, err: any): void {
    const failures = Math.min((this.failures.get(league) || 0) + 1, 5);
    this.failures.set(league, failures);
    const retry = err.response?.headers?.['retry-after'];
    const seconds = retry == null ? NaN : Number(retry);
    const retryMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retry) - Date.now()) || 0;
    const delay = Math.max(60000 * 2 ** (failures - 1), retryMs);
    const until = Date.now() + delay;
    this.backoffUntil.set(league, until); this.nextPollAt.set(league, until);
    console.warn(`[Sports polling] ${league}: backing off ${Math.ceil(delay / 1000)}s after ${err.response?.status || err.message}`);
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const groups = new Map<string, { teams: TrackedTeam[]; dates: number[] }>();
    try {
      for (const team of this.trackedTeams.values()) {
        const leagueKey = `${team.trigger.properties.sport.toLowerCase()}/${team.trigger.properties.league.toLowerCase()}`;
        if ((this.backoffUntil.get(leagueKey) || 0) > Date.now()) continue;
        try {
          await this.refreshSchedule(team);
          if (this.trackedTeams.get(team.flowId) !== team) continue;
          const active = team.schedule.filter(g => {
            const props = team.trigger.properties;
            const key = [team.flowId, props.sport, props.league, team.teamId || props.team.trim().toLowerCase(), props.event || 'score', g.id].join(':');
            if (g.id && this.states[key]?.state === 'post') return false;
            return Date.now() - Date.parse(g.date) >= -15 * 60 * 1000 && Date.now() - Date.parse(g.date) <= 8 * 60 * 60 * 1000;
          });
          if (!active.length) continue;
          const key = `${team.trigger.properties.sport.toLowerCase()}/${team.trigger.properties.league.toLowerCase()}`;
          const group = groups.get(key) || { teams: [], dates: [] };
          group.teams.push(team); group.dates.push(...active.map(g => Date.parse(g.date))); groups.set(key, group);
        } catch (err: any) { this.deferLeague(leagueKey, err); }
      }
      for (const [league, group] of groups) {
        if ((this.nextPollAt.get(league) || 0) > Date.now()) continue;
        try {
          const day = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
          const college = league.endsWith('/college-football') ? '&groups=80' : '';
          // ESPN football rejects date ranges. Query individual days; the prior
          // UTC day covers evening US kickoffs listed on their local date.
          const candidates = [...new Set(group.dates.flatMap(ms => [day(ms), day(ms - 86400000)]))];
          const preferred = this.preferredDay.get(league);
          const dates = preferred && candidates.includes(preferred) ? [preferred, ...candidates.filter(d => d !== preferred)] : candidates;
          const events = new Map<string, any>();
          let lastError: any;
          for (const date of dates) {
            try {
              const data = (await axios.get(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard?limit=1000&dates=${date}${college}`, { timeout: 10000 })).data;
              if (!Array.isArray(data?.events)) throw new Error('ESPN scoreboard has no events array');
              for (const event of data.events) if (!events.has(event.id)) events.set(event.id, event);
              const allFound = group.teams.every(t => [...events.values()].some(e => t.schedule.some(g => g.id ? g.id === e.id : Math.abs(Date.parse(g.date) - Date.parse(e.date)) < 12 * 60 * 60 * 1000)));
              if (allFound) { this.preferredDay.set(league, date); break; }
            } catch (err: any) {
              if (!err.response || err.response.status === 429 || err.response.status === 403 || err.response.status >= 500) throw err;
              lastError = err;
            }
          }
          if (!events.size && lastError) throw lastError;
          const currentTeams = group.teams.filter(t => this.trackedTeams.get(t.flowId) === t);
          const currentEvents = [...events.values()];
          this.processLeagueEvents(currentEvents, currentTeams);
          this.failures.delete(league); this.backoffUntil.delete(league);
          const delay = this.pollDelay(currentEvents, currentTeams);
          this.nextPollAt.set(league, Date.now() + delay);
          console.log(`[Sports polling] ${league}: next scoreboard check in ${delay / 1000}s`);
        } catch (err: any) { this.deferLeague(league, err); }
      }
    } finally {
      this.busy = false;
      if (this.trackedTeams.size && !this.timer) {
        const due = [...groups.keys()].map(key => (this.nextPollAt.get(key) || Date.now() + 30000) - Date.now());
        const wait = Math.max(1000, Math.min(30000, ...due));
        this.timer = setTimeout(() => { this.timer = null; void this.poll(); }, wait);
      }
    }
  }

  private processLeagueEvents(events: any[], teams: TrackedTeam[]): void {
    // Process score celebrations before win celebrations, so a win can take priority.
    const ordered = [...teams].sort((a, b) => Number(a.trigger.properties.event === 'win') - Number(b.trigger.properties.event === 'win'));
    for (const team of ordered) {
      const props = team.trigger.properties;
      const name = props.team.trim().toLowerCase();
      for (const event of events) {
        if (!event.id || !team.schedule.some(g => g.id ? g.id === event.id : Math.abs(Date.parse(g.date) - Date.parse(event.date)) < 12 * 60 * 60 * 1000)) continue;
        const competition = event.competitions?.[0];
        const mine = competition?.competitors?.find((c: any) => team.teamId ? c.team?.id === team.teamId :
          ['name', 'displayName', 'abbreviation', 'shortDisplayName'].some(k => c.team?.[k]?.toLowerCase() === name));
        if (!mine) continue;
        const score = Number(mine.score);
        const state = event.status?.type?.state || competition.status?.type?.state;
        if (!Number.isFinite(score) || !['pre', 'in', 'post'].includes(state)) continue;
        const key = [team.flowId, props.sport, props.league, team.teamId || name, props.event || 'score', event.id].join(':');
        const previous = this.states[key];
        const won = state === 'post' && mine.winner === true;
        // A first observation establishes a baseline; never celebrate an old score or final on startup.
        const victoryReady = won && teams.some(t => {
          if (t.trigger.properties.event !== 'win' || t.teamId !== team.teamId || t.trigger.properties.team !== props.team) return false;
          const winKey = [t.flowId, props.sport, props.league, t.teamId || name, 'win', event.id].join(':');
          return this.states[winKey] && !this.states[winKey].winHandled;
        });
        const fire = !!previous && (props.event === 'kickoff'
          ? !previous.kickoffHandled && previous.state === 'pre' && state === 'in'
          : props.event === 'win'
          ? won && !previous.winHandled
          : !victoryReady && (state === 'in' || state === 'post') && score > previous.score);
        this.states[key] = { score: Math.max(previous?.score ?? score, score), state,
          winHandled: previous?.winHandled || state === 'post', kickoffHandled: previous?.kickoffHandled || state !== 'pre' };
        try { this.saveState(); }
        catch (err: any) { console.error('Cannot checkpoint sports event; skipping celebration:', err.message); continue; }
        if (fire) {
          console.log(`[Sports] ${props.team} ${props.event || 'score'} event ${event.id}: ${previous.score} -> ${score}`);
          team.executeCallback();
        }
      }
    }
  }
}

export const scoreboardService = new ScoreboardService();
