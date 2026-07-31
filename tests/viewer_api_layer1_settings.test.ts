// The task-297 saved-project settings file: missing or corrupt reads as "nothing saved"; save is read-modify-write.
//
// In-process, against a tmp settings file redirected through setLayer1SettingsPath — nothing here may touch the real home.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import {
    readLayer1Settings,
    saveLayer1Project,
    setLayer1SettingsPath,
    type Layer1ProjectSettings,
} from "../src/viewer_api_layer1_settings.ts";

// A fresh file per test, so the round-trip cases cannot pass on a leftover from an earlier one.
function redirectSettingsToFreshFile(): void {
    setLayer1SettingsPath(new Path(join(mkdtempSync(join(tmpdir(), "layer1-settings-")), "settings.json")));
}

function makeProjectSettings(dir: string): Layer1ProjectSettings {
    return {
        dir,
        repo: `${dir}-repo`,
        branch: "main",
        ref: "HEAD",
        jsonl: [`${dir}-sessions`],
        fileHistory: [`${dir}-history`],
    };
}

test("test_layer1_settings_read_of_missing_file_is_the_empty_shape", () => {
    // Scenario: the very first page load, before anything was ever saved.
    redirectSettingsToFreshFile();
    assert.deepEqual(readLayer1Settings(), { lastDir: null, projects: {} });
});

test("test_layer1_settings_read_of_corrupt_file_is_the_empty_shape", () => {
    // Scenario: a half-written or hand-edited file must never stop the page from loading.
    const folder = mkdtempSync(join(tmpdir(), "layer1-settings-"));
    const settingsFile = join(folder, "settings.json");
    writeFileSync(settingsFile, "{ not json");
    setLayer1SettingsPath(new Path(settingsFile));
    assert.deepEqual(readLayer1Settings(), { lastDir: null, projects: {} });
});

test("test_layer1_settings_save_then_read_round_trips_the_project", () => {
    redirectSettingsToFreshFile();
    const project = makeProjectSettings("/tmp/demo-app");
    saveLayer1Project(project);
    const settings = readLayer1Settings();
    // lastDir is what the page restores on boot, so it must name the project just saved.
    assert.equal(settings.lastDir, "/tmp/demo-app");
    assert.deepEqual(settings.projects["/tmp/demo-app"], project);
});

test("test_layer1_settings_second_project_leaves_the_first_intact", () => {
    // Scenario: read-modify-write — saving project B must not drop project A's entry, only move lastDir onto B.
    redirectSettingsToFreshFile();
    const first = makeProjectSettings("/tmp/first-app");
    const second = makeProjectSettings("/tmp/second-app");
    saveLayer1Project(first);
    saveLayer1Project(second);
    const settings = readLayer1Settings();
    assert.equal(settings.lastDir, "/tmp/second-app");
    assert.deepEqual(settings.projects["/tmp/first-app"], first);
    assert.deepEqual(settings.projects["/tmp/second-app"], second);
});

test("test_layer1_settings_refuses_a_project_with_no_dir", () => {
    // `dir` is the storage key, so an empty one would write a junk "" entry rather than fail.
    redirectSettingsToFreshFile();
    assert.throws(() => saveLayer1Project(makeProjectSettings("")), /non-empty dir/);
});

test("test_saving_collapsed_folders_alone_preserves_the_saved_header_fields", () => {
    redirectSettingsToFreshFile();
    const dir = "/tmp/demo-app";
    const project = makeProjectSettings(dir);
    saveLayer1Project(project);
    saveLayer1Project({ dir, collapsedFolders: ["src/nested"] });
    const saved = readLayer1Settings().projects[dir]!;
    assert.equal(saved.repo, project.repo);
    assert.equal(saved.branch, project.branch);
    assert.equal(saved.ref, project.ref);
    assert.deepEqual(saved.jsonl, project.jsonl);
    assert.deepEqual(saved.fileHistory, project.fileHistory);
    assert.deepEqual(saved.collapsedFolders, ["src/nested"]);
});

test("test_saving_header_settings_preserves_previously_saved_collapsed_folders", () => {
    redirectSettingsToFreshFile();
    const dir = "/tmp/demo-app";
    saveLayer1Project({ dir, collapsedFolders: ["src/nested"] });
    saveLayer1Project(makeProjectSettings(dir));
    assert.deepEqual(readLayer1Settings().projects[dir]!.collapsedFolders, ["src/nested"]);
});
