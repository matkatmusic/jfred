import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JFRED_FOLDER = join(import.meta.dirname, "..");
const CLI_SCRIPT = "engineV3/engineV3_inverse_repos_for_project.ts";
const PERMISSION_DENIED_TEXT = "Access to this API has been restricted";

type Fixture = { rootFolder: string; projectFolder: string; jsonlsFolder: string; snapshotFolder: string; storeFolder: string };

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function runGit(folder: string, args: string[], second: number): void {
    const commitDate = makeInstant(second).toISOString();
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], { cwd: folder, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate }, stdio: "pipe" });
}

function makeEditRows(toolUseId: string, filePath: string, oldString: string, newString: string, originalFile: string, second: number): object[] {
    const toolUseResult = { filePath, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false, originalFile };
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Edit", input: { file_path: filePath }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [callRecord, resultRecord];
}

// A temp root with a git project holding a.txt and sub/b.txt (committed once, edited once after), one transcript naming both edits, an empty file-history folder and an empty store folder.
function makeFixture(t: TestContext): Fixture {
    const rootFolder = mkdtempSync(join(tmpdir(), "engine-v3-read-only-"));
    t.after(() => {
        execFileSync("chmod", ["-R", "u+w", rootFolder]);
        rmSync(rootFolder, { recursive: true, force: true });
    });
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    const snapshotFolder = join(rootFolder, "file-history");
    const storeFolder = join(rootFolder, "store");
    mkdirSync(join(projectFolder, "sub"), { recursive: true });
    mkdirSync(jsonlsFolder);
    mkdirSync(snapshotFolder);
    mkdirSync(storeFolder);
    runGit(projectFolder, ["init", "-q"], 0);
    writeFileSync(join(projectFolder, "a.txt"), "one\n");
    writeFileSync(join(projectFolder, "sub", "b.txt"), "red\n");
    runGit(projectFolder, ["add", "a.txt", "sub/b.txt"], 5);
    runGit(projectFolder, ["commit", "-q", "-m", "first"], 5);
    writeFileSync(join(projectFolder, "a.txt"), "two\n");
    writeFileSync(join(projectFolder, "sub", "b.txt"), "blue\n");
    const records = [
        ...makeEditRows("toolu_01ExampleEditA", join(projectFolder, "a.txt"), "one", "two", "one\n", 20),
        ...makeEditRows("toolu_01ExampleEditB", join(projectFolder, "sub", "b.txt"), "red", "blue", "red\n", 30),
    ];
    writeFileSync(join(jsonlsFolder, "11111111-2222-3333-4444-555555555555.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return { rootFolder, projectFolder, jsonlsFolder, snapshotFolder, storeFolder };
}

// Maps every path under the folder to its kind, mode, size and sha256.
function takeListing(folder: string): Map<string, string> {
    const listing = new Map<string, string>();
    for (const relativePath of readdirSync(folder, { recursive: true, encoding: "utf8" })) {
        const stats = lstatSync(join(folder, relativePath));
        const kind = stats.isDirectory() ? "dir" : stats.isSymbolicLink() ? "link" : "file";
        const hash = kind === "file" ? createHash("sha256").update(readFileSync(join(folder, relativePath))).digest("hex") : "";
        listing.set(relativePath, `${kind} ${(stats.mode & 0o7777).toString(8)} ${stats.size} ${hash}`);
    }
    return listing;
}

function compareListings(before: Map<string, string>, after: Map<string, string>): string[] {
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
    return paths.filter((path) => before.get(path) !== after.get(path));
}

function makeFolderReadOnly(folder: string): void {
    for (const relativePath of readdirSync(folder, { recursive: true, encoding: "utf8" })) {
        const isFolder = lstatSync(join(folder, relativePath)).isDirectory();
        chmodSync(join(folder, relativePath), isFolder ? 0o555 : 0o444);
    }
    chmodSync(folder, 0o555);
}

function getPermissionFlags(storeFolder: string): string[] {
    const tsxCacheFolder = join(tmpdir(), `tsx-${process.getuid!()}`);
    return ["--no-warnings", "--permission", "--allow-fs-read=*", `--allow-fs-write=${storeFolder}`, `--allow-fs-write=${tsxCacheFolder}`, "--allow-worker", "--allow-child-process"];
}

function runWalkWithPermissionModel(fixture: Fixture): SpawnSyncReturns<string> {
    const flags = [...getPermissionFlags(fixture.storeFolder), "--import", "tsx", CLI_SCRIPT, "--project", fixture.projectFolder, "--jsonls", fixture.jsonlsFolder, "--file-history", fixture.snapshotFolder, "--store", fixture.storeFolder];
    return spawnSync(process.execPath, flags, { cwd: JFRED_FOLDER, encoding: "utf8" });
}

test("test_the_walk_writes_only_under_the_store_folder", (t) => {
    // Scenario: the walk on a project writes nothing outside --store, and the permission model stops a stray write.
    // A project, a log folder, a file-history folder and an empty store folder sit in one temp root.
    const fixture = makeFixture(t);
    // The project, log and file-history folders are made read-only.
    makeFolderReadOnly(fixture.projectFolder);
    makeFolderReadOnly(fixture.jsonlsFolder);
    makeFolderReadOnly(fixture.snapshotFolder);
    // Listings (path, kind, mode, size, sha256) of the three folders and the top-level entries of the temp root are taken.
    const projectBefore = takeListing(fixture.projectFolder);
    const jsonlsBefore = takeListing(fixture.jsonlsFolder);
    const snapshotBefore = takeListing(fixture.snapshotFolder);
    const rootEntriesBefore = readdirSync(fixture.rootFolder).sort();
    // The CLI runs as a child process with the permission flags and exits with code 0.
    const result = runWalkWithPermissionModel(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /done: 2 files/);
    // The three listings are equal to the ones taken before the walk.
    assert.deepEqual(compareListings(projectBefore, takeListing(fixture.projectFolder)), []);
    assert.deepEqual(compareListings(jsonlsBefore, takeListing(fixture.jsonlsFolder)), []);
    assert.deepEqual(compareListings(snapshotBefore, takeListing(fixture.snapshotFolder)), []);
    // The top-level entries of the temp root are the same.
    assert.deepEqual(readdirSync(fixture.rootFolder).sort(), rootEntriesBefore);
    // The store now holds one repo per file.
    assert.ok(existsSync(join(fixture.storeFolder, "a.txt.git")));
    assert.ok(existsSync(join(fixture.storeFolder, "sub", "b.txt.git")));
});

test("test_the_listing_compare_detects_a_write_into_the_project", (t) => {
    // Scenario: the listing compare reports a changed file, so an empty compare result means something.
    // A project exists and its listing is taken.
    const fixture = makeFixture(t);
    const projectBefore = takeListing(fixture.projectFolder);
    // A child process appends one line to a.txt.
    execFileSync(process.execPath, ["-e", "require('node:fs').appendFileSync(process.argv[1], 'extra\\n')", join(fixture.projectFolder, "a.txt")]);
    // The compare of the listing before and the listing after names a.txt.
    assert.deepEqual(compareListings(projectBefore, takeListing(fixture.projectFolder)), ["a.txt"]);
});

test("test_the_permission_model_stops_a_write_outside_the_store", (t) => {
    // Scenario: with the permission flags, a node process cannot write outside the store folder.
    // A temp root holds an empty store folder.
    const fixture = makeFixture(t);
    // A node process with the permission flags tries to write outside.txt in the temp root.
    const outsideFile = join(fixture.rootFolder, "outside.txt");
    const result = spawnSync(process.execPath, [...getPermissionFlags(fixture.storeFolder), "-e", "require('node:fs').writeFileSync(process.argv[1], 'x')", outsideFile], { encoding: "utf8" });
    // The exit code is not 0, stderr holds the permission message, and the file does not exist.
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(PERMISSION_DENIED_TEXT));
    assert.equal(existsSync(outsideFile), false);
});
