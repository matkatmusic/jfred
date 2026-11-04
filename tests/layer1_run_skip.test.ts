import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    BOX_BLOCKED_REASON_PREFIX,
    BOX_BLOCK_SIGNATURES,
    formatReplayFailure,
    findRunSkipReason,
    isBlockedByBox,
} from "../src/layer1_run_skip.ts";
import { setPreBaselineReconstructionAllowed } from "../src/reconstruction_base_commit.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { SANDBOX_TIMEOUT_MS } from "../src/reconstruction_script_sandbox_dir.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const WRITING_CODE = 'open("a.txt", "w").write("x")\n';
const MOUNT = new Path("/work");

function buildRun(overrides: Partial<ScriptRun>): ScriptRun {
    return { code: WRITING_CODE, timestamp: new Date("2026-01-01T00:00:05Z"), executorKind: ScriptExecutorKind.python, ...overrides };
}

test("test_findRunSkipReason_is_undefined_for_a_python_run_that_writes", () => {
    assert.equal(findRunSkipReason(buildRun({})), undefined);
    assert.equal(findRunSkipReason(buildRun({ language: "python" })), undefined);
    assert.equal(findRunSkipReason(buildRun({ language: "python3" })), undefined);
});

test("test_findRunSkipReason_names_a_bash_run", () => {
    assert.match(findRunSkipReason(buildRun({ executorKind: ScriptExecutorKind.bash }))!, /Bash/);
});

test("test_findRunSkipReason_names_a_language_that_is_not_python", () => {
    assert.match(findRunSkipReason(buildRun({ language: "javascript" }))!, /javascript/);
});

test("test_findRunSkipReason_names_a_read_only_run", () => {
    assert.match(findRunSkipReason(buildRun({ code: 'print(open("a.txt").read())\n' }))!, /only reads/);
});

test("test_findRunSkipReason_names_a_run_at_or_before_the_skipped_baseline", () => {
    const repo = mkdtempSync(join(tmpdir(), "run-skip-repo-"));
    writeFileSync(join(repo, "a.txt"), "a\n");
    const env = { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:10Z", GIT_AUTHOR_DATE: "2026-01-01T00:00:10Z" };
    execSync("git init -q && git add a.txt && git -c user.name=t -c user.email=t@t commit -q -m c", { cwd: repo, env });
    const baseCommit = execSync("git rev-parse HEAD", { cwd: repo }).toString().trim();
    setPreBaselineReconstructionAllowed(false);
    setPathOverrides({ repoDir: new Path(repo), baseCommit: new Uuid(baseCommit) });
    try {
        assert.match(findRunSkipReason(buildRun({ timestamp: new Date("2026-01-01T00:00:05Z") }))!, /base commit/);
        assert.equal(findRunSkipReason(buildRun({ timestamp: new Date("2026-01-01T00:00:20Z") })), undefined);
    }
    finally {
        setPreBaselineReconstructionAllowed(true);
        setPathOverrides({});
    }
});

test("test_BOX_BLOCK_SIGNATURES_holds_the_four_signatures", () => {
    assert.equal(BOX_BLOCK_SIGNATURES.length, 4);
});

test("test_isBlockedByBox_matches_Network_is_unreachable", () => {
    assert.equal(isBlockedByBox("OSError: [Errno 101] Network is unreachable\n", MOUNT), true);
});

test("test_isBlockedByBox_matches_Temporary_failure_in_name_resolution", () => {
    assert.equal(isBlockedByBox("socket.gaierror: [Errno -3] Temporary failure in name resolution\n", MOUNT), true);
});

test("test_isBlockedByBox_matches_Name_or_service_not_known", () => {
    assert.equal(isBlockedByBox("socket.gaierror: [Errno -2] Name or service not known\n", MOUNT), true);
});

test("test_isBlockedByBox_matches_a_missing_absolute_path_outside_the_mount", () => {
    assert.equal(isBlockedByBox("FileNotFoundError: [Errno 2] No such file or directory: '/Users/me/other/x.txt'\n", MOUNT), true);
});

test("test_isBlockedByBox_ignores_a_missing_path_inside_the_mount_and_a_relative_path", () => {
    assert.equal(isBlockedByBox("FileNotFoundError: [Errno 2] No such file or directory: '/work/sub/x.txt'\n", MOUNT), false);
    assert.equal(isBlockedByBox("FileNotFoundError: [Errno 2] No such file or directory: 'x.txt'\n", MOUNT), false);
    assert.equal(isBlockedByBox("ValueError: bad\n", MOUNT), false);
});

test("test_formatReplayFailure_starts_with_the_box_text_for_a_box_signature", () => {
    const reason = formatReplayFailure({ stdout: "", stderr: "OSError: Network is unreachable\n", exitCode: 1, timedOut: false }, MOUNT);
    assert.ok(reason.startsWith(BOX_BLOCKED_REASON_PREFIX));
    assert.ok(reason.includes("Network is unreachable"));
});

test("test_formatReplayFailure_reports_a_timeout_with_the_limit", () => {
    const reason = formatReplayFailure({ stdout: "", stderr: "", timedOut: true }, MOUNT);
    assert.ok(reason.includes(String(SANDBOX_TIMEOUT_MS / 1000)));
});

test("test_formatReplayFailure_reports_the_exit_code_and_the_last_stderr_lines", () => {
    const stderr = "line 1\nline 2\nline 3\nline 4\nValueError: bad\n";
    const reason = formatReplayFailure({ stdout: "", stderr, exitCode: 2, timedOut: false }, MOUNT);
    assert.ok(reason.includes("exit code 2"));
    assert.ok(reason.includes("ValueError: bad"));
    assert.ok(!reason.includes("line 1"));
    assert.ok(!reason.startsWith(BOX_BLOCKED_REASON_PREFIX));
});
