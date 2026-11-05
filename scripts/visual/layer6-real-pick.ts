// Task 358 step 1: finds one real python run that replays, over HTTP, and prints timings.

import { WireRunOutcome, type WireNeededRun, type WireScriptNeedsReply } from "../../webapp/layer1-wire-script-results.ts";
import { type WireScriptRunsView } from "../../webapp/layer1-wire-script-runs.ts";
import { findRunById, getFirstCodeLine } from "./layer4-real-helpers.ts";
import {
  MAX_CANDIDATES, formatNeedsLine, formatOutcomeCounts, formatRunLine, isAttempted, isReplayWithoutFile,
  listCandidateRuns, parseStreamResult, type ReplayAttempt,
} from "./layer6-real-helpers.ts";

export interface WireTarget { origin: string; query: string }
export interface RunRef { sessionFile: string; toolUseId: string }
export interface RealScript extends RunRef { changedPaths: string[] }

async function sendJson(target: WireTarget, path: string, body: object): Promise<Response> {
  const headers = { "Content-Type": "application/json" };
  return await fetch(`${target.origin}${path}?${target.query}`, { method: "POST", headers, body: JSON.stringify(body) });
}

export async function fetchRunsView(target: WireTarget): Promise<WireScriptRunsView> {
  const response = await fetch(`${target.origin}/api/layer1-script-runs?${target.query}`);
  if (!response.ok) {
    throw new Error(`/api/layer1-script-runs answered ${response.status}: ${await response.text()}`);
  }
  return await response.json() as WireScriptRunsView;
}

async function fetchNeeds(target: WireTarget, run: RunRef): Promise<WireNeededRun[]> {
  const startedAt = Date.now();
  const response = await sendJson(target, "/api/layer1-script-needs", { sessionFile: run.sessionFile, toolUseId: run.toolUseId });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`/api/layer1-script-needs answered ${response.status}: ${text}`);
  }
  const reply = JSON.parse(text) as WireScriptNeedsReply;
  console.log(formatNeedsLine(run.toolUseId, reply.needs.length, Date.now() - startedAt));
  return reply.needs;
}

async function sendRunRequest(target: WireTarget, run: RunRef): Promise<ReplayAttempt> {
  const startedAt = Date.now();
  const body = { sessionFile: run.sessionFile, toolUseId: run.toolUseId, allowScripts: true };
  const response = await sendJson(target, "/api/layer1-script-run", body);
  const result = parseStreamResult(await response.text());
  const attempt = { toolUseId: run.toolUseId, outcome: result.outcome, ms: Date.now() - startedAt, result };
  console.log(formatRunLine(attempt));
  const isEmptyReplay = isReplayWithoutFile(result);
  if (isEmptyReplay) {
    console.log(`replayed run changed no file: ${run.toolUseId}`);
  }
  return attempt;
}

// Replays what the needs route lists, one at a time; false when a needed run did not replay.
export async function executeNeededRuns(target: WireTarget, run: RunRef, attempts: ReplayAttempt[]): Promise<boolean> {
  for (let step = 0; step < MAX_CANDIDATES; step += 1) {
    const first = (await fetchNeeds(target, run))[0];
    if (first === undefined) {
      return true;
    }
    const attempt = await sendRunRequest(target, first);
    attempts.push(attempt);
    if (attempt.outcome !== WireRunOutcome.replayed) {
      return false;
    }
  }
  throw new Error(`needs route still lists runs for ${run.toolUseId} after ${MAX_CANDIDATES} replays`);
}

function printPicked(view: WireScriptRunsView, attempt: ReplayAttempt, attempts: ReplayAttempt[], pairPaths: Set<string>): RealScript {
  const run = findRunById(view, attempt.toolUseId);
  if (run === undefined) {
    throw new Error(`picked run ${attempt.toolUseId} is not in the payload`);
  }
  console.log(`real jot script: ${attempt.toolUseId}, first code line: ${getFirstCodeLine(run.code)}`);
  for (const file of attempt.result.files) {
    console.log(`  file ${file.path}: ${file.confidence}`);
  }
  console.log(`python runs tried: ${attempts.length} (${formatOutcomeCounts(attempts)})`);
  console.log(`replayed runs whose changed files are all outside the pairs: ${countReplaysOutsidePairs(attempts, pairPaths)}`);
  // const changedPaths = attempt.result.files.map((file) => file.path);
  const changedPaths = listPairChangedPaths(attempt, pairPaths);
  return { sessionFile: run.sessionFile, toolUseId: run.toolUseId, changedPaths };
}

async function executeCandidate(target: WireTarget, run: RunRef, attempts: ReplayAttempt[]): Promise<void> {
  const isClear = await executeNeededRuns(target, run, attempts);
  const isNew = !isAttempted(attempts, run.toolUseId);
  const isReady = isClear && isNew;
  if (isReady) {
    attempts.push(await sendRunRequest(target, run));
  }
}

// The page draws dots only on pair bubbles; orphan-bucket files get none.
async function fetchPairPaths(target: WireTarget): Promise<Set<string>> {
  const response = await fetch(`${target.origin}/api/layer1-view?${target.query}`);
  if (!response.ok) {
    throw new Error(`/api/layer1-view answered ${response.status}: ${await response.text()}`);
  }
  const body = await response.json() as { pairs: { path: string }[] };
  return new Set(body.pairs.map((pair) => pair.path));
}

function listPairChangedPaths(attempt: ReplayAttempt, pairPaths: Set<string>): string[] {
  return attempt.result.files.map((file) => file.path).filter((path) => pairPaths.has(path));
}

function findReplayedAttemptWithPairFile(attempts: ReplayAttempt[], pairPaths: Set<string>): ReplayAttempt | undefined {
  for (const attempt of attempts) {
    const isReplayed = attempt.outcome === WireRunOutcome.replayed;
    if (isReplayed) {
      const hasPairFile = listPairChangedPaths(attempt, pairPaths).length > 0;
      if (hasPairFile) {
        return attempt;
      }
    }
  }
  return undefined;
}

function countReplaysOutsidePairs(attempts: ReplayAttempt[], pairPaths: Set<string>): number {
  let count = 0;
  for (const attempt of attempts) {
    const isReplayed = attempt.outcome === WireRunOutcome.replayed;
    const hasFile = attempt.result.files.length > 0;
    const hasPairFile = listPairChangedPaths(attempt, pairPaths).length > 0;
    const isOutsideOnly = isReplayed && hasFile && !hasPairFile;
    if (isOutsideOnly) {
      count += 1;
    }
  }
  return count;
}

export async function findRealScript(target: WireTarget, view: WireScriptRunsView): Promise<RealScript> {
  const pairPaths = await fetchPairPaths(target);
  const attempts: ReplayAttempt[] = [];
  for (const run of listCandidateRuns(view).slice(0, MAX_CANDIDATES)) {
    await executeCandidate(target, run, attempts);
    const picked = findReplayedAttemptWithPairFile(attempts, pairPaths);
    if (picked !== undefined) {
      return printPicked(view, picked, attempts, pairPaths);
    }
  }
  const outsideCount = countReplaysOutsidePairs(attempts, pairPaths);
  throw new Error(`none of the first ${MAX_CANDIDATES} python runs replayed with a changed file that is a pair in /api/layer1-view (a bubble with dots): ${outsideCount} replayed runs changed files only outside the pairs;${formatOutcomeCounts(attempts)}`);
}
