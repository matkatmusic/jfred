// Executed-scenario transcripts, bound by scenario dir name so re-runs (new uuid files) keep working.

import { Path } from "../src/structures/domain.ts";
import {
  SCENARIO_ROOTS,
  findScenarioDir,
  findScenarioJsonl,
  listScenarioJsonlPaths,
} from "./scenario-locator.ts";

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

// m1–m7 were renumbered to s46–s52; the M*_JSONL names resolve to the new dirs.
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

// s39+ are the `git-baseline` family, resolved from the in-worktree capture root.
export const S39_JSONL = findScenarioJsonl("s39-git-baseline-seed");
export const S39_PROJECT_DIR: Path = new Path(findScenarioDir(SCENARIO_ROOTS, "s39-git-baseline-seed"));
export const S39_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S39_PROJECT_DIR);
export const S40_JSONL = findScenarioJsonl("s40-git-baseline-user-edits");
// s40 is multi-session: the timeline suite builds from both transcripts.
export const S40_PROJECT_DIR: Path = new Path(findScenarioDir(SCENARIO_ROOTS, "s40-git-baseline-user-edits"));
export const S40_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S40_PROJECT_DIR);
export const S41_JSONL = findScenarioJsonl("s41-git-baseline-mid-commit");
// s41 is multi-session: the git-operations suite builds from both transcripts.
export const S41_PROJECT_DIR: Path = new Path(findScenarioDir(SCENARIO_ROOTS, "s41-git-baseline-mid-commit"));
export const S41_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S41_PROJECT_DIR);
export const S42_JSONL = findScenarioJsonl("s42-git-baseline-from-s38");
export const S43_JSONL = findScenarioJsonl("s43-git-baseline-uncommitted-module");
// s43 is multi-session: the blob-snapshot endpoint test scans both transcripts.
export const S43_PROJECT_DIR: Path = new Path(findScenarioDir(SCENARIO_ROOTS, "s43-git-baseline-uncommitted-module"));
export const S43_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S43_PROJECT_DIR);
export const S44_JSONL = findScenarioJsonl("s44-git-baseline-then-rename");
export const S45_JSONL = findScenarioJsonl("s45-rewind-abandoned-branch");

// s84/s85 are multi-file project fixtures: tests build from every JSONL in the dir.
export const S84_PROJECT_DIR: Path = new Path(findScenarioDir(SCENARIO_ROOTS, "s84-multiagent-scripts-git-baseline"));
export const S84_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S84_PROJECT_DIR);
export const S85_PROJECT_DIR: Path = new Path(findScenarioDir(SCENARIO_ROOTS, "s85-git-commit-csv-and-move-scripts"));
export const S85_JSONL_PATHS: Path[] = listScenarioJsonlPaths(S85_PROJECT_DIR);
