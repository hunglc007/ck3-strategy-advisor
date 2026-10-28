import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type CouncilRole = "chancellor" | "steward" | "marshal" | "spymaster" | "court_chaplain";

const ROLE_FILE = /^\d+_(chancellor|steward|marshal|spymaster|court_chaplain)_tasks\.txt$/;

/**
 * Which councillor a council task belongs to. The game groups the tasks of each councillor in
 * `common/council_tasks/<NN>_<position>_tasks.txt`, so the task key -> position link is read
 * from the file a task is defined in (a councillor can switch tasks, e.g. a marshal doing
 * Increase Control, and is still the marshal).
 */
export function parseCouncilTaskRoles(files: Array<[string, string]>): Map<string, CouncilRole> {
  const out = new Map<string, CouncilRole>();
  for (const [name, text] of files) {
    const m = ROLE_FILE.exec(name);
    if (!m) continue;
    for (const t of text.matchAll(/^(task_[\w]+)\s*=\s*\{/gm)) out.set(t[1]!, m[1] as CouncilRole);
  }
  return out;
}

export function loadCouncilTaskRoles(gameRoot: string | null): Map<string, CouncilRole> {
  if (!gameRoot) return new Map();
  const dir = join(gameRoot, "common", "council_tasks");
  try {
    return parseCouncilTaskRoles(
      readdirSync(dir)
        .filter((f) => ROLE_FILE.test(f))
        .map((f): [string, string] => [f, readFileSync(join(dir, f), "utf8")]),
    );
  } catch {
    return new Map();
  }
}
