import type { TextChannel } from "discord.js";

export enum Faction {
  TOWN = "TOWN",
  EVIL = "EVIL",
  NEUTRAL = "NEUTRAL",
}

export enum Role {
  MAUSHOLD = "MAUSHOLD",
  ALAKAZAM = "ALAKAZAM",
  CHANSEY = "CHANSEY",
  GENGAR = "GENGAR",
  DITTO = "DITTO",
  MIMIKYU = "MIMIKYU",
}

export enum GameStatus {
  LOBBY = "LOBBY",
  RUNNING = "RUNNING",
  ENDED = "ENDED",
}

export enum GamePhase {
  NIGHT = "NIGHT",
  DAY = "DAY",
  VOTING = "VOTING",
}

export interface RoleConfig {
  role: Role;
  faction: Faction;
  hasNightAction: boolean;
  commandHint: string;
  description: string;
}

export interface GameSettings {
  nightDurationSec: number;
  dayDurationSec: number;
  voteDurationSec: number;
  revealRoles: boolean;
  allowSelfTarget: boolean;
  noRepeatProtect: boolean;
}

export interface PlayerState {
  userId: string;
  displayName: string;
  role: Role;
  faction: Faction;
  alive: boolean;
  lastProtectedTargetId?: string;
  copiedRole?: Role;
  dmOk?: boolean;
}

export interface NightActions {
  gengarTargetId?: string;
  chanseyTargetId?: string;
  alakazamTargetId?: string;
  submittedBy: Set<Role>;
}

export interface VoteState {
  votesByVoterId: Map<string, string>;
  locked: boolean;
  startedAt?: number;
}

export interface GameState {
  guildId: string;
  channelId: string;
  hostId: string;
  status: GameStatus;
  phase: GamePhase;
  dayNumber: number;
  players: Map<string, PlayerState>;
  aliveIds: Set<string>;
  deadIds: Set<string>;
  actions: NightActions;
  votes: VoteState;
  timers: {
    nightTimer?: NodeJS.Timeout;
    dayTimer?: NodeJS.Timeout;
    voteTimer?: NodeJS.Timeout;
  };
  settings: GameSettings;
  channel?: TextChannel;
  winnerText?: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  nightDurationSec: 60,
  dayDurationSec: 120,
  voteDurationSec: 60,
  revealRoles: true,
  allowSelfTarget: false,
  noRepeatProtect: true,
};

export const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  [Role.MAUSHOLD]: {
    role: Role.MAUSHOLD,
    faction: Faction.TOWN,
    hasNightAction: false,
    commandHint: "No night action.",
    description: "A loyal family member. Use discussion and voting to win.",
  },
  [Role.ALAKAZAM]: {
    role: Role.ALAKAZAM,
    faction: Faction.TOWN,
    hasNightAction: true,
    commandHint: "Use /mafia inspect @user during NIGHT.",
    description: "Investigate one player each night and learn their apparent faction.",
  },
  [Role.CHANSEY]: {
    role: Role.CHANSEY,
    faction: Faction.TOWN,
    hasNightAction: true,
    commandHint: "Use /mafia protect @user during NIGHT.",
    description: "Protect one player each night from Gengar's elimination.",
  },
  [Role.GENGAR]: {
    role: Role.GENGAR,
    faction: Faction.EVIL,
    hasNightAction: true,
    commandHint: "Use /mafia haunt @user during NIGHT.",
    description: "Eliminate one target each night.",
  },
  [Role.DITTO]: {
    role: Role.DITTO,
    faction: Faction.EVIL,
    hasNightAction: false,
    commandHint: "No night action in MVP.",
    description: "Always appears TOWN to investigations.",
  },
  [Role.MIMIKYU]: {
    role: Role.MIMIKYU,
    faction: Faction.NEUTRAL,
    hasNightAction: false,
    commandHint: "No night action.",
    description: "Win instantly if eliminated by day vote.",
  },
};
