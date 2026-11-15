import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import {
    DockerReadiness,
    SCRIPT_REPLAY_USER,
    ScriptInterpreter,
    ScriptReplayChangeKind,
    ScriptReplayInputKind,
    buildScriptReplayDockerArguments,
    checkDockerReadiness,
    executeScriptReplayInContainer,
    removeScriptReplayContainers,
    type ScriptReplayChangedFile,
    type ScriptReplayRequest,
    type ScriptReplayResponse,
} from "./engineV3_script_replay_container.ts";

const TEST_CONTAINER_PREFIX = `jfred-replay-test-${randomUUID()}-`;
const STORE_REPO_RELATIVE_PATH = "files/data.git";
const STORE_BLOB_NAME = "data.txt";
const STORE_BLOB_TEXT = "text from the store\n";
const FAKE_PROJECT_ROOT = `/jfred-test-project/${randomUUID()}`;
const CANARY_FILE_TEXTS = ["canary one\n", "canary two\n", "canary three\n"];
const DOCKER_TEST_TIMEOUT_MS = 90000;

let fakeStoreFolder = "";
let canaryFolder = "";
let storeCommitHash = "";
let hostSnapshotBeforeTest = "";

function runGit(gitDirectory: string, gitArguments: string[], input?: string): string {
    const environment = {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.invalid", GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.invalid", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
    };
    return execFileSync("git", [`--git-dir=${gitDirectory}`, ...gitArguments], { encoding: "utf8", input, env: environment }).trim();
}

function makeFakeStore(): string {
    const storeFolder = mkdtempSync(join(tmpdir(), "jfred-store-"));
    const repoFolder = join(storeFolder, STORE_REPO_RELATIVE_PATH);
    mkdirSync(repoFolder, { recursive: true });
    execFileSync("git", ["init", "--bare", "-q", repoFolder]);
    const blobHash = runGit(repoFolder, ["hash-object", "-w", "--stdin"], STORE_BLOB_TEXT);
    const treeHash = runGit(repoFolder, ["mktree"], `100644 blob ${blobHash}\t${STORE_BLOB_NAME}\n`);
    storeCommitHash = runGit(repoFolder, ["commit-tree", treeHash, "-m", "fake commit"]);
    return storeFolder;
}

function makeCanaryFolder(): string {
    const folder = join(tmpdir(), `jfred-canary-${randomUUID()}`);
    mkdirSync(folder);
    for (const [index, text] of CANARY_FILE_TEXTS.entries()) {
        writeFileSync(join(folder, `canary-${index}.txt`), text);
    }
    return folder;
}

function describeFolderTree(folder: string): string[] {
    const lines: string[] = [];
    for (const entryName of readdirSync(folder).sort()) {
        const entryPath = join(folder, entryName);
        const entryStat = lstatSync(entryPath);
        if (entryStat.isDirectory()) {
            lines.push(`dir ${entryPath} ${entryStat.mtimeMs}`);
            lines.push(...describeFolderTree(entryPath));
        } else {
            const fileHash = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
            lines.push(`file ${entryPath} ${entryStat.mtimeMs} ${fileHash}`);
        }
    }
    return lines;
}

function takeHostSnapshot(): string {
    const canaryLines = describeFolderTree(canaryFolder);
    const storeLines = describeFolderTree(fakeStoreFolder);
    const tmpFolderListing = readdirSync(tmpdir()).filter((name) => name.startsWith("jfred-canary-")).sort();
    return JSON.stringify({ canaryLines, storeLines, tmpFolderListing });
}

function assertHostUnchanged(snapshotBefore: string): void {
    assert.equal(takeHostSnapshot(), snapshotBefore);
}

before(() => {
    const readiness = checkDockerReadiness();
    if (readiness !== DockerReadiness.Ready) {
        throw new Error(`Docker is not ready (${readiness}). Run: npm run sandbox:build`);
    }
    fakeStoreFolder = makeFakeStore();
    canaryFolder = makeCanaryFolder();
});

after(() => {
    removeScriptReplayContainers(TEST_CONTAINER_PREFIX);
    rmSync(fakeStoreFolder, { recursive: true, force: true });
    rmSync(canaryFolder, { recursive: true, force: true });
});

beforeEach(() => {
    hostSnapshotBeforeTest = takeHostSnapshot();
});

afterEach(() => {
    assertHostUnchanged(hostSnapshotBeforeTest);
});

function listArgumentsBeforeImage(dockerArguments: string[]): string[] {
    const imageIndex = dockerArguments.indexOf("reveng-sandbox:1");
    return dockerArguments.slice(0, imageIndex);
}

test("test_docker_arguments_mount_only_the_store_read_only", () => {
    // Build the docker argument list for the fake store.
    const containerName = `${TEST_CONTAINER_PREFIX}${randomUUID()}`;
    const dockerArguments = buildScriptReplayDockerArguments(containerName, new Path(fakeStoreFolder), FAKE_PROJECT_ROOT);
    const printedArguments = [...dockerArguments.slice(0, -1), `<wrapper source: ${dockerArguments.at(-1)?.length} characters>`];
    console.log(JSON.stringify(printedArguments));
    const optionArguments = listArgumentsBeforeImage(dockerArguments);
    // The list holds exactly one -v.
    assert.equal(optionArguments.filter((argument) => argument === "-v").length, 1);
    // Its value is <store>:/store:ro, and the store is the test's fake store.
    assert.equal(optionArguments[optionArguments.indexOf("-v") + 1], `${fakeStoreFolder}:/store:ro`);
    // No --mount, and no other argument names the store folder.
    assert.equal(optionArguments.some((argument) => argument.startsWith("--mount")), false);
    assert.equal(optionArguments.filter((argument) => argument.includes(fakeStoreFolder)).length, 1);
});

test("test_docker_arguments_have_no_privilege_flags", () => {
    // Build the docker argument list.
    const containerName = `${TEST_CONTAINER_PREFIX}${randomUUID()}`;
    const dockerArguments = buildScriptReplayDockerArguments(containerName, new Path(fakeStoreFolder), FAKE_PROJECT_ROOT);
    const optionArguments = listArgumentsBeforeImage(dockerArguments);
    // The list equals the contract list, in order.
    const expectedOptionArguments = [
        "run", "--rm", "-i", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "1g",
        "--user", SCRIPT_REPLAY_USER, "--name", containerName,
        "-e", "HOME=/tmp/home", "-e", "TMPDIR=/tmp",
        "--tmpfs", "/tmp:rw,nosuid,size=128m,uid=1000,gid=1000,mode=1777",
        "--tmpfs", `${FAKE_PROJECT_ROOT}:rw,exec,nosuid,size=256m,uid=1000,gid=1000,mode=755`,
        "-v", `${fakeStoreFolder}:/store:ro`,
    ];
    assert.deepEqual(optionArguments, expectedOptionArguments);
    // None of the privilege flags appear.
    for (const forbiddenFlag of ["--privileged", "--pid", "--ipc", "--userns", "--device", "--volumes-from", "--cap-add"]) {
        assert.equal(optionArguments.some((argument) => argument === forbiddenFlag || argument.startsWith(`${forbiddenFlag}=`)), false, forbiddenFlag);
    }
    assert.equal(optionArguments.some((argument) => argument.includes("docker.sock")), false);
    // The image runs the wrapper with python3 -I -c.
    assert.deepEqual(dockerArguments.slice(optionArguments.length, optionArguments.length + 4), ["reveng-sandbox:1", "python3", "-I", "-c"]);
});

function makeRequest(interpreter: ScriptInterpreter, source: string, overrides: Partial<ScriptReplayRequest> = {}): ScriptReplayRequest {
    return { projectRoot: FAKE_PROJECT_ROOT, cwd: FAKE_PROJECT_ROOT, interpreter, source, inputs: [], timeoutSeconds: 30, ...overrides };
}

function runScriptInContainer(request: ScriptReplayRequest, signal: AbortSignal = new AbortController().signal): Promise<ScriptReplayResponse> {
    return executeScriptReplayInContainer(new Path(fakeStoreFolder), request, signal, TEST_CONTAINER_PREFIX);
}

function listTestContainerNames(): string[] {
    const result = spawnSync("docker", ["ps", "-a", "--filter", `name=${TEST_CONTAINER_PREFIX}`, "--format", "{{.Names}}"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split("\n").filter((line) => line !== "");
}

async function waitForTestContainerCount(isWanted: (count: number) => boolean): Promise<string[]> {
    const deadline = Date.now() + 30000;
    let names = listTestContainerNames();
    while (!isWanted(names.length)) {
        assert.ok(Date.now() < deadline, `container count never reached the wanted state: ${names.join(", ")}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
        names = listTestContainerNames();
    }
    return names;
}

function findChangedFile(response: ScriptReplayResponse, relativePath: string): ScriptReplayChangedFile {
    const changedFile = response.changedFiles.find((candidate) => candidate.relativePath === relativePath);
    assert.ok(changedFile, `no changed file ${relativePath} in ${JSON.stringify(response.changedFiles)}`);
    return changedFile;
}

const PYTHON_ATTEMPT_HELPER = `
import json, os, shutil
results = {}
def attempt(label, action):
    try:
        action()
        results[label] = "ok"
    except OSError:
        results[label] = "blocked"
`;

test("test_script_cannot_write_into_the_store_folder", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // The store hash was taken in beforeEach.
    // Run a Python script that tries to write a file, remove a repo file and remove the whole store folder.
    const source = `${PYTHON_ATTEMPT_HELPER}
attempt("write", lambda: open("/store/x", "w").write("x"))
attempt("remove", lambda: os.remove("/store/${STORE_REPO_RELATIVE_PATH}/HEAD"))
attempt("rmtree", lambda: shutil.rmtree("/store"))
print(json.dumps(results))
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source));
    // Every attempt reports blocked.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.deepEqual(JSON.parse(response.stdout), { write: "blocked", remove: "blocked", rmtree: "blocked" });
    // The store hash is equal afterward.
    assertHostUnchanged(hostSnapshotBeforeTest);
});

test("test_script_cannot_change_the_host_canary_folder", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run a Python script that writes and deletes at the absolute host path of the canary folder.
    // It then walks / (not /proc, /sys, /dev, /tmp: kernel files and the wrapper's own output files) and tries to delete and overwrite every file.
    const source = `
import json, os
canary = ${JSON.stringify(canaryFolder)}
successes = []
def attempt(path, action):
    try:
        action()
        successes.append(path)
    except OSError:
        pass
attempt(canary + "/new.txt", lambda: open(canary + "/new.txt", "w").write("x"))
attempt(canary, lambda: os.makedirs(canary))
for index in range(3):
    attempt(canary + "/canary-" + str(index) + ".txt", lambda: open(canary + "/canary-" + str(index) + ".txt", "w").write("x"))
    attempt(canary + "/canary-" + str(index) + ".txt", lambda: os.remove(canary + "/canary-" + str(index) + ".txt"))
skipped = ("/proc", "/sys", "/dev", "/tmp")
for folder, folder_names, file_names in os.walk("/"):
    folder_names[:] = [name for name in folder_names if os.path.join(folder, name) not in skipped]
    for file_name in file_names:
        path = os.path.join(folder, file_name)
        attempt(path, lambda: open(path, "wb").write(b"x"))
        attempt(path, lambda: os.remove(path))
print(json.dumps(successes))
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source));
    assert.equal(response.exitCode, 0, response.stderr);
    // Nothing outside the project root succeeded.
    const successes: string[] = JSON.parse(response.stdout);
    const successesOutsideProjectRoot = successes.filter((path) => !path.startsWith(`${FAKE_PROJECT_ROOT}/`));
    assert.deepEqual(successesOutsideProjectRoot, []);
    // All canary hashes are equal afterward.
    assertHostUnchanged(hostSnapshotBeforeTest);
});

test("test_script_has_no_network", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run a Python script that connects a socket to 1.1.1.1:53.
    const source = `
import socket
connection = socket.socket()
connection.settimeout(5)
try:
    connection.connect(("1.1.1.1", 53))
    print("connected")
except OSError:
    print("blocked")
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source));
    // The connect failed.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.equal(response.stdout.trim(), "blocked");
});

test("test_script_changes_inside_project_root_are_returned_not_applied_to_the_host", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Give the container three Text inputs: one to keep, one to change, one to delete.
    const textInput = (relativePath: string, text: string) => ({ relativePath, source: { kind: ScriptReplayInputKind.Text as const, text } });
    const inputs = [textInput("keep.txt", "keep\n"), textInput("edit.txt", "old\n"), textInput("gone.txt", "bye\n")];
    // Run a Python script that changes edit.txt, creates made.txt and blob.bin, and deletes gone.txt.
    const source = `
import os
root = ${JSON.stringify(FAKE_PROJECT_ROOT)}
open(root + "/edit.txt", "w").write("new\\n")
open(root + "/made.txt", "w").write("made\\n")
open(root + "/blob.bin", "wb").write(b"\\xff\\xfe")
os.remove(root + "/gone.txt")
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source, { inputs }));
    // The response lists changed, created and deleted files with their texts, and not the kept file.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.deepEqual(findChangedFile(response, "edit.txt"), { relativePath: "edit.txt", changeKind: ScriptReplayChangeKind.Changed, text: "new\n", isNotText: false });
    assert.deepEqual(findChangedFile(response, "made.txt"), { relativePath: "made.txt", changeKind: ScriptReplayChangeKind.Created, text: "made\n", isNotText: false });
    assert.deepEqual(findChangedFile(response, "gone.txt"), { relativePath: "gone.txt", changeKind: ScriptReplayChangeKind.Deleted, text: null, isNotText: false });
    assert.deepEqual(findChangedFile(response, "blob.bin"), { relativePath: "blob.bin", changeKind: ScriptReplayChangeKind.Created, text: null, isNotText: true });
    assert.equal(response.changedFiles.some((changedFile) => changedFile.relativePath === "keep.txt"), false);
    // The store hash is equal.
    assertHostUnchanged(hostSnapshotBeforeTest);
});

test("test_script_cannot_write_to_the_root_file_system", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run a Python script that tries to create a file in /usr, /etc and /root.
    const source = `${PYTHON_ATTEMPT_HELPER}
for folder in ["/usr", "/etc", "/root"]:
    attempt(folder, lambda: open(folder + "/jfred-test.txt", "w").write("x"))
print(json.dumps(results))
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source));
    // All three attempts are blocked.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.deepEqual(JSON.parse(response.stdout), { "/usr": "blocked", "/etc": "blocked", "/root": "blocked" });
});

test("test_script_cannot_write_to_a_world_writable_folder_of_the_image", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run a Python script that tries to create a file in /var/tmp, /var/lib and /run/lock.
    // /var/tmp and /run/lock are mode 1777 in the image, so only --read-only blocks them for user 1000.
    const source = `${PYTHON_ATTEMPT_HELPER}
for folder in ["/var/tmp", "/var/lib", "/run/lock"]:
    attempt(folder, lambda: open(folder + "/jfred-probe", "w").write("x"))
print(json.dumps(results))
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source));
    // All three attempts are blocked.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.deepEqual(JSON.parse(response.stdout), { "/var/tmp": "blocked", "/var/lib": "blocked", "/run/lock": "blocked" });
});

test("test_symlink_in_project_root_cannot_write_into_the_store", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run a Python script that links to a store file and a store folder, then writes and removes through the links.
    const source = `${PYTHON_ATTEMPT_HELPER}
root = ${JSON.stringify(FAKE_PROJECT_ROOT)}
os.symlink("/store/${STORE_REPO_RELATIVE_PATH}/HEAD", root + "/link_file")
os.symlink("/store/files", root + "/link_folder")
attempt("write_file", lambda: open(root + "/link_file", "w").write("x"))
attempt("write_new", lambda: open(root + "/link_folder/new.txt", "w").write("x"))
attempt("remove", lambda: os.remove(root + "/link_folder/data.git/HEAD"))
print(json.dumps(results))
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source));
    // Every write through a link is blocked.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.deepEqual(JSON.parse(response.stdout), { write_file: "blocked", write_new: "blocked", remove: "blocked" });
    // The store hash is equal.
    assertHostUnchanged(hostSnapshotBeforeTest);
});

test("test_timeout_stops_the_script_and_leaves_no_container", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run bash `sleep 600` with a 2 second limit.
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Bash, "sleep 600", { timeoutSeconds: 2 }));
    // The response says timedOut.
    assert.equal(response.timedOut, true);
    // No container with the test prefix is left.
    assert.deepEqual(await waitForTestContainerCount((count) => count === 0), []);
});

test("test_abort_signal_kills_the_container", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Start bash `sleep 600` with a long limit.
    const controller = new AbortController();
    const run = runScriptInContainer(makeRequest(ScriptInterpreter.Bash, "sleep 600", { timeoutSeconds: 600 }), controller.signal);
    // Wait until the container exists, then abort.
    await waitForTestContainerCount((count) => count === 1);
    controller.abort();
    // The run rejects, and no container is left.
    await assert.rejects(run, /aborted/);
    assert.deepEqual(await waitForTestContainerCount((count) => count === 0), []);
});

test("test_background_process_dies_with_the_container", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run bash that starts `sleep 1000 &` and then ends.
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Bash, "sleep 1000 &\necho started"));
    assert.equal(response.exitCode, 0, response.stderr);
    // No container with the test prefix is left.
    assert.deepEqual(await waitForTestContainerCount((count) => count === 0), []);
});

test("test_inputs_are_laid_out_at_the_recorded_project_root", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Give the container one Store input and one Text input.
    const inputs = [
        { relativePath: `sub/${STORE_BLOB_NAME}`, source: { kind: ScriptReplayInputKind.Store as const, repoRelativePath: STORE_REPO_RELATIVE_PATH, commitHash: storeCommitHash } },
        { relativePath: "notes/hello.txt", source: { kind: ScriptReplayInputKind.Text as const, text: "hello text\n" } },
    ];
    // Run a Python script that prints both files from the recorded project root.
    const source = `
root = ${JSON.stringify(FAKE_PROJECT_ROOT)}
print(open(root + "/sub/${STORE_BLOB_NAME}").read(), end="")
print(open(root + "/notes/hello.txt").read(), end="")
`;
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, source, { inputs }));
    // The output holds the store text and then the request text.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.equal(response.stdout, `${STORE_BLOB_TEXT}hello text\n`);
});

test("test_input_path_with_dot_dot_is_refused", async () => {
    // Make one request whose input path holds a .. segment, and one whose input path is absolute.
    const textInput = (relativePath: string) => ({ relativePath, source: { kind: ScriptReplayInputKind.Text as const, text: "x" } });
    const dotDotRequest = makeRequest(ScriptInterpreter.Bash, "true", { inputs: [textInput("../escape.txt")] });
    const absoluteRequest = makeRequest(ScriptInterpreter.Bash, "true", { inputs: [textInput("/etc/escape.txt")] });
    // Both are refused before docker starts.
    await assert.rejects(runScriptInContainer(dotDotRequest), /\.\. segment/);
    await assert.rejects(runScriptInContainer(absoluteRequest), /absolute/);
    assert.deepEqual(listTestContainerNames(), []);
});

test("test_bash_interpreter_runs_mv_and_perl_in_place_edit", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Give the container a.txt with the text "x".
    const inputs = [{ relativePath: "a.txt", source: { kind: ScriptReplayInputKind.Text as const, text: "x\n" } }];
    // Run bash: mv a.txt b.txt, then perl in-place edit of b.txt.
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Bash, "mv a.txt b.txt\nperl -pi -e 's/x/y/' b.txt", { inputs }));
    // a.txt is deleted, and b.txt is created with the new text.
    assert.equal(response.exitCode, 0, response.stderr);
    assert.deepEqual(findChangedFile(response, "a.txt"), { relativePath: "a.txt", changeKind: ScriptReplayChangeKind.Deleted, text: null, isNotText: false });
    assert.deepEqual(findChangedFile(response, "b.txt"), { relativePath: "b.txt", changeKind: ScriptReplayChangeKind.Created, text: "y\n", isNotText: false });
});

test("test_check_docker_readiness_returns_ready_when_docker_runs", () => {
    // Docker runs and the image exists, because the suite's before hook needs both.
    assert.equal(checkDockerReadiness(), DockerReadiness.Ready);
});

test("test_missing_command_is_named_in_missing_executable", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run bash `nosuchtool --x`.
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Bash, "nosuchtool --x"));
    // The exit code is 127, and the missing tool is named.
    assert.equal(response.exitCode, 127);
    assert.equal(response.missingExecutable, "nosuchtool");
});

test("test_missing_python_module_is_named_in_missing_executable", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run Python `import nosuchmodule`.
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, "import nosuchmodule"));
    // The missing module is named.
    assert.equal(response.missingExecutable, "nosuchmodule");
});

test("test_missing_data_file_is_not_named_in_missing_executable", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run Python `open("input.csv")` where the file does not exist.
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, 'open("input.csv")'));
    // The script fails with FileNotFoundError, and no missing executable is named.
    assert.match(response.stderr, /FileNotFoundError/);
    assert.equal(response.missingExecutable, null);
});

test("test_missing_program_started_from_python_is_named_in_missing_executable", { timeout: DOCKER_TEST_TIMEOUT_MS }, async () => {
    // Run Python `subprocess.run(["nosuchtool"])`.
    const response = await runScriptInContainer(makeRequest(ScriptInterpreter.Python, 'import subprocess\nsubprocess.run(["nosuchtool"])'));
    // The missing program is named.
    assert.equal(response.missingExecutable, "nosuchtool");
});
