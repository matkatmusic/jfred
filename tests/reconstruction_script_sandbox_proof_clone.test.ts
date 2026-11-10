import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Path, Uuid } from "../src/structures/domain.ts";
import { chooseSandboxMount, type DockerLaunch } from "../src/reconstruction_script_sandbox_docker.ts";
import { copyProjectAtCommit } from "../src/reconstruction_script_sandbox_project.ts";
import { NO_SUCH_FILE, PROOF_TIMEOUT_MS, runProofScript } from "./reconstruction_script_sandbox_proof_helpers.ts";

const BOX_SCRIPT_FILE = new Path("/reveng-script/script.py");
const TRACKED_FILE = "notes.txt";

function hashFile(file: string): string {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// The script lives in its own host folder and is mounted read-only, as in a real run.
function createHostScript(script: string): { hostFile: string; hashBefore: string } {
    const hostFile = join(mkdtempSync(join(tmpdir(), "reveng-proof-script-")), "script.py");
    writeFileSync(hostFile, script);
    return { hostFile, hashBefore: hashFile(hostFile) };
}

function buildReadOnlyScriptLaunch(hostFile: string, mount: Path): DockerLaunch {
    return { workdir: mount, scriptArgument: BOX_SCRIPT_FILE.toString(), readOnlyScript: { hostFile: new Path(hostFile), boxFile: BOX_SCRIPT_FILE } };
}

function runHostGit(repo: string, args: string[]): string {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
}

// A temp host repo with one commit, packed so the clone has pack files to attack.
function createHostRepo(): { repo: string; commit: string } {
    const repo = mkdtempSync(join(tmpdir(), "reveng-proof-hostrepo-"));
    runHostGit(repo, ["init", "--quiet"]);
    writeFileSync(join(repo, TRACKED_FILE), "tracked content\n");
    runHostGit(repo, ["add", TRACKED_FILE]);
    runHostGit(repo, ["-c", "user.name=proof", "-c", "user.email=proof@reveng.invalid", "commit", "--quiet", "-m", "first"]);
    runHostGit(repo, ["gc", "--quiet"]);
    return { repo, commit: runHostGit(repo, ["rev-parse", "HEAD"]) };
}

// One line per entry under the folder, files by content hash, so any change shows.
function describeTree(folder: string): string[] {
    const entries = readdirSync(folder, { recursive: true, encoding: "utf8" }).sort();
    return entries.map((entry) => {
        const stat = lstatSync(join(folder, entry));
        if (stat.isFile()) {
            return `${entry} ${hashFile(join(folder, entry))}`;
        }
        return `${entry} (not a file)`;
    });
}

test("test_proof_9_the_extra_script_mount_is_read_only", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const script = 'print("TRYING")\nopen(__file__, "a")\nprint("WROTE-TO-SCRIPT")\n';
    const { hostFile, hashBefore } = createHostScript(script);
    const mount = chooseSandboxMount(undefined);
    const run = await runProofScript(script, mount, [], buildReadOnlyScriptLaunch(hostFile, mount));
    assert.ok(run.stdout.includes("TRYING"), `the script did not run: ${run.stderr}`);
    assert.ok(!run.stdout.includes("WROTE-TO-SCRIPT"));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /\[Errno 30\] Read-only file system/);
    assert.equal(hashFile(hostFile), hashBefore);
});

test("test_proof_10_the_clone_cannot_reach_the_host_repo", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const { repo, commit } = createHostRepo();
    const headBefore = runHostGit(repo, ["rev-parse", "HEAD"]);
    const treeBefore = describeTree(repo);
    const script = [
        "import os",
        "packs = [os.path.join(root, name) for root, _, names in os.walk('.git/objects/pack') for name in names]",
        "for pack in packs:",
        "    os.chmod(pack, 0o644)",
        "    open(pack, 'wb').write(b'overwritten')",
        "print('PACKS=' + str(len(packs)))",
        "for root, _, names in os.walk('.git'):",
        "    for name in names:",
        "        os.remove(os.path.join(root, name))",
        "print('GIT-FILES-LEFT=' + str(sum(len(names) for _, _, names in os.walk('.git'))))",
        `open(${JSON.stringify(join(repo, ".git", "HEAD"))})`,
        "print('HOST-REACHED')",
        "",
    ].join("\n");
    const { hostFile } = createHostScript(script);
    const mount = chooseSandboxMount(new Path("/proof/clone"));
    const prepare = (mountDir: Path): void => copyProjectAtCommit(new Path(repo), new Uuid(commit), mountDir);
    const run = await runProofScript(script, mount, [], buildReadOnlyScriptLaunch(hostFile, mount), prepare);
    assert.match(run.stdout, /PACKS=[1-9]/, `the clone had no pack to attack: ${run.stderr}`);
    assert.ok(run.stdout.includes("GIT-FILES-LEFT=0"), run.stdout);
    assert.ok(!run.stdout.includes("HOST-REACHED"));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, NO_SUCH_FILE);
    assert.ok(run.stderr.includes(repo), run.stderr);
    assert.deepEqual(describeTree(repo), treeBefore);
    assert.equal(runHostGit(repo, ["rev-parse", "HEAD"]), headBefore);
    runHostGit(repo, ["fsck", "--strict"]);
});

test("test_proof_11_git_works_in_the_mounted_clone", { timeout: PROOF_TIMEOUT_MS }, async () => {
    const { repo, commit } = createHostRepo();
    const script = [
        "import subprocess",
        `commands = [["git", "-C", ".", "rev-parse", "HEAD"], ["git", "show", "HEAD:${TRACKED_FILE}"], ["git", "status", "--porcelain"]]`,
        "for command in commands:",
        "    result = subprocess.run(command, capture_output=True, text=True)",
        "    print('EXIT=' + str(result.returncode) + ' ' + ' '.join(command))",
        "    print(result.stdout.strip())",
        "    print(result.stderr.strip())",
        "",
    ].join("\n");
    const { hostFile } = createHostScript(script);
    const mount = chooseSandboxMount(new Path("/proof/clone"));
    const prepare = (mountDir: Path): void => copyProjectAtCommit(new Path(repo), new Uuid(commit), mountDir);
    const run = await runProofScript(script, mount, [], buildReadOnlyScriptLaunch(hostFile, mount), prepare);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.split("\n").filter((line) => line.startsWith("EXIT=0 ")).length, 3, run.stdout);
    assert.ok(run.stdout.includes(commit), run.stdout);
    assert.ok(run.stdout.includes("tracked content"), run.stdout);
});
