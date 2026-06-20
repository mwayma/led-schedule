import axios from 'axios';
import { SportsScoreTrigger, Flow } from '../types';

interface TrackedTeam {
  flowId: string;
  trigger: SportsScoreTrigger;
  teamId?: string; // cached ESPN team ID
  gameStartTimes: Date[]; // list of scheduled game times (either auto or manual)
  lastScheduleFetch: Date | null;
  lastCompletedGameTime?: string; // ISO string of gameStartTime that was completed
  currentGameStartTime?: string; // ISO string of currently active game start time
  isGameActive: boolean; // whether this game is currently active
  lastScore: number | null;
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  lastChecked: Date;
  executeCallback: () => void;
}

export class ScoreboardService {
  private trackedTeams: Map<string, TrackedTeam> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private isPollCycleRunning: boolean = false;

  constructor() {}

  public registerFlow(flow: Flow, executeCallback: () => void): void {
    if (flow.trigger.type !== 'sports_score') return;

    const trigger = flow.trigger as SportsScoreTrigger;
    const key = flow.id;

    console.log(`Registering sports trigger for flow '${flow.name}': Team '${trigger.properties.team}' in ${trigger.properties.league}`);

    // If already tracked, keep relevant cached state
    const existing = this.trackedTeams.get(key);
    this.trackedTeams.set(key, {
      flowId: flow.id,
      trigger,
      teamId: existing ? existing.teamId : undefined,
      gameStartTimes: existing ? existing.gameStartTimes : [],
      lastScheduleFetch: existing ? existing.lastScheduleFetch : null,
      lastCompletedGameTime: existing ? existing.lastCompletedGameTime : undefined,
      currentGameStartTime: existing ? existing.currentGameStartTime : undefined,
      isGameActive: existing ? existing.isGameActive : false,
      lastScore: existing ? existing.lastScore : null,
      gameState: existing ? existing.gameState : 'unknown',
      lastChecked: new Date(),
      executeCallback
    });

    this.startPolling();
  }

  public unregisterFlow(flowId: string): void {
    if (this.trackedTeams.has(flowId)) {
      console.log(`Unregistering sports trigger for flow ID '${flowId}'`);
      this.trackedTeams.delete(flowId);
    }

    if (this.trackedTeams.size === 0) {
      this.stopPolling();
    }
  }

  public clear(): void {
    console.log('Clearing all tracked sports teams and stopping poller.');
    this.trackedTeams.clear();
    this.stopPolling();
  }

  public startPolling(): void {
    if (this.checkInterval) return;
    console.log('Starting Sports Scoreboard Scheduler...');
    
    // Run checking cycle immediately
    this.checkSchedulesAndPoll();
    
    // Run every minute (60000 ms)
    this.checkInterval = setInterval(() => {
      this.checkSchedulesAndPoll();
    }, 60000);
  }

  public stopPolling(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('Stopped Sports Scoreboard poller/scheduler.');
  }

  private async checkSchedulesAndPoll(): Promise<void> {
    const now = new Date();
    let anyGameActive = false;

    for (const tracked of this.trackedTeams.values()) {
      // 1. Resolve/refresh schedule based on mode
      const mode = tracked.trigger.properties.scheduleMode || 'auto';
      if (mode === 'manual') {
        const manual = tracked.trigger.properties.manualSchedule || [];
        tracked.gameStartTimes = manual
          .map(str => new Date(str))
          .filter(d => !isNaN(d.getTime()))
          .sort((a, b) => a.getTime() - b.getTime());
        tracked.lastScheduleFetch = new Date();
      } else {
        // Auto mode
        const needsFetch = !tracked.lastScheduleFetch || 
                           (now.getTime() - tracked.lastScheduleFetch.getTime() > 12 * 60 * 60 * 1000) ||
                           (tracked.gameStartTimes.length === 0 && (!tracked.lastScheduleFetch || now.getTime() - tracked.lastScheduleFetch.getTime() > 1 * 60 * 60 * 1000));
        if (needsFetch) {
          await this.refreshAutoSchedule(tracked);
        }
      }

      // 2. Check if a game is currently active
      let isThisGameActive = false;
      for (const gameTime of tracked.gameStartTimes) {
        const timeDiffMs = now.getTime() - gameTime.getTime();
        const fifteenMinsMs = 15 * 60 * 1000;
        const fiveHoursMs = 5 * 60 * 60 * 1000;

        // Active if current time is between S - 15 minutes and S + 5 hours
        if (timeDiffMs >= -fifteenMinsMs && timeDiffMs <= fiveHoursMs) {
          const gameTimeStr = gameTime.toISOString();
          if (tracked.lastCompletedGameTime !== gameTimeStr) {
            isThisGameActive = true;
            tracked.currentGameStartTime = gameTimeStr;
            break;
          }
        }
      }

      tracked.isGameActive = isThisGameActive;
      if (isThisGameActive) {
        anyGameActive = true;
      }
    }

    // 3. Manage the score polling timer
    if (anyGameActive) {
      if (!this.pollTimer && !this.isPollCycleRunning) {
        console.log('Active sports game(s) detected. Starting high-frequency scoreboard polling...');
        this.runPollCycle();
      }
    } else {
      if (this.pollTimer) {
        console.log('No active sports games. Stopping scoreboard polling...');
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    }
  }

  private async runPollCycle(): Promise<void> {
    this.isPollCycleRunning = true;
    try {
      await this.pollAllLeagues();
    } catch (err) {
      console.error('Error in sports poll cycle:', err);
    } finally {
      this.isPollCycleRunning = false;
    }

    // Double check if we still have active games
    let stillHasActiveGame = false;
    for (const team of this.trackedTeams.values()) {
      if (team.isGameActive) {
        stillHasActiveGame = true;
        break;
      }
    }

    if (stillHasActiveGame) {
      this.pollTimer = setTimeout(() => this.runPollCycle(), 30000);
    } else {
      this.pollTimer = null;
    }
  }

  private async refreshAutoSchedule(tracked: TrackedTeam): Promise<void> {
    const { sport, league, team } = tracked.trigger.properties;
    console.log(`Refreshing auto schedule for ${team} (${sport}/${league})...`);
    
    try {
      let teamId = tracked.teamId;
      if (!teamId) {
        const fetchedId = await this.fetchTeamId(sport, league, team);
        if (fetchedId) {
          tracked.teamId = fetchedId;
          teamId = fetchedId;
        } else {
          console.error(`Could not find team ID for team: ${team}`);
          tracked.lastScheduleFetch = new Date(); // prevent fast retrying on failure
          return;
        }
      }

      const url = `https://site.api.espn.com/apis/site/v2/sports/${sport.toLowerCase()}/${league.toLowerCase()}/teams/${teamId}/schedule`;
      const response = await axios.get(url, { timeout: 10000 });
      const events = response.data?.events;
      if (Array.isArray(events)) {
        const gameTimes: Date[] = [];
        for (const event of events) {
          if (event.date) {
            gameTimes.push(new Date(event.date));
          }
        }
        gameTimes.sort((a, b) => a.getTime() - b.getTime());
        tracked.gameStartTimes = gameTimes;
        console.log(`Successfully loaded ${gameTimes.length} games for ${team}.`);
      }
      tracked.lastScheduleFetch = new Date();
    } catch (err: any) {
      console.error(`Failed to refresh schedule for ${team}:`, err.message);
      tracked.lastScheduleFetch = new Date(); // prevent fast retrying on failure
    }
  }

  private async fetchTeamId(sport: string, league: string, teamName: string): Promise<string | null> {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport.toLowerCase()}/${league.toLowerCase()}/teams?limit=100`;
    try {
      const response = await axios.get(url, { timeout: 10000 });
      const teamsData = response.data?.sports?.[0]?.leagues?.[0]?.teams;
      if (!Array.isArray(teamsData)) return null;
      
      const searchName = teamName.toLowerCase().trim();
      for (const t of teamsData) {
        const team = t.team;
        if (!team) continue;
        
        const name = team.name?.toLowerCase().trim();
        const displayName = team.displayName?.toLowerCase().trim();
        const abbreviation = team.abbreviation?.toLowerCase().trim();
        const shortDisplayName = team.shortDisplayName?.toLowerCase().trim();
        
        if (name === searchName || 
            displayName === searchName || 
            abbreviation === searchName || 
            shortDisplayName === searchName) {
          return team.id;
        }
      }
    } catch (err: any) {
      console.error(`Failed to fetch team list for ID lookup:`, err.message);
    }
    return null;
  }

  private async pollAllLeagues(): Promise<void> {
    const leagueGroups: { [key: string]: { sport: string; league: string; teams: TrackedTeam[] } } = {};

    for (const tracked of this.trackedTeams.values()) {
      if (!tracked.isGameActive) continue;

      const sport = tracked.trigger.properties.sport.toLowerCase();
      const league = tracked.trigger.properties.league.toLowerCase();
      const key = `${sport}/${league}`;

      if (!leagueGroups[key]) {
        leagueGroups[key] = { sport, league, teams: [] };
      }
      leagueGroups[key].teams.push(tracked);
    }

    for (const groupKey of Object.keys(leagueGroups)) {
      const { sport, league, teams } = leagueGroups[groupKey];
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        if (!data || !Array.isArray(data.events)) {
          continue;
        }

        this.processLeagueEvents(data.events, teams);
      } catch (err: any) {
        console.error(`Failed to fetch scoreboard for ${sport}/${league}:`, err.message);
      }
    }
  }

  private processLeagueEvents(events: any[], trackedTeams: TrackedTeam[]): void {
    for (const tracked of trackedTeams) {
      const targetTeamName = tracked.trigger.properties.team.toLowerCase();
      let gameFound = false;

      for (const event of events) {
        const competition = event.competitions?.[0];
        if (!competition || !Array.isArray(competition.competitors)) continue;

        const competitors = competition.competitors;
        const myTeamData = competitors.find((c: any) => 
          c.team?.name?.toLowerCase() === targetTeamName ||
          c.team?.displayName?.toLowerCase() === targetTeamName ||
          c.team?.abbreviation?.toLowerCase() === targetTeamName ||
          c.team?.shortDisplayName?.toLowerCase() === targetTeamName
        );

        if (myTeamData) {
          gameFound = true;
          const gameState = event.status?.type?.state || 'unknown'; // 'pre', 'in', 'post'
          const score = parseInt(myTeamData.score || '0', 10);

          const previousState = tracked.gameState;
          const previousScore = tracked.lastScore;

          tracked.gameState = gameState;
          tracked.lastChecked = new Date();

          if (previousState !== gameState) {
            console.log(`Game state for ${tracked.trigger.properties.team} changed from ${previousState} to ${gameState}`);
          }

          if (gameState === 'in') {
            if (previousScore !== null && score > previousScore) {
              console.log(`Score increase detected for ${tracked.trigger.properties.team}! ${previousScore} -> ${score}. TRIGGERING CELEBRATION!`);
              tracked.executeCallback();
            }
            tracked.lastScore = score;
          } else if (gameState === 'pre') {
            tracked.lastScore = 0;
          } else if (gameState === 'post') {
            tracked.lastScore = score;
            
            // Mark the active game as completed so we stop polling it
            if (tracked.currentGameStartTime) {
              console.log(`Game starting at ${tracked.currentGameStartTime} for ${tracked.trigger.properties.team} is marked post/completed. Stopping polling for this game.`);
              tracked.lastCompletedGameTime = tracked.currentGameStartTime;
              tracked.currentGameStartTime = undefined;
              tracked.isGameActive = false;
            }
          }
          break;
        }
      }
    }
  }
}

export const scoreboardService = new ScoreboardService();
