// Task 305: GET /api/layer1-diff answers unified hunks between two revisions of ONE Layer 1 file.
//
// Driven through a recording ServerResponse stand-in (viewer_api_layer1_file.test.ts's pattern); refusals surface as throws.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordType } from "../src/structures/vocabulary.ts";
import { handleLayer1DiffContentRequest, handleLayer1DiffRequest } from "../src/viewer_api_layer1_diff.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

const FIRST_TEXT = "shared line\nfirst only\n";
const SECOND_TEXT = "shared line\nsecond only\n";
const WORKING_TREE_TEXT = "shared line\nsecond only\nedited on disk\n";
const FIXTURE_FILE = "notes.txt";

// Fixed git identity so the fixture never depends on the machine's config.
function runGit(repoDir: string, command: string): string {
    return execSync(`git -c user.name=t -c user.email=t@t ${command}`, { cwd: repoDir, stdio: "pipe" }).toString();
}

// Two commits of one file, then a further on-disk edit — every side kind the route serves.
function makeTwoCommitRepo(): { repoDir: string; firstHash: string; secondHash: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-diff-repo-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, FIXTURE_FILE), FIRST_TEXT);
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m first");
    const firstHash = runGit(repoDir, "rev-parse HEAD").trim();
    writeFileSync(join(repoDir, FIXTURE_FILE), SECOND_TEXT);
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m second");
    const secondHash = runGit(repoDir, "rev-parse HEAD").trim();
    writeFileSync(join(repoDir, FIXTURE_FILE), WORKING_TREE_TEXT);
    return { repoDir, firstHash, secondHash };
}

// Drive the route the way the server does — a query string in, one { diff } out.
function requestLayer1Diff(parameters: Record<string, string>): { status: number; diff: string } {
    let status = 0;
    let body = "";
    const response = {
        writeHead: (code: number) => { status = code; },
        end: (text: string) => { body = text; },
    } as unknown as ServerResponse;
    handleLayer1DiffRequest(response, new URLSearchParams(parameters));
    return { status, diff: (JSON.parse(body) as { diff: string }).diff };
}

const { repoDir, firstHash, secondHash } = makeTwoCommitRepo();

test("test_layer1_diff_endpoint_diffs_two_commits_of_one_file", () => {
    const { status, diff } = requestLayer1Diff({ repo: repoDir, path: FIXTURE_FILE, baseHash: firstHash, targetHash: secondHash });
    assert.equal(status, 200);
    assert.ok(diff.startsWith("@@"), diff);
    assert.ok(diff.includes("-first only"), diff);
    assert.ok(diff.includes("+second only"), diff);
});

test("test_layer1_diff_endpoint_uses_the_working_tree_for_a_side_with_no_hash", () => {
    const { diff } = requestLayer1Diff({ repo: repoDir, dir: repoDir, path: FIXTURE_FILE, baseHash: secondHash });
    assert.ok(diff.includes("+edited on disk"), diff);
    assert.ok(!diff.includes("-second only"), diff);
});

test("test_layer1_diff_endpoint_answers_empty_for_identical_sides", () => {
    const { diff } = requestLayer1Diff({ repo: repoDir, path: FIXTURE_FILE, baseHash: firstHash, targetHash: firstHash });
    assert.equal(diff, "");
});

// User bug 2026-07-29: full content on an identical pair showed nothing; it must show the whole file.
test("test_layer1_diff_endpoint_answers_the_whole_file_as_context_for_identical_sides_at_context_full", () => {
    const { diff } = requestLayer1Diff({ repo: repoDir, path: FIXTURE_FILE, baseHash: firstHash, targetHash: firstHash, context: "full" });
    const lines = diff.split("\n");
    assert.equal(lines[0], "@@ -1,2 +1,2 @@", diff);
    assert.deepEqual(lines.slice(1), [" shared line", " first only"], diff);
});

// Task 320: a far-away line only appears as context when the full-context toggle widens the diff.
test("test_layer1_diff_endpoint_widens_context_to_the_whole_file_on_context_full", () => {
    const farLine = "far line 1";
    const sharedLines = Array.from({ length: 10 }, (_, index) => `far line ${index + 1}`);
    const wideFile = "wide.txt";
    writeFileSync(join(repoDir, wideFile), [...sharedLines, "changed once"].join("\n") + "\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m wide-first");
    const wideFirstHash = runGit(repoDir, "rev-parse HEAD").trim();
    writeFileSync(join(repoDir, wideFile), [...sharedLines, "changed twice"].join("\n") + "\n");
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m wide-second");
    const wideSecondHash = runGit(repoDir, "rev-parse HEAD").trim();
    const defaultRequest = { repo: repoDir, path: wideFile, baseHash: wideFirstHash, targetHash: wideSecondHash };
    // Whole-line match: "far line 1" is a substring of the in-context "far line 10".
    assert.ok(!requestLayer1Diff(defaultRequest).diff.includes(` ${farLine}\n`));
    assert.ok(requestLayer1Diff({ ...defaultRequest, context: "full" }).diff.includes(` ${farLine}\n`));
});

// Task 329: sides as CONTENT STRINGS — any source that can produce a string diffs through this route.
function requestContentDiff(payload: object): { status: number; diff: string } {
    let status = 0;
    let body = "";
    const response = {
        writeHead: (code: number) => { status = code; },
        end: (text: string) => { body = text; },
    } as unknown as ServerResponse;
    const request = new EventEmitter() as unknown as IncomingMessage;
    handleLayer1DiffContentRequest(request, response);
    (request as unknown as EventEmitter).emit("data", Buffer.from(JSON.stringify(payload)));
    (request as unknown as EventEmitter).emit("end");
    return { status, diff: (JSON.parse(body) as { diff: string }).diff };
}

test("test_layer1_diff_content_endpoint_diffs_two_strings", () => {
    const { status, diff } = requestContentDiff({ base: "shared\nold line\n", target: "shared\nnew line\n" });
    assert.equal(status, 200);
    assert.ok(diff.includes("-old line"), diff);
    assert.ok(diff.includes("+new line"), diff);
});

test("test_layer1_diff_content_endpoint_answers_the_whole_file_for_identical_sides_at_context_full", () => {
    const { diff } = requestContentDiff({ base: "one\ntwo\n", target: "one\ntwo\n", context: "full" });
    assert.deepEqual(diff.split("\n"), ["@@ -1,2 +1,2 @@", " one", " two"]);
});

// Task 329: a snapshot is a diff SIDE — its bytes come from the owning session's sidecar blob.
test("test_layer1_diff_endpoint_diffs_a_snapshot_side_against_the_working_tree", () => {
    const sessionId = "b21d84c5-0000-0000-0000-000000000001";
    const relativePath = "src/util.ts";
    const treeRoot = makeTempDir();
    const projectDir = mkdtempSync(join(tmpdir(), "layer1-diff-snap-project-"));
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, relativePath), "shared line\ndisk only\n");
    const jsonlDir = join(treeRoot, "projects", "-demo");
    mkdirSync(jsonlDir, { recursive: true });
    const records = [
        { type: RecordType.user, cwd: projectDir, sessionId, message: { role: "user", content: "hi" } },
        {
            type: RecordType.fileHistorySnapshot,
            messageId: "m-1",
            isSnapshotUpdate: false,
            snapshot: {
                messageId: "m-1",
                timestamp: "2026-06-03T10:30:00.000Z",
                trackedFileBackups: {
                    [join(projectDir, relativePath)]: { backupFileName: "abc123@v2", version: 2, backupTime: "2026-06-03T10:30:00.000Z" },
                },
            },
        },
    ];
    const jsonlPath = join(jsonlDir, `${sessionId}.jsonl`);
    writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    mkdirSync(join(treeRoot, "file-history", sessionId), { recursive: true });
    writeFileSync(join(treeRoot, "file-history", sessionId, "abc123@v2"), "shared line\nsnapshot only\n");

    const { status, diff } = requestLayer1Diff({
        dir: projectDir,
        path: relativePath,
        baseSnapshotSession: jsonlPath,
        baseSessionId: sessionId,
        baseVersion: "2",
    });
    assert.equal(status, 200);
    assert.ok(diff.includes("-snapshot only"), diff);
    assert.ok(diff.includes("+disk only"), diff);
});

test("test_layer1_diff_endpoint_refuses_bad_hashes_and_escaping_paths", () => {
    assert.throws(
        () => requestLayer1Diff({ repo: repoDir, path: FIXTURE_FILE, baseHash: "HEAD; rm -rf /", targetHash: firstHash }),
        /not a commit hash/,
    );
    assert.throws(
        () => requestLayer1Diff({ dir: repoDir, path: "../../etc/passwd" }),
        /escapes the folder/,
    );
});
