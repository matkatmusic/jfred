// The TUI start file: a process-level test of the --auto run.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { getProjectCacheFile } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { initGitRepo } from "./engineV3_step_test_projects.ts";

const JFRED_FOLDER = join(import.meta.dirname, "..");

function makeTempFolder(t: TestContext, folderName: string): string {
    const folder = join(tmpdir(), `jfred-test-${folderName}-${randomUUID()}`);
    mkdirSync(folder, { recursive: true });
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// A store path inside the cache folder that does not exist yet. The test removes the store and its tui cache folder.
function makeMissingStoreFolderInsideCacheFolder(t: TestContext): Path {
    const storeFolder = new Path(join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-" + randomUUID()));
    t.after(() => {
        rmSync(storeFolder.toString(), { recursive: true, force: true });
        rmSync(dirname(getProjectCacheFile(storeFolder).toString()), { recursive: true, force: true });
    });
    return storeFolder;
}

test("test_auto_on_a_project_with_no_events_ends_with_exit_code_0_at_once", (t) => {
    // Scenario: --auto on a project with no file events ends with exit code 0 and does not hang or throw.
    // a project folder (a git repo with one empty commit, because the file list needs a repo), an empty transcript folder, an empty file-history folder, and a new store folder inside the cache folder.
    const projectFolder = makeTempFolder(t, "project");
    initGitRepo(projectFolder);
    const jsonlsFolder = makeTempFolder(t, "jsonls");
    const fileHistoryFolder = makeTempFolder(t, "file-history");
    const storeFolder = makeMissingStoreFolderInsideCacheFolder(t);
    // the TUI runs as its own process with --auto, and its input is not a terminal.
    const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "engineV3/tui/jfredTUI.ts", "--project", projectFolder, "--jsonls", jsonlsFolder, "--file-history", fileHistoryFolder, "--store", storeFolder.toString(), "--auto"],
        { cwd: JFRED_FOLDER, encoding: "utf8", timeout: 100000 },
    );
    // the process ended by itself with exit code 0 and was not killed by the time limit.
    const output = `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.equal(result.signal, null, output);
});
