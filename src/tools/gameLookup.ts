import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotCache } from "../cache.js";
import { CATEGORIES } from "../gameLookup.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

function text(body: string, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: body }],
  };
}

const NO_GAME =
  "Game files are not available. Set CK3_GAME_DIR to the Crusader Kings III install folder " +
  "(the one containing `game/` or the `game` folder itself).";

const categoryList = () =>
  Object.entries(CATEGORIES)
    .map(([k, c]) => `${k} (${c.about})`)
    .join("; ");

// Rules reference built from the player's own installed game files (exact
// numbers for their patch), not from the web and not from the save.
export function registerGameLookupTools(server: McpServer, cache: SnapshotCache) {
  const lookup = cache.lookup;

  server.registerTool(
    "game_search",
    {
      title: "Game Data Search",
      description:
        "Search the installed game's rules data by name or key: men-at-arms, casus belli, buildings, traits, " +
        "decisions, traditions, innovations, laws, doctrines, council tasks, perks, interactions, events, and more. " +
        "Returns matching entries (category, key, English name, short description) to pass to `game_entry`. " +
        "Omit `category` to search everything except events. Reflects the installed game version.",
      inputSchema: {
        query: z.string().describe("name or key words, e.g. 'huscarl', 'warrior culture', 'claim'"),
        category: z
          .string()
          .optional()
          .describe(
            `one of: ${Object.keys(CATEGORIES).join(", ")} (omit to search all but events)`,
          ),
        limit: z.number().optional().describe("max results (default 15)"),
      },
      annotations: READ_ONLY,
    },
    async ({ query, category, limit }: { query: string; category?: string; limit?: number }) => {
      if (!lookup.available) return text(NO_GAME, true);
      if (category && !CATEGORIES[category])
        return text(`Unknown category '${category}'. Categories: ${categoryList()}`, true);
      const hits = lookup.search(query, category, Math.min(Math.max(limit ?? 15, 1), 50));
      if (hits.length === 0)
        return text(`No game data matching '${query}'${category ? ` in ${category}` : ""}.`);
      const lines = hits.map(({ entry, name }) => {
        const desc = lookup.description(entry);
        const label = name === entry.key ? "" : ` — ${name}`;
        const snippet = desc ? `: ${desc.length > 110 ? desc.slice(0, 110) + "…" : desc}` : "";
        return `- [${entry.category}] \`${entry.key}\`${label}${snippet}`;
      });
      return text(`# ${hits.length} match(es) for '${query}'\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "game_entry",
    {
      title: "Game Data Entry",
      description:
        "Full definition of one game data entry: its English name and description, the source file and line, " +
        "and the raw script block with `@constants` filled in (damage/toughness, costs, modifiers, conditions, " +
        "effects). Use `game_search` first if you only have a name. The script is the game's own, so read " +
        "numbers and conditions from it directly. Costs like `gold = huscarls_recruitment_cost` are named " +
        "values: look them up with category `script_value`; reusable `some_effect`/`some_trigger` calls " +
        "with `scripted_effect` / `scripted_trigger`.",
      inputSchema: {
        category: z.string().describe(`one of: ${Object.keys(CATEGORIES).join(", ")}`),
        key: z.string().describe("entry key, e.g. 'huscarl', 'claim_cb', 'brave'"),
        max_chars: z
          .number()
          .optional()
          .describe("truncate the script after this many characters (default 6000)"),
      },
      annotations: READ_ONLY,
    },
    async ({ category, key, max_chars }: { category: string; key: string; max_chars?: number }) => {
      if (!lookup.available) return text(NO_GAME, true);
      if (!CATEGORIES[category])
        return text(`Unknown category '${category}'. Categories: ${categoryList()}`, true);
      const entry = lookup.get(category, key);
      if (!entry) {
        const near = lookup.suggest(category, key);
        return text(
          `No ${category} entry '${key}'.` +
            (near.length ? ` Similar keys: ${near.map((k) => `\`${k}\``).join(", ")}.` : ""),
          true,
        );
      }
      const limit = Math.min(Math.max(max_chars ?? 6000, 500), 40000);
      const desc = lookup.description(entry);
      const body =
        entry.text.length > limit ? `${entry.text.slice(0, limit)}\n… (truncated)` : entry.text;
      const lines = [
        `# ${lookup.displayName(entry)} (\`${entry.key}\`, ${category})`,
        desc ? `${desc}\n` : "",
        `Source: ${entry.file}:${entry.line}${entry.overrides > 0 ? ` (redefined ${entry.overrides}x in later files; this is the last)` : ""}`,
        "```",
        body,
        "```",
      ];
      return text(lines.filter((l) => l !== "").join("\n"));
    },
  );
}
