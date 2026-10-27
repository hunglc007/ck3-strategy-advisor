import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { ROLE_SKILL, type CouncilRole } from "../extract/council.js";
import { z } from "zod";
import { extractPool, type PoolCharacter, type PoolScope } from "../extract/courtiers.js";

const UPGRADE_MARGIN = 3;

function desc(c: PoolCharacter, skill: keyof PoolCharacter["skills"]): string {
  const s = c.skills;
  return (
    `${c.name} (${c.id}, ${c.female ? "F" : "M"} ${c.age}): ${skill.slice(0, 3).toUpperCase()} ${s[skill]} ` +
    `[DIP ${s.diplomacy} MAR ${s.martial} STE ${s.stewardship} INT ${s.intrigue} LEA ${s.learning} PRO ${s.prowess}]` +
    (c.flags.length ? ` ⚠ ${c.flags.join(", ")}` : "")
  );
}

export function registerCourtiersTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "court_candidates",
    {
      title: "Court Candidates",
      description:
        "Same-faith adults (16-55) who belong to nobody's court and hold no land, i.e. people you could invite, limited to your de jure kingdom or empire by where they are now (scope). For each council seat, shows the best of them against your current holder and whether the gap is worth an invitation (3+ points), plus the best knights/commanders by martial and prowess. This is a map of who exists, not of who you can hire: the game does not let you search freely. Hiring for a court position (e.g. court physician) offers only a few pool characters in your capital province or newly generated ones, at a gold cost of months of income, so most people listed here may not be reachable. Willingness and cost are not in the save, so check acceptance in game.",
      inputSchema: {
        scope: z
          .enum(["kingdom", "empire", "all"])
          .optional()
          .describe(
            "how far to look, by where they are now: your de jure kingdom, your de jure empire (default, e.g. the British Isles) or everywhere",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ scope }: { scope?: PoolScope }) => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const year = Number.parseInt(snap.date, 10);
      const result = await cache.query((q) => extractPool(q, cache.loc, year, scope ?? "empire"));
      if (result !== null && typeof result === "object" && "error" in result)
        return {
          isError: true,
          content: [{ type: "text", text: (result as { error: string }).error }],
        };
      const pool = result as ReturnType<typeof extractPool>;
      if (!pool)
        return { content: [{ type: "text", text: stamp(snap, "Player faith not found.") }] };

      const holder = (role: CouncilRole) => {
        const id = snap.council.seats[role];
        return snap.council.courtiers.find((c) => c.id === id) ?? null;
      };
      const usable = pool.characters.filter((c) => c.flags.length === 0);
      let body = `# Court candidates: ${pool.characters.length} unattached same-faith adults${
        pool.region ? ` in ${pool.region}` : " (anywhere)"
      } (${pool.faithMatched} worldwide)\n`;
      for (const role of Object.keys(ROLE_SKILL) as CouncilRole[]) {
        const skill = ROLE_SKILL[role];
        const cur = holder(role);
        const curVal = cur ? cur.skills[skill] : 0;
        const best = [...usable].sort((a, b) => b.skills[skill] - a.skills[skill]).slice(0, 3);
        const worth = best.some((c) => c.skills[skill] >= curVal + UPGRADE_MARGIN);
        body += `\n## ${role} (${skill}): now ${cur ? `${cur.name} ${curVal}` : "vacant"} — ${
          worth ? "an invitation is worth it" : "no worthwhile upgrade"
        }\n`;
        body += best.map((c) => `- ${desc(c, skill)}`).join("\n") + "\n";
      }
      const fighters = (c: PoolCharacter) => c.skills.martial + c.skills.prowess / 2;
      const knights = [...usable].sort((a, b) => fighters(b) - fighters(a)).slice(0, 4);
      body +=
        "\n## knights / commanders (martial + prowess)\n" +
        knights.map((c) => `- ${desc(c, "martial")}`).join("\n");
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
