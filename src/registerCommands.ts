import { REST, Routes } from "discord.js";
import { commandsJson } from "./commands";

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId) {
    throw new Error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID.");
  }

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandsJson });
    console.log(`Registered guild commands for ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commandsJson });
    console.log("Registered global commands");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
