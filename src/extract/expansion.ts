import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import type { War } from "./military.js";
import { resolveTitleName } from "./titleUtils.js";
import { charName } from "./common.js";

export interface ClaimRef {
  title: string;
  pressed: boolean;
}
export interface ExpansionInfo {
  claims: ClaimRef[];
  pressedCount: number;
  deJureUnheld: { title: string }[];
  /** De jure parts of your duchies/kingdoms held by rulers outside your realm. */
  deJureOutsideRealm: { title: string; partOf: string; holderId: number; holderName: string }[];
  /** Rulers the game flags as having a usable casus belli against them. */
  cbTargets: { id: number; name: string; primaryTitle: string | null }[];
  warTargets: { title: string; cbType: string }[];
}

// Walk a title's de facto liege chain: it is inside the player's realm if any
// title on the chain is held by the player.
function inRealm(q: Query, playerId: number, titleId: number): boolean {
  let id: unknown = titleId;
  for (let depth = 0; depth < 8 && typeof id === "number"; depth++) {
    const t = q.at(`/landed_titles/landed_titles/${id}`) as Record<string, unknown> | undefined;
    if (!t) return false;
    if (t["holder"] === playerId) return true;
    id = t["de_facto_liege"];
  }
  return false;
}

function topLiegeHolder(q: Query, titleId: number): number | null {
  let id: unknown = titleId;
  let holder: number | null = null;
  for (let depth = 0; depth < 8 && typeof id === "number"; depth++) {
    const t = q.at(`/landed_titles/landed_titles/${id}`) as Record<string, unknown> | undefined;
    if (!t) break;
    if (typeof t["holder"] === "number") holder = t["holder"];
    id = t["de_facto_liege"];
  }
  return holder;
}

export function extractExpansion(q: Query, loc: Localizer, wars: War[]): ExpansionInfo {
  const playerId = q.at("/played_character/character") as number;
  const aliveData = `/living/${playerId}/alive_data`;

  // Claims: alive_data/claim is an array of { title, pressed? }
  const rawClaims =
    (q.at(`${aliveData}/claim`) as Array<Record<string, unknown>> | undefined) ?? [];
  const claims: ClaimRef[] = rawClaims.map((c) => ({
    title: resolveTitleName(q, loc, c["title"] as number),
    pressed: c["pressed"] === true,
  }));
  const pressedCount = claims.filter((c) => c.pressed).length;

  // De jure unheld: titles in primary title's de_jure_vassals with no holder
  const primaryTitleId = (
    q.at(`/living/${playerId}/landed_data/domain`) as number[] | undefined
  )?.[0];
  const deJureVassals =
    primaryTitleId !== undefined
      ? ((q.at(`/landed_titles/landed_titles/${primaryTitleId}/de_jure_vassals`) as
          | number[]
          | undefined) ?? [])
      : [];

  const deJureUnheld = deJureVassals
    .filter((tid) => q.at(`/landed_titles/landed_titles/${tid}/holder`) === undefined)
    .map((tid) => ({ title: resolveTitleName(q, loc, tid) }));

  // De jure parts of every duchy+ title the player holds that sit outside the realm.
  const domain = (q.at(`/living/${playerId}/landed_data/domain`) as number[] | undefined) ?? [];
  const deJureOutsideRealm: ExpansionInfo["deJureOutsideRealm"] = [];
  for (const tid of domain) {
    const key = q.at(`/landed_titles/landed_titles/${tid}/key`);
    if (typeof key !== "string" || !/^[dke]_/.test(key)) continue;
    const parts =
      (q.at(`/landed_titles/landed_titles/${tid}/de_jure_vassals`) as number[] | undefined) ?? [];
    for (const part of parts) {
      if (q.at(`/landed_titles/landed_titles/${part}/holder`) === undefined) continue;
      if (inRealm(q, playerId, part)) continue;
      const holderId = topLiegeHolder(q, part);
      if (holderId === null) continue;
      deJureOutsideRealm.push({
        title: resolveTitleName(q, loc, part),
        partOf: resolveTitleName(q, loc, tid),
        holderId,
        holderName: charName(q, holderId),
      });
    }
  }

  // The game's "you have a casus belli" nudges (important actions) name the target ruler.
  const cbTargets: ExpansionInfo["cbTargets"] = [];
  const actions =
    (q.at("/important_action_manager/active") as Record<string, unknown> | undefined) ?? {};
  for (const raw of Object.values(actions)) {
    const a = raw as Record<string, unknown> | undefined;
    if (!a || a["character"] !== playerId) continue;
    if (a["important_action_type"] !== "action_has_any_display_cb_on") continue;
    const targets = (a["scope"] as Record<string, unknown> | undefined)?.["event_targets"] as
      | Record<string, { type?: string; identity?: number }>
      | undefined;
    const id = targets?.["recipient"]?.identity;
    if (typeof id !== "number" || cbTargets.some((c) => c.id === id)) continue;
    const primary = (q.at(`/living/${id}/landed_data/domain`) as number[] | undefined)?.[0];
    cbTargets.push({
      id,
      name: charName(q, id),
      primaryTitle: primary !== undefined ? resolveTitleName(q, loc, primary) : null,
    });
  }

  // War targets: reuse already-extracted wars
  const warTargets = wars.map((w) => ({
    title: w.targetTitle ?? "?",
    cbType: w.cbType,
  }));

  return { claims, pressedCount, deJureUnheld, deJureOutsideRealm, cbTargets, warTargets };
}
