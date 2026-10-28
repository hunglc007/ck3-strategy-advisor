import type { Query } from "../parser.js";
import type { Localizer } from "../localization.js";
import { charName, playerIdOf } from "./common.js";

export interface SecretRef {
  type: string; // localized secret type
  ownerId: number;
  ownerName: string;
  targetName: string | null; // the other party, for secrets like lover/murder
}
export interface HookRef {
  type: string; // localized hook type
  otherId: number;
  otherName: string;
}
export interface IntrigueInfo {
  /** Other people's secrets the player has discovered. */
  knownSecrets: SecretRef[];
  /** The player's own secrets and how many others know each. */
  ownSecrets: (SecretRef & { knownBy: number })[];
  hooksHeld: HookRef[];
  hooksAgainst: HookRef[];
}

// Only what the player could see in-game: secrets they have discovered (not
// every secret in the world), their own secrets, and hooks either way.
export function extractIntrigue(q: Query, loc: Localizer): IntrigueInfo {
  const playerId = playerIdOf(q);
  const secrets = (q.at("/secrets/secrets") as Record<string, unknown> | undefined) ?? {};
  const known = (q.at("/secrets/known_secrets") as Record<string, unknown>[] | undefined) ?? [];

  const secretRef = (id: string): SecretRef | null => {
    const s = secrets[id] as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object" || typeof s["owner"] !== "number") return null;
    const target = s["target"] as { type?: string; identity?: number } | undefined;
    return {
      type: loc.resolve(String(s["type"])),
      ownerId: s["owner"],
      ownerName: charName(q, s["owner"]),
      targetName:
        target?.type === "char" && typeof target.identity === "number"
          ? charName(q, target.identity)
          : null,
    };
  };

  // known_secrets: { secret, owner } where `owner` is the character who knows it.
  const knowers = new Map<string, number[]>();
  for (const k of known) {
    if (!k || typeof k !== "object") continue;
    const sid = String(k["secret"]);
    const list = knowers.get(sid) ?? [];
    if (typeof k["owner"] === "number") list.push(k["owner"]);
    knowers.set(sid, list);
  }

  const knownSecrets: SecretRef[] = [];
  const ownSecrets: IntrigueInfo["ownSecrets"] = [];
  for (const sid of Object.keys(secrets)) {
    const ref = secretRef(sid);
    if (!ref) continue;
    const who = knowers.get(sid) ?? [];
    if (ref.ownerId === playerId)
      ownSecrets.push({ ...ref, knownBy: who.filter((w) => w !== playerId).length });
    else if (who.includes(playerId)) knownSecrets.push(ref);
  }

  // active_hook_0 is held by `first` over `second`; active_hook_1 the reverse.
  const hooksHeld: HookRef[] = [];
  const hooksAgainst: HookRef[] = [];
  const rels = (q.at("/relations/active_relations") as Record<string, unknown>[] | undefined) ?? [];
  for (const r of rels) {
    if (!r || typeof r !== "object") continue;
    const first = r["first"];
    const second = r["second"];
    if (first !== playerId && second !== playerId) continue;
    const other = (first === playerId ? second : first) as number;
    for (const [slot, holder] of [
      ["active_hook_0", first],
      ["active_hook_1", second],
    ] as const) {
      const hook = r[slot] as Record<string, unknown> | undefined;
      if (!hook || typeof hook["type"] !== "string") continue;
      const ref = {
        type: loc.resolve(hook["type"]),
        otherId: other,
        otherName: charName(q, other),
      };
      (holder === playerId ? hooksHeld : hooksAgainst).push(ref);
    }
  }

  return { knownSecrets, ownSecrets, hooksHeld, hooksAgainst };
}
