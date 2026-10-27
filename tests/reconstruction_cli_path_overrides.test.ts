import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/reconstruction_cli_args.ts";
import { applyCliPathOverrides } from "../src/reconstruction_cli_path_overrides.ts";
import {
    getPathOverrides,
    setPathOverrides,
    PROJECT_PATHS_CONFIG_NAME,
    type WireProjectPaths,
} from "../src/reconstruction_overrides.ts";
import {
    isPreBaselineReconstructionAllowed,
    setPreBaselineReconstructionAllowed,
} from "../src/reconstruction_base_commit.ts";

// Build a temp <root>/projects/<project>/session.jsonl tree, optionally dropping a reveng-paths.json config beside the project dir. Returns the transcript path applyCliPathOverrides will derive from.
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

    // The projects-folder config entry is the base and direct CLI flags win per-field: the config's cwd survives while the flag's repo replaces the config's repo.
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

test("test_apply_cli_overrides_derives_sources_from_multi_root_positionals", () => {
    // Scenario (spec S4b): positionals spanning two DISTINCT projects roots, with no config sources, derive one bare {projectsDir} source per root so per-source sibling file-history resolution works with zero config.  Step: two copied-out-of-~/.claude trees, one transcript path in each.
    const treeA = mkdtempSync(join(tmpdir(), "cli-sources-a-"));
    const treeB = mkdtempSync(join(tmpdir(), "cli-sources-b-"));
    const projectDirA = join(treeA, "projects", "-proj-a");
    const projectDirB = join(treeB, "projects", "-proj-b");
    mkdirSync(projectDirA, { recursive: true });
    mkdirSync(projectDirB, { recursive: true });
    const options = parseArgs([join(projectDirA, "a.jsonl"), join(projectDirB, "b.jsonl")]);
    // Test action: apply the overrides for this run.
    applyCliPathOverrides(options);
    // Test verification: one derived source per distinct projects root, positional order.
    const sources = getPathOverrides().sources;
    assert.equal(sources?.length, 2);
    assert.equal(sources?.[0]?.projectsDir.toString(), join(treeA, "projects"));
    assert.equal(sources?.[1]?.projectsDir.toString(), join(treeB, "projects"));
    setPathOverrides({});
});

test("test_apply_cli_overrides_single_positional_leaves_sources_absent", () => {
    // Scenario (spec S4b): single-source invocations stay unchanged — no derived sources.
    const tree = mkdtempSync(join(tmpdir(), "cli-sources-single-"));
    const projectDir = join(tree, "projects", "-proj");
    mkdirSync(projectDir, { recursive: true });
    const options = parseArgs([join(projectDir, "t.jsonl")]);
    applyCliPathOverrides(options);
    assert.equal(getPathOverrides().sources, undefined);
    setPathOverrides({});
});

test("test_apply_cli_overrides_declines_pre_baseline_reconstruction", () => {
    // Scenario (task 223): applying the options is what reaches the engine's module-level gate, so a re-seeded CLI iteration reconstructs only forward from its own seed.
    const tree = mkdtempSync(join(tmpdir(), "cli-pre-baseline-"));
    const projectDir = join(tree, "projects", "-proj");
    mkdirSync(projectDir, { recursive: true });
    try {
        applyCliPathOverrides(parseArgs([join(projectDir, "t.jsonl"), "--no-pre-baseline"]));
        assert.equal(isPreBaselineReconstructionAllowed(), false);
        // Test verification: the gate is shared module state, so the NEXT in-process run must not inherit the declined answer.
        applyCliPathOverrides(parseArgs([join(projectDir, "t.jsonl")]));
        assert.equal(isPreBaselineReconstructionAllowed(), true);
    } finally {
        setPreBaselineReconstructionAllowed(true);
        setPathOverrides({});
    }
});
