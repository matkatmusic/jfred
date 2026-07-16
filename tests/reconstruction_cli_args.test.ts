import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCliPathOverrides, parseArgs } from "../src/reconstruction_cli_args.ts";
import {
    getPathOverrides,
    setPathOverrides,
    PROJECT_PATHS_CONFIG_NAME,
    type WireProjectPaths,
} from "../src/reconstruction_overrides.ts";

// A transcript path is required; without one, parseArgs reports usage.
test("test_parse_args_requires_a_transcript_path", () => {
    assert.throws(() => parseArgs(["--verbose"]), /usage/);
});

// parseArgs reads the path, an optional --target, and the view flags.
test("test_parse_args_reads_path_target_and_flags", () => {
    const options = parseArgs(["t.jsonl", "--target", "/a/b.py", "--diff"]);
    assert.equal(options.jsonlPath, "t.jsonl");
    assert.equal(options.target?.toString(), "/a/b.py");
    assert.equal(options.diff, true);
    assert.equal(options.verbose, false);
});

// parseArgs reads all four item-46 path-override flags, each landing as a typed domain value; the
// positional transcript path is still found (flag values are never mistaken for it).
test("test_parse_args_extracts_path_override_flags", () => {
    // Step: parse an argv carrying every override flag plus the positional transcript path.
    const options = parseArgs([
        "--file-history-loc", "/data/file-history",
        "--cwd", "/now/project",
        "--repo", "/now/repo",
        "--base-commit", "abc1234",
        "t.jsonl",
    ]);
    // Step: the positional path survives the flag extraction untouched.
    assert.equal(options.jsonlPath, "t.jsonl");
    // Step: each flag value is hydrated into its domain type (Path/Uuid), not left a bare string.
    assert.equal(options.fileHistoryRoot?.toString(), "/data/file-history");
    assert.equal(options.projectCwd?.toString(), "/now/project");
    assert.equal(options.repoDir?.toString(), "/now/repo");
    assert.equal(options.baseCommit?.toString(), "abc1234");
});

// The --fhsLoc alias alone populates fileHistoryRoot (mirror of the --target/--file alias pattern).
test("test_parse_args_accepts_fhs_alias", () => {
    // Step: parse an argv where the file-history root arrives ONLY via the alias spelling.
    const options = parseArgs(["t.jsonl", "--fhsLoc", "/data/file-history"]);
    // Step: the alias lands in the same fileHistoryRoot field, hydrated as a Path.
    assert.equal(options.fileHistoryRoot?.toString(), "/data/file-history");
});

// Build a temp <root>/projects/<project>/session.jsonl tree, optionally dropping a reveng-paths.json
// config beside the project dir. Returns the transcript path applyCliPathOverrides will derive from.
function makeProjectsTree(projectName: string, config?: Record<string, WireProjectPaths>): string {
    const projectsDir = join(mkdtempSync(join(tmpdir(), "item46-cli-")), "projects");
    mkdirSync(join(projectsDir, projectName), { recursive: true });
    const jsonlPath = join(projectsDir, projectName, "session.jsonl");
    writeFileSync(jsonlPath, "");
    if (config !== undefined) {
        writeFileSync(join(projectsDir, PROJECT_PATHS_CONFIG_NAME), JSON.stringify(config));
    }
    return jsonlPath;
}

describe("applyCliPathOverrides", () => {
    // Every test here mutates the process-wide override state; always reset it.
    afterEach(() => setPathOverrides({}));

    // The projects-folder config entry is the base and direct CLI flags win per-field: the config's
    // cwd survives while the flag's repo replaces the config's repo.
    test("test_apply_cli_path_overrides_merges_config_under_flags", () => {
        // Step: a projects tree whose reveng-paths.json gives this project a cwd AND a repo.
        const jsonlPath = makeProjectsTree("-Users-me-proj", {
            "-Users-me-proj": { cwd: "/config/cwd", repo: "/config/repo" },
        });
        // Step: the CLI run supplies ONLY --repo, with a different value than the config's.
        const options = parseArgs([jsonlPath, "--repo", "/flag/repo"]);
        applyCliPathOverrides(options);
        // Step: the config's cwd survives (no flag contested it).
        assert.equal(getPathOverrides().projectCwd?.toString(), "/config/cwd");
        // Step: the flag's repo wins over the config's repo.
        assert.equal(getPathOverrides().repoDir?.toString(), "/flag/repo");
    });

    // With no config file and no flags, applying the overrides is a no-op: the state stays {}.
    test("test_apply_cli_path_overrides_no_ops_without_config_or_flags", () => {
        // Step: a projects tree WITHOUT a reveng-paths.json.
        const jsonlPath = makeProjectsTree("-Users-me-proj");
        // Step: a bare CLI run — no override flags at all.
        const options = parseArgs([jsonlPath]);
        applyCliPathOverrides(options);
        // Step: the override state deep-equals the empty default (no stray defined fields).
        assert.deepEqual(getPathOverrides(), {});
    });
});
