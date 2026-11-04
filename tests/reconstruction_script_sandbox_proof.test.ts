import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { chooseSandboxMount } from "../src/reconstruction_script_sandbox_docker.ts";
import { createCanary, NO_SUCH_FILE, PROOF_TIMEOUT_MS, runProofScript } from "./reconstruction_script_sandbox_proof_helpers.ts";

test("test_proof_0_docker_can_see_the_temp_folder", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const run = await runProofScript(
        'import os\nprint("MARKER=" + open("marker.txt").read().strip())\nprint("LS=" + ",".join(sorted(os.listdir("."))))\n',
        undefined,
        [["marker.txt", "seen-from-host"]],
    );
    assert.equal(run.status, 0, run.stderr);
    assert.ok(
        run.stdout.includes("MARKER=seen-from-host"),
        "Docker cannot see the temp folder; share it in Docker settings",
    );
    assert.ok(run.stdout.includes("LS=__script__.py,marker.txt"), run.stdout);
});

test("test_proof_1_control_write_inside_the_mount_works", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const run = await runProofScript('open("ok.txt", "w").write("inside\\n")\nprint("WROTE")\n');
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes("WROTE"));
    assert.equal(readFileSync(join(run.mountDir, "ok.txt"), "utf8"), "inside\n");
});

test("test_proof_1b_control_a_recorded_cwd_is_the_mount_and_the_working_folder", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const run = await runProofScript(
        'import os\nprint("CWD=" + os.getcwd())\nopen("ok.txt", "w").write("x")\n',
        chooseSandboxMount(new Path("/Users/someone/proj")),
    );
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes("CWD=/Users/someone/proj"), run.stdout);
    assert.ok(existsSync(join(run.mountDir, "ok.txt")));
});

test("test_proof_1c_control_a_script_can_change_and_delete_copied_files", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const run = await runProofScript(
        'import os\nopen("keep.txt", "w").write("changed\\n")\nos.remove("drop.txt")\nos.makedirs("sub/dir")\nopen("sub/dir/new.txt", "w").write("created\\n")\n',
        undefined,
        [["keep.txt", "original\n"], ["drop.txt", "to-delete\n"]],
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(run.mountDir, "keep.txt"), "utf8"), "changed\n");
    assert.ok(!existsSync(join(run.mountDir, "drop.txt")));
    assert.equal(readFileSync(join(run.mountDir, "sub", "dir", "new.txt"), "utf8"), "created\n");
});

test("test_proof_2_write_outside_the_mount_fails_and_the_canary_is_unchanged", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const canary = createCanary();
    const run = await runProofScript(`open(${JSON.stringify(canary.path)}, "w").write("overwritten")\nprint("WRITE-SUCCEEDED")\n`);
    assert.notEqual(run.status, 0);
    assert.ok(!run.stdout.includes("WRITE-SUCCEEDED"));
    assert.match(run.stderr, NO_SUCH_FILE);
    assert.ok(run.stderr.includes(canary.path), run.stderr);
    assert.equal(canary.readHash(), canary.hashBefore);
});

test("test_proof_3_delete_outside_the_mount_fails_and_the_canary_is_unchanged", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const canary = createCanary();
    const run = await runProofScript(`import os\nos.remove(${JSON.stringify(canary.path)})\nprint("DELETE-SUCCEEDED")\n`);
    assert.notEqual(run.status, 0);
    assert.ok(!run.stdout.includes("DELETE-SUCCEEDED"));
    assert.match(run.stderr, NO_SUCH_FILE);
    assert.ok(run.stderr.includes(canary.path), run.stderr);
    assert.ok(existsSync(canary.path));
    assert.equal(canary.readHash(), canary.hashBefore);
});

test("test_proof_4_read_outside_the_mount_fails", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const canary = createCanary();
    const run = await runProofScript(`print("READ=" + open(${JSON.stringify(canary.path)}).read())\n`);
    assert.notEqual(run.status, 0);
    assert.ok(!run.stdout.includes("READ="));
    assert.match(run.stderr, NO_SUCH_FILE);
    assert.ok(run.stderr.includes(canary.path), run.stderr);
    assert.equal(canary.readHash(), canary.hashBefore);
});
