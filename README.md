# CK3 Strategy Advisor (MCP server)

[![CI](https://github.com/thomandretti/ck3-strategy-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/thomandretti/ck3-strategy-advisor/actions/workflows/ci.yml)

A local [Model Context Protocol](https://modelcontextprotocol.io) server that
reads your **Crusader Kings III** save file and exposes your strategic situation
to Claude as compact, curated tools. Ask Claude "what's my situation?" and it can
pull your realm overview, military, succession, diplomacy, vassals, factions, and
expansion options straight from your latest save.

It is read-only: it never modifies your save or your game.

## Requirements

- **Node.js ≥ 22**
- **Non-Ironman saves only.** Ironman saves are stored in a binary format; the
  advisor detects them and returns a friendly message instead of mis-parsing.
  Play (or re-save) without Ironman to use the advisor.
- Mid/late-game saves are large (the embedded game state is ~200+ MB of text);
  parsing one peaks at roughly **1.1 GB of memory** and takes a couple of seconds.

## Install & build

```bash
npm install
npm run build
```

## Configuration

The server finds your save and game directories from environment variables, with
WSL/`/mnt/c` discovery as a fallback:

| Variable       | Purpose                             | Default                                                                                         |
| -------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CK3_SAVE_DIR` | Folder containing your `.ck3` saves | auto-discovered at `/mnt/c/Users/*/Documents/Paradox Interactive/Crusader Kings III/save games` |
| `CK3_GAME_DIR` | CK3 game install (for localization) | `/mnt/c/Program Files (x86)/Steam/steamapps/common/Crusader Kings III/game`                     |

`CK3_GAME_DIR` is optional. Without it, titles/traits are shown as their raw game
keys instead of localized names — everything else still works.

The server reads the **newest readable** `.ck3` in the save directory. CK3
autosaves are written in a binary token format (the same one Ironman uses)
regardless of whether you play Ironman, and the advisor can't decode it — so it
automatically **skips binary autosaves/Ironman saves and uses your newest normal
save** instead. You don't need to delete or rename autosaves; just keep making
ordinary saves and the freshest one is picked up.

## Register with Claude

Add it as a local stdio MCP server. In **Claude Code**:

```bash
claude mcp add ck3-advisor -- node /absolute/path/to/ck3mod/dist/index.js
```

Or in **Claude Desktop**, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ck3-advisor": {
      "command": "node",
      "args": ["/absolute/path/to/ck3mod/dist/index.js"],
      "env": {
        "CK3_SAVE_DIR": "/mnt/c/Users/you/Documents/Paradox Interactive/Crusader Kings III/save games"
      }
    }
  }
}
```

## Workflow

1. Play CK3 (non-Ironman). **Save your game** whenever you want fresh advice.
2. Ask Claude about your realm. Each tool response is stamped with the save's
   in-game date and how long ago it was read, so you know how current it is.
3. Saved again? Just ask again — the server re-reads the newest save automatically.

## Tools

| Tool             | What it returns                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `realm_overview` | Ruler, age, title & tier, gold/income, prestige/piety, legitimacy, laws, limits. Start here.              |
| `alerts`         | The game's own "important actions" nudges (unmarried, CB available, unstationed MaA…).                    |
| `military`       | Levy + strength, your men-at-arms (type, size, station), ongoing wars.                                    |
| `succession`     | Heirs in order, succession & gender laws, rival claimants.                                                |
| `diplomacy`      | Alliances, truces, independence, and who most dislikes you.                                               |
| `vassals`        | Your most powerful vassals: power owed, opinion, council seat, faction danger flag.                       |
| `titles`         | Titles you personally hold, grouped by tier, each with its de jure liege.                                 |
| `factions`       | Factions targeting you: type, strength vs. their threshold, members, leader.                              |
| `expansion`      | Claims, unheld de jure titles, your de jure land held by others, CB targets, wars.                        |
| `court`          | Council (task, skills, traits), court positions, knights, best courtier per skill (base + trait bonuses). |
| `family`         | Parents, spouses, children, siblings; for you, heirs labelled by kinship.                                 |
| `domain`         | Your counties (development, control) and holdings (buildings, slots, levy, income).                       |
| `intrigue`       | Secrets you've discovered, your own secrets, hooks you hold / others hold on you.                         |
| `game_search`    | Search the installed game's rules data (men-at-arms, CBs, buildings, traits, decisions…).                 |
| `game_entry`     | One entry's name, description, source file and raw script (numbers, conditions, effects).                 |
| `find_character` | Search living characters by (partial) name → ids.                                                         |
| `character`      | Full dossier for one character id: age, court, traits, skills, wealth, claims.                            |
| `foreign_realm`  | Look up any realm by name/key — ruler, army, allies, liege, active wars.                                  |

## Known limitations (v1)

These reflect what is and isn't stored in the save:

- **`game_search` / `game_entry`** read the game's own script and localization
  files under `CK3_GAME_DIR` (so they match your installed patch; mods are not
  merged in). They return raw script, not a computed tooltip: values that
  depend on your culture, techs or perks must be read from the conditions.
  Costs written as `@constants` are filled in; named values are in the
  `script_value` category. Categories: men_at_arms, casus_belli, building, trait,
  decision, tradition, innovation, pillar, culture, law, government, council_task,
  court_position, perk, focus, interaction, doctrine, tenet, faith, dynasty_legacy,
  faction, secret, artifact, holding, activity, script_value, scripted_effect,
  scripted_trigger, event. Events are only searched when `category: event` is
  given.
- **Skills** in the save are base values. `character` and `court` add the trait
  bonuses they can derive from the game files (fixed modifiers plus the XP-track
  tiers a character has reached) and show the base in brackets. Perks, artifacts,
  temporary modifiers and conditional trait effects are not included, so the
  in-game number can be higher. Needs `CK3_GAME_DIR`; without it only base skills
  are shown.
- **Names** are stored in CK3's encoded form; `find_character` normalizes and does
  best-effort substring matching, so very stylized names may not match.
- **Claims** are reported as pressed/unpressed — CK3 does not store a strong/weak
  distinction in the save.
- **Men-at-arms** are listed for the player's own regiments only (vassals'
  hired regiments are not attributed).
- **Marriage candidates** are not stored in the save; `alerts` only says who
  can/should marry.
- `domain` needs `CK3_GAME_DIR`: the barony → province link lives in the game's
  `common/landed_titles`, not in the save.
- **Opinion** values (e.g. in `diplomacy`/`vassals`) are approximate, summed from
  stored opinion modifiers rather than the game's computed total.
- **Localization** is English-only (checked against a 1.20 install). Alert
  labels have CK3 markup stripped, but other `$KEY$` interpolation is ignored.
  `CK3_GAME_DIR` may be the install root or its `game` folder. Without it,
  titles and traits appear as their raw game keys.
- `expansion` lists **stored** levers (claims, unheld de jure titles, active-war
  CBs), not a full computed enumeration of every possible casus belli.

## Development

```bash
npm test        # run the vitest suite
npm run test:watch
npm run lint    # eslint (typescript-eslint, flat config)
npm run format  # prettier --write (check-only: npm run format:check)
npm run dev     # run the server from source via tsx
```

The verified gamestate field paths the extractors rely on are documented in
[`docs/save-schema.md`](docs/save-schema.md), and `scripts/inspect-section.mjs`
/ `scripts/check-paths.mjs` help map new fields against a real save.

## Distribution (future)

The documented path for shipping this to non-developers is [MCPB](https://github.com/anthropics/mcpb)
(a self-contained bundle with the Node runtime), so it can be installed without a
local Node/npm setup. The current release targets the local stdio prototype above.

## License

[MIT](LICENSE) © Thom Andretti

This is an unofficial, fan-made tool. _Crusader Kings III_ is a trademark of
Paradox Interactive AB. This project is not affiliated with or endorsed by
Paradox Interactive.
