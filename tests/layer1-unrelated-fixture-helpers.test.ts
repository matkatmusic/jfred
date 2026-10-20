// The unrelated fixtures share no path between folder and repo, and the submodule root carries a gitlink.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import {
    SUBMODULE_FIXTURE_FOLDER, makeSubmoduleFixtureRoot, makeUnrelatedFixtureDiskFolder, makeUnrelatedFixtureRepo,
} from "./layer1-unrelated-fixture-helpers.ts";

test("the unrelated folder and repo hold no file name in common", () => {
    const folderNames = readdirSync(makeUnrelatedFixtureDiskFolder());
    const repoFiles = execSync("git ls-files", { cwd: makeUnrelatedFixtureRepo(), encoding: "utf8" }).trim().split("\n");

    assert.deepEqual(folderNames.sort(), ["notes.txt", "todo.md"]);
    assert.deepEqual(repoFiles.sort(), ["alpha.py", "docs/readme.md"]);
});

test("the submodule root tracks the submodule folder as a gitlink", () => {
    const rootDir = makeSubmoduleFixtureRoot();

    const tree = execSync(`git ls-tree HEAD ${SUBMODULE_FIXTURE_FOLDER}`, { cwd: rootDir, encoding: "utf8" });

    assert.ok(tree.startsWith("160000 commit"));
});
