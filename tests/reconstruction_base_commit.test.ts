// Tests for the item-46 base-commit beacon stage: when the user configures repoDir +
// baseCommit overrides, seedBaseCommitBeacon splices a tier-1 WriteEvent of the committed
// bytes at the commit's committer timestamp; every absence degrades silently to a no-op.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import type { WriteEvent } from "../src/reconstruction_engine.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import {
    BASE_COMMIT_CHANGE_ID_PREFIX,
    computeBaseCommitChangeId,
    computeSkippedBaselineCutoff,
    readCommitTimestamp,
    seedBaseCommitBeacon,
    setPreBaselineReconstructionAllowed,
} from "../src/reconstruction_base_commit.ts";

// Overrides and the task-56 pre-baseline flag are process-wide module state — never let
// one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
    setPreBaselineReconstructionAllowed(true);
});

// Build a throwaway git repo holding `files`, committed once at `commitInstant`
// (git init -b main + local user config, per the render_git_diff/git_evidence recipe).
function makeCommittedRepo(files: Record<string, string>, commitInstant: string): { repoDir: string; commitHash: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "reveng-base-commit-"));
    for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(repoDir, name), content);
    }
    execSync("git init -q -b main", { cwd: repoDir });
    execSync("git config user.email t@t", { cwd: repoDir });
    execSync("git config user.name t", { cwd: repoDir });
    execSync("git add -A", { cwd: repoDir });
    execSync(`git commit -q -m baseline --date ${JSON.stringify(commitInstant)}`, {
        cwd: repoDir,
        env: { ...process.env, GIT_COMMITTER_DATE: commitInstant },
    });
    const commitHash = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim();
    return { repoDir, commitHash };
}

// The minimal record the stage reads: only cwd and timestamp matter, accessed via the
// engine's own `(record as { cwd?: Path })` pattern.
function buildRecordWithCwd(cwd: string, timestamp: string): TranscriptRecord {
    return { cwd: new Path(cwd), timestamp: new Date(timestamp) } as unknown as TranscriptRecord;
}

// A plain full-content write event at `timestamp` — the transcript-side neighbors the
// beacon must be ordered against.
function buildWriteEvent(target: Path, content: string, timestamp: string, changeId: string): WriteEvent {
    return {
        kind: EventKind.write,
        changeId: new Uuid(changeId),
        target,
        content,
        timestamp: new Date(timestamp),
    };
}

test("test_compute_base_commit_change_id_is_deterministic", () => {
    // Scenario: the changeId is a pure function of (commit hash, target) so every replay
    // of the same baseline agrees (item-34 scriptRun: precedent).
    const commit = new Uuid("abc123");
    const target = new Path("/tmp/project/orders.py");
    // Step: the same hash+target twice yields equal ids.
    assert.ok(computeBaseCommitChangeId(commit, target).equals(computeBaseCommitChangeId(commit, target)));
    // Step: a different target yields a different id.
    const otherTarget = new Path("/tmp/project/inventory.py");
    assert.ok(!computeBaseCommitChangeId(commit, target).equals(computeBaseCommitChangeId(commit, otherTarget)));
    // Step: the id string starts with the exported prefix.
    assert.ok(computeBaseCommitChangeId(commit, target).toString().startsWith(BASE_COMMIT_CHANGE_ID_PREFIX));
});

test("test_seed_base_commit_beacon_no_ops_without_overrides", () => {
    // Scenario: an unconfigured engine ({} overrides) must behave exactly as before item 46 —
    // the events pass through identically.
    setPathOverrides({});
    const target = new Path("/tmp/project/orders.py");
    // Step: one ordinary write event and one record.
    const events = [buildWriteEvent(target, "print('hi')\n", "2026-01-01T00:01:00Z", "toolu_w1")];
    const records = [buildRecordWithCwd("/tmp/project", "2026-01-01T00:01:00Z")];
    // Step: seeding without overrides returns the same array contents.
    const seeded = seedBaseCommitBeacon(records, events, target);
    assert.deepEqual(seeded, events);
});

test("test_seed_base_commit_beacon_splices_committed_content_at_commit_timestamp", () => {
    // Scenario: repoDir+baseCommit are configured and the commit's tree holds the target —
    // a tier-1 write beacon of the committed bytes lands BEFORE the later transcript write.
    const committedBytes = "def order():\n    return 1\n";
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": committedBytes }, commitInstant);
    try {
        // Step: the recorded project root (first record cwd) IS the repo root.
        const records = [buildRecordWithCwd(repoDir, "2026-01-01T00:00:01Z")];
        const target = new Path(join(repoDir, "orders.py"));
        // Step: the transcript carries one write strictly after the commit time.
        const laterWrite = buildWriteEvent(target, "def order():\n    return 2\n", "2026-01-01T00:01:00Z", "toolu_w1");
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        // Step: seeding splices exactly one new event, first in the stream.
        const seeded = seedBaseCommitBeacon(records, [laterWrite], target);
        assert.equal(seeded.length, 2);
        const beacon = seeded[0]!;
        // Step: the beacon is a write event (enum-member comparison) of the committed bytes.
        assert.ok(beacon.kind === EventKind.write);
        assert.equal(beacon.content, committedBytes);
        // Step: the beacon carries the commit's committer timestamp.
        assert.equal(beacon.timestamp.getTime(), new Date(commitInstant).getTime());
        // Step: the beacon carries the deterministic changeId.
        assert.ok(beacon.changeId.equals(computeBaseCommitChangeId(new Uuid(commitHash), target)));
        // Step: the transcript write survives untouched after the beacon.
        assert.equal(seeded[1], laterWrite);
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_seed_base_commit_beacon_inserts_mid_stream_by_timestamp", () => {
    // Scenario: two transcript events bracket the commit time — the beacon lands BETWEEN
    // them (index 1), so a mid-session baseline supersedes only what came before it.
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        const records = [buildRecordWithCwd(repoDir, "2026-01-01T00:00:01Z")];
        const target = new Path(join(repoDir, "orders.py"));
        // Step: one event before the commit time, one after.
        const earlier = buildWriteEvent(target, "before\n", "2026-01-01T00:00:05Z", "toolu_w1");
        const later = buildWriteEvent(target, "after\n", "2026-01-01T00:00:20Z", "toolu_w2");
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        // Step: the beacon is spliced at index 1, keeping both neighbors in place.
        const seeded = seedBaseCommitBeacon(records, [earlier, later], target);
        assert.equal(seeded.length, 3);
        assert.equal(seeded[0], earlier);
        assert.ok(seeded[1]!.changeId.equals(computeBaseCommitChangeId(new Uuid(commitHash), target)));
        assert.equal(seeded[2], later);
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_seed_base_commit_beacon_no_ops_for_file_absent_from_commit", () => {
    // Scenario: the target path is not in the commit's tree — silent-degradation channel,
    // events pass through unchanged.
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        const records = [buildRecordWithCwd(repoDir, "2026-01-01T00:00:01Z")];
        // Step: the target names a file the commit does not carry.
        const target = new Path(join(repoDir, "missing.py"));
        const events = [buildWriteEvent(target, "print('hi')\n", "2026-01-01T00:01:00Z", "toolu_w1")];
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        // Step: seeding returns the events unchanged.
        const seeded = seedBaseCommitBeacon(records, events, target);
        assert.deepEqual(seeded, events);
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_seed_base_commit_beacon_drops_superseded_events_when_pre_baseline_reconstruction_declined", () => {
    // Scenario (task 56): the user answered "No" to the pre-baseline question — events the
    // beacon supersedes (at-or-before its insertion point) are dropped so replay skips them.
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        const records = [buildRecordWithCwd(repoDir, "2026-01-01T00:00:01Z")];
        const target = new Path(join(repoDir, "orders.py"));
        // Step: one event before the commit time, one after (same bracket as the splice test).
        const earlier = buildWriteEvent(target, "before\n", "2026-01-01T00:00:05Z", "toolu_w1");
        const later = buildWriteEvent(target, "after\n", "2026-01-01T00:00:20Z", "toolu_w2");
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        // Step: decline pre-baseline reconstruction.
        setPreBaselineReconstructionAllowed(false);
        // Step: the result is exactly [beacon, later] — the earlier event is gone.
        const seeded = seedBaseCommitBeacon(records, [earlier, later], target);
        assert.equal(seeded.length, 2);
        assert.ok(seeded[0]!.changeId.equals(computeBaseCommitChangeId(new Uuid(commitHash), target)));
        assert.equal(seeded[1], later);
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_seed_base_commit_beacon_keeps_pre_baseline_events_by_default", () => {
    // Scenario (task 56): with the flag untouched, the default is today's behavior — the
    // beacon is spliced and every pre-baseline event survives (locks the CLI-safe default).
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        const records = [buildRecordWithCwd(repoDir, "2026-01-01T00:00:01Z")];
        const target = new Path(join(repoDir, "orders.py"));
        const earlier = buildWriteEvent(target, "before\n", "2026-01-01T00:00:05Z", "toolu_w1");
        const later = buildWriteEvent(target, "after\n", "2026-01-01T00:00:20Z", "toolu_w2");
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        // Step: the splice keeps both neighbors in place around the beacon.
        const seeded = seedBaseCommitBeacon(records, [earlier, later], target);
        assert.equal(seeded.length, 3);
        assert.equal(seeded[0], earlier);
        assert.ok(seeded[1]!.changeId.equals(computeBaseCommitChangeId(new Uuid(commitHash), target)));
        assert.equal(seeded[2], later);
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_compute_skipped_baseline_cutoff_is_undefined_while_pre_baseline_reconstruction_is_allowed", () => {
    // Scenario (task 151): with the flag at its default `true`, there is no cutoff — script
    // runs must never be skipped on a "Yes" (or unasked) build, overrides or not. The flag
    // short-circuits before the repo is consulted, so a fake override path suffices.
    setPathOverrides({ repoDir: new Path("/tmp/some-repo"), baseCommit: new Uuid("abc123") });
    assert.equal(computeSkippedBaselineCutoff(), undefined);
});

test("test_compute_skipped_baseline_cutoff_returns_the_commit_timestamp_when_pre_baseline_is_declined", () => {
    // Scenario (task 151): "No" + configured overrides — the cutoff is the baseline commit's
    // committer timestamp, the same instant seedBaseCommitBeacon orders its beacon by.
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        // Step: decline pre-baseline reconstruction.
        setPreBaselineReconstructionAllowed(false);
        // Step: the cutoff equals the repo's committer timestamp.
        const cutoff = computeSkippedBaselineCutoff();
        const expected = readCommitTimestamp(new Path(repoDir), new Uuid(commitHash));
        assert.ok(cutoff !== undefined);
        assert.equal(cutoff.getTime(), expected!.getTime());
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_read_commit_timestamp_returns_undefined_for_bad_repo", () => {
    // Scenario: a nonexistent repo directory is a silent undefined, never a throw.
    const timestamp = readCommitTimestamp(new Path("/nonexistent-reveng-base-commit-dir"), new Uuid("deadbeef"));
    assert.equal(timestamp, undefined);
});

