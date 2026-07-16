// The executed-scenario transcripts the tests read from. Each `<scenario>_JSONL` constant resolves its
// transcript by SCENARIO DIRECTORY NAME, not by a hard-coded uuid filename: re-running a scenario writes
// a fresh `<uuid>.jsonl` (new uuid, new timestamps) into the same dir, so binding to the dir survives every
// re-run while binding to the uuid path breaks the whole suite. `findScenarioJsonl` scans the known roots
// (the repo's scenarios/executed submodule checkout) for the dir and returns its single
// `*.jsonl`. The legacy m1–m7 scenarios were folded into the sequential numbering as s46–s52 by the re-run,
// so the M*_JSONL constants point at those dirs.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../src/structures/domain.ts";
import { resolveScenarioDir, listScenarioJsonlPaths } from "./utilities.ts";

// Where executed scenarios live: the repo's scenarios submodule checkout, derived from this
// file's location so the suite works from any clone (same derivation as check_scenario_coverage).
const SCENARIO_ROOTS = [
    fileURLToPath(new URL("../scenarios/executed", import.meta.url)),
] as const;

// A scenario's transcript JSONL, found by dir name. Searches each root in order and returns the first
// `*.jsonl` (sorted) in the first dir that has one. Single-session scenarios (every fixture a test actually
// reads) hold exactly one; multi-session scenarios (/clear, git-baseline, concurrent) hold several — those
// are reconstructed by merging ALL of a dir's jsonl via the coverage suite (scripts/coverage_scenarios.ts),
// so this single-transcript resolver is only for the legacy single-session per-scenario fixtures. Throws
// (loudly, at import) only when the dir is missing everywhere — a clear failure beats an opaque ENOENT.
export function findScenarioJsonl(dirName: string): string {
    for (const root of SCENARIO_ROOTS) {
        const dir = join(root, dirName);
        let jsonls: string[];
        try {
            jsonls = readdirSync(dir).filter((name) => name.endsWith(".jsonl")).sort();
        } catch {
            continue;
        }
        if (jsonls.length > 0) {
            return join(dir, jsonls[0]!);
        }
    }
    throw new Error(`scenario ${dirName}: no .jsonl found under known roots`);
}

export const S1_JSONL = findScenarioJsonl("s1-delete-file");
export const S2_JSONL = findScenarioJsonl("s2-move-file");
export const S3_JSONL = findScenarioJsonl("s3-copy-file");
export const S4_JSONL = findScenarioJsonl("s4-overwrite-file");
export const S5_JSONL = findScenarioJsonl("s5-bash-redirect");
export const S6_JSONL = findScenarioJsonl("s6-git-mv");
export const S7_JSONL = findScenarioJsonl("s7-minimal-code-restore");
export const S8_JSONL = findScenarioJsonl("s8-repeated-code-restore-rewinds");
export const S9_JSONL = findScenarioJsonl("s9-code-restore-no-post-edit");
export const S10_JSONL = findScenarioJsonl("s10-conv-only-no-post-edit");
export const S11_JSONL = findScenarioJsonl("s11-write-code-restore-rewrite");
export const S12_JSONL = findScenarioJsonl("s12-write-conv-only-rewrite");
export const S13_JSONL = findScenarioJsonl("s13-multi-edit-code-restore-read");
export const S14_JSONL = findScenarioJsonl("s14-multi-edit-conv-only-read");
export const S15_JSONL = findScenarioJsonl("s15-user-edit-then-conv-rewind");
export const S16_JSONL = findScenarioJsonl("s16-multi-edit-code-restore-re-edit");
export const S17_JSONL = findScenarioJsonl("s17-multi-edit-conv-only-re-edit");
export const S18_JSONL = findScenarioJsonl("s18-user-edit-no-rewind");
export const S19_JSONL = findScenarioJsonl("s19-user-edit-conv-rewind");
export const S20_JSONL = findScenarioJsonl("s20-user-edit-code-rewind");
export const S21_JSONL = findScenarioJsonl("s21-multiple-user-edits");
export const S22_JSONL = findScenarioJsonl("s22-user-edits-conv-rewind");
export const S23_JSONL = findScenarioJsonl("s23-user-edits-code-rewind");

// m1–m7 were renumbered to s46–s52 by the all-scenario re-run; the M*_JSONL names are kept for the
// existing m-series tests but resolve to the new sequential dirs.
export const M1_JSONL = findScenarioJsonl("s46-cp-fork");
export const M2_JSONL = findScenarioJsonl("s47-mv-rename");
export const M3_JSONL = findScenarioJsonl("s48-bash-redirect");
export const M4_JSONL = findScenarioJsonl("s49-delete-recreate");
export const M5_JSONL = findScenarioJsonl("s50-full-interleave");
export const M6_JSONL = findScenarioJsonl("s51-cp-user-edit-rewind");
export const M7_JSONL = findScenarioJsonl("s52-conv-rewind-no-user-edits");

export const S24_JSONL = findScenarioJsonl("s24-script-rename-functions");
export const S25_JSONL = findScenarioJsonl("s25-script-rename-multi-file");
export const S26_JSONL = findScenarioJsonl("s26-script-rename-csv-map");
export const S27_JSONL = findScenarioJsonl("s27-script-rename-edited-before-run");
export const S28_JSONL = findScenarioJsonl("s28-script-rename-scope");
export const S29_JSONL = findScenarioJsonl("s29-script-rename-repo-walk");
export const S30_JSONL = findScenarioJsonl("s30-script-rename-count-mismatch");
export const S31_JSONL = findScenarioJsonl("s31-script-rename-many-rows");
export const S32_JSONL = findScenarioJsonl("s32-script-rename-mcp-exec");
export const S33_JSONL = findScenarioJsonl("s33-script-rename-csv-user-edit");
export const S34_JSONL = findScenarioJsonl("s34-script-rename-driver-back-and-forth");
export const S35_JSONL = findScenarioJsonl("s35-script-rename-script-user-edit");
export const S36_JSONL = findScenarioJsonl("s36-script-rename-csv-user-edit-mcp");
export const S37_JSONL = findScenarioJsonl("s37-script-rename-driver-back-and-forth-mcp");
export const S38_JSONL = findScenarioJsonl("s38-script-rename-script-user-edit-mcp");

// s39+ are the `git-baseline` family; see plans/ and the per-scenario ground-truth notes for the full
// scenario shapes. They resolve from the in-worktree capture root like every other scenario.
export const S39_JSONL = findScenarioJsonl("s39-git-baseline-seed");
export const S39_PROJECT_DIR: Path = new Path(resolveScenarioDir(SCENARIO_ROOTS, "s39-git-baseline-seed"));
export const S39_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S39_PROJECT_DIR);
export const S40_JSONL = findScenarioJsonl("s40-git-baseline-user-edits");
// s40 is multi-session (two interleaved transcripts); the timeline suite must build from BOTH, so it
// exposes the dir + full path list like s84/s85, not just the single-transcript S40_JSONL above.
export const S40_PROJECT_DIR: Path = new Path(resolveScenarioDir(SCENARIO_ROOTS, "s40-git-baseline-user-edits"));
export const S40_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S40_PROJECT_DIR);
export const S41_JSONL = findScenarioJsonl("s41-git-baseline-mid-commit");
// s41 is multi-session (excluded baseline + mid-stream); the git-operations suite builds from BOTH
// transcripts, so it exposes the dir + full path list like s39/s40.
export const S41_PROJECT_DIR: Path = new Path(resolveScenarioDir(SCENARIO_ROOTS, "s41-git-baseline-mid-commit"));
export const S41_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S41_PROJECT_DIR);
export const S42_JSONL = findScenarioJsonl("s42-git-baseline-from-s38");
export const S43_JSONL = findScenarioJsonl("s43-git-baseline-uncommitted-module");
// s43 is multi-session too; the blob-snapshot endpoint test scans BOTH transcripts for
// file-history-snapshot records, so it exposes the dir + full path list.
export const S43_PROJECT_DIR: Path = new Path(resolveScenarioDir(SCENARIO_ROOTS, "s43-git-baseline-uncommitted-module"));
export const S43_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S43_PROJECT_DIR);
export const S44_JSONL = findScenarioJsonl("s44-git-baseline-then-rename");
export const S45_JSONL = findScenarioJsonl("s45-rewind-abandoned-branch");

// s84/s85 are multi-file PROJECT fixtures for the revision-timeline suite: tests build the unified
// document from every JSONL in the scenario dir, so these expose the dir and the full path list.
export const S84_PROJECT_DIR: Path = new Path(resolveScenarioDir(SCENARIO_ROOTS, "s84-multiagent-scripts-git-baseline"));
export const S84_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S84_PROJECT_DIR);
export const S85_PROJECT_DIR: Path = new Path(resolveScenarioDir(SCENARIO_ROOTS, "s85-git-commit-csv-and-move-scripts"));
export const S85_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S85_PROJECT_DIR);

