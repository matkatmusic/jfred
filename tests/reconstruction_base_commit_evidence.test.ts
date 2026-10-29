// Tests for base-commit evidence: first record cwd, per-source root choice, and the global single-source fallback.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { findBaseCommitEvidenceForTarget, findFirstRecordCwd, readCommitTimestamp } from "../src/reconstruction_base_commit_evidence.ts";

afterEach(() => {
    setPathOverrides({});
});

function buildRecordWithCwd(cwd: string): TranscriptRecord {
    return { cwd: new Path(cwd) } as unknown as TranscriptRecord;
}

test("test_read_commit_timestamp_returns_undefined_for_bad_repo", () => {
    // A nonexistent repo directory must be a silent undefined, never a throw.
    const timestamp = readCommitTimestamp(new Path("/nonexistent-reveng-base-commit-dir"), new Uuid("deadbeef"));
    assert.equal(timestamp, undefined);
});

test("test_find_first_record_cwd_skips_records_without_cwd", () => {
    const records = [{} as unknown as TranscriptRecord, buildRecordWithCwd("/work/a"), buildRecordWithCwd("/work/b")];
    assert.equal(findFirstRecordCwd(records)?.toString(), "/work/a");
    assert.equal(findFirstRecordCwd([]), undefined);
});

test("test_find_evidence_without_sources_uses_global_overrides_and_first_cwd", () => {
    setPathOverrides({ repoDir: new Path("/repo"), baseCommit: new Uuid("abc") });
    const evidence = findBaseCommitEvidenceForTarget([buildRecordWithCwd("/work")], new Path("/work/x.ts"));
    assert.equal(evidence?.repoDir.toString(), "/repo");
    assert.equal(evidence?.baseCommit.toString(), "abc");
    assert.equal(evidence?.relativeRoot.toString(), "/work");
});

test("test_find_evidence_without_global_repo_is_undefined", () => {
    assert.equal(findBaseCommitEvidenceForTarget([buildRecordWithCwd("/work")], new Path("/work/x.ts")), undefined);
});

test("test_find_evidence_with_sources_picks_longest_enclosing_root", () => {
    setPathOverrides({
        repoDir: new Path("/global-repo"),
        baseCommit: new Uuid("global"),
        sources: [
            { projectsDir: new Path("/p1"), root: new Path("/work"), repoDir: new Path("/outer-repo"), baseCommit: new Uuid("outer") },
            { projectsDir: new Path("/p2"), root: new Path("/work/nested"), repoDir: new Path("/inner-repo") },
            { projectsDir: new Path("/p3") },
        ],
    });
    const evidence = findBaseCommitEvidenceForTarget([], new Path("/work/nested/x.ts"));
    assert.equal(evidence?.repoDir.toString(), "/inner-repo");
    assert.equal(evidence?.baseCommit.toString(), "global");
    assert.equal(evidence?.relativeRoot.toString(), "/work/nested");
    assert.equal(findBaseCommitEvidenceForTarget([], new Path("/elsewhere/x.ts")), undefined);
});
