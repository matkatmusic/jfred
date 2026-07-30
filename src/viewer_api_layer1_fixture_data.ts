// Task 330: THE DATA. Ported wholesale from plans/layer2-mockup/fixture.js — no clock, no randomness.
//
// Every instant is a literal or arithmetic on one, so the fixture view is byte-stable across renders.

import { Path, Uuid } from "./structures/domain.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";

export const ms = (iso: string): number => Date.parse(iso);
export const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

// Fake absolute paths the fixture settings hand the page, so it auto-boots with no real folder.
export const FIXTURE_DIR = "/fixture/demo/worktree";
export const FIXTURE_REPO = "/fixture/demo/worktree";
export const FIXTURE_JSONL_DIR = "/fixture/demo/projects";

export interface FixtureTitleRange { title: string; from: number; to: number; }
export interface FixtureCommit { hash: string; at: string; wrote: string; subject: string; files: string[]; }
export interface FixtureDisk { path: string; born: string; at: string; }
export interface FixtureSession { file: string; titles: FixtureTitleRange[]; started: string; ended: string; paths: string[]; }
export interface FixtureSnapshot { path: string; version: string; at: string; session: string; line: number; }

// A commit carries BOTH stamps: `at` is committer time, `wrote` is author time (the rebase case).
export const COMMITS: FixtureCommit[] = [
    { hash: "a1b2c3d4", at: "2026-06-01T09:00:00Z", wrote: "2026-06-01T09:00:00Z",
        subject: "seed the demo app with an index and a readme", files: ["src/index.ts", "README.md"] },
    { hash: "e4f5a6b7", at: "2026-06-01T14:30:00Z", wrote: "2026-06-01T14:30:00Z",
        subject: "extract the shared trim helper into src/util.ts", files: ["src/index.ts", "src/util.ts"] },
    { hash: "c7d8e9f0", at: "2026-06-03T11:00:00Z", wrote: "2026-06-02T08:10:00Z",
        subject: "dispatch run-scenario cases through one table", files: ["src/util.ts",
            "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts"] },
    { hash: "0a1b2c3d", at: "2026-06-03T18:20:00Z", wrote: "2026-06-03T18:20:00Z",
        subject: "lowercase the parsed input before dispatch", files: ["src/index.ts"] },
    { hash: "4d5e6f70", at: "2026-07-20T16:00:00Z", wrote: "2026-07-20T16:00:00Z",
        subject: "retire the old API notes", files: ["README.md", "docs/old-api.md"] },
    { hash: "8a9b0c1d", at: "2026-07-20T21:05:00Z", wrote: "2026-07-20T21:05:00Z",
        subject: "ship the deploy script", files: ["scripts/deploy.sh"] },
    { hash: "5636d8ec", at: "2026-07-20T21:20:00Z", wrote: "2026-07-19T13:45:00Z",
        subject: "cover the dispatcher's error branch", files: [
            "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts"] },
];

export const DISK: FixtureDisk[] = [
    { path: "src/index.ts", born: "2026-06-01T08:05:00Z", at: "2026-07-24T08:15:00Z" },
    { path: "src/util.ts", born: "2026-05-31T14:35:00Z", at: "2026-07-24T08:05:00Z" },
    { path: "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts",
        born: "2026-05-31T11:05:00Z", at: "2026-07-24T09:30:00Z" },
    { path: "README.md", born: "2026-07-20T16:00:00Z", at: "2026-07-20T16:00:00Z" },
    { path: "notes.txt", born: "2026-07-23T19:40:00Z", at: "2026-07-23T19:40:00Z" },
    { path: ".env.local", born: "2026-05-28T07:00:00Z", at: "2026-05-28T07:00:00Z" },
];

export const BRANCHES = ["main", "layer-1-milestone", "spike/author-timestamps"];

export const SESSIONS: FixtureSession[] = [
    { file: "0f3c9a7e.jsonl", titles: [{ title: "seed the demo app", from: 1, to: 120 }],
        started: "2026-06-01T08:44:00Z", ended: "2026-06-01T09:12:00Z",
        paths: ["src/index.ts", "README.md"] },
    { file: "b21d84c5.jsonl", titles: [
        { title: "extract the trim helper", from: 1, to: 210 },
        { title: "dispatch through one table", from: 211, to: 520 }],
        started: "2026-06-01T14:05:00Z", ended: "2026-06-03T18:40:00Z",
        paths: ["src/index.ts", "src/util.ts",
            "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts"] },
    { file: "7ce50a19.jsonl", titles: [],
        started: "2026-07-20T15:38:00Z", ended: "2026-07-20T21:30:00Z",
        paths: ["README.md", "docs/old-api.md", "scripts/deploy.sh"] },
    { file: "d4a06b8f.jsonl", titles: [{ title: "cover the error branch, take notes", from: 1, to: 260 }],
        started: "2026-07-23T19:10:00Z", ended: "2026-07-24T09:45:00Z",
        paths: ["notes.txt", "src/index.ts", "src/util.ts",
            "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts"] },
];

// @vN is numbered PER SESSION: src/util.ts carries @v2 from b21d84c5 AND a different one from d4a06b8f.
export const SNAPSHOTS: FixtureSnapshot[] = [
    { path: "src/index.ts", version: "@v1", at: "2026-06-01T08:50:00Z", session: "0f3c9a7e.jsonl", line: 40 },
    { path: "src/index.ts", version: "@v2", at: "2026-06-01T09:05:00Z", session: "0f3c9a7e.jsonl", line: 95 },
    { path: "src/util.ts", version: "@v1", at: "2026-06-01T14:20:00Z", session: "b21d84c5.jsonl", line: 60 },
    { path: "src/util.ts", version: "@v2", at: "2026-06-03T10:30:00Z", session: "b21d84c5.jsonl", line: 300 },
    { path: "src/util.ts", version: "@v2", at: "2026-07-24T08:00:00Z", session: "d4a06b8f.jsonl", line: 120 },
    { path: "src/index.ts", version: "@v3", at: "2026-07-24T08:15:00Z", session: "d4a06b8f.jsonl", line: 200 },
    { path: "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts",
        version: "@v1", at: "2026-07-23T19:55:00Z", session: "d4a06b8f.jsonl", line: 30 },
];

// The title in effect AT a position — not the session's first and not its last (task #305).
export function titleAt(file: string, line: number): string {
    const session = SESSIONS.find((entry) => entry.file === file);
    return session?.titles.find((range) => line >= range.from && line <= range.to)?.title ?? "untitled session";
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

const bulkSessions = new Map<string, { paths: string[]; from: number; to: number }>();
for (let i = 0; i < BULK_FILES; i += 1) {
    const path = `${BULK_DIRS[i % BULK_DIRS.length]}/module_${String(i).padStart(2, "0")}`
        + `.${BULK_EXTS[i % BULK_EXTS.length]}`;
    const born = BULK_BORN0 + i * 7 * HOUR_MS;
    const commitAt = (k: number): number => born + (5 + k * 23) * HOUR_MS;
    const commitCount = 2 + (i % 3);
    for (let k = 0; k < commitCount; k += 1) {
        COMMITS.push({ hash: fakeHash(i * 17 + k), at: iso(commitAt(k)), wrote: iso(commitAt(k)),
            subject: `bulk change ${k + 1} to ${basename(path)}`, files: [path] });
    }
    const mtime = commitAt(commitCount - 1) + 4 * HOUR_MS;
    DISK.push({ path, born: iso(born), at: iso(mtime) });
    const wanted = [
        i % 3 === 2 ? null : born + 3 * HOUR_MS,
        i % 3 === 0 ? commitAt(1) : null,
        i % 4 === 0 ? mtime : null,
    ].filter((t): t is number => t !== null);
    const file = `bulk-${Math.floor(i / 12)}.jsonl`;
    wanted.forEach((t, v) => SNAPSHOTS.push(
        { path, version: `@v${v + 1}`, at: iso(t), session: file, line: 40 + v * 60 }));
    const group = bulkSessions.get(file) ?? { paths: [], from: born, to: mtime };
    group.paths.push(path);
    group.to = Math.max(group.to, mtime);
    bulkSessions.set(file, group);
}
for (const [file, group] of bulkSessions) {
    SESSIONS.push({ file, titles: [{ title: `bulk pass over ${group.paths.length} modules`, from: 1, to: 400 }],
        started: iso(group.from), ended: iso(group.to), paths: group.paths });
}

// ---- fixture self-check: born <= snapshot <= mtime, inside the session window, on a title line ----
const bad: string[] = [];
for (const s of SNAPSHOTS) {
    const disk = DISK.find((d) => d.path === s.path);
    const owner = SESSIONS.find((x) => x.file === s.session);
    const where = `${s.path} ${s.version} (${s.session})`;
    if (!disk) { bad.push(`${where}: no DISK entry`); }
    else if (ms(s.at) < ms(disk.born)) { bad.push(`${where}: before born ${disk.born}`); }
    else if (ms(s.at) > ms(disk.at)) { bad.push(`${where}: after mtime ${disk.at}`); }
    if (!owner) { bad.push(`${where}: owning session is missing`); }
    else if (ms(s.at) < ms(owner.started) || ms(s.at) > ms(owner.ended)) {
        bad.push(`${where}: outside its session's window`);
    } else if (owner.titles.length && !owner.titles.some((t) => s.line >= t.from && s.line <= t.to)) {
        bad.push(`${where}: line ${s.line} is in no title range`);
    }
}
if (bad.length) { throw new Error(`fixture is out of order:\n  ${bad.join("\n  ")}`); }

// A stable per-session Uuid; the wire needs an id but the fixture reads no real transcript.
export function sessionIdFor(file: string): Uuid {
    return new Uuid(`fixture-${file.replace(/\.jsonl$/, "")}`);
}

// A fake absolute transcript path whose basename equals the fixture session file name.
export function sessionFileFor(file: string): Path {
    return new Path(`${FIXTURE_JSONL_DIR}/${file}`);
}

// The snapshot placements for one path, ascending — the SnapshotPlacement shape the wire builder wants.
export function fixtureSnapshotPlacements(path: string): SnapshotPlacement[] {
    return SNAPSHOTS.filter((s) => s.path === path)
        .map((s) => ({
            path: new Path(s.path),
            version: Number(s.version.replace("@v", "")),
            instant: new Date(ms(s.at)),
            sessionId: sessionIdFor(s.session),
            sessionFile: sessionFileFor(s.session),
            line: s.line,
            backupFileName: new Path(`${s.session}-${s.version}`),
        }))
        .sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

