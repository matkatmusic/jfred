import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyGitCommitEvidence } from "../src/reconstruction_git_placement.ts";
import { injectScriptExecutions } from "../src/reconstruction_script_stage.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

// An assistant record with one `name` tool_use carrying `input`, plus the record-level cwd.
function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string, cwd: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: new Path(cwd),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

const emptyReader: BackupReader = () => "";

test("test_gitCommitEvidence_places_an_unexplained_diff_between_the_move_and_the_rename_run", () => {
    // Scenario (s85 miniature): a comment only in the post-rename commit must be spliced between move and rename.
    const repo = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        const moved = '"""Module two."""\n\n\ndef f_two(x):\n    return x + 2\n';
        const blob = '"""Module two."""\n\n\ndef beta(x):\n    return x + 2\n# reviewed by ops\n';
        writeFileSync(join(repo, "core_two.py"), blob);
        execSync(
            'git init -q && git add core_two.py && git -c user.name=t -c user.email=t@t commit -q -m post-rename',
            { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:20Z" } },
        );
        const moveScript = 'import shutil\nshutil.move("two.py", "core_two.py")\n';
        const renameScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
            + '    text = open(p).read()\n'
            + '    open(p, "w").write(text.replace("f_two", "beta"))\n';
        const records = [
            buildToolRecord(ToolName.Write, { file_path: join(repo, "two.py"), content: moved }, "2026-01-01T00:00:01Z", repo),
            buildToolRecord(ToolName.CtxExecute, { cwd: repo, code: moveScript }, "2026-01-01T00:00:05Z", repo),
            buildToolRecord(ToolName.CtxExecute, { cwd: repo, code: renameScript }, "2026-01-01T00:00:15Z", repo),
            buildToolRecord(ToolName.Bash, { command: `git -C ${repo} commit -m post-rename` }, "2026-01-01T00:00:19Z", repo),
        ];
        const target = new Path(join(repo, "core_two.py"));
        const events = injectScriptExecutions(records, [], emptyReader, target);
        assert.equal(events.length, 2);
        const placed = applyGitCommitEvidence(records, events, emptyReader, target);
        assert.equal(placed.length, 3);
        // The spliced user-edit carries the comment on the PRE-rename content...
        assert.equal(placed[1]!.kind, EventKind.userEdit);
        assert.equal((placed[1] as { content: string }).content, moved + "# reviewed by ops\n");
        // ...strictly between the move and the rename...
        assert.ok(placed[1]!.timestamp.getTime() > new Date("2026-01-01T00:00:05Z").getTime());
        assert.ok(placed[1]!.timestamp.getTime() < new Date("2026-01-01T00:00:15Z").getTime());
        // ...and the rename event's content is rebuilt so the comment survives it.
        assert.equal((placed[2] as { content: string }).content, blob);
    } finally {
        rmSync(repo, { recursive: true, force: true });
    }
});
