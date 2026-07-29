// Task 257 step 7: GET /api/layer1-file serves one file at one moment for the drawer.
//
// No server is spawned: the route is driven through a recording ServerResponse stand-in; refusals surface as throws.
//
// The temp-repo fixture is copied from tests/layer1-view-test-helpers.ts's pattern, not imported: this needs a dirty tree.

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
const IMAGE_FILE = "logo.png";
// Task 299: PNG-magic bytes plus a NUL — bytes a UTF-8 decode would destroy.
const COMMITTED_IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01]);
const WORKING_TREE_IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x11, 0x22, 0x33]);

// Fixed git identity so the fixture never depends on the machine's config.
function runGit(repoDir: string, command: string): string {
    return execSync(`git -c user.name=t -c user.email=t@t ${command}`, { cwd: repoDir, stdio: "pipe" }).toString();
}

// One repo whose committed files have since been edited on disk — the state the drawer distinguishes.
function makeDirtyFixtureRepo(): { repoDir: string; hash: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "layer1-file-repo-"));
    runGit(repoDir, "init -q");
    writeFileSync(join(repoDir, FIXTURE_FILE), COMMITTED_TEXT);
    writeFileSync(join(repoDir, IMAGE_FILE), COMMITTED_IMAGE_BYTES);
    runGit(repoDir, "add -A");
    runGit(repoDir, "commit -q -m first");
    const hash = runGit(repoDir, "rev-parse HEAD").trim();
    writeFileSync(join(repoDir, FIXTURE_FILE), WORKING_TREE_TEXT);
    writeFileSync(join(repoDir, IMAGE_FILE), WORKING_TREE_IMAGE_BYTES);
    return { repoDir, hash };
}

// The fields the route writes, captured without a socket; `body` stays a Buffer for the binary form.
type RecordedResponse = { status: number; body: string | Buffer; contentType: string };

// Drive the route the way the server does — a query string in, one response out.
function requestLayer1File(parameters: Record<string, string>): RecordedResponse {
    const recorded: RecordedResponse = { status: 0, body: "", contentType: "" };
    const response = {
        writeHead: (status: number, headers: Record<string, string>) => {
            recorded.status = status;
            recorded.contentType = headers["Content-Type"] ?? "";
        },
        end: (body: string | Buffer) => { recorded.body = body; },
    } as unknown as ServerResponse;
    handleLayer1FileRequest(response, new URLSearchParams(parameters));
    return recorded;
}

function readContentField(recorded: RecordedResponse): string {
    return (JSON.parse(recorded.body.toString()) as { content: string }).content;
}

const { repoDir, hash } = makeDirtyFixtureRepo();

test("test_layer1_file_endpoint_reads_the_committed_bytes_for_a_commit_node", () => {
    // The hash form answers the COMMITTED text, never the working-tree edit.
    const recorded = requestLayer1File({ repo: repoDir, path: FIXTURE_FILE, hash });
    assert.equal(recorded.status, 200);
    assert.equal(readContentField(recorded), COMMITTED_TEXT);
    assert.ok(!readContentField(recorded).includes("edited since"), recorded.body.toString());
});

test("test_layer1_file_endpoint_reads_the_working_tree_bytes_for_the_on_disk_node", () => {
    // The dir form takes no hash and answers what is on disk NOW.
    const recorded = requestLayer1File({ dir: repoDir, path: FIXTURE_FILE });
    assert.equal(recorded.status, 200);
    assert.equal(readContentField(recorded), WORKING_TREE_TEXT);
});

test("test_layer1_file_endpoint_serves_raw_image_bytes_for_both_forms_when_binary_is_asked", () => {
    // Task 299: binary=1 answers the exact bytes with an image content-type, per form.
    const disk = requestLayer1File({ dir: repoDir, path: IMAGE_FILE, binary: "1" });
    assert.equal(disk.status, 200);
    assert.equal(disk.contentType, "image/png");
    assert.deepEqual(disk.body, WORKING_TREE_IMAGE_BYTES);
    const committed = requestLayer1File({ repo: repoDir, path: IMAGE_FILE, hash, binary: "1" });
    assert.deepEqual(committed.body, COMMITTED_IMAGE_BYTES);
});

test("test_layer1_file_endpoint_refuses_a_path_that_escapes_the_folder", () => {
    // `path` arrives from a URL, so traversal is a trust boundary; refused before any read.
    assert.throws(
        () => requestLayer1File({ dir: repoDir, path: "../../etc/passwd" }),
        /escapes the folder/,
    );
    // The sibling case a prefix comparison without a separator would let through.
    assert.throws(
        () => requestLayer1File({ dir: repoDir, path: `../${join("..", "etc", "hosts")}` }),
        /escapes the folder/,
    );
    // A non-hex hash never reaches the git argument.
    assert.throws(
        () => requestLayer1File({ repo: repoDir, path: FIXTURE_FILE, hash: "HEAD; rm -rf /" }),
        /not a commit hash/,
    );
});
