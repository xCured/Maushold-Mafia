import {
    ChannelType,
    EmbedBuilder,
    type ChatInputCommandInteraction,
    type Client,
    type GuildMember,
    type TextChannel,
} from "discord.js";
import {
    DEFAULT_SETTINGS,
    Faction,
    GamePhase,
    GameState,
    GameStatus,
    type PlayerState,
    Role,
    ROLE_CONFIGS,
} from "./types";

const MIN_PLAYERS = 6;
const gamesByChannel = new Map<string, GameState>();

function shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function resetNightActions(game: GameState): void {
    game.actions = { submittedBy: new Set<Role>() };
}

function resetVotes(game: GameState): void {
    game.votes = { votesByVoterId: new Map(), locked: false };
}

function clearTimers(game: GameState): void {
    if (game.timers.nightTimer) clearTimeout(game.timers.nightTimer);
    if (game.timers.dayTimer) clearTimeout(game.timers.dayTimer);
    if (game.timers.voteTimer) clearTimeout(game.timers.voteTimer);
    if (game.timers.nightReminder20) clearTimeout(game.timers.nightReminder20);
    if (game.timers.dayReminder60) clearTimeout(game.timers.dayReminder60);
    if (game.timers.dayReminder20) clearTimeout(game.timers.dayReminder20);
    if (game.timers.voteReminder20) clearTimeout(game.timers.voteReminder20);
    game.timers = {};
}

async function createDeadThread(game: GameState): Promise<void> {
    if (!game.channel) return;

    try {
        const thread = await game.channel.threads.create({
            name: `💀 dead-chat-day-${game.dayNumber}`,
            autoArchiveDuration: 60,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: "Dead players discussion thread for Maushold Mafia",
        });

        game.deadThreadId = thread.id;
        await thread.send("💀 Dead chat is open. Only eliminated players can talk here.");
    } catch {
        // Ignore permission/thread creation failures; game can continue without dead thread.
    }
}

async function lockMainChannelToGamePlayers(game: GameState): Promise<void> {
    if (!game.channel?.guild) return;

    try {
        await game.channel.permissionOverwrites.edit(game.channel.guild.roles.everyone.id, {
            SendMessages: false,
            AddReactions: false,
        });

        for (const player of game.players.values()) {
            await game.channel.permissionOverwrites.edit(player.userId, {
                SendMessages: true,
                AddReactions: true,
            });
        }

        game.channelLockedForGame = true;
    } catch {
        game.channelLockedForGame = false;
        // Ignore permission failures in case bot lacks Manage Channels/Permissions.
    }
}

async function silenceInMainChannel(game: GameState, userId: string): Promise<void> {
    if (!game.channel?.guild) return;

    try {
        await game.channel.permissionOverwrites.edit(userId, {
            SendMessages: false,
            AddReactions: false,
        });
    } catch {
        // Ignore permission failures in case bot lacks Manage Channels/Permissions.
    }
}

async function addToDeadThread(game: GameState, userId: string): Promise<void> {
    if (!game.channel?.guild || !game.deadThreadId) return;

    try {
        const thread = await game.channel.threads.fetch(game.deadThreadId);
        if (!thread || thread.type !== ChannelType.PrivateThread) return;
        await thread.members.add(userId);
    } catch {
        // Ignore failures to add users to thread (permissions or thread state).
    }
}

async function handlePlayerDeath(game: GameState, userId: string): Promise<void> {
    const player = game.players.get(userId);
    if (!player || !player.alive) return;

    player.alive = false;
    game.aliveIds.delete(userId);
    game.deadIds.add(userId);

    await silenceInMainChannel(game, userId);
    await addToDeadThread(game, userId);
}

async function restoreMainChannelPermissions(game: GameState): Promise<void> {
    if (!game.channel) return;

    for (const player of game.players.values()) {
        try {
            await game.channel.permissionOverwrites.delete(player.userId);
        } catch {
            // Ignore cleanup failures.
        }
    }

    if (game.channelLockedForGame) {
        try {
            await game.channel.permissionOverwrites.delete(game.channel.guild.roles.everyone.id);
        } catch {
            // Ignore cleanup failures.
        }

        game.channelLockedForGame = false;
    }
}

async function archiveDeadThread(game: GameState): Promise<void> {
    if (!game.channel?.guild || !game.deadThreadId) return;

    try {
        const thread = await game.channel.threads.fetch(game.deadThreadId);
        if (thread?.isThread()) {
            await thread.setArchived(true, "Game ended");
            await thread.setLocked(true, "Game ended");
        }
    } catch {
        // Ignore thread cleanup failures.
    }
}

export function getRoleList(nPlayers: number): Role[] {
    if (nPlayers < MIN_PLAYERS) {
        throw new Error(`At least ${MIN_PLAYERS} players are required.`);
    }

    const roles: Role[] = [Role.GENGAR, Role.ALAKAZAM, Role.CHANSEY];

    if (nPlayers >= 8) roles.push(Role.DITTO);
    if (nPlayers >= 11) roles.push(Role.MIMIKYU);

    while (roles.length < nPlayers) roles.push(Role.MAUSHOLD);
    return shuffle(roles);
}

export function getGame(channelId: string): GameState | undefined {
    return gamesByChannel.get(channelId);
}

export function formatRole(role: Role): string {
    return role.toLowerCase().replace("_", " ");
}


async function ensurePrivateRoleThread(game: GameState, player: PlayerState): Promise<string | undefined> {
    if (!game.channel) return undefined;

    if (player.roleThreadId) {
        try {
            const existing = await game.channel.threads.fetch(player.roleThreadId);
            if (existing?.isThread()) return existing.id;
        } catch {
            player.roleThreadId = undefined;
        }
    }

    try {
        const sanitized = player.displayName.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 24) || "player";
        const thread = await game.channel.threads.create({
            name: `🔒 role-${sanitized}`,
            autoArchiveDuration: 60,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: "Private role thread for Maushold Mafia player",
        });

        await thread.members.add(player.userId);
        player.roleThreadId = thread.id;
        return thread.id;
    } catch {
        return undefined;
    }
}

async function sendRoleInfoInPrivateThread(game: GameState, player: PlayerState): Promise<void> {
    const threadId = await ensurePrivateRoleThread(game, player);
    if (!threadId || !game.channel) return;

    try {
        const thread = await game.channel.threads.fetch(threadId);
        if (!thread?.isThread()) return;
        const roleCfg = ROLE_CONFIGS[player.role];
        const investigationNote = player.lastInvestigationNote ? `

${player.lastInvestigationNote}` : "";
        const teammateInfo = evilTeammateLine(game, player);
        await thread.send(
            `🎭 Your role is **${formatRole(player.role)}** (${player.faction}).
${roleCfg.description}
${roleCfg.commandHint}${teammateInfo}${investigationNote}`,
        );
    } catch {
        // Ignore if role thread messaging fails.
    }
}

async function archiveRoleThreads(game: GameState): Promise<void> {
    if (!game.channel) return;

    for (const player of game.players.values()) {
        if (!player.roleThreadId) continue;
        try {
            const thread = await game.channel.threads.fetch(player.roleThreadId);
            if (thread?.isThread()) {
                await thread.setArchived(true, "Game ended");
                await thread.setLocked(true, "Game ended");
            }
        } catch {
            // Ignore role-thread cleanup failures.
        }
    }
}

function aliveMentions(game: GameState): string {
    return [...game.aliveIds].map((id) => `<@${id}>`).join(", ");
}

function evilTeammateLine(game: GameState, player: PlayerState): string {
    if (player.faction !== Faction.EVIL) return "";

    const allies = [...game.players.values()]
        .filter((p) => p.faction === Faction.EVIL && p.userId !== player.userId)
        .map((p) => `<@${p.userId}> (**${formatRole(p.role)}**)`);

    if (allies.length === 0) return "\n\n🕶️ You have no known EVIL allies this game.";
    return `\n\n🕶️ EVIL allies: ${allies.join(", ")}`;
}

function checkWinConditions(game: GameState): string | undefined {
    let aliveTown = 0;
    let aliveEvil = 0;

    for (const id of game.aliveIds) {
        const p = game.players.get(id);
        if (!p) continue;
        if (p.faction === Faction.TOWN) aliveTown += 1;
        if (p.faction === Faction.EVIL) aliveEvil += 1;
    }

    if (aliveEvil === 0) return "🏆 Town wins! All EVIL roles have been eliminated.";
    if (aliveEvil >= aliveTown) return "💀 Evil wins! Gengar's side now controls the game.";
    return undefined;
}

async function endGame(game: GameState, reason: string): Promise<void> {
    game.status = GameStatus.ENDED;
    clearTimers(game);
    game.winnerText = reason;

    if (game.channel) {
        const reveal = [...game.players.values()]
            .map((p) => `• **${p.displayName}** — ${formatRole(p.role)} (${p.faction})`)
            .join("\n");

        await game.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🎉 Game Over")
                    .setDescription(`${reason}\n\n**Role Reveal**\n${reveal}`)
                    .setColor(0xffc0cb),
            ],
        });
    }

    await restoreMainChannelPermissions(game);
    await archiveDeadThread(game);
    await archiveRoleThreads(game);
    gamesByChannel.delete(game.channelId);
}

async function beginVoting(client: Client, game: GameState): Promise<void> {
    game.phase = GamePhase.VOTING;
    resetVotes(game);
    game.votes.startedAt = Date.now();

    await game.channel?.send({
        embeds: [
            new EmbedBuilder()
                .setTitle("🔄 New Phase: 🗳️ Voting")
                .setDescription("Voting has started. Use `/mafia vote @user` or the Vote button. Ties result in no elimination.")
                .setColor(0xf4d03f),
        ],
    });

    if (game.settings.voteDurationSec > 20) {
        game.timers.voteReminder20 = setTimeout(async () => {
            await game.channel?.send("⏳ Voting reminder: 20 seconds remaining!");
        }, (game.settings.voteDurationSec - 20) * 1000);
    }

    game.timers.voteTimer = setTimeout(async () => {
        await endVotingAndResolve(client, game);
    }, game.settings.voteDurationSec * 1000);
}

async function beginDay(client: Client, game: GameState): Promise<void> {
    game.phase = GamePhase.DAY;

    await game.channel?.send({
        embeds: [
            new EmbedBuilder()
                .setTitle(`🔄 New Phase: 🧀 Day ${game.dayNumber} Discussion`)
                .setDescription(`Alive: ${aliveMentions(game)}\nDiscuss now — voting opens after this phase.`)
                .setColor(0x58d68d),
        ],
    });

    if (game.settings.dayDurationSec > 60) {
        game.timers.dayReminder60 = setTimeout(async () => {
            await game.channel?.send("⏳ Day discussion reminder: 60 seconds remaining!");
        }, (game.settings.dayDurationSec - 60) * 1000);
    }

    if (game.settings.dayDurationSec > 20) {
        game.timers.dayReminder20 = setTimeout(async () => {
            await game.channel?.send("⏳ Day discussion reminder: 20 seconds remaining!");
        }, (game.settings.dayDurationSec - 20) * 1000);
    }

    game.timers.dayTimer = setTimeout(async () => {
        await beginVoting(client, game);
    }, game.settings.dayDurationSec * 1000);
}

async function beginNight(client: Client, game: GameState): Promise<void> {
    game.phase = GamePhase.NIGHT;
    resetNightActions(game);

    await game.channel?.send({
        embeds: [
            new EmbedBuilder()
                .setTitle(`🔄 New Phase: 🌙 Night ${game.dayNumber}`)
                .setDescription(`Alive: ${aliveMentions(game)}\nPower roles, use your role action now. (Use /mafia actions or the My Role button.)`)
                .setColor(0x5dade2),
        ],
    });

    if (game.settings.nightDurationSec > 20) {
        game.timers.nightReminder20 = setTimeout(async () => {
            await game.channel?.send("⏳ Night reminder: 20 seconds remaining!");
        }, (game.settings.nightDurationSec - 20) * 1000);
    }

    game.timers.nightTimer = setTimeout(async () => {
        await endNightAndResolve(client, game);
    }, game.settings.nightDurationSec * 1000);
}

async function endNightAndResolve(client: Client, game: GameState): Promise<void> {
    const killTarget = game.actions.gengarTargetId;
    const protectedTarget = game.actions.chanseyTargetId;
    const inspectTarget = game.actions.alakazamTargetId;

    let killedId: string | undefined;
    let attackedButSaved = false;

    if (killTarget) {
        if (protectedTarget && protectedTarget === killTarget) attackedButSaved = true;
        else killedId = killTarget;
    }

    if (killedId && game.aliveIds.has(killedId)) {
        await handlePlayerDeath(game, killedId);
    }

    if (inspectTarget) {
        const investigator = [...game.players.values()].find((p) => p.role === Role.ALAKAZAM && p.alive);
        const inspected = game.players.get(inspectTarget);
        if (investigator && inspected) {
            const apparentFaction = inspected.role === Role.DITTO ? Faction.TOWN : inspected.faction;
            investigator.lastInvestigationNote = `🔮 Your vision reveals that **${inspected.displayName}** appears as **${apparentFaction}**.`;
            await sendRoleInfoInPrivateThread(game, investigator);
        }
    }

    let dawnText = "No one died last night.";
    if (killedId) {
        const dead = game.players.get(killedId);
        dawnText = dead
            ? `💀 <@${dead.userId}> was found among crumbs.${game.settings.revealRoles ? ` Role: **${formatRole(dead.role)}**.` : ""}`
            : dawnText;
    } else if (attackedButSaved) {
        dawnText = "⚔️ Someone was attacked, but they survived.";
    }

    await game.channel?.send({
        embeds: [new EmbedBuilder().setTitle(`☀️ Dawn ${game.dayNumber}`).setDescription(dawnText).setColor(0xf8c471)],
    });

    const winner = checkWinConditions(game);
    if (winner) {
        await endGame(game, winner);
        return;
    }

    await beginDay(client, game);
}

async function endVotingAndResolve(client: Client, game: GameState): Promise<void> {
    const tally = new Map<string, number>();
    for (const [voter, target] of game.votes.votesByVoterId.entries()) {
        if (!game.aliveIds.has(voter) || !game.aliveIds.has(target)) continue;
        tally.set(target, (tally.get(target) ?? 0) + 1);
    }

    let topTarget: string | undefined;
    let topCount = 0;
    let tie = false;

    for (const [target, count] of tally.entries()) {
        if (count > topCount) {
            topCount = count;
            topTarget = target;
            tie = false;
        } else if (count === topCount) {
            tie = true;
        }
    }

    if (!topTarget || tie || topCount === 0) {
        await game.channel?.send("🗳️ Vote ended in a tie (or no votes). No one is eliminated.");
        game.dayNumber += 1;
        await beginNight(client, game);
        return;
    }

    const eliminated = game.players.get(topTarget);
    if (!eliminated) {
        game.dayNumber += 1;
        await beginNight(client, game);
        return;
    }

    await handlePlayerDeath(game, topTarget);

    await game.channel?.send(
        `🔨 <@${topTarget}> was banished by vote.${game.settings.revealRoles ? ` Role: **${formatRole(eliminated.role)}**.` : ""}`,
    );

    if (eliminated.role === Role.MIMIKYU) {
        await endGame(game, "🎭 Mimikyu was voted out and wins instantly!");
        return;
    }

    const winner = checkWinConditions(game);
    if (winner) {
        await endGame(game, winner);
        return;
    }

    game.dayNumber += 1;
    await beginNight(client, game);
}

export async function createGame(interaction: ChatInputCommandInteraction): Promise<string> {
    if (!interaction.guildId || !interaction.channelId || !interaction.channel?.isTextBased()) {
        return "This command must be used in a guild text channel.";
    }

    if (gamesByChannel.has(interaction.channelId)) {
        return "A game already exists in this channel.";
    }

    const hostName = (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username;

    const hostPlayer: PlayerState = {
        userId: interaction.user.id,
        displayName: hostName,
        role: Role.MAUSHOLD,
        faction: Faction.TOWN,
        alive: true,
    };

    const game: GameState = {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        hostId: interaction.user.id,
        status: GameStatus.LOBBY,
        phase: GamePhase.NIGHT,
        dayNumber: 1,
        players: new Map([[interaction.user.id, hostPlayer]]),
        aliveIds: new Set([interaction.user.id]),
        deadIds: new Set(),
        actions: { submittedBy: new Set<Role>() },
        votes: { votesByVoterId: new Map(), locked: false },
        timers: {},
        settings: { ...DEFAULT_SETTINGS },
        channel: interaction.channel as TextChannel,
        deadThreadId: undefined,
        channelLockedForGame: false,
    };

    gamesByChannel.set(interaction.channelId, game);
    return `Lobby created by ${hostName}. Use /mafia join to enter.`;
}

export function joinGame(interaction: ChatInputCommandInteraction): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel. Use /mafia create.";
    if (game.status !== GameStatus.LOBBY) return "Game already started. You can't join now.";
    if (game.players.has(interaction.user.id)) return "You're already in the lobby.";

    const displayName = (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username;
    const player: PlayerState = {
        userId: interaction.user.id,
        displayName,
        role: Role.MAUSHOLD,
        faction: Faction.TOWN,
        alive: true,
    };

    game.players.set(interaction.user.id, player);
    game.aliveIds.add(interaction.user.id);
    return `${displayName} joined the lobby. (${game.players.size} players)`;
}

export async function leaveGame(interaction: ChatInputCommandInteraction): Promise<string> {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";

    const player = game.players.get(interaction.user.id);
    if (!player) return "You're not in this game.";

    if (game.status === GameStatus.LOBBY) {
        game.players.delete(interaction.user.id);
        game.aliveIds.delete(interaction.user.id);

        if (game.players.size === 0) {
            await restoreMainChannelPermissions(game);
            await archiveDeadThread(game);
            await archiveRoleThreads(game);
            gamesByChannel.delete(game.channelId);
            return "You left. Lobby is empty, so it was removed.";
        }

        if (game.hostId === interaction.user.id) {
            const nextHost = game.players.keys().next().value;
            if (nextHost) game.hostId = nextHost;
        }

        return "You left the lobby.";
    }

    await handlePlayerDeath(game, player.userId);
    await game.channel?.send(`🏃 <@${player.userId}> fled the kitchen and joined the dead chat.`);

    const winner = checkWinConditions(game);
    if (winner) {
        await endGame(game, winner);
        return "You fled the kitchen and are now considered dead.";
    }

    return "You fled the kitchen and are now considered dead.";
}

export function listLobby(interaction: ChatInputCommandInteraction): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    const players = [...game.players.values()].map((p) => `• ${p.displayName}`).join("\n");
    return `Host: <@${game.hostId}>\nPlayers (${game.players.size}):\n${players}`;
}

export async function startGame(interaction: ChatInputCommandInteraction, client: Client): Promise<string> {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    if (game.status !== GameStatus.LOBBY) return "Game has already started.";
    if (game.hostId !== interaction.user.id) return "Only the host can start the game.";
    if (game.players.size < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players to start.`;

    const roles = getRoleList(game.players.size);
    const ids = [...game.players.keys()];

    ids.forEach((id, idx) => {
        const player = game.players.get(id);
        if (!player) return;
        player.role = roles[idx];
        player.faction = ROLE_CONFIGS[roles[idx]].faction;
        player.alive = true;
    });

    game.status = GameStatus.RUNNING;
    game.phase = GamePhase.NIGHT;
    game.dayNumber = 1;

    await lockMainChannelToGamePlayers(game);
    await createDeadThread(game);
    await game.channel?.send("🎮 Game started! Night 1 begins.\nEach player will receive an automatic private role thread in this channel.\nEliminated players will be moved to a private dead-chat thread and muted in this main channel.");

    for (const player of game.players.values()) {
        await sendRoleInfoInPrivateThread(game, player);
    }

    await beginNight(client, game);
    return "Game started successfully.";
}

export async function cancelOrEndGame(interaction: ChatInputCommandInteraction, forced = false): Promise<string> {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";

    const member = interaction.member as GuildMember | null;
    const canForce = Boolean(member?.permissions.has("ManageGuild"));
    if (interaction.user.id !== game.hostId && !canForce && !forced) {
        return "Only host or server mods can end/cancel the game.";
    }

    clearTimers(game);
    await restoreMainChannelPermissions(game);
    await archiveDeadThread(game);
    await archiveRoleThreads(game);
    gamesByChannel.delete(game.channelId);
    return "Game ended and cleaned up.";
}

export function statusText(interaction: ChatInputCommandInteraction): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";

    return [
        `Status: **${game.status}**`,
        `Phase: **${game.phase}**`,
        `Day: **${game.dayNumber}**`,
        `Alive (${game.aliveIds.size}): ${aliveMentions(game) || "None"}`,
    ].join("\n");
}

export function actionReminder(interaction: ChatInputCommandInteraction): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";

    const player = game.players.get(interaction.user.id);
    if (!player) return "You're not in this game.";
    const roleCfg = ROLE_CONFIGS[player.role];
    const teammateInfo = evilTeammateLine(game, player);
    const investigationNote = player.lastInvestigationNote ? `\n\n${player.lastInvestigationNote}` : "";
    return `Role: **${formatRole(player.role)}** (${player.faction})\n${roleCfg.description}\n${roleCfg.commandHint}${teammateInfo}${investigationNote}`;
}

function validateNightAction(
    game: GameState,
    actor: PlayerState,
    targetId: string,
    requiredRole: Role,
): string | undefined {
    if (game.status !== GameStatus.RUNNING) return "Game is not running.";
    if (game.phase !== GamePhase.NIGHT) return "Night actions can only be used during NIGHT.";
    if (!actor.alive) return "Dead players can't act.";
    if (actor.role !== requiredRole) return `Only ${formatRole(requiredRole)} can use this command.`;
    if (!game.aliveIds.has(targetId)) return "Target must be alive.";
    if (!game.settings.allowSelfTarget && targetId === actor.userId) return "You cannot target yourself.";
    return undefined;
}


export function configureGame(interaction: ChatInputCommandInteraction, hideVotes?: boolean): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    if (interaction.user.id !== game.hostId) return "Only the host can change game settings.";

    if (typeof hideVotes === "boolean") {
        game.settings.hideVotes = hideVotes;
        return `Settings updated: hideVotes is now **${hideVotes ? "ON" : "OFF"}**.`;
    }

    return `Current settings: hideVotes=**${game.settings.hideVotes ? "ON" : "OFF"}**.`;
}

export function submitHaunt(interaction: ChatInputCommandInteraction, targetId: string): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    const actor = game.players.get(interaction.user.id);
    if (!actor) return "You're not in this game.";

    const err = validateNightAction(game, actor, targetId, Role.GENGAR);
    if (err) return err;

    game.actions.gengarTargetId = targetId;
    game.actions.submittedBy.add(Role.GENGAR);
    return `✅ Haunt action set on <@${targetId}>.`;
}

export function submitProtect(interaction: ChatInputCommandInteraction, targetId: string): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    const actor = game.players.get(interaction.user.id);
    if (!actor) return "You're not in this game.";

    const err = validateNightAction(game, actor, targetId, Role.CHANSEY);
    if (err) return err;

    if (game.settings.noRepeatProtect && actor.lastProtectedTargetId === targetId) {
        return "Chansey cannot protect the same target on consecutive nights.";
    }

    game.actions.chanseyTargetId = targetId;
    game.actions.submittedBy.add(Role.CHANSEY);
    actor.lastProtectedTargetId = targetId;
    return `✅ Protection set on <@${targetId}>.`;
}

export function submitInspect(interaction: ChatInputCommandInteraction, targetId: string): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    const actor = game.players.get(interaction.user.id);
    if (!actor) return "You're not in this game.";

    const err = validateNightAction(game, actor, targetId, Role.ALAKAZAM);
    if (err) return err;

    game.actions.alakazamTargetId = targetId;
    game.actions.submittedBy.add(Role.ALAKAZAM);
    return `✅ Inspection set on <@${targetId}>.`;
}

export function submitVote(interaction: ChatInputCommandInteraction, targetId: string): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    if (game.status !== GameStatus.RUNNING) return "Game is not running.";
    if (game.phase !== GamePhase.VOTING) return "Voting is only allowed during the VOTING phase.";
    if (!game.aliveIds.has(interaction.user.id)) return "Only alive players can vote.";
    if (!game.aliveIds.has(targetId)) return "Target must be alive.";

    game.votes.votesByVoterId.set(interaction.user.id, targetId);
    if (game.settings.hideVotes) return "🗳️ Vote received.";
    return `🗳️ You voted for <@${targetId}>.`;
}

export function unvote(interaction: ChatInputCommandInteraction): string {
    const game = interaction.channelId ? gamesByChannel.get(interaction.channelId) : undefined;
    if (!game) return "No game in this channel.";
    if (game.status !== GameStatus.RUNNING) return "Game is not running.";
    if (game.phase !== GamePhase.VOTING) return "You can only unvote during the VOTING phase.";
    if (!game.aliveIds.has(interaction.user.id)) return "Only alive players can unvote.";

    game.votes.votesByVoterId.delete(interaction.user.id);
    return "Vote removed.";
}
