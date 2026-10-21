// Shared bulk generator for every layer's fixture data; the self-checks live in viewer_api_fixture_check.ts.

import { assertFixture } from "./viewer_api_fixture_check.ts";
import { listTemplateLines } from "./viewer_api_layer1_fixture_content.ts";
import type { FixtureCommit, FixtureDisk, FixtureSession } from "./viewer_api_layer1_fixture_data.ts";
import { getBasename, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import type { FixtureSnapshot } from "./viewer_api_layer2_fixture_data.ts";
import { buildEditEvent, buildReadEvent, type FixtureEvent } from "./viewer_api_layer3_fixture_data.ts";
import type { FixtureScriptRun } from "./viewer_api_layer4_fixture_data.ts";

export interface BulkFixtureTarget {
  commits: FixtureCommit[];
  disk: FixtureDisk[];
  sessions: FixtureSession[];
  snapshots: FixtureSnapshot[];
  edits: FixtureEvent[];
  scriptRuns: FixtureScriptRun[];
}

// ---- bulk fixture: ~90 bubbles and ~400 instants, so BOTH scroll axes are real (generated) ----
const HOUR_MS = 3600000;
const BULK_DIRS = ["src/api", "src/ui/panels", "src/ui/widgets", "lib/parse", "tests/unit",
  "docs/guides", "scripts/ci"];
const BULK_EXTS = ["ts", "ts", "tsx", "py", "sh", "md"];
const BULK_FILES = 84;
const BULK_BORN0 = parseMs("2026-06-05T09:00:00Z");
const EDIT_FREE_EVERY = 6;

function formatIso(t: number): string {
  return new Date(t).toISOString();
}

// Knuth's constant, so neighbouring indexes do not produce neighbouring-looking hashes.
function buildFakeHash(n: number): string {
  const hex = ((n * 2654435761) % 4294967296).toString(16);
  const padded = hex.padStart(8, "0");
  return padded.slice(0, 8);
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

// Every sixth file stays free of Read/Edit nodes, so the page always has bubbles that match layer 2 exactly.
function generateBulkEvents(target: BulkFixtureTarget, i: number, path: string, born: number, file: string): void {
  const isEditFree = i % EDIT_FREE_EVERY === EDIT_FREE_EVERY - 1;
  if (isEditFree) {
    return;
  }
  const base = listTemplateLines(path);
  const readLine = 20 + (i % 10);
  target.edits.push(buildReadEvent({ path, at: formatIso(born + HOUR_MS), session: file, line: readLine }, base));
  target.edits.push(buildEditEvent({ path, at: formatIso(born + 2 * HOUR_MS), session: file, line: readLine + 4 }, base, 3 + (i % 5)));
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
    generateBulkEvents(target, i, path, born, file);
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

export function buildBulkFixture(target: BulkFixtureTarget): void {
  generateBulkRows(target);
  assertFixture(target);
}
