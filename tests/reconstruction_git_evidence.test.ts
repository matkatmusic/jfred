import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findFallbackRepoDirs, readCommittedFileContent } from "../src/reconstruction_git_evidence.ts";
import { findGitCommitEvents } from "../src/reconstruction_git_commit_events.ts";
import { placeGitCommitEvidence } from "../src/reconstruction_git_placement.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { injectScriptExecutions } from "../src/reconstruction_script_stage.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

// Path overrides are process-wide module state — never let one test's overrides leak
// into the next (item 46).
afterEach(() => {
    setPathOverrides({});
});

// An assistant record carrying one Bash tool_use running `command`, with the record-level cwd.
function buildBashRecord(command: string, timestamp: string, cwd?: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: cwd !== undefined ? new Path(cwd) : undefined,
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name: ToolName.Bash, input: { command }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A `git -C <dir> commit` names its repo in the command; a bare `git commit` falls back to the
// record cwd; a `git add` is not a commit.
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

// A commit chained behind another command with `&&` is still a commit event (task 89), and its
// `-C` dir is read from the commit's OWN segment, not the compound's head.
test("test_findGitCommitEvents_sees_a_commit_inside_a_compound_command", () => {
    const records = [
        buildBashRecord('git add a.py && git -C /tmp/repo commit -m "x"', "2026-01-01T00:00:01Z", "/elsewhere"),
    ];
    const commits = findGitCommitEvents(records);
    assert.equal(commits.length, 1);
    assert.equal(commits[0]!.cwd?.toString(), "/tmp/repo");
});

test("test_readCommittedFileContent_returns_the_blob_at_a_recorded_commit", () => {
    // Steps:
    // create a temp git repo with one committed file.
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

test("test_gitCommitEvidence_places_an_unexplained_diff_between_the_move_and_the_rename_run", () => {
    // Scenario (s85 in miniature): a move run births core_two.py, a rename run rewrites it via
    // glob, and a `# reviewed by ops` comment exists ONLY in the post-rename commit blob. The
    // stage must splice a user-edit carrying the comment between the move and the rename, and
    // rebuild the rename event's content so the comment survives it.
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
        const placed = placeGitCommitEvidence(records, events, emptyReader, target);
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

test("test_readCommittedFileContent_falls_back_to_a_preserved_repo_when_the_recorded_cwd_decays", () => {
    // Scenario (s85's regression): macOS purged the recorded temp cwd's repo, but the scenario
    // capture preserved a clone of it next to the transcript. The reader must serve the committed
    // blob from the preserved repo, still resolving the file's path relative to the RECORDED cwd.
    const preserved = mkdtempSync(join(tmpdir(), "reveng-git-"));
    const decayed = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        const committedBytes = "def f_two(x):\n    return x + 2\n# reviewed by ops\n";
        writeFileSync(join(preserved, "core_two.py"), committedBytes);
        const commitInstant = "2026-01-01T00:00:10Z";
        execSync(
            'git init -q && git add core_two.py && git -c user.name=t -c user.email=t@t commit -q -m baseline',
            { cwd: preserved, env: { ...process.env, GIT_COMMITTER_DATE: commitInstant } },
        );
        const content = readCommittedFileContent(
            new Path(decayed),
            new Date(commitInstant),
            new Path(join(decayed, "core_two.py")),
            // item 46: new Path(preserved),
            [new Path(preserved)],
        );
        assert.equal(content, committedBytes);
    } finally {
        rmSync(preserved, { recursive: true, force: true });
        rmSync(decayed, { recursive: true, force: true });
    }
});

// Absence of the repo itself is a silent no-op — every non-git scenario must be untouched.
test("test_readCommittedFileContent_returns_undefined_for_a_missing_repo", () => {
    const content = readCommittedFileContent(
        new Path("/nonexistent/repo/dir"),
        new Date("2026-01-01T00:00:10Z"),
        new Path("/nonexistent/repo/dir/f.py"),
    );
    assert.equal(content, undefined);
});

test("test_read_committed_file_content_tries_each_fallback_repo_dir", () => {
    // Steps:
    // build repo B — a relocated mirror of the recorded repo — holding one commit of orders.py.
    const repoB = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        const committedBytes = "def place_order(item):\n    return item\n";
        writeFileSync(join(repoB, "orders.py"), committedBytes);
        const commitInstant = "2026-01-01T00:00:10Z";
        execSync("git init -q -b main", { cwd: repoB });
        execSync(`git -C ${repoB} config user.email t@t && git -C ${repoB} config user.name t`);
        execSync("git add orders.py && git commit -q -m baseline", {
            cwd: repoB,
            env: { ...process.env, GIT_COMMITTER_DATE: commitInstant },
        });
        // read via a NONEXISTENT recorded cwd whose relative layout matches, with repo B as fallback.
        const decayedCwd = "/nonexistent/reveng-item46-project";
        const content = readCommittedFileContent(
            new Path(decayedCwd),
            new Date(commitInstant),
            new Path(join(decayedCwd, "orders.py")),
            [new Path(repoB)],
        );
        // the committed bytes come back — the fallback chain survives a dead recorded cwd.
        assert.equal(content, committedBytes);
    } finally {
        rmSync(repoB, { recursive: true, force: true });
    }
});

test("test_find_fallback_repo_dirs_orders_override_before_preserved", () => {
    // Steps:
    // build a transcript dir that ALSO carries a preserved repo clone (a .git next to the jsonl).
    const transcriptDir = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        mkdirSync(join(transcriptDir, ".git"));
        const jsonlPath = join(transcriptDir, "session.jsonl");
        writeFileSync(jsonlPath, JSON.stringify({ type: RecordType.aiTitle, aiTitle: "t" }) + "\n");
        // load the records from the file so each carries its source (findPreservedRepoDir reads it).
        const { records } = loadTranscript(jsonlPath);
        // set both path overrides.
        setPathOverrides({ repoDir: new Path("/override/repo"), projectCwd: new Path("/override/cwd") });
        // the fallback list is most-explicit first: repoDir, projectCwd, preserved clone.
        const dirs = findFallbackRepoDirs(records).map((dir) => dir.toString());
        assert.deepEqual(dirs, ["/override/repo", "/override/cwd", transcriptDir]);
    } finally {
        rmSync(transcriptDir, { recursive: true, force: true });
    }
});

