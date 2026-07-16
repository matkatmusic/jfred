import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { RepoSnapshot } from "../src/reconstruction_steps.ts";
import type { ProvenanceEntry } from "../src/reconstruction_provenance.ts";
import { checkScenario, renderStepProvenance } from "../scripts/check_scenario_coverage.ts";
import {
    findCoveredScenarios,
    listCoveredScenarios,
    buildUuidLineIndex,
    readStepStateFiles,
    type CoveredScenario,
} from "../scripts/coverage_scenarios.ts";
import { firstLineDifference, selectBestEngineStep } from "../scripts/coverage_compare.ts";
import { S19_JSONL } from "./fixtures.ts";

// The repo root and the executed-scenarios root, derived from this test file's location.
const REPO = fileURLToPath(new URL("../", import.meta.url));
const EXECUTED_ROOT = new URL("../scenarios/executed/", import.meta.url);
const S19_STEP_STATES = join(REPO, "scenarios/executed/s19-user-edit-conv-rewind/.step_states");
const S2_STEP_001 = join(REPO, "scenarios/executed/s2-move-file/.step_states/step-001");
const BROKEN_STEP_STATES = join(REPO, "tests/fixtures/broken-step-states/.step_states");

// A snapshot built from plain string paths, for the pure selectBestEngineStep test.
function snapshotOf(entries: Record<string, string>): RepoSnapshot {
    return new Map(Object.entries(entries).map(([path, text]) => [new Path(path), text]));
}

test("test_findCoveredScenarios_returns_only_dirs_that_contain_step_states", () => {
    // Behavior: every returned scenario points at a real `.step_states` dir.
    const covered = findCoveredScenarios(EXECUTED_ROOT);
    assert.ok(covered.length > 0, "expected at least one covered scenario");
    for (const scenario of covered) {
        assert.ok(scenario.stepStatesDir.endsWith(".step_states"), scenario.stepStatesDir);
    }
});

test("test_findCoveredScenarios_includes_s19", () => {
    // Behavior: s19 (one jsonl + a .step_states dir) is discovered, with its scenario id parsed.
    const covered = findCoveredScenarios(EXECUTED_ROOT);
    const s19 = covered.find((scenario) => scenario.dirName === "s19-user-edit-conv-rewind");
    assert.ok(s19, "s19 should be covered");
    assert.equal(s19!.scenarioId, "s19");
});

test("test_buildUuidLineIndex_maps_a_record_uuid_to_its_one_based_line_number", () => {
    // Behavior: a record's uuid maps to its true 1-based line number (the first uuid-bearing line, since the
    // transcript may open with a uuid-less meta line).
    const index = buildUuidLineIndex([new Path(S19_JSONL)]);
    const lines = readFileSync(S19_JSONL, "utf8").split("\n");
    const firstUuidLine = lines.findIndex((line) => {
        try {
            return typeof (JSON.parse(line) as { uuid?: unknown }).uuid === "string";
        } catch {
            return false;
        }
    });
    const uuid = JSON.parse(lines[firstUuidLine]!).uuid as string;
    // Verify: that uuid is indexed at its 1-based line number.
    assert.equal(index.get(uuid), firstUuidLine + 1);
});

test("test_readStepStateFiles_includes_source_files_and_excludes_manifest_and_caches", () => {
    // Behavior: source files (including nested tests/) are read; manifest.json is excluded.
    const files = readStepStateFiles(S2_STEP_001);
    assert.ok(files.has("s2_original.py"), "should include the source file");
    assert.ok([...files.keys()].some((key) => key.startsWith("tests/")), "should include nested tests/ file");
    assert.ok(!files.has("manifest.json"), "should exclude manifest.json");
});

test("test_firstLineDifference_returns_the_first_differing_line", () => {
    // Behavior: the first line that differs is reported with its 1-based number and both sides.
    const diff = firstLineDifference("a\nb\nc", "a\nX\nc");
    assert.deepEqual(diff, { lineNo: 2, expected: "b", actual: "X" });
});

test("test_firstLineDifference_returns_undefined_when_texts_are_equal", () => {
    // Behavior: identical texts have no first difference.
    assert.equal(firstLineDifference("a\nb", "a\nb"), undefined);
});

test("test_selectBestEngineStep_returns_the_step_reproducing_the_most_files", () => {
    // Behavior: the step reproducing the most ground-truth files is chosen (step 1 reproduces both).
    const groundTruth = new Map([["a.py", "X\n"], ["b.py", "Y\n"]]);
    const steps: RepoSnapshot[] = [
        snapshotOf({ "/t/a.py": "X" }),
        snapshotOf({ "/t/a.py": "X", "/t/b.py": "Y" }),
    ];
    assert.equal(selectBestEngineStep(steps, groundTruth), 1);
});

test("test_checkScenario_reports_every_step_passes_for_s19", () => {
    // Behavior: s19 is the known-good control — every captured step folder is reproduced by some engine step.
    const scenario: CoveredScenario = {
        scenarioId: "s19",
        dirName: "s19-user-edit-conv-rewind",
        jsonlPaths: [new Path(S19_JSONL)],
        stepStatesDir: S19_STEP_STATES,
    };
    const result = checkScenario(scenario);
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches));
    assert.equal(result.passed, result.total);
});

// The discovered CoveredScenario for a scenario id, reproducing the sweep's own discovery exactly (all
// session jsonls merged, the real .step_states dir). Used for the recoverable-gap scenarios — git-baseline
// s40/s41 especially, whose baseline session must come through the SAME discovery, never hand-excluded.
function discoverScenario(scenarioId: string): CoveredScenario {
    const scenario = listCoveredScenarios().find((covered) => covered.scenarioId === scenarioId);
    assert.ok(scenario, `${scenarioId} should be a covered scenario`);
    return scenario!;
}

test("test_checkScenario_reports_every_step_passes_for_s28", () => {
    // Behavior: every captured step folder of s28 (scoped script rename) is reproduced by some engine step —
    // catalog_view.py's renamed-no-preview state (load_catalog) is recovered, not the stale pre-rename load_all.
    const result = checkScenario(discoverScenario("s28"));
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches));
    assert.equal(result.passed, result.total);
});

test("test_checkScenario_reports_every_step_passes_for_s40", () => {
    // Behavior: every captured step folder of s40 (git-baseline user edits) is reproduced — orders.py's
    // intermediate "# reviewed by ops"-only state becomes its own revision, not coalesced into the final echo.
    const result = checkScenario(discoverScenario("s40"));
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches));
    assert.equal(result.passed, result.total);
});

test("test_checkScenario_reports_every_step_passes_for_s41", () => {
    // Behavior: every captured step folder of s41 (git-baseline mid-commit) is reproduced — same intermediate
    // reviewed-only orders.py revision as s40, surfaced from the distinct earlier in-window backup.
    const result = checkScenario(discoverScenario("s41"));
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches));
    assert.equal(result.passed, result.total);
});

test("test_checkScenario_reports_every_step_passes_for_s34", () => {
    // Behavior: every captured step folder of s34 (script-rename driver-back-and-forth) is reproduced.
    // The rename runs via `python3 apply_renames.py` (an indirected Bash script), so the clean
    // post-rename ledger.py (record_entry, no comment) is computed by script replay and surfaces as
    // its own revision — the out-of-band "# names normalized via rename script" append is NOT spliced
    // onto that clean step's ledger.py.
    const result = checkScenario(discoverScenario("s34"));
    assert.equal(result.mismatches.length, 0, JSON.stringify(result.mismatches));
    assert.equal(result.passed, result.total);
});

test("test_renderStepProvenance_keeps_only_entries_for_the_differing_file_at_or_before_the_step", () => {
    // Behavior: only entries whose target is the differing file AND whose backup time is at or before the
    // step are kept; other files and later backups are dropped.
    const stepTime = new Date("2026-01-01T00:00:10Z");
    const entries: ProvenanceEntry[] = [
        { stage: "completeElidedBeacons", target: new Path("/t/pkg/a.py"), detail: "kept entry", when: new Date("2026-01-01T00:00:05Z") },
        { stage: "seedStaleEditBases", target: new Path("/t/pkg/b.py"), detail: "other file", when: new Date("2026-01-01T00:00:05Z") },
        { stage: "completeTruncatedBeacon", target: new Path("/t/pkg/a.py"), detail: "too late", when: new Date("2026-01-01T00:00:20Z") },
    ];
    const rendered = renderStepProvenance(entries, "pkg/a.py", stepTime);
    // Verify: the on-file, in-time entry is kept; the other-file and after-step entries are dropped.
    assert.ok(rendered.includes("completeElidedBeacons") && rendered.includes("kept entry"));
    assert.ok(!rendered.includes("other file"));
    assert.ok(!rendered.includes("too late"));
});

test("test_renderStepProvenance_returns_empty_string_when_no_entry_matches", () => {
    // Behavior: no matching entry yields the empty string (nothing to append to the mismatch).
    assert.equal(renderStepProvenance([], "pkg/a.py", new Date("2026-01-01T00:00:10Z")), "");
});

test("test_checkScenario_reports_a_mismatch_with_the_broken_fixture", () => {
    // Behavior: the deliberately-wrong step-001 (scenario19.py mangled) is reported as a mismatch with the
    // folder number, the differing file in the diff, and a JSONL-line lead.
    const scenario: CoveredScenario = {
        scenarioId: "s19",
        dirName: "broken-step-states",
        jsonlPaths: [new Path(S19_JSONL)],
        stepStatesDir: BROKEN_STEP_STATES,
    };
    const result = checkScenario(scenario);
    assert.ok(result.mismatches.length >= 1, "expected a mismatch");
    const mismatch = result.mismatches[0]!;
    assert.equal(mismatch.stepNum, 1);
    assert.ok(mismatch.diff.includes("scenario19.py"), `diff should name the file: ${mismatch.diff}`);
    assert.ok(mismatch.jsonlLine.length > 0, "jsonlLine should be set");
});

