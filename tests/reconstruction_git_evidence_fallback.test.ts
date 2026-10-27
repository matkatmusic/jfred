import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findFallbackRepoDirs, readCommittedFileContent } from "../src/reconstruction_git_evidence.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";

// Path overrides are process-wide state: reset them so no test leaks into the next (item 46).
afterEach(() => {
    setPathOverrides({});
});

test("test_readCommittedFileContent_falls_back_to_a_preserved_repo_when_the_recorded_cwd_decays", () => {
    // Scenario (s85 regression): the recorded cwd's repo decayed, so read the blob from the preserved clone.
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

test("test_read_committed_file_content_tries_each_fallback_repo_dir", () => {
    // Steps: build repo B, a relocated mirror of the recorded repo, with one commit of orders.py.
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
        // read via a NONEXISTENT recorded cwd with a matching layout, using repo B as fallback.
        const decayedCwd = "/nonexistent/reveng-item46-project";
        const content = readCommittedFileContent(
            new Path(decayedCwd),
            new Date(commitInstant),
            new Path(join(decayedCwd, "orders.py")),
            [new Path(repoB)],
        );
        // the committed bytes come back: the fallback chain survives a dead recorded cwd.
        assert.equal(content, committedBytes);
    } finally {
        rmSync(repoB, { recursive: true, force: true });
    }
});

test("test_find_fallback_repo_dirs_orders_override_before_preserved", () => {
    // Steps: build a transcript dir that also holds a preserved repo clone (.git next to the jsonl).
    const transcriptDir = mkdtempSync(join(tmpdir(), "reveng-git-"));
    try {
        mkdirSync(join(transcriptDir, ".git"));
        const jsonlPath = join(transcriptDir, "session.jsonl");
        writeFileSync(jsonlPath, JSON.stringify({ type: RecordType.aiTitle, aiTitle: "t" }) + "\n");
        // load the records from the file so each carries its source.
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
