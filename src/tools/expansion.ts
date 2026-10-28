import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";

export function registerExpansionTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "expansion",
    {
      title: "Expansion",
      description:
        "Stored expansion levers: your title claims (pressed/unpressed — CK3 does not store strong/weak), " +
        "de jure titles in your realm that are currently unheld, de jure parts of your duchies/kingdoms held by " +
        "rulers outside your realm, rulers the game flags as valid casus belli targets right now, and the targets " +
        "of your ongoing wars. The CB list comes from the game's own nudges and does not name the CB type.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const snap = await cache.get();
        if ("error" in snap)
          return { isError: true, content: [{ type: "text", text: snap.error }] };
        const e = snap.expansion;

        let body = "# Expansion\n";

        // Claims
        const { shown: shownClaims, note: claimsNote } = truncate(e.claims, 10);
        if (shownClaims.length === 0) {
          body += `## Claims (0)\nNo claims.\n`;
        } else {
          body += `## Claims (${e.claims.length}, ${e.pressedCount} pressed)\n`;
          for (const c of shownClaims) {
            body += `- ${c.title} (${c.pressed ? "pressed" : "unpressed"})\n`;
          }
          body += claimsNote;
        }

        // Unheld de jure titles
        if (e.deJureUnheld.length > 0) {
          const { shown: shownDJ, note: djNote } = truncate(e.deJureUnheld, 10);
          body += `## Unheld de jure titles (${e.deJureUnheld.length})\n`;
          for (const t of shownDJ) {
            body += `- ${t.title}\n`;
          }
          body += djNote;
        } else {
          body += `## Unheld de jure titles (0)\nNone.\n`;
        }

        // De jure land held outside the realm (de jure CB / claim targets)
        if (e.deJureOutsideRealm.length > 0) {
          const { shown: shownDO, note: doNote } = truncate(e.deJureOutsideRealm, 10);
          body += `## Your de jure land held by others (${e.deJureOutsideRealm.length})\n`;
          for (const t of shownDO) {
            body += `- ${t.title} (part of ${t.partOf}) — held by ${t.holderName} (${t.holderId})\n`;
          }
          body += doNote;
        }

        // Rulers the game says you can declare war on right now
        if (e.cbTargets.length > 0) {
          const { shown: shownCB, note: cbNote } = truncate(e.cbTargets, 10);
          body += `## Available casus belli targets (${e.cbTargets.length})\n`;
          for (const t of shownCB) {
            body += `- ${t.name} (${t.id})${t.primaryTitle ? ` — ${t.primaryTitle}` : ""}\n`;
          }
          body += cbNote;
        }

        // Ongoing war targets
        if (e.warTargets.length > 0) {
          const { shown: shownWT, note: wtNote } = truncate(e.warTargets, 10);
          body += `## Ongoing war targets (${e.warTargets.length})\n`;
          for (const t of shownWT) {
            body += `- ${t.title} (${t.cbType})\n`;
          }
          body += wtNote;
        }

        return { content: [{ type: "text", text: stamp(snap, body) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}
