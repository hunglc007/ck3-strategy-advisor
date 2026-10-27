import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { extractMarriageCandidates, type MarriageCandidate } from "../extract/marriage.js";

function line(c: MarriageCandidate): string {
  const s = c.skills;
  const home = c.inYourCourt
    ? "your court"
    : c.home
      ? `${c.home.name}'s court${c.home.realm ? ` (${c.home.realm}` : " ("}${
          c.home.strength !== null ? `, army ${Math.round(c.home.strength)}` : ""
        })`
      : "no court (available in the pool)";
  return (
    `- ${c.name} (${c.id}, age ${c.age}${[
      c.nearby ? "same region" : "",
      c.sameCulture ? "same culture" : "",
    ]
      .filter(Boolean)
      .map((x) => `, ${x}`)
      .join("")}): ` +
    `fertility ${c.fertility !== null ? c.fertility.toFixed(2) : "?"} | ` +
    `DIP ${s.diplomacy} STE ${s.stewardship} INT ${s.intrigue} LEA ${s.learning} | ${home}` +
    (c.traits.length ? `\n  traits: ${c.traits.join(", ")}` : "")
  );
}

export function registerMarriageTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "marriage_candidates",
    {
      title: "Marriage Candidates",
      description:
        "Unmarried, same-faith, opposite-gender adults (16-45) outside your dynasty house, ranked by fertility, stewardship/diplomacy, how strong their home realm is as an ally and whether it is in your de jure region or your culture (distances are not in the save). Not checked (not in the save): close kin beyond your house, existing betrothals, distance, personality fit, and whether they would accept. Same faith, not same rite.",
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional().describe("how many to list (default 12)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }: { limit?: number }) => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const year = Number.parseInt(snap.date, 10);
      const result = await cache.query((q) =>
        extractMarriageCandidates(q, cache.loc, year, limit ?? 12),
      );
      if (result !== null && typeof result === "object" && "error" in result)
        return {
          isError: true,
          content: [{ type: "text", text: (result as { error: string }).error }],
        };
      const r = result as ReturnType<typeof extractMarriageCandidates>;
      if (!r)
        return { content: [{ type: "text", text: stamp(snap, "Player character not found.") }] };

      let body = `# Marriage candidates for ${r.you.name} (age ${r.you.age}); ${r.faithMatched} same-faith matches before filtering\n`;
      body += r.candidates.length
        ? r.candidates.map(line).join("\n")
        : "No eligible candidates found.";
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
