import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp } from "../format.js";
import { ROLE_SKILL, suggestCouncil, type Courtier } from "../extract/council.js";

function line(c: Courtier): string {
  const s = c.skills;
  const age = c.age !== null ? `, age ${c.age}` : "";
  const tags = [c.knight ? "knight" : "", c.seat ? `seat: ${c.seat}` : ""].filter(Boolean);
  return (
    `- ${c.name} (${c.id}${age}): DIP ${s.diplomacy} / MAR ${s.martial} / STE ${s.stewardship} / ` +
    `INT ${s.intrigue} / LEA ${s.learning} / PRO ${s.prowess}` +
    (tags.length ? ` [${tags.join(", ")}]` : "") +
    (c.traits.length ? `\n  traits: ${c.traits.join(", ")}` : "")
  );
}

export function registerCouncilTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "council",
    {
      title: "Council",
      description:
        "Your council seats (chancellor, steward, marshal, spymaster, court chaplain) and every courtier in your court with skills and traits, plus a suggested reshuffle that maximises each seat's primary skill. Suggestion only weighs skills: check traits, faith (chaplain) and opinions before swapping.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };

      const { council } = snap;
      const plan = suggestCouncil(council);

      let body = "# Council\n";
      for (const a of plan) {
        const skill = ROLE_SKILL[a.role];
        const cur = a.current
          ? `${a.current.name} (${skill} ${a.current.skills[skill]})`
          : "vacant";
        const sug = a.suggested
          ? `${a.suggested.name} (${a.suggested.id}, ${skill} ${a.suggested.skills[skill]})`
          : "none eligible";
        const same = a.current?.id === a.suggested?.id;
        body +=
          `- ${a.role}: ${cur}` +
          (same ? " — keep\n" : ` → suggest ${sug} [${a.gain >= 0 ? "+" : ""}${a.gain}]\n`);
      }

      const rest = [...council.courtiers].sort((x, y) => x.id - y.id);
      body += `\n# Court (${rest.length})\n` + rest.map(line).join("\n") + "\n";
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
