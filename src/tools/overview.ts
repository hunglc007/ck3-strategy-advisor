import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";

function fmt(v: number | null, digits = 0): string {
  return v === null ? "?" : v.toFixed(digits);
}

export function registerOverview(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "realm_overview",
    {
      title: "Realm Overview",
      description:
        "Snapshot of the player's ruler and realm: name, age, primary title & tier, house, gold, monthly income/balance, " +
        "spendable prestige (plus lifetime), piety, legitimacy, marital status, government, realm laws, and domain/vassal " +
        "limits, plus the in-game date. Start here for 'what's my situation', then `alerts` for what the game is " +
        "nudging you to do. For military/wars use `military`; for heirs use `succession`.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const o = snap.overview;
      const lines = [
        `# ${o.rulerName} — ${o.primaryTitle} (tier ${o.tier})`,
        `- House: ${o.house} | Age: ${o.age ?? "?"} | ${o.spouses > 0 ? `Married (${o.spouses} spouse${o.spouses > 1 ? "s" : ""})` : "Unmarried"}`,
        `- Gold: ${fmt(o.gold)} | Income: ${fmt(o.income, 2)}/month | Balance: ${fmt(o.balance, 2)}/month`,
        `- Prestige: ${fmt(o.prestige)} (lifetime ${fmt(o.prestigeLifetime)}) | Piety: ${fmt(o.piety)} | Legitimacy: ${fmt(o.legitimacy)}`,
        `- Holdings: ${o.holdings}/${o.domainLimit ?? "?"} domain limit | Vassals: ${o.vassalsTowardsLimit ?? "?"}/${o.vassalLimit ?? "?"} vassal limit`,
      ];
      if (o.government) lines.push(`- Government: ${cache.loc.resolve(o.government)}`);
      if (o.laws.length > 0) lines.push(`- Laws: ${o.laws.join(", ")}`);
      return { content: [{ type: "text", text: stamp(snap, lines.join("\n")) }] };
    },
  );
}
