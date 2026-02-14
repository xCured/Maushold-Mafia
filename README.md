# Maushold Mafia (Discord Bot)

Node.js + TypeScript Discord bot for a Pokémon-themed social deduction game.

## New: UI-first flow for non-technical players
You can still use slash commands, but now you can run games mostly from a clickable panel:
- Buttons for **Join / Leave / Start / Vote / Role actions / Status**
- Target pickers via dropdown menus for vote + night actions
- Permission and phase checks are still enforced (host-only start, role-only night actions, alive-only voting, etc.)

Use either:
- `/mafia create` (creates lobby + posts control panel)
- `/mafia panel` (posts another control panel manually)

## Features
- Single game instance per channel.
- Lobby flow: create, join, leave, list, start, cancel.
- Phases: Night → Day → Voting loop.
- Night actions:
  - `Gengar` uses haunt
  - `Chansey` uses protect
  - `Alakazam` uses inspect
- Added role support + distribution:
  - 6–7: Gengar, Alakazam, Chansey, rest Maushold
  - 8–10: + Ditto
  - 11–14: + Mimikyu
- Ditto mask mechanic: appears as TOWN to Alakazam.
- Mimikyu instant win if eliminated by day vote.
- Tie vote => no elimination.
- Protection rule: attacked + protected => survive, generic survival message.
- Role reveal on death (enabled by default).

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create Discord app + bot and set env vars:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID` (optional, for guild-scoped fast updates)
3. Register commands:
   ```bash
   npm run register-commands
   ```
4. Run in development:
   ```bash
   npm run dev
   ```
5. Build + run:
   ```bash
   npm run build
   npm start
   ```

## Commands
- Lobby:
  - `/mafia create`
  - `/mafia panel`
  - `/mafia join`
  - `/mafia leave`
  - `/mafia list`
  - `/mafia start`
  - `/mafia cancel`
- Runtime:
  - `/mafia status`
  - `/mafia actions`
  - `/mafia vote @user`
  - `/mafia unvote`
- Night actions:
  - `/mafia haunt @user`
  - `/mafia protect @user`
  - `/mafia inspect @user`

## Notes
- Game state is in-memory per channel and resets on process restart.
- If DM fails, the bot falls back to ephemeral interaction responses where possible.
