import { SlashCommandBuilder } from "discord.js";

export const mafiaCommand = new SlashCommandBuilder()
    .setName("mafia")
    .setDescription("Maushold Mafia game commands")
    .addSubcommand((s) => s.setName("create").setDescription("Create a lobby in this channel"))
    .addSubcommand((s) => s.setName("panel").setDescription("Post a clickable game control panel"))
    .addSubcommand((s) => s.setName("join").setDescription("Join the current lobby"))
    .addSubcommand((s) => s.setName("leave").setDescription("Leave lobby or flee active game"))
    .addSubcommand((s) => s.setName("list").setDescription("List lobby players"))
    .addSubcommand((s) => s.setName("start").setDescription("Start game (host only)"))
    .addSubcommand((s) => s.setName("cancel").setDescription("Cancel/End game (host/mod)"))
    .addSubcommand((s) => s.setName("status").setDescription("Show current game status"))
    .addSubcommand((s) =>
        s
            .setName("config")
            .setDescription("Change game settings (host only)")
            .addBooleanOption((o) => o.setName("hide_votes").setDescription("Hide individual vote choices")),
    )
    .addSubcommand((s) => s.setName("actions").setDescription("Show your role and action reminder"))
    .addSubcommand((s) =>
        s
            .setName("vote")
            .setDescription("Vote a player")
            .addUserOption((o) => o.setName("target").setDescription("Player to vote").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("unvote").setDescription("Remove your vote"))
    .addSubcommand((s) =>
        s
            .setName("haunt")
            .setDescription("Gengar night action")
            .addUserOption((o) => o.setName("target").setDescription("Target to eliminate").setRequired(true)),
    )
    .addSubcommand((s) =>
        s
            .setName("protect")
            .setDescription("Chansey night action")
            .addUserOption((o) => o.setName("target").setDescription("Target to protect").setRequired(true)),
    )
    .addSubcommand((s) =>
        s
            .setName("inspect")
            .setDescription("Alakazam night action")
            .addUserOption((o) => o.setName("target").setDescription("Target to inspect").setRequired(true)),
    );

export const commandsJson = [mafiaCommand.toJSON()];
