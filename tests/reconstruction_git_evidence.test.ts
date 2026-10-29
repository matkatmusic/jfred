import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCommittedFileContent } from "../src/reconstruction_git_evidence.ts";
import { findGitCommitEvents } from "../src/reconstruction_git_commit_events.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

// An assistant record with one Bash tool_use running `command`, plus the record-level cwd.
function buildBashRecord(command: string, timestamp: string, cwd?: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: cwd !== undefined ? new Path(cwd) : undefined,
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name: ToolName.Bash, input: { command }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// `-C <dir>` names the repo; a bare commit uses the record cwd; `git add` is not a commit.
test("test_findGitCommitEvents_reads_the_repo_dir_from_dash_C_or_the_record_cwd", () => {
    const records = [
        buildBashRecord('git -C /tmp/repo commit -m "baseline"', "2026-01-01T00:00:01Z", "/elsewhere"),
        buildBashRecord('git commit -m "second"', "2026-01-01T00:00:02Z", "/tmp/repo"),
        buildBashRecord("git add -A", "2026-01-01T00:00:03Z", "/tmp/repo"),
    ];
    const commits = findGitCommitEvents(records);
    assert.equal(commits.length, 2);
    assert.equal(commits[0]!.cwd?.toString(), "/tmp/repo");
    assert.equal(commits[1]!.cwd?.toString(), "/tmp/repo");
});

// A commit after `&&` is still a commit event (task 89); read `-C` from its own segment.
test("test_findGitCommitEvents_sees_a_commit_inside_a_compound_command", () => {
    const records = [
        buildBashRecord('git add a.py && git -C /tmp/repo commit -m "x"', "2026-01-01T00:00:01Z", "/elsewhere"),
    ];
    const commits = findGitCommitEvents(records);
    assert.equal(commits.length, 1);
    assert.equal(commits[0]!.cwd?.toString(), "/tmp/repo");
});

test("test_readCommittedFileContent_returns_the_blob_at_a_recorded_commit", () => {
    // Steps: create a temp git repo with one committed file.
    const repo = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        const committedBytes = "def f_two(x):\n    return x + 2\n# reviewed by ops\n";
        writeFileSync(join(repo, "core_two.py"), committedBytes);
        const commitInstant = "2026-01-01T00:00:10Z";
        execSync(
            'git init -q && git add core_two.py && git -c user.name=t -c user.email=t@t commit -q -m baseline --date "2026-01-01T00:00:10Z"',
            { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: commitInstant } },
        );
        // read the file's content at that commit via the new reader.
        const content = readCommittedFileContent(
            new Path(repo),
            new Date(commitInstant),
            new Path(join(repo, "core_two.py")),
        );
        // assert it equals the committed bytes.
        assert.equal(content, committedBytes);
        // A path the commit does not carry is a silent undefined, never a throw.
        assert.equal(
            readCommittedFileContent(new Path(repo), new Date(commitInstant), new Path(join(repo, "missing.py"))),
            undefined,
        );
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

// A missing repo is a silent no-op, so every non-git scenario stays untouched.
test("test_readCommittedFileContent_returns_undefined_for_a_missing_repo", () => {
    const content = readCommittedFileContent(
        new Path("/nonexistent/repo/dir"),
        new Date("2026-01-01T00:00:10Z"),
        new Path("/nonexistent/repo/dir/f.py"),
    );
    assert.equal(content, undefined);
});
