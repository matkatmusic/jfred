import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROOF_TIMEOUT_MS } from "../tests/reconstruction_script_sandbox_proof_helpers.ts";

const BUILD_TIMEOUT_MS = 600000;
const IMAGE_TAG = "engine-v3:1";
const CONTAINER = `engine-v3-safety-${randomUUID()}`;
const STATE_FOLDER = "/Users/replaytest/state";
const INPUT_FILE = "/input/note.txt";
const PERMISSION_DENIED = /Permission denied/;
const LIST_INPUT_TREE = "find /input -exec stat -c '%n %a %U %s' {} + | sort; find /input -type f -exec sha256sum {} + | sort";

function runDocker(args: string[]): string {
    return execFileSync("docker", args, { encoding: "utf8" });
}

function runAsReplay(command: string) {
    return spawnSync("docker", ["exec", "-u", "replay", CONTAINER, "sh", "-c", command], { encoding: "utf8" });
}

function copyFakeInputFolder(): void {
    const hostFolder = mkdtempSync(join(tmpdir(), "engine-v3-safety-"));
    const repoFolder = join(hostFolder, "repo");
    execFileSync("git", ["init", "-q", repoFolder]);
    writeFileSync(join(repoFolder, "a.txt"), "a\n");
    execFileSync("git", ["-C", repoFolder, "add", "a.txt"]);
    execFileSync("git", ["-C", repoFolder, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"]);
    writeFileSync(join(hostFolder, "note.txt"), "input note\n");
    runDocker(["exec", CONTAINER, "mkdir", "-p", "/input"]);
    runDocker(["cp", join(repoFolder, ".git"), `${CONTAINER}:/input/repo.git`]);
    runDocker(["cp", join(hostFolder, "note.txt"), `${CONTAINER}:${INPUT_FILE}`]);
}

function isAllowedWritablePath(path: string): boolean {
    for (const root of [STATE_FOLDER, "/tmp", "/private/tmp"]) {
        if (path === root) {
            return true;
        }
        if (path.startsWith(`${root}/`)) {
            return true;
        }
    }
    return false;
}

before(() => {
    runDocker(["build", "-t", IMAGE_TAG, import.meta.dirname]);
    runDocker(["run", "-d", "--network", "none", "--name", CONTAINER, IMAGE_TAG, "sleep", "infinity"]);
    runDocker(["exec", CONTAINER, "mkdir", "-p", STATE_FOLDER]);
    runDocker(["exec", CONTAINER, "chown", "replay", STATE_FOLDER]);
    copyFakeInputFolder();
}, { timeout: BUILD_TIMEOUT_MS });

after(() => {
    spawnSync("docker", ["rm", "-f", CONTAINER]);
});

test("test_replay_user_can_write_in_the_state_folder", { timeout: PROOF_TIMEOUT_MS }, () => {
    const run = runAsReplay(`echo x > ${STATE_FOLDER}/new.txt`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(runAsReplay(`cat ${STATE_FOLDER}/new.txt`).stdout, "x\n");
});

test("test_replay_user_can_write_in_tmp", { timeout: PROOF_TIMEOUT_MS }, () => {
    const run = runAsReplay("echo x > /tmp/new.txt");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(runAsReplay("cat /tmp/new.txt").stdout, "x\n");
});

test("test_replay_user_can_write_in_private_tmp_and_read_it_from_tmp", { timeout: PROOF_TIMEOUT_MS }, () => {
    const name = `private-${randomUUID()}.txt`;
    const run = runAsReplay(`echo x > /private/tmp/${name}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(runAsReplay(`cat /tmp/${name}`).stdout, "x\n");
});

test("test_container_tmp_is_not_the_mac_tmp", { timeout: PROOF_TIMEOUT_MS }, () => {
    const tmpName = `tmp-${randomUUID()}.txt`;
    const privateTmpName = `private-${randomUUID()}.txt`;
    const run = runAsReplay(`echo x > /tmp/${tmpName} && echo x > /private/tmp/${privateTmpName}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(`/tmp/${tmpName}`), false);
    assert.equal(existsSync(`/private/tmp/${privateTmpName}`), false);
});

test("test_replay_user_cannot_write_a_file_under_input", { timeout: PROOF_TIMEOUT_MS }, () => {
    const run = runAsReplay("echo x > /input/new.txt");
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, PERMISSION_DENIED);
    assert.notEqual(runAsReplay("test -e /input/new.txt").status, 0);
});

test("test_replay_user_cannot_delete_a_file_under_input", { timeout: PROOF_TIMEOUT_MS }, () => {
    const hashBefore = runAsReplay(`sha256sum ${INPUT_FILE}`).stdout;
    const run = runAsReplay(`rm ${INPUT_FILE}`);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, PERMISSION_DENIED);
    assert.equal(runAsReplay(`sha256sum ${INPUT_FILE}`).stdout, hashBefore);
});

test("test_input_tree_is_unchanged_after_a_script_tries_to_wipe_it", { timeout: PROOF_TIMEOUT_MS }, () => {
    const treeBefore = runAsReplay(LIST_INPUT_TREE).stdout;
    const run = runAsReplay("rm -rf /input/* ; echo x > /input/repo.git/HEAD");
    assert.match(run.stderr, PERMISSION_DENIED);
    assert.equal(runAsReplay(LIST_INPUT_TREE).stdout, treeBefore);
});

test("test_no_folder_outside_state_and_tmp_is_writable_by_the_replay_user", { timeout: PROOF_TIMEOUT_MS }, () => {
    const run = runAsReplay("find / -xdev -writable -not -path '/proc/*' 2>/dev/null");
    const writablePaths = run.stdout.split("\n");
    assert.ok(writablePaths.includes(STATE_FOLDER), run.stderr);
    const unexpectedPaths: string[] = [];
    for (const path of writablePaths) {
        const isAllowed = isAllowedWritablePath(path);
        if (path !== "") {
            if (!isAllowed) {
                unexpectedPaths.push(path);
            }
        }
    }
    assert.deepEqual(unexpectedPaths, [], `writable outside state and /tmp: ${unexpectedPaths.join(", ")}`);
});
