import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapshotCache } from "../cache.js";
import type { Query } from "../parser.js";
import { stamp, truncate } from "../format.js";
import { extractAlerts } from "../extract/alerts.js";
import { extractCourt, type CourtMember } from "../extract/court.js";
import { extractFamily, type Relative } from "../extract/family.js";
import { extractDomain, type Holding } from "../extract/domain.js";
import { extractIntrigue } from "../extract/intrigue.js";
import { extractMarriageCandidates, type MarriageCandidate } from "../extract/marriage.js";
import { SKILL_NAMES } from "../extract/common.js";
import { SKILL_NOTE, formatEffective } from "../extract/skills.js";

type ToolResult = { isError?: boolean; content: { type: "text"; text: string }[] };

// Shared plumbing for tools that need a fresh jomini pass beyond the snapshot:
// fetch the snapshot (for stamping), run the extractor, surface errors as text.
async function run<T>(
  cache: SnapshotCache,
  extract: (q: Query) => T,
  render: (data: T) => string,
): Promise<ToolResult> {
  const snap = await cache.get();
  if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
  // Wrap so a null/array extractor result can't be confused with cache.query's { error }.
  const result = await cache.query((q) => ({ data: extract(q) }));
  if ("error" in result) return { isError: true, content: [{ type: "text", text: result.error }] };
  return { content: [{ type: "text", text: stamp(snap, render(result.data)) }] };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

function who(m: CourtMember): string {
  return `${m.name} (${m.id}${m.age !== null ? `, age ${m.age}` : ""})`;
}

function kin(r: Relative): string {
  const status = r.alive ? (r.age !== null ? `age ${r.age}` : "alive") : "dead";
  return `${r.name} (${r.id}, ${r.female ? "F" : "M"}, ${status})`;
}

function candidateLine(c: MarriageCandidate, n: number): string {
  const where =
    c.source === "ruler"
      ? `rules ${c.ownTitle ?? "a realm"}`
      : c.source === "pool"
        ? "unattached"
        : c.host
          ? `${c.source === "courtier" ? "at the court of" : "child of"} ${c.host.name} (${c.host.id}${c.host.title ? `, ${c.host.title}` : ""})`
          : c.source;
  const lines = [
    `${n}. ${c.name} (${c.id}, ${c.female ? "F" : "M"}, age ${c.age ?? "?"}) — ${where}`,
    `   ${formatEffective(c.skills)}` +
      `${c.traits.length ? ` — ${c.traits.join(", ")}` : ""}` +
      `${c.fertility !== null ? ` — fertility ${c.fertility.toFixed(2)}` : ""}`,
  ];
  const extra: string[] = [];
  if (c.distance !== null) extra.push(`distance ${Math.round(c.distance)}`);
  if (c.allyRuler)
    extra.push(
      c.allyRuler.relation === "self"
        ? `rules (army ${Math.round(c.allyRuler.strength)}): alliance plausible`
        : `${c.allyRuler.relation} ${c.allyRuler.name} rules (army ${Math.round(c.allyRuler.strength)}): alliance plausible`,
    );
  if (c.goodGenes.length) extra.push(`good genes: ${c.goodGenes.join(", ")}`);
  if (c.badGenes.length) extra.push(`⚠ bad genes: ${c.badGenes.join(", ")}`);
  if (c.claims.length) extra.push(`claims: ${c.claims.join(", ")}`);
  if (extra.length) lines.push(`   ${extra.join(" | ")}`);
  if (c.notes.length) lines.push(`   ${c.notes.join("; ")}`);
  return lines.join("\n") + "\n";
}

function holdingLine(h: Holding, cache: SnapshotCache): string {
  const parts = [
    h.type ?? "unknown holding",
    h.levy !== null ? `levy ${Math.round(h.levy)}` : null,
    h.garrison !== null ? `garrison ${Math.round(h.garrison)}` : null,
    h.income !== null ? `income ${h.income.toFixed(2)}` : null,
    h.fortLevel !== null ? `fort ${h.fortLevel}` : null,
  ].filter(Boolean);
  const where = h.province !== null ? ` [${cache.provinceName(h.province)}]` : "";
  const buildings =
    h.buildings.length > 0
      ? `\n    - Buildings: ${h.buildings.join(", ")}`
      : "\n    - Buildings: none";
  return (
    `  - ${h.title}${where}${h.isCapital ? " ★capital" : ""}: ${parts.join(", ")}` +
    `${buildings}; ${h.emptySlots} empty slot(s)`
  );
}

export function registerExtendedTools(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "alerts",
    {
      title: "Alerts",
      description:
        "The game's own 'important actions' nudges for the player (the top-right alert icons): e.g. you or your " +
        "heir are unmarried, family members can marry, an unused casus belli, unstationed men-at-arms, a lifestyle " +
        "to pick, hostages, empty accolade slots. Each lists the characters/titles it concerns. Good second call " +
        "after `realm_overview` to see what needs attention.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        (q) => extractAlerts(q, cache.loc),
        (alerts) => {
          if (alerts.length === 0) return "# Alerts\nNothing flagged by the game.";
          let body = `# Alerts (${alerts.length})\n`;
          for (const a of alerts) {
            const label = a.label === a.type ? a.type : `${a.label} (${a.type})`;
            body += `- ${label}\n`;
            const { shown, note } = truncate(a.targets, 8);
            for (const t of shown) body += `  - ${t.name} (${t.kind} ${t.id})\n`;
            if (note) body += `  ${note.trim()}\n`;
          }
          return body;
        },
      ),
  );

  server.registerTool(
    "court",
    {
      title: "Court",
      description:
        "Your council (task each councillor is on, with skills and traits), court positions (physician, etc.), " +
        "knights, and the best courtiers for each skill with the post they already hold — use it to pick or " +
        "replace councillors and court positions. Only covers your own court. Skills are base + trait bonuses " +
        "(estimated from the game files, base in brackets); perks/artifacts/temporary modifiers are not included.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        (q) => extractCourt(q, cache.loc, cache.lookup),
        (c) => {
          let body = `${SKILL_NOTE}\n\n# Council\n`;
          if (c.council.length === 0) body += "Empty.\n";
          for (const s of c.council)
            body +=
              `- ${s.task}: ${who(s.member)} — ${formatEffective(s.member.skills)}` +
              `${s.member.traits.length ? ` — ${s.member.traits.join(", ")}` : ""}\n`;
          body += `\n# Court positions (${c.positions.length})\n`;
          if (c.positions.length === 0) body += "None filled.\n";
          for (const p of c.positions)
            body +=
              `- ${p.position}: ${who(p.member)} — ${formatEffective(p.member.skills)}` +
              `${p.member.traits.length ? ` — ${p.member.traits.join(", ")}` : ""}\n`;
          body += `\n# Knights (${c.knights.length})\n`;
          for (const k of c.knights)
            body += `- ${who(k)} — prowess ${k.skills.effective.prowess}\n`;
          body += `\n# Best courtiers by skill (${c.courtierCount} courtiers)\n`;
          for (const skill of SKILL_NAMES) {
            const list = c.bestBySkill[skill]
              .map(
                (e) =>
                  `${e.member.name} ${e.member.skills.effective[skill]}${e.holds ? ` [${e.holds}]` : ""}`,
              )
              .join("; ");
            body += `- ${skill}: ${list || "none"}\n`;
          }
          return body;
        },
      ),
  );

  server.registerTool(
    "family",
    {
      title: "Family",
      description:
        "Family tree around a character (default: you): parents, spouses, betrothals, children, and siblings with " +
        "ages and alive/dead. For you it also labels the first heirs in the succession line by kinship " +
        "(child, sibling, nephew, cousin…) — use it to see who inherits and how they relate to you.",
      inputSchema: {
        id: z.number().optional().describe("character id (omit for the player)"),
      },
      annotations: READ_ONLY,
    },
    async ({ id }: { id?: number }) =>
      run(
        cache,
        (q) => extractFamily(q, id),
        (f) => {
          if (!f) return `No character with id ${id}.`;
          const section = (title: string, list: Relative[], withRel = false) =>
            `## ${title} (${list.length})\n` +
            (list.length === 0
              ? "None.\n"
              : list.map((r) => `- ${kin(r)}${withRel ? ` — ${r.relation}` : ""}\n`).join(""));
          let body = `# Family of ${f.subject.name} (${f.subject.id}, age ${f.subject.age ?? "?"})\n`;
          body += section("Parents", f.parents);
          body += section("Spouses", f.spouses);
          if (f.betrothed.length) body += section("Betrothed", f.betrothed);
          if (f.formerSpouses.length) body += section("Former spouses", f.formerSpouses);
          body += section("Children", f.children);
          body += section("Siblings", f.siblings, true);
          if (f.heirs.length) {
            body += `## Succession line (first ${f.heirs.length})\n`;
            f.heirs.forEach((h, i) => (body += `${i + 1}. ${kin(h)} — ${h.relation}\n`));
          }
          return body;
        },
      ),
  );

  server.registerTool(
    "domain",
    {
      title: "Domain",
      description:
        "Land you hold personally: each county's development, control and culture, and each holding's type, " +
        "buildings, empty building slots, levy, garrison, income and fort level, plus holdings vs your domain " +
        "limit. Use it to plan construction or decide what to grant away.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        (q) => extractDomain(q, cache.loc, cache.game),
        (d) => {
          let body = `# Domain — ${d.holdingCount}/${d.domainLimit ?? "?"} holdings\n`;
          for (const c of d.counties) {
            body +=
              `- ${c.title}: development ${c.development ?? "?"}, control ${c.control ?? "?"}` +
              `${c.culture ? `, culture ${c.culture}` : ""}\n`;
            for (const h of c.holdings) body += holdingLine(h, cache) + "\n";
          }
          if (d.looseHoldings.length) {
            body += "- Holdings in counties you don't hold:\n";
            for (const h of d.looseHoldings) body += holdingLine(h, cache) + "\n";
          }
          if (d.counties.length === 0 && d.looseHoldings.length === 0) body += "No land held.\n";
          return body;
        },
      ),
  );

  server.registerTool(
    "intrigue",
    {
      title: "Intrigue",
      description:
        "Secrets and hooks as the player can see them: other people's secrets you have discovered, your own " +
        "secrets and how many people know each, hooks you hold over others, and hooks others hold over you. " +
        "Does not reveal secrets you have not discovered.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      run(
        cache,
        (q) => extractIntrigue(q, cache.loc),
        (i) => {
          let body = `# Secrets you know (${i.knownSecrets.length})\n`;
          if (i.knownSecrets.length === 0) body += "None.\n";
          for (const s of i.knownSecrets)
            body += `- ${s.ownerName} (${s.ownerId}): ${s.type}${s.targetName ? ` (with ${s.targetName})` : ""}\n`;
          body += `## Your own secrets (${i.ownSecrets.length})\n`;
          if (i.ownSecrets.length === 0) body += "None.\n";
          for (const s of i.ownSecrets)
            body += `- ${s.type}${s.targetName ? ` (with ${s.targetName})` : ""} — known by ${s.knownBy} other(s)\n`;
          body += `## Hooks you hold (${i.hooksHeld.length})\n`;
          if (i.hooksHeld.length === 0) body += "None.\n";
          for (const h of i.hooksHeld) body += `- on ${h.otherName} (${h.otherId}): ${h.type}\n`;
          body += `## Hooks on you (${i.hooksAgainst.length})\n`;
          if (i.hooksAgainst.length === 0) body += "None.\n";
          for (const h of i.hooksAgainst) body += `- by ${h.otherName} (${h.otherId}): ${h.type}\n`;
          return body;
        },
      ),
  );

  server.registerTool(
    "marriage_candidates",
    {
      title: "Marriage candidates",
      description:
        "Who the subject (default: your heir) could marry, rebuilt from the game's own arrange-marriage rules: " +
        "every ruler, courtier and ruler's child of the opposite sex who is unmarried, not betrothed elsewhere and " +
        "not too closely related under both faiths' consanguinity doctrines. Ranked by the standing of the court " +
        "they belong to, then Dip+Stw+Int+Lrn. Limited to the game's diplomatic range (maxDistance) rather than by language. Also shows the strongest ruler among their close family (a marriage alliance is plausible), heritable good/bad genes and claims; rank=priority orders for an heir. " +
        "Does NOT include the acceptance chance shown in the game; check that in the marriage window.",
      inputSchema: {
        id: z
          .number()
          .optional()
          .describe("character id looking for a spouse (omit for your heir)"),
        minAge: z.number().optional().describe("minimum candidate age (default 16)"),
        maxAge: z.number().optional().describe("maximum candidate age (default 45)"),
        sameLanguage: z
          .boolean()
          .optional()
          .describe(
            "only candidates sharing a language with the subject (default false: the game lists by distance, not language)",
          ),
        host: z
          .string()
          .optional()
          .describe("only candidates at / child of a ruler whose name contains this"),
        maxDistance: z
          .number()
          .optional()
          .describe(
            "only people within this map distance of you (default 1130, the game's diplomatic range around Munster; raise it for the whole world)",
          ),
        rank: z
          .enum(["standing", "priority"])
          .optional()
          .describe(
            "standing (default): court tier and rite first. priority: strongest ally first, then youth and fertility, skills, good genes",
          ),
        limit: z.number().optional().describe("how many to list (default 25)"),
      },
      annotations: READ_ONLY,
    },
    async (args: {
      id?: number;
      minAge?: number;
      maxAge?: number;
      sameLanguage?: boolean;
      host?: string;
      maxDistance?: number;
      rank?: "standing" | "priority";
      limit?: number;
    }) =>
      run(
        cache,
        (q) => extractMarriageCandidates(q, cache.loc, cache.lookup, args),
        (m) => {
          if (!m) return `No character with id ${args.id}.`;
          const s = m.subject;
          let body = `${SKILL_NOTE}\n\n`;
          body += `# Marriage candidates for ${s.name} (${s.id}, ${s.female ? "F" : "M"}, age ${s.age ?? "?"}`;
          body += `${s.rite ? `, ${s.rite}` : ""})\n`;
          body += `${m.total} match(es) out of ${m.scanned} characters checked; showing ${m.candidates.length}.\n`;
          const ex = Object.entries(m.excluded)
            .sort((a, b) => b[1] - a[1])
            .map(([why, n]) => `${why} ${n}`)
            .join(", ");
          if (ex) body += `Filtered out: ${ex}.\n`;
          body += "\n";
          m.candidates.forEach((c, i) => (body += candidateLine(c, i + 1)));
          if (m.candidates.length === 0)
            body += "None found. Try a larger maxDistance or a wider age range.\n";
          return body;
        },
      ),
  );
}
