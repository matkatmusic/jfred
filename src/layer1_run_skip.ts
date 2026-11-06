// Task 358 part R: why a run is not replayed, and why a replay failed, in plain words.

import { WireScriptLanguage } from "../webapp/layer1-components/details-drawer/layer1-script-language.ts";
import { isTimestampAtOrBeforeSkippedBaseline } from "./reconstruction_base_commit.ts";
import { ScriptExecutorKind, type ScriptRun } from "./reconstruction_script_execution.ts";
import { isScriptCodeWriteCapable } from "./reconstruction_script_prestate.ts";
import { SANDBOX_TIMEOUT_MS } from "./reconstruction_script_sandbox_dir.ts";
import type { SandboxOutput } from "./reconstruction_script_sandbox_memo.ts";
import type { Path } from "./structures/domain.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";

const REPLAYED_LANGUAGES: readonly string[] = [WireScriptLanguage.python, WireScriptLanguage.python3];
const STDERR_TAIL_LINES = 3;

export const BOX_BLOCKED_REASON_PREFIX = "This script needs something the Docker box blocks: network, a file outside the copied folder, or another program.";

// A pattern with a capture group names a path: it counts only when the path is outside the mount.
export const BOX_BLOCK_SIGNATURES: readonly RegExp[] = [
  /Network is unreachable/,
  /Temporary failure in name resolution/,
  /Name or service not known/,
  /(?:FileNotFoundError|No such file or directory)[^\n]*?'(\/[^']*)'/,
];

export function isReplayedLanguage(language: string | undefined): boolean {
  return language === undefined || REPLAYED_LANGUAGES.includes(language);
}

function findKindSkipReason(run: ScriptRun): string | undefined {
  const isBash = run.executorKind === ScriptExecutorKind.bash;
  if (isBash) {
    return "Bash scripts are not replayed.";
  }
  const isLanguageReplayed = isReplayedLanguage(run.language);
  if (!isLanguageReplayed) {
    return `Language ${run.language} is not replayed.`;
  }
  return undefined;
}

function findCodeSkipReason(run: ScriptRun): string | undefined {
  const isWriteCapable = isScriptCodeWriteCapable(run.code);
  if (!isWriteCapable) {
    return "This script only reads files, so it is not replayed.";
  }
  const isBeforeBaseline = isTimestampAtOrBeforeSkippedBaseline(run.timestamp, getPathOverrides());
  if (isBeforeBaseline) {
    return "This script ran at or before the base commit, so it is not replayed.";
  }
  return undefined;
}

export function findRunSkipReason(run: ScriptRun): string | undefined {
  return findKindSkipReason(run) ?? findCodeSkipReason(run);
}

function isInsideMount(file: string, mount: Path): boolean {
  return file === mount.toString() || file.startsWith(`${mount.toString()}/`);
}

function isSignatureBlocking(signature: RegExp, stderr: string, mount: Path): boolean {
  const match = signature.exec(stderr);
  if (match === null) {
    return false;
  }
  const namedFile = match[1];
  if (namedFile === undefined) {
    return true;
  }
  return !isInsideMount(namedFile, mount);
}

export function isBlockedByBox(stderr: string, mount: Path): boolean {
  for (const signature of BOX_BLOCK_SIGNATURES) {
    const isBlocking = isSignatureBlocking(signature, stderr, mount);
    if (isBlocking) {
      return true;
    }
  }
  return false;
}

function formatStderrTail(stderr: string): string {
  const lines = stderr.trim().split("\n");
  return lines.slice(-STDERR_TAIL_LINES).join(" ");
}

export function formatReplayFailure(output: SandboxOutput, mount: Path): string {
  if (output.timedOut) {
    return `The script ran longer than ${SANDBOX_TIMEOUT_MS / 1000} seconds and was stopped.`;
  }
  const tail = formatStderrTail(output.stderr);
  const isBlocked = isBlockedByBox(output.stderr, mount);
  if (isBlocked) {
    return `${BOX_BLOCKED_REASON_PREFIX} ${tail}`;
  }
  return `The script stopped with exit code ${output.exitCode}. ${tail}`;
}
