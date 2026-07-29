// Staged (git add) blobs as evidence (s87): `git add` with no later commit leaves content NOWHERE else — the driver's external edit exists ONLY in the repo's index.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readStagedFileContent } from "../src/reconstruction_git_evidence.ts";
import { findGitAddEvents } from "../src/reconstruction_git_commit_events.ts";
import { placeGitCommitEvidence } from "../src/reconstruction_git_placement.ts";
import { injectScriptExecutions } from "../src/reconstruction_script_stage.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

// An assistant record carrying one Bash tool_use running `command`, with the record-level cwd.
function buildBashRecord(command: string, timestamp: string, cwd?: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: cwd !== undefined ? new Path(cwd) : undefined,
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name: ToolName.Bash, input: { command }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// An assistant record carrying one tool_use of `name` with `input`, with the record-level cwd.
function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string, cwd: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: new Path(cwd),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

const emptyReader: BackupReader = () => "";

test("test_findGitAddEvents_parses_explicit_paths_and_compound_segments", () => {
    // Steps: a bare `git add <file>`, an add inside a compound command, and path-less forms (-A, .).
    const records = [
        buildBashRecord("git add reporting_core.py", "2026-01-01T00:20:19Z", "/tmp/repo"),
        buildBashRecord('git add apply_renames.py && git -C /tmp/repo commit -m "x"', "2026-01-01T00:30:45Z", "/tmp/repo"),
        buildBashRecord("git add -A", "2026-01-01T00:31:00Z", "/tmp/repo"),
        buildBashRecord("git add .", "2026-01-01T00:31:05Z", "/tmp/repo"),
    ];
    const adds = findGitAddEvents(records);
    // one event per EXPLICIT path; -A and . name no explicit path and yield nothing.
    assert.equal(adds.length, 2);
    assert.equal(adds[0]!.path.toString(), "/tmp/repo/reporting_core.py");
    assert.equal(adds[0]!.timestamp.getTime(), new Date("2026-01-01T00:20:19Z").getTime());
    assert.equal(adds[1]!.path.toString(), "/tmp/repo/apply_renames.py");
});

test("test_readStagedFileContent_returns_the_index_blob_not_the_worktree", () => {
    // Steps: stage one version of a file, then change the worktree copy WITHOUT re-adding.
    const repo = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        const stagedBytes = "def report(store):\n    return store\n# reviewed by ops\n# reviewed by ops\n";
        writeFileSync(join(repo, "reporting_core.py"), stagedBytes);
        execSync("git init -q && git add reporting_core.py", { cwd: repo });
        writeFileSync(join(repo, "reporting_core.py"), "changed after staging\n");
        // the reader must serve the INDEX blob, not the worktree bytes.
        const content = readStagedFileContent(new Path(repo), new Path(join(repo, "reporting_core.py")));
        assert.equal(content, stagedBytes);
        // an unstaged path is a silent undefined, never a throw.
        assert.equal(readStagedFileContent(new Path(repo), new Path(join(repo, "missing.py"))), undefined);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});

test("test_gitStagedEvidence_places_an_unexplained_diff_using_the_index_blob", () => {
    // Scenario (s87 in miniature): a move run births core_two.py, a rename run rewrites it, and a `# reviewed by ops` comment exists ONLY in the blob staged by a later `git add` — there is NO commit. The stage must splice a user-edit carrying the comment between the move and the rename run, and rebuild the run event's content so the comment survives it.
    const repo = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        const moved = '"""Module two."""\n\n\ndef f_two(x):\n    return x + 2\n';
        const blob = '"""Module two."""\n\n\ndef beta(x):\n    return x + 2\n# reviewed by ops\n';
        writeFileSync(join(repo, "core_two.py"), blob);
        execSync("git init -q && git add core_two.py", { cwd: repo });
        const moveScript = 'import shutil\nshutil.move("two.py", "core_two.py")\n';
        const renameScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
            + '    text = open(p).read()\n'
            + '    open(p, "w").write(text.replace("f_two", "beta"))\n';
        const records = [
            buildToolRecord(ToolName.Write, { file_path: join(repo, "two.py"), content: moved }, "2026-01-01T00:00:01Z", repo),
            buildToolRecord(ToolName.CtxExecute, { cwd: repo, code: moveScript }, "2026-01-01T00:00:05Z", repo),
            buildToolRecord(ToolName.CtxExecute, { cwd: repo, code: renameScript }, "2026-01-01T00:00:15Z", repo),
            buildBashRecord("git add core_two.py", "2026-01-01T00:00:19Z", repo),
        ];
        const target = new Path(join(repo, "core_two.py"));
        const events = injectScriptExecutions(records, [], emptyReader, target);
        assert.equal(events.length, 2);
        const placed = placeGitCommitEvidence(records, events, emptyReader, target);
        assert.equal(placed.length, 3);
        // The spliced user-edit carries the comment on the PRE-rename content...
        assert.equal(placed[1]!.kind, EventKind.userEdit);
        assert.equal((placed[1] as { content: string }).content, moved + "# reviewed by ops\n");
        // ...strictly between the move and the rename run...
        assert.ok(placed[1]!.timestamp.getTime() > new Date("2026-01-01T00:00:05Z").getTime());
        assert.ok(placed[1]!.timestamp.getTime() < new Date("2026-01-01T00:00:15Z").getTime());
        // ...and the run event's content is rebuilt so the comment survives it.
        assert.equal((placed[2] as { content: string }).content, blob);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});
