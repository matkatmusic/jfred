// Tests for the session-dots filter (task 888 step 10): which logs and which lines belong to the loaded project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { isProjectFolderMentioned, isProjectLogPath } from "../src/layer1_session_dots_filter.ts";

const PROJECT_DIR = new Path("/Users/x/Programming/jot");
const PROJECT_LOG = new Path("/h/.claude/projects/-Users-x-Programming-jot/s.jsonl");

test("test_a_log_under_the_project_folder_name_is_a_project_log", () => {
    // Scenario: a log sits in the Claude folder named after the project dir.
    // The folder name is the project dir with every non-alphanumeric character turned into a dash.
    assert.equal(isProjectLogPath(PROJECT_LOG, PROJECT_DIR), true);
});

test("test_a_backup_copy_under_another_root_is_a_project_log", () => {
    // Scenario: a backup copy of the project folder lives under a different root and a deeper path.
    // Only the segment equal to the folder name matters.
    const backupLog = new Path("/h/jot-recovery/claude-data/projects/-Users-x-Programming-jot/a/subagents/agent-1.jsonl");
    assert.equal(isProjectLogPath(backupLog, PROJECT_DIR), true);
});

test("test_a_sibling_project_folder_is_not_a_project_log", () => {
    // Scenario: the folder name only starts like the project's name, so it is another project.
    const siblingLog = new Path("/h/.claude/projects/-Users-x-Programming-jot-recovery/s.jsonl");
    assert.equal(isProjectLogPath(siblingLog, PROJECT_DIR), false);
});

test("test_a_worktree_project_folder_is_not_a_project_log", () => {
    // Scenario: a worktree folder name starts like the project's name, so it is another project.
    const worktreeLog = new Path("/h/.claude/projects/-Users-x-Programming-jot--claude-worktrees-w/s.jsonl");
    assert.equal(isProjectLogPath(worktreeLog, PROJECT_DIR), false);
});

test("test_a_trailing_slash_on_the_dir_changes_nothing", () => {
    // Scenario: the project dir is given with a trailing slash.
    // The same log must still be a project log.
    const dirWithSlash = new Path("/Users/x/Programming/jot/");
    assert.equal(isProjectLogPath(PROJECT_LOG, dirWithSlash), true);
});

test("test_a_mention_followed_by_a_slash_counts", () => {
    // Scenario: the raw text names a file inside the project dir.
    assert.equal(isProjectFolderMentioned("edit /Users/x/Programming/jot/src/a.ts now", PROJECT_DIR), true);
});

test("test_a_mention_followed_by_a_quote_counts", () => {
    // Scenario: the raw JSON text has the project dir as the end of a quoted string.
    assert.equal(isProjectFolderMentioned('{"cwd":"/Users/x/Programming/jot"}', PROJECT_DIR), true);
});

test("test_a_mention_followed_by_a_backslash_counts", () => {
    // Scenario: raw JSONL text escapes a newline, so a backslash and an n follow the project dir.
    assert.equal(isProjectFolderMentioned("cd /Users/x/Programming/jot\\nls", PROJECT_DIR), true);
});

test("test_a_mention_at_the_end_of_the_text_counts", () => {
    // Scenario: the project dir is the last thing in the text.
    assert.equal(isProjectFolderMentioned("cd /Users/x/Programming/jot", PROJECT_DIR), true);
});

test("test_a_mention_followed_by_a_space_counts", () => {
    // Scenario: a space follows the project dir.
    assert.equal(isProjectFolderMentioned("cd /Users/x/Programming/jot && ls", PROJECT_DIR), true);
});

test("test_jot_recovery_is_not_a_mention", () => {
    // Scenario: a dash follows the project dir, so it is a longer name.
    assert.equal(isProjectFolderMentioned("cd /Users/x/Programming/jot-recovery", PROJECT_DIR), false);
});

test("test_jotty_is_not_a_mention", () => {
    // Scenario: a letter follows the project dir, so it is a longer name.
    assert.equal(isProjectFolderMentioned("cd /Users/x/Programming/jotty", PROJECT_DIR), false);
});

test("test_jot_dot_old_is_not_a_mention", () => {
    // Scenario: a dot follows the project dir, so it is a longer name.
    assert.equal(isProjectFolderMentioned("cd /Users/x/Programming/jot.old", PROJECT_DIR), false);
});

test("test_a_second_mention_after_a_false_one_still_counts", () => {
    // Scenario: the first match is a longer name, the second match is a true mention.
    const text = "/Users/x/Programming/jot-recovery and /Users/x/Programming/jot/src";
    assert.equal(isProjectFolderMentioned(text, PROJECT_DIR), true);
});
