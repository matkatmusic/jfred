// The layer1-view fixtures pin their mtimes and commit instants to stated values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
    EARLY_DISK_ORPHAN_MTIME, FIRST_COMMIT_INSTANT, SECOND_COMMIT_INSTANT, createFixtureDiskFolder, createFixtureRepo,
} from "./layer1-view-test-helpers.ts";

test("createFixtureDiskFolder pins early.txt to the stated early mtime", () => {
    const diskDir = createFixtureDiskFolder();

    const mtime = statSync(join(diskDir, "early.txt")).mtime;

    assert.equal(mtime.getTime(), new Date(EARLY_DISK_ORPHAN_MTIME).getTime());
});

test("createFixtureRepo makes two commits stamped with the stated committer dates", () => {
    const repoDir = createFixtureRepo();

    const log = execSync("git log --format=%cI", { cwd: repoDir, encoding: "utf8" }).trim().split("\n");

    const committedAt = log.map((stamp) => new Date(stamp).getTime());
    assert.deepEqual(committedAt, [new Date(SECOND_COMMIT_INSTANT).getTime(), new Date(FIRST_COMMIT_INSTANT).getTime()]);
});
