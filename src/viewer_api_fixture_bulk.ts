// Shared bulk generator and self-check for every layer's fixture data.

import type { FixtureCommit, FixtureDisk, FixtureSession } from "./viewer_api_layer1_fixture_data.ts";
import { getBasename, parseMs } from "./viewer_api_layer1_fixture_data.ts";
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
const BULK_BORN0 = parseMs("2026-06-05T09:00:00Z");

function formatIso(t: number): string {
  return new Date(t).toISOString();
}

// Knuth's constant, so neighbouring indexes do not produce neighbouring-looking hashes.
function buildFakeHash(n: number): string {
  return ((n * 2654435761) % 4294967296).toString(16).padStart(8, "0").slice(0, 8);
}

function listWantedSnapshotTimes(i: number, born: number, secondCommitAt: number, mtime: number): number[] {
  const candidates = [
    i % 3 === 2 ? null : born + 3 * HOUR_MS,
    i % 3 === 0 ? secondCommitAt : null,
    i % 4 === 0 ? mtime : null,
  ];
  const wanted: number[] = [];
  for (const t of candidates) {
    if (t !== null) {
      wanted.push(t);
    }
  }
  return wanted;
}

function generateBulkRows(target: BulkFixtureTarget): void {
  const bulkSessions = new Map<string, { paths: string[]; from: number; to: number }>();
  for (let i = 0; i < BULK_FILES; i += 1) {
    const path = `${BULK_DIRS[i % BULK_DIRS.length]}/module_${String(i).padStart(2, "0")}`
      + `.${BULK_EXTS[i % BULK_EXTS.length]}`;
    const born = BULK_BORN0 + i * 7 * HOUR_MS;
    const computeCommitAt = (k: number): number => born + (5 + k * 23) * HOUR_MS;
    const commitCount = 2 + (i % 3);
    for (let k = 0; k < commitCount; k += 1) {
      target.commits.push({ hash: buildFakeHash(i * 17 + k), at: formatIso(computeCommitAt(k)),
        wrote: formatIso(computeCommitAt(k)), subject: `bulk change ${k + 1} to ${getBasename(path)}`, files: [path] });
    }
    const mtime = computeCommitAt(commitCount - 1) + 4 * HOUR_MS;
    target.disk.push({ path, born: formatIso(born), at: formatIso(mtime) });
    const wanted = listWantedSnapshotTimes(i, born, computeCommitAt(1), mtime);
    const file = `bulk-${Math.floor(i / 12)}.jsonl`;
    for (let v = 0; v < wanted.length; v += 1) {
      target.snapshots.push({ path, version: `@v${v + 1}`, at: formatIso(wanted[v]!), session: file, line: 40 + v * 60 });
    }
    const group = bulkSessions.get(file) ?? { paths: [], from: born, to: mtime };
    group.paths.push(path);
    group.to = Math.max(group.to, mtime);
    bulkSessions.set(file, group);
  }
  for (const [file, group] of bulkSessions) {
    target.sessions.push({ file, titles: [{ title: `bulk pass over ${group.paths.length} modules`, from: 1, to: 400 }],
      started: formatIso(group.from), ended: formatIso(group.to), paths: group.paths });
  }
}

function isOnTitleLine(owner: FixtureSession, line: number): boolean {
  for (const title of owner.titles) {
    const isInRange = line >= title.from && line <= title.to;
    if (isInRange) {
      return true;
    }
  }
  return false;
}

// ---- fixture self-check: born <= snapshot <= mtime, inside the session window, on a title line ----
function checkFixtureOrder(target: BulkFixtureTarget): void {
  const diskByPath = new Map<string, FixtureDisk>();
  for (const d of target.disk) {
    if (!diskByPath.has(d.path)) {
      diskByPath.set(d.path, d);
    }
  }
  const sessionByFile = new Map<string, FixtureSession>();
  for (const x of target.sessions) {
    if (!sessionByFile.has(x.file)) {
      sessionByFile.set(x.file, x);
    }
  }
  const bad: string[] = [];
  for (const s of target.snapshots) {
    const disk = diskByPath.get(s.path);
    const owner = sessionByFile.get(s.session);
    const where = `${s.path} ${s.version} (${s.session})`;
    if (!disk) {
      bad.push(`${where}: no DISK entry`);
    }
    else if (parseMs(s.at) < parseMs(disk.born)) {
      bad.push(`${where}: before born ${disk.born}`);
    }
    else if (parseMs(s.at) > parseMs(disk.at)) {
      bad.push(`${where}: after mtime ${disk.at}`);
    }
    if (!owner) {
      bad.push(`${where}: owning session is missing`);
      continue;
    }
    const isBeforeWindow = parseMs(s.at) < parseMs(owner.started);
    const isAfterWindow = parseMs(s.at) > parseMs(owner.ended);
    const isOutsideWindow = isBeforeWindow || isAfterWindow;
    const hasTitles = owner.titles.length > 0;
    if (isOutsideWindow) {
      bad.push(`${where}: outside its session's window`);
    }
    else if (hasTitles && !isOnTitleLine(owner, s.line)) {
      bad.push(`${where}: line ${s.line} is in no title range`);
    }
  }
  if (bad.length > 0) {
    throw new Error(`fixture is out of order:\n  ${bad.join("\n  ")}`);
  }
}

export function buildBulkFixture(target: BulkFixtureTarget): void {
  generateBulkRows(target);
  checkFixtureOrder(target);
}
