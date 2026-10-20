// Task 354: the shared bulk generator and self-check for every layer's fixture data.  One loop fills the layer 1 arrays AND the layer 2 snapshots per file, so both stay mutually consistent.

import type { FixtureCommit, FixtureDisk, FixtureSession } from "./viewer_api_layer1_fixture_data.ts";
import { basename, ms } from "./viewer_api_layer1_fixture_data.ts";
import type { FixtureSnapshot } from "./viewer_api_layer2_fixture_data.ts";

export interface BulkFixtureTarget {
  commits: FixtureCommit[];
  disk: FixtureDisk[];
  sessions: FixtureSession[];
  snapshots: FixtureSnapshot[];
}

// ---- bulk fixture: ~90 bubbles and ~400 instants, so BOTH scroll axes are real (generated) ----
const HOUR_MS = 3600000;
const BULK_DIRS = ["src/api", "src/ui/panels", "src/ui/widgets", "lib/parse", "tests/unit",
  "docs/guides", "scripts/ci"];
const BULK_EXTS = ["ts", "ts", "tsx", "py", "sh", "md"];
const BULK_FILES = 84;
const BULK_BORN0 = ms("2026-06-05T09:00:00Z");
const iso = (t: number): string => new Date(t).toISOString();
// Knuth's constant, so neighbouring indexes do not produce neighbouring-looking hashes.
const fakeHash = (n: number): string => ((n * 2654435761) % 4294967296).toString(16).padStart(8, "0").slice(0, 8);

function generateBulkRows(target: BulkFixtureTarget): void {
  const bulkSessions = new Map<string, { paths: string[]; from: number; to: number }>();
  for (let i = 0; i < BULK_FILES; i += 1) {
    const path = `${BULK_DIRS[i % BULK_DIRS.length]}/module_${String(i).padStart(2, "0")}`
            + `.${BULK_EXTS[i % BULK_EXTS.length]}`;
    const born = BULK_BORN0 + i * 7 * HOUR_MS;
    const commitAt = (k: number): number => born + (5 + k * 23) * HOUR_MS;
    const commitCount = 2 + (i % 3);
    for (let k = 0; k < commitCount; k += 1) {
      target.commits.push({ hash: fakeHash(i * 17 + k), at: iso(commitAt(k)), wrote: iso(commitAt(k)),
        subject: `bulk change ${k + 1} to ${basename(path)}`, files: [path] });
    }
    const mtime = commitAt(commitCount - 1) + 4 * HOUR_MS;
    target.disk.push({ path, born: iso(born), at: iso(mtime) });
    const wanted = [
      i % 3 === 2 ? null : born + 3 * HOUR_MS,
      i % 3 === 0 ? commitAt(1) : null,
      i % 4 === 0 ? mtime : null,
    ].filter((t): t is number => t !== null);
    const file = `bulk-${Math.floor(i / 12)}.jsonl`;
    wanted.forEach((t, v) => target.snapshots.push(
      { path, version: `@v${v + 1}`, at: iso(t), session: file, line: 40 + v * 60 }));
    const group = bulkSessions.get(file) ?? { paths: [], from: born, to: mtime };
    group.paths.push(path);
    group.to = Math.max(group.to, mtime);
    bulkSessions.set(file, group);
  }
  for (const [file, group] of bulkSessions) {
    target.sessions.push({ file, titles: [{ title: `bulk pass over ${group.paths.length} modules`, from: 1, to: 400 }],
      started: iso(group.from), ended: iso(group.to), paths: group.paths });
  }
}

// ---- fixture self-check: born <= snapshot <= mtime, inside the session window, on a title line ----
function checkFixtureOrder(target: BulkFixtureTarget): void {
  const bad: string[] = [];
  for (const s of target.snapshots) {
    const disk = target.disk.find((d) => d.path === s.path);
    const owner = target.sessions.find((x) => x.file === s.session);
    const where = `${s.path} ${s.version} (${s.session})`;
    if (!disk) {
      bad.push(`${where}: no DISK entry`);
    }
    else if (ms(s.at) < ms(disk.born)) {
      bad.push(`${where}: before born ${disk.born}`);
    }
    else if (ms(s.at) > ms(disk.at)) {
      bad.push(`${where}: after mtime ${disk.at}`);
    }
    if (!owner) {
      bad.push(`${where}: owning session is missing`);
    }
    else if (ms(s.at) < ms(owner.started) || ms(s.at) > ms(owner.ended)) {
      bad.push(`${where}: outside its session's window`);
    }
    else if (owner.titles.length && !owner.titles.some((t) => s.line >= t.from && s.line <= t.to)) {
      bad.push(`${where}: line ${s.line} is in no title range`);
    }
  }
  if (bad.length) {
    throw new Error(`fixture is out of order:\n  ${bad.join("\n  ")}`);
  }
}

export function buildBulkFixture(target: BulkFixtureTarget): void {
  generateBulkRows(target);
  checkFixtureOrder(target);
}
