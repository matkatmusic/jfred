// Crafted one-session transcripts on disk for the task 358 run tests.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { executeRunReplay } from "../src/layer1_run_replay.ts";
import { loadReplayRun, type ReplayInput, type RunInput } from "../src/layer1_run_start_files.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { getReconstructionCounterSnapshot, resetReconstructionCounters } from "../src/reconstruction_counters.ts";
import { computeSandboxInputKey } from "../src/reconstruction_script_sandbox.ts";
import { buildSandboxBox } from "../src/reconstruction_script_sandbox_box.ts";
import { setSandboxMemoPersistence } from "../src/reconstruction_script_sandbox_memo.ts";
import { buildReadRecordPair, buildWriteRecordPair, type RecordEnvelope } from "./tool-call-record-pair-builders.ts";

export const RUN_SESSION_ID = "cccccccc-1111-2222-3333-444444444444";
export const APPEND_Z_SCRIPT = 'text = open("a.txt").read()\nopen("a.txt", "w").write(text + "z\\n")\n';
export const APPEND_Y_SCRIPT = 'text = open("a.txt").read()\nopen("a.txt", "w").write(text + "y\\n")\n';

export const OPTIONS = { timeout: 120000 };

export interface CraftedProject {
  dir: string;
  records: object[];
}

export function createCraftedProject(): CraftedProject {
  return { dir: mkdtempSync(join(tmpdir(), "run-project-")), records: [] };
}

function buildEnvelope(project: CraftedProject, toolId: string, second: number): RecordEnvelope {
  const timestamp = `2026-07-24T10:00:${String(second).padStart(2, "0")}.000Z`;
  return { sessionId: RUN_SESSION_ID, cwd: project.dir, timestamp, toolId, parentUuid: null };
}

export function addWrite(project: CraftedProject, toolId: string, second: number, fileName: string, content: string): void {
  project.records.push(...buildWriteRecordPair(buildEnvelope(project, toolId, second), join(project.dir, fileName), content).records);
}

export function addFullRead(project: CraftedProject, toolId: string, second: number, fileName: string, content: string): void {
  const lines = content.split("\n").length - 1;
  const window = { startLine: 1, numLines: lines, totalLines: lines };
  project.records.push(...buildReadRecordPair(buildEnvelope(project, toolId, second), join(project.dir, fileName), content, window).records);
}

// A script run: one assistant tool_use, plus an is_error result when `isErrored`.
export function addScriptRun(project: CraftedProject, toolId: string, second: number, input: object, options: { toolName?: string; isErrored?: boolean } = {}): void {
  const envelope = buildEnvelope(project, toolId, second);
  const block = { type: "tool_use", id: toolId, name: options.toolName ?? ToolName.CtxExecute, input: { cwd: project.dir, ...input } };
  const base = { sessionId: RUN_SESSION_ID, timestamp: envelope.timestamp, cwd: project.dir };
  project.records.push({ ...base, type: "assistant", uuid: `${toolId}-a`, parentUuid: null, message: { role: "assistant", content: [block] } });
  if (options.isErrored === true) {
    const result = { type: "tool_result", tool_use_id: toolId, content: "boom", is_error: true };
    project.records.push({ ...base, type: "user", uuid: `${toolId}-r`, parentUuid: `${toolId}-a`, message: { role: "user", content: [result] }, toolUseResult: "boom" });
  }
}

export function writeProjectFile(project: CraftedProject, fileName: string, content: string): void {
  writeFileSync(join(project.dir, fileName), content);
}

export function resetRunState(): void {
  setSandboxMemoPersistence(undefined);
  resetReconstructionCounters();
}

export function countSpawns(): number {
  return getReconstructionCounterSnapshot().sandboxSpawns ?? 0;
}

export async function collectReplay(input: ReplayInput, signal: AbortSignal = new AbortController().signal) {
  const progress: ProgressEvent[] = [];
  const outputs: string[] = [];
  function pushProgress(event: ProgressEvent): void {
    progress.push(event);
  }
  function pushOutput(_stream: unknown, text: string): void {
    outputs.push(text);
  }
  const result = await executeRunReplay(input, pushProgress, pushOutput, signal);
  return { result, progress, outputs };
}

// Write a.txt (s1), run T (s5), then `extend` adds the proof after the run.
export function createCraftedSession(code: string, extend: (project: CraftedProject) => void = () => {}) {
  const project = createCraftedProject();
  addWrite(project, "toolu_w", 1, "a.txt", "a\n");
  addScriptRun(project, "toolu_T", 5, { code });
  extend(project);
  return { project, input: writeCraftedSession(project, "toolu_T") };
}

// A git repo with one commit made before every crafted run (those start at 2026-07-24T10:00).
export function createCraftedGitRepo(): Path {
  const repo = mkdtempSync(join(tmpdir(), "run-git-repo-"));
  const commitEnvironment = { ...process.env, GIT_AUTHOR_DATE: "2026-07-24T09:00:00Z", GIT_COMMITTER_DATE: "2026-07-24T09:00:00Z" };
  writeFileSync(join(repo, "tracked.txt"), "tracked\n");
  execFileSync("git", ["init", "--quiet", repo]);
  execFileSync("git", ["-C", repo, "add", "tracked.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "first"], { env: commitEnvironment });
  return new Path(repo);
}

// The memo key the lineage and the live run both use for one run of the session.
export function computeBoxedRunKey(input: RunInput, toolUseId: string, preState: Map<string, string>): string {
  const { run } = loadReplayRun({ ...input, toolUseId: new Uuid(toolUseId) });
  return computeSandboxInputKey(run.code, preState, run.cwd, buildSandboxBox(run, input.repoPath));
}

// A real git repo with no commit, so the box finds no project copy.
function createEmptyCraftedGitRepo(): Path {
  const repo = mkdtempSync(join(tmpdir(), "run-empty-repo-"));
  execFileSync("git", ["init", "--quiet", repo]);
  return new Path(repo);
}

// Writes the transcript under a projects folder (so the file-history sibling resolves) and returns a run input.
export function writeCraftedSession(project: CraftedProject, toolUseId: string): ReplayInput {
  const treeRoot = mkdtempSync(join(tmpdir(), "run-session-tree-"));
  const projectDir = join(treeRoot, "projects", "-run-session");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(treeRoot, "file-history"));
  const sessionFile = new Path(join(projectDir, "a.jsonl"));
  const recordLines: string[] = [];
  for (const record of project.records) {
    recordLines.push(JSON.stringify(record));
  }
  writeFileSync(sessionFile.toString(), recordLines.join("\n") + "\n");
  const repoPath = createEmptyCraftedGitRepo();
  return { sessionFile, toolUseId: new Uuid(toolUseId), dir: new Path(project.dir), sources: undefined, sessionFiles: [sessionFile], repoPath };
}
