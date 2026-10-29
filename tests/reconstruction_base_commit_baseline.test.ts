// Tests for the pre-baseline flag: dropped events, kept events, and the skipped-baseline cutoff.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import type { WriteEvent } from "../src/reconstruction_events.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import {
    computeBaseCommitChangeId,
    computeSkippedBaselineCutoff,
    insertBaseCommitBeacon,
    setPreBaselineReconstructionAllowed,
} from "../src/reconstruction_base_commit.ts";
import { readCommitTimestamp } from "../src/reconstruction_base_commit_evidence.ts";

// Overrides and the pre-baseline flag are process-wide state: never let one test leak into the next.
afterEach(() => {
    setPathOverrides({});
    setPreBaselineReconstructionAllowed(true);
});

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

// Only cwd and timestamp matter to the stage; the cast mirrors the engine's own access pattern.
function buildRecordWithCwd(cwd: string, timestamp: string): TranscriptRecord {
    return { cwd: new Path(cwd), timestamp: new Date(timestamp) } as unknown as TranscriptRecord;
}

function buildWriteEvent(target: Path, content: string, timestamp: string, changeId: string): WriteEvent {
    return {
        kind: EventKind.write,
        changeId: new Uuid(changeId),
        target,
        content,
        timestamp: new Date(timestamp),
    };
}

test("test_seed_base_commit_beacon_drops_superseded_events_when_pre_baseline_reconstruction_declined", () => {
    // Task 56: on a declined pre-baseline question, events the beacon supersedes are dropped.
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        const records = [buildRecordWithCwd(repoDir, "2026-01-01T00:00:01Z")];
        const target = new Path(join(repoDir, "orders.py"));
        const earlier = buildWriteEvent(target, "before\n", "2026-01-01T00:00:05Z", "toolu_w1");
        const later = buildWriteEvent(target, "after\n", "2026-01-01T00:00:20Z", "toolu_w2");
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        setPreBaselineReconstructionAllowed(false);
        const seeded = insertBaseCommitBeacon(records, [earlier, later], target);
        assert.equal(seeded.length, 2);
        assert.ok(seeded[0]!.changeId.equals(computeBaseCommitChangeId(new Uuid(commitHash), target)));
        assert.equal(seeded[1], later);
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_seed_base_commit_beacon_keeps_pre_baseline_events_by_default", () => {
    // Task 56: locks the CLI-safe default: untouched flag keeps every pre-baseline event.
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        const records = [buildRecordWithCwd(repoDir, "2026-01-01T00:00:01Z")];
        const target = new Path(join(repoDir, "orders.py"));
        const earlier = buildWriteEvent(target, "before\n", "2026-01-01T00:00:05Z", "toolu_w1");
        const later = buildWriteEvent(target, "after\n", "2026-01-01T00:00:20Z", "toolu_w2");
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        const seeded = insertBaseCommitBeacon(records, [earlier, later], target);
        assert.equal(seeded.length, 3);
        assert.equal(seeded[0], earlier);
        assert.ok(seeded[1]!.changeId.equals(computeBaseCommitChangeId(new Uuid(commitHash), target)));
        assert.equal(seeded[2], later);
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});

test("test_compute_skipped_baseline_cutoff_is_undefined_while_pre_baseline_reconstruction_is_allowed", () => {
    // Task 151: the flag short-circuits before the repo is consulted, so a fake path suffices.
    setPathOverrides({ repoDir: new Path("/tmp/some-repo"), baseCommit: new Uuid("abc123") });
    assert.equal(computeSkippedBaselineCutoff(), undefined);
});

test("test_compute_skipped_baseline_cutoff_returns_the_commit_timestamp_when_pre_baseline_is_declined", () => {
    // Task 151: the cutoff must be the same instant insertBaseCommitBeacon orders its beacon by.
    const commitInstant = "2026-01-01T00:00:10Z";
    const { repoDir, commitHash } = makeCommittedRepo({ "orders.py": "committed\n" }, commitInstant);
    try {
        setPathOverrides({ repoDir: new Path(repoDir), baseCommit: new Uuid(commitHash) });
        setPreBaselineReconstructionAllowed(false);
        const cutoff = computeSkippedBaselineCutoff();
        const expected = readCommitTimestamp(new Path(repoDir), new Uuid(commitHash));
        assert.ok(cutoff !== undefined);
        assert.equal(cutoff.getTime(), expected!.getTime());
    } finally {
        rmSync(repoDir, { recursive: true, force: true });
    }
});
