import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOCKER_SCRIPT_PATH = join(import.meta.dirname, "run_replay_in_docker.sh");
const OLD_CONFIG_FILE_NAME = "debt_ratchet_eslint_config_at_2026_10_17.js.txt";
const OLD_CONFIG_PATH = join(import.meta.dirname, "replay_overlays", OLD_CONFIG_FILE_NAME);
const MAC_CONFIG_PATH = "/Users/matkatmusicllc/Programming/dotfiles/claude/claude_hooks/debt-ratchet/eslint.config.js";
// The git blob id of debt-ratchet/eslint.config.js in dotfiles commit 62a68a3 (2026-10-17), the content until the recorded edits of 2026-10-29T09:36Z.
const OLD_CONFIG_GIT_BLOB_ID = "464485d294392796f05b6c16c68f641db20dddb0";

function computeGitBlobId(fileBytes: Buffer): string {
    return createHash("sha1").update(`blob ${fileBytes.length}\0`).update(fileBytes).digest("hex");
}

test("test_old_debt_ratchet_config_is_the_exact_content_of_dotfiles_commit_62a68a3", () => {
    // Scenario: the overlay file holds the config that the recorded eslint calls of 2026-10-27 to 2026-10-29 ran with.
    // read the overlay file
    const fileBytes = readFileSync(OLD_CONFIG_PATH);
    // its git blob id is the blob id of the committed config
    assert.equal(computeGitBlobId(fileBytes), OLD_CONFIG_GIT_BLOB_ID);
});

test("test_old_debt_ratchet_config_has_no_max_lines_per_function_rule", () => {
    // Scenario: the rule arrived on 2026-10-30, after the recorded call that failed in the replay.
    // read the overlay file
    const configText = readFileSync(OLD_CONFIG_PATH, "utf8");
    // it does not name the rule
    assert.equal(configText.includes("max-lines-per-function"), false);
});

test("test_typesafe_replay_mounts_the_old_debt_ratchet_config_over_the_mac_config", () => {
    // Scenario: the container sees the old config at the Mac path, read-only, when the git repo is typesafe-playground.
    // read the script
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    // the mount line maps the overlay file to the Mac config path
    const wantedMount = `-v "$ENGINE_FOLDER/replay_overlays/${OLD_CONFIG_FILE_NAME}:${MAC_CONFIG_PATH}:ro"`;
    const mountLineIndex = scriptText.indexOf(wantedMount);
    assert.notEqual(mountLineIndex, -1, "the script has the overlay mount");
    // the mount sits inside the typesafe-playground check
    const guardLineIndex = scriptText.lastIndexOf('if [ "$GIT_REPO_FOLDER" = "/Users/matkatmusicllc/Programming/typesafe-playground" ]; then', mountLineIndex);
    assert.notEqual(guardLineIndex, -1, "the mount has the typesafe-playground check before it");
    assert.ok(mountLineIndex - guardLineIndex < 400, "the check is the one right before the mount");
});
