import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { extractTargets, type Route, type Target } from "../extract/targets.js";

const ROUTE_LABEL: Record<Route, string> = {
  de_jure: "de jure (in a duchy you hold)",
  claim: "you hold a claim",
  fabricate: "needs a claim first",
};

function line(t: Target): string {
  const own = t.holderStrength !== null ? Math.round(t.holderStrength) : "?";
  const lieg = t.liege
    ? `, liege ${t.liege.name} (${t.liege.strength !== null ? Math.round(t.liege.strength) : "?"})`
    : ", independent";
  const flags = [t.atWar ? "at war" : "", t.allies > 0 ? `${t.allies} ally` : "no allies"]
    .filter(Boolean)
    .join(", ");
  const odds = t.odds !== null ? `, odds ${t.odds.toFixed(2)}:1` : "";
  return (
    `- ${t.county} (${t.titleId}, ${t.duchy}, ${t.baronies} baronies): ${t.holder} (${t.holderId}) ` +
    `army ${own}${lieg}; ${flags}${odds} — ${ROUTE_LABEL[t.route]}`
  );
}

export function registerTargetsTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "expansion_targets",
    {
      title: "Expansion Targets",
      description:
        "Counties someone else holds in the same de jure kingdom as your primary title, ranked by how you can get them (de jure in a duchy you hold, an existing claim, or needs Fabricate Claim) and then by how weak the defender is (holder + liege army, allies). Shows your odds as your army divided by theirs. The save has no map coordinates, so 'near' means same de jure region, not adjacency. Army figures are totals, not what will actually be raised.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe("how many targets to list (default 12)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }: { limit?: number }) => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const result = await cache.query((q) => extractTargets(q, cache.loc, snap.military.strength));
      if (result !== null && typeof result === "object" && "error" in result)
        return {
          isError: true,
          content: [{ type: "text", text: (result as { error: string }).error }],
        };
      const r = result as ReturnType<typeof extractTargets>;
      if (!r)
        return {
          content: [{ type: "text", text: stamp(snap, "No primary title to expand from.") }],
        };

      const n = limit ?? 12;
      const shown = r.targets.slice(0, n);
      let body = `# Expansion targets in ${r.region} (your army ${r.yourStrength !== null ? Math.round(r.yourStrength) : "?"})\n`;
      body += shown.length
        ? shown.map(line).join("\n")
        : "No counties held by others in this region.";
      if (r.targets.length > n) body += `\n\n_Showing ${n} of ${r.targets.length}._`;
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
