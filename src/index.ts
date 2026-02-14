import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  actionReminder,
  cancelOrEndGame,
  createGame,
  configureGame,
  getGame,
  joinGame,
  leaveGame,
  listLobby,
  startGame,
  statusText,
  submitHaunt,
  submitInspect,
  submitProtect,
  submitVote,
  unvote,
} from "./gameEngine";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("Missing DISCORD_TOKEN in environment.");

const UI_PREFIX = "mafia_ui";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
});

function isSendableChannel(channel: unknown): channel is { send: (payload: unknown) => Promise<unknown> } {
  return Boolean(channel) && typeof (channel as { send?: unknown }).send === "function";
}

function uiId(action: string, channelId: string): string {
  return `${UI_PREFIX}:${action}:${channelId}`;
}

function buildControlPanel(channelId: string) {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(uiId("join", channelId)).setLabel("Join").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(uiId("leave", channelId)).setLabel("Leave").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(uiId("list", channelId)).setLabel("Players").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(uiId("status", channelId)).setLabel("Status").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(uiId("actions", channelId)).setLabel("My Role").setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(uiId("start", channelId)).setLabel("Start").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(uiId("vote", channelId)).setLabel("Vote").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(uiId("unvote", channelId)).setLabel("Unvote").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(uiId("cancel", channelId)).setLabel("End/Cancel").setStyle(ButtonStyle.Danger),
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(uiId("haunt", channelId)).setLabel("Haunt").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(uiId("protect", channelId)).setLabel("Protect").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(uiId("inspect", channelId)).setLabel("Inspect").setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

async function postControlPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelId = interaction.channelId;
  if (!isSendableChannel(interaction.channel)) return;

  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
          .setTitle("🐭 Maushold Mafia Control Panel")
          .setDescription(
              "Use buttons if slash commands are confusing. Access is still restricted by role/phase/host permissions.",
          )
          .setColor(0x9b59b6),
    ],
    components: buildControlPanel(channelId),
  });
}

async function openTargetPicker(
    interaction: ButtonInteraction,
    mode: "vote" | "haunt" | "protect" | "inspect",
    channelId: string,
): Promise<void> {
  const game = getGame(channelId);
  if (!game) {
    await interaction.reply({ content: "No active game in this channel.", ephemeral: true });
    return;
  }

  const options = [...game.aliveIds]
      .filter((id) => id !== interaction.user.id)
      .map((id) => {
        const p = game.players.get(id);
        return {
          label: p?.displayName ?? id,
          value: id,
          description: "Choose this player",
        };
      })
      .slice(0, 25);

  if (options.length === 0) {
    await interaction.reply({ content: "No valid targets right now.", ephemeral: true });
    return;
  }

  const select = new StringSelectMenuBuilder()
      .setCustomId(uiId(`${mode}_target`, channelId))
      .setPlaceholder(`Choose a target to ${mode}`)
      .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  await interaction.reply({ content: `Pick your target for **${mode}**:`, components: [row], ephemeral: true });
}

async function handleMafiaCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    await interaction.reply(await createGame(interaction));
    await postControlPanel(interaction);
    return;
  }

  if (sub === "panel") {
    await interaction.reply({ content: "Posted control panel.", ephemeral: true });
    await postControlPanel(interaction);
    return;
  }

  if (sub === "join") return void interaction.reply(joinGame(interaction));
  if (sub === "leave") return void interaction.reply(leaveGame(interaction));
  if (sub === "list") return void interaction.reply(listLobby(interaction));
  if (sub === "start") {
    await interaction.deferReply({ ephemeral: true });
    const result = await startGame(interaction, client);
    await interaction.editReply(result);
    return;
  }
  if (sub === "cancel") return void interaction.reply(await cancelOrEndGame(interaction));
  if (sub === "status") return void interaction.reply(statusText(interaction));
  if (sub === "config") {
    const hideVotes = interaction.options.getBoolean("hide_votes");
    return void interaction.reply({ content: configureGame(interaction, hideVotes ?? undefined), ephemeral: true });
  }

  if (sub === "actions") {
    return void interaction.reply({ content: actionReminder(interaction), ephemeral: true });
  }

  if (sub === "vote") {
    const target = interaction.options.getUser("target", true);
    const game = getGame(interaction.channelId);
    const content = submitVote(interaction, target.id);
    return void interaction.reply({ content, ephemeral: Boolean(game?.settings.hideVotes) });
  }

  if (sub === "unvote") {
    const game = getGame(interaction.channelId);
    return void interaction.reply({ content: unvote(interaction), ephemeral: Boolean(game?.settings.hideVotes) });
  }

  if (sub === "haunt") {
    const target = interaction.options.getUser("target", true);
    return void interaction.reply({ content: submitHaunt(interaction, target.id), ephemeral: true });
  }

  if (sub === "protect") {
    const target = interaction.options.getUser("target", true);
    return void interaction.reply({ content: submitProtect(interaction, target.id), ephemeral: true });
  }

  if (sub === "inspect") {
    const target = interaction.options.getUser("target", true);
    return void interaction.reply({ content: submitInspect(interaction, target.id), ephemeral: true });
  }
}

async function handleUiButton(interaction: ButtonInteraction): Promise<void> {
  const [prefix, action, channelId] = interaction.customId.split(":");
  if (prefix !== UI_PREFIX) return;

  if (interaction.channelId !== channelId) {
    await interaction.reply({ content: "This panel belongs to a different channel.", ephemeral: true });
    return;
  }

  if (action === "join") return void interaction.reply(joinGame(interaction as unknown as ChatInputCommandInteraction));
  if (action === "leave") return void interaction.reply(leaveGame(interaction as unknown as ChatInputCommandInteraction));
  if (action === "list") return void interaction.reply({ content: listLobby(interaction as unknown as ChatInputCommandInteraction), ephemeral: true });
  if (action === "start") {
    await interaction.deferReply({ ephemeral: true });
    const result = await startGame(interaction as unknown as ChatInputCommandInteraction, client);
    await interaction.editReply(result);
    return;
  }
  if (action === "cancel") return void interaction.reply(await cancelOrEndGame(interaction as unknown as ChatInputCommandInteraction));
  if (action === "status") return void interaction.reply({ content: statusText(interaction as unknown as ChatInputCommandInteraction), ephemeral: true });
  if (action === "actions") return void interaction.reply({ content: actionReminder(interaction as unknown as ChatInputCommandInteraction), ephemeral: true });
  if (action === "unvote") return void interaction.reply({ content: unvote(interaction as unknown as ChatInputCommandInteraction), ephemeral: true });

  if (action === "vote" || action === "haunt" || action === "protect" || action === "inspect") {
    await openTargetPicker(interaction, action, channelId);
  }
}

async function handleUiSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [prefix, action, channelId] = interaction.customId.split(":");
  if (prefix !== UI_PREFIX) return;

  const targetId = interaction.values[0];
  const fake = interaction as unknown as ChatInputCommandInteraction;

  if (action === "vote_target") return void interaction.update({ content: submitVote(fake, targetId), components: [] });
  if (action === "haunt_target") return void interaction.update({ content: submitHaunt(fake, targetId), components: [] });
  if (action === "protect_target") return void interaction.update({ content: submitProtect(fake, targetId), components: [] });
  if (action === "inspect_target") return void interaction.update({ content: submitInspect(fake, targetId), components: [] });

  if (interaction.channelId !== channelId) {
    await interaction.reply({ content: "This picker belongs to a different channel.", ephemeral: true });
  }
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "mafia") {
      await handleMafiaCommand(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith(UI_PREFIX)) {
      await handleUiButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(UI_PREFIX)) {
      await handleUiSelect(interaction);
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "Unexpected error handling interaction.", ephemeral: true });
      } else {
        await interaction.reply({ content: "Unexpected error handling interaction.", ephemeral: true });
      }
    }
  }
});

void client.login(token);
