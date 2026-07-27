// Task 257 step 7: GET /api/layer1-file serves ONE file at ONE moment for the Detail View drawer.
// The two forms must not agree — a commit node shows the COMMITTED bytes while the on-disk node
// shows what is on disk NOW — so the fixture is one committed file whose working-tree copy has
// since changed, and each assertion names the bytes only its own form can produce.
//
// No server is spawned: handleLayer1FileRequest is driven directly through a recording stand-in
// for ServerResponse, so this file tests the route's own contract rather than viewer_server.ts's
// wiring (which is a different task's edit). The refusals therefore surface as THROWS — that is
// exactly what the route hands the server's outer catch to turn into a 400.
//
// The temp-repo fixture is modelled on tests/viewer_api_layer1.test.ts's (via
// tests/layer1-view-test-helpers.ts) and deliberately COPIED rather than imported: those helpers
// build the pinned-instant Layer 1 ruler fixture that three files depend on, and this test needs
// a plain repo with a dirty working tree instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleLayer1FileRequest } from "../src/viewer_api_layer1_file.ts";

const COMMITTED_TEXT = "committed line\n";
const WORKING_TREE_TEXT = "committed line\nedited since the commit\n";
const FIXTURE_FILE = "notes.txt";

// Run a git command in `repoDir` with a fixed identity, so the fixture never depends on the
// machine's git config.
function runGit(repoDir: string, command: string): string {
    return execSync(`git -c user.name=t -c user.email=t@t ${command}`, { cwd: repoDir, stdio: "pipe" }).toString();
}

// One repo holding one committed file that has since been edited on disk — the exact state the
// drawer distinguishes between.
function makeDirtyFixtureRepo(): { repoDir: string; hash: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-file-repo-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, FIXTURE_FILE), COMMITTED_TEXT);
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m first");
    const hash = runGit(repoDir, "rev-parse HEAD").trim();
    writeFileSync(join(repoDir, FIXTURE_FILE), WORKING_TREE_TEXT);
    return { repoDir, hash };
}

// The two fields sendJson writes, captured without a socket.
type RecordedResponse = { status: number; body: string };

// Drive the route the way the server does — a query string in, one JSON response out.
function requestLayer1File(parameters: Record<string, string>): RecordedResponse {
    const recorded: RecordedResponse = { status: 0, body: "" };
    const response = {
        writeHead: (status: number) => { recorded.status = status; },
        end: (body: string) => { recorded.body = body; },
    } as unknown as ServerResponse;
    handleLayer1FileRequest(response, new URLSearchParams(parameters));
    return recorded;
}

function readContentField(recorded: RecordedResponse): string {
    return (JSON.parse(recorded.body) as { content: string }).content;
}

const { repoDir, hash } = makeDirtyFixtureRepo();

test("test_layer1_file_endpoint_reads_the_committed_bytes_for_a_commit_node", () => {
    // Scenario: a commit node is clicked, so the drawer must show the file AS COMMITTED.
    // Steps:
    // the hash form answers 200 with the committed text...
    const recorded = requestLayer1File({ repo: repoDir, path: FIXTURE_FILE, hash });
    assert.equal(recorded.status, 200);
    assert.equal(readContentField(recorded), COMMITTED_TEXT);
    // ...and NOT the working-tree edit, which the same path holds on disk right now.
    assert.ok(!readContentField(recorded).includes("edited since"), recorded.body);
});

test("test_layer1_file_endpoint_reads_the_working_tree_bytes_for_the_on_disk_node", () => {
    // Scenario: the on-disk node is clicked, so the drawer must show what is on disk NOW —
    // the dir form takes no hash and reads straight through git.
    const recorded = requestLayer1File({ dir: repoDir, path: FIXTURE_FILE });
    assert.equal(recorded.status, 200);
    assert.equal(readContentField(recorded), WORKING_TREE_TEXT);
});

test("test_layer1_file_endpoint_refuses_a_path_that_escapes_the_folder", () => {
    // Scenario: `path` arrives from a URL, so traversal is a trust boundary, not a typo.
    // a ../ path is refused before any read, naming the offending path.
    assert.throws(
        () => requestLayer1File({ dir: repoDir, path: "../../etc/passwd" }),
        /escapes the folder/,
    );
    // a bare ../ that lands next to the folder is refused too — the sibling case a prefix
    // comparison without a separator would let through.
    assert.throws(
        () => requestLayer1File({ dir: repoDir, path: `../${join("..", "etc", "hosts")}` }),
        /escapes the folder/,
    );
    // and a hash that is not hex never reaches the git argument.
    assert.throws(
        () => requestLayer1File({ repo: repoDir, path: FIXTURE_FILE, hash: "HEAD; rm -rf /" }),
        /not a commit hash/,
    );
});
