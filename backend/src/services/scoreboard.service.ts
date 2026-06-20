import axios from 'axios';
import { SportsScoreTrigger, Flow } from '../types';

interface TrackedTeam {
  flowId: string;
  trigger: SportsScoreTrigger;
  lastScore: number | null;
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  lastChecked: Date;
  executeCallback: () => void;
}

export class ScoreboardService {
  private trackedTeams: Map<string, TrackedTeam> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs: number = 30000; // Poll active games every 30s
  private idlePollIntervalMs: number = 300000; // Poll scheduled/inactive every 5m
  private isPolling: boolean = false;

  constructor() {}

  public registerFlow(flow: Flow, executeCallback: () => void): void {
    if (flow.trigger.type !== 'sports_score') return;

    const trigger = flow.trigger as SportsScoreTrigger;
    const key = flow.id;

    console.log(`Registering sports trigger for flow '${flow.name}': Team '${trigger.properties.team}' in ${trigger.properties.league}`);

    // If already tracked, keep the last score if possible
    const existing = this.trackedTeams.get(key);
    this.trackedTeams.set(key, {
      flowId: flow.id,
      trigger,
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

  public startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;
    console.log('Starting Sports Scoreboard Poller...');
    this.runPollCycle();
  }

  public stopPolling(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isPolling = false;
    console.log('Stopped Sports Scoreboard Poller.');
  }

  private async runPollCycle(): Promise<void> {
    if (!this.isPolling) return;

    try {
      await this.pollAllLeagues();
    } catch (err) {
      console.error('Error in sports poll cycle:', err);
    }

    // Determine next poll interval
    // If we have any active game ('in'), poll fast (30s). Otherwise poll slow (5m).
    let hasActiveGame = false;
    for (const team of this.trackedTeams.values()) {
      if (team.gameState === 'in') {
        hasActiveGame = true;
        break;
      }
    }

    const interval = hasActiveGame ? this.pollIntervalMs : this.idlePollIntervalMs;
    
    if (this.isPolling) {
      this.timer = setTimeout(() => this.runPollCycle(), interval);
    }
  }

  private async pollAllLeagues(): Promise<void> {
    // Group tracked teams by league to minimize API calls
    const leagueGroups: { [key: string]: { sport: string; league: string; teams: TrackedTeam[] } } = {};

    for (const tracked of this.trackedTeams.values()) {
      const sport = tracked.trigger.properties.sport.toLowerCase();
      const league = tracked.trigger.properties.league.toLowerCase();
      const key = `${sport}/${league}`;

      if (!leagueGroups[key]) {
        leagueGroups[key] = { sport, league, teams: [] };
      }
      leagueGroups[key].teams.push(tracked);
    }

    // Fetch and process each league
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

        // Check if our team is playing in this game
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

          // Log game state changes
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
            // Reset score to 0 before the game starts
            tracked.lastScore = 0;
          } else if (gameState === 'post') {
            // Keep the score but don't trigger updates
            tracked.lastScore = score;
          }
          break; // Found the game for this team, no need to check other events
        }
      }

      if (!gameFound) {
        // No current game found in the scoreboard list for this team
        tracked.gameState = 'unknown';
        tracked.lastScore = null;
      }
    }
  }
}

// Export singleton instance
export const scoreboardService = new ScoreboardService();
