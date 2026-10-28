// Run detection lives in reconstruction_script_execution.ts, pre-execution seeding in reconstruction_script_prestate.ts.

import { Path } from "./structures/domain.ts";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { getMemoizedSandboxOutcome, storeSandboxOutcome } from "./reconstruction_script_sandbox_memo.ts";
import {
  ReconstructionCounter,
  incrementReconstructionCounter,
} from "./reconstruction_counters.ts";

function readAllFiles(dir: string, base: string = dir): [string, string][] {
  const files: [string, string][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const entryIsDirectory = entry.isDirectory();
    const entryIsFile = entry.isFile();
    if (entryIsDirectory) {
      files.push(...readAllFiles(full, base));
    }
    else if (entryIsFile) {
      files.push([relative(base, full), readFileSync(full, "utf8")]);
    }
  }
  return files;
}

// The script's first line, capped, so a progress line identifies which run is executing.
function formatScriptForProgress(script: string): string {
  const firstLine = script.split("\n", 1)[0] ?? "";
  if (firstLine.length <= 60) {
    return firstLine;
  }
  return `${firstLine.slice(0, 59)}…`;
}

export const PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX = "running script in sandbox";
export const PROGRESS_LABEL_SANDBOX_MEMO_PREFIX = "reusing sandbox result";

// Python bytecode caches are sandbox artifacts no scenario tracks; canonical filter for all callers.
export function isJunkStateKey(key: string): boolean {
  return key.includes("__pycache__") || key.endsWith(".pyc");
}

// Hashes the script plus sorted seeded (path, content) pairs, plus cwd since remapping changes the script.
function computeSandboxInputKey(script: string, preState: Map<string, string>, recordedCwd?: Path): string {
  const hash = createHash("sha256");
  hash.update(script);
  if (recordedCwd !== undefined) {
    hash.update("\0cwd\0");
    hash.update(recordedCwd.toString());
  }
  const sortedPaths = [...preState.keys()].sort();
  for (const path of sortedPaths) {
    hash.update("\0");
    hash.update(path);
    hash.update("\0");
    hash.update(preState.get(path)!);
  }
  return hash.digest("hex");
}

export function executeScriptAgainstState(
  script: string,
  preState: Map<string, string>,
  sourceLabel = "",
  recordedCwd?: Path,
): Map<string, string> | undefined {
  const inputKey = computeSandboxInputKey(script, preState, recordedCwd);
  const memoizedOutcome = getMemoizedSandboxOutcome(inputKey);
  if (memoizedOutcome !== undefined) {
    incrementReconstructionCounter(ReconstructionCounter.sandboxMemoHits);
    reportReconstructionProgress(
      `${PROGRESS_LABEL_SANDBOX_MEMO_PREFIX}${sourceLabel}: ${formatScriptForProgress(script)}`,
    );
    return memoizedOutcome.post;
  }
  reportReconstructionProgress(
    `${PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX} (${preState.size} seeded files)${sourceLabel}: ${formatScriptForProgress(script)}`,
  );
  incrementReconstructionCounter(ReconstructionCounter.sandboxSpawns);
  const post = spawnSandboxRun(script, preState, recordedCwd);
  storeSandboxOutcome(inputKey, post);
  return post;
}

// Seeds a temp dir, runs python3, reads back the tree; remaps a hardcoded cwd so scripts stay inside.
function spawnSandboxRun(
  script: string,
  preState: Map<string, string>,
  recordedCwd?: Path,
): Map<string, string> | undefined {
  const tempDir = mkdtempSync(join(tmpdir(), "reveng-"));
  try {
    for (const [relativePath, content] of preState) {
      const dest = join(tempDir, relativePath);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
    const remappedScript =
      recordedCwd === undefined ? script : script.replaceAll(recordedCwd.toString(), tempDir);
    writeFileSync(join(tempDir, "__script__.py"), remappedScript);
    execSync("python3 __script__.py", { cwd: tempDir, timeout: 5000, stdio: "pipe" });
    const result = new Map<string, string>();
    for (const [relativePath, content] of readAllFiles(tempDir)) {
      if (relativePath === "__script__.py")
        continue;
      result.set(relativePath, content);
    }
    return result;
  }
  catch {
    return undefined;
  }
  finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
