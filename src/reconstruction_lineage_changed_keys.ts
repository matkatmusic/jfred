// Changed state keys of memoized script executions, matched against lineage paths.

import type { RunExecution } from "./reconstruction_script_runs.ts";
import { isJunkStateKey } from "./reconstruction_script_sandbox.ts";

// The state keys one memoized execution changed, created, or deleted.
function computeChangedStateKeys(execution: RunExecution): string[] {
  if (execution.post === undefined) {
    return [];
  }
  const unionKeys = new Set([...execution.pre.keys(), ...execution.post.keys()]);
  const changedKeys: string[] = [];
  for (const key of unionKeys) {
    const isJunk = isJunkStateKey(key);
    const preValue = execution.pre.get(key);
    const postValue = execution.post.get(key);
    if (isJunk) {
      continue;
    }
    if (preValue === postValue) {
      continue;
    }
    changedKeys.push(key);
  }
  return changedKeys;
}

const changedKeysByExecution = new WeakMap<RunExecution, string[]>();

// Computed once per execution object — the full-content comparison is what makes a per-query diff too expensive.
export function getChangedStateKeysOnce(execution: RunExecution): string[] {
  let changedKeys = changedKeysByExecution.get(execution);
  if (changedKeys === undefined) {
    changedKeys = computeChangedStateKeys(execution);
    changedKeysByExecution.set(execution, changedKeys);
  }
  return changedKeys;
}

// A state key matches if it equals the path or the path ends with "/<key>".
export function isAnyKeyOnLineagePath(stateKeys: string[], lineagePathStrings: string[]): boolean {
  for (const stateKey of stateKeys) {
    for (const pathString of lineagePathStrings) {
      const isExactMatch = pathString === stateKey;
      const isSuffixMatch = pathString.endsWith(`/${stateKey}`);
      const isMatch = isExactMatch || isSuffixMatch;
      if (isMatch) {
        return true;
      }
    }
  }
  return false;
}
