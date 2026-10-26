// The static read-only gate (TASKS.md item 68) plus pre-execution file-state seeding for a run.

import { BlockType, EventKind, ToolName } from "./structures/vocabulary.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";
import { readWriteInput } from "./structures/tool-result-shapes.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { backupSeedWriteFor, type BackupReader } from "./reconstruction_sidecar.ts";
import { relative } from "node:path";
import { quotedFilename } from "./regex_expressions.ts";
import { pythonWritePrimitive, shellWritePrimitive } from "./regex_script_detection.ts";
import { isEveryImportReadOnlySafe, isEveryOpenCallRead } from "./reconstruction_script_prestate_gate.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { buildRenameChain, resolveFinalPath } from "./reconstruction_lineage.ts";
import type { WriteEvent } from "./reconstruction_events.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { formatRunSource, type ScriptRun } from "./reconstruction_script_execution.ts";
import { extractPathBasename } from "./reconstruction_script_indirection.ts";
import {
  ReconstructionCounter,
  incrementReconstructionCounter,
} from "./reconstruction_counters.ts";


// Whether the script could change files; unparseable code counts as may-write. ponytail: raw-text scan, aliased builtins evade it.
export function isScriptCodeWriteCapable(code: string): boolean {
  if (shellWritePrimitive.test(code))
    return true;
  if (pythonWritePrimitive.test(code))
    return true;
  if (!isEveryImportReadOnlySafe(code))
    return true;
  if (!isEveryOpenCallRead(code))
    return true;
  return false;
}

function findPathByBasename(records: TranscriptRecord[], basename: string): Path | undefined {
  const erroredIds = collectErroredToolUseIds(records);
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      if (block.type !== BlockType.tool_use)
        continue;
      if (block.name === ToolName.Write) {
        if (erroredIds.has(block.id.toString()))
          continue;
        const { filePath } = readWriteInput(block);
        if (extractPathBasename(filePath.toString()) === basename)
          return filePath;
        continue;
      }
      const filePath = (block.input as { file_path?: string }).file_path;
      if (filePath !== undefined && extractPathBasename(filePath) === basename)
        return new Path(filePath);
    }
  }
  return undefined;
}


// All file-path-like quoted strings in the script source (e.g. "billing.py", "renames.csv").
export function parseScriptFileRefs(code: string): string[] {
  const matches = code.match(quotedFilename) ?? [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

// Undefined when the lineage has no revision strictly before that instant.
export type LineageContentBefore = (target: Path, before: Date) => string | undefined;

// The name the script itself uses: cwd-relative when under cwd (so subdirectories survive), else the flat basename.
export function computeScriptStateKey(filePath: Path, runCwd: Path | undefined): string {
  if (runCwd !== undefined) {
    const cwdRelativePath = relative(runCwd.toString(), filePath.toString());
    if (cwdRelativePath !== "" && !cwdRelativePath.startsWith("..")) {
      return cwdRelativePath;
    }
  }
  return extractPathBasename(filePath.toString());
}

// Files Written before the run, plus backup-only referenced files, keyed by the script's relative name.
export function getPreExecutionState(
  run: ScriptRun,
  records: TranscriptRecord[],
  reader: BackupReader,
  seedContent?: LineageContentBefore,
): Map<string, string> {
  incrementReconstructionCounter(ReconstructionCounter.preStateBuilds);
  reportReconstructionProgress(`building pre-execution state for run @ ${run.timestamp.toISOString()}${formatRunSource(run)}`);
  const events = extractFileEvents(records);
  const renameChain = buildRenameChain(events);
  const state = new Map<string, string>();
  // Task 192 Phase 3: delete then set keeps map order equal to final-Write order.
  const latestWritesByCurrentPath = new Map<string, { currentPath: Path; write: WriteEvent }>();
  for (const event of events) {
    if (event.kind !== EventKind.write)
      continue;
    if (event.timestamp.getTime() > run.timestamp.getTime())
      continue;
    const currentPath = resolveFinalPath(event.target, renameChain);
    const pathKey = currentPath.toString();
    latestWritesByCurrentPath.delete(pathKey);
    latestWritesByCurrentPath.set(pathKey, { currentPath, write: event });
  }
  for (const { currentPath, write } of latestWritesByCurrentPath.values()) {
    // Priority order: lineage (post-backup edits, earlier runs), then current-name backup, then rename-source backup, then the authored Write.
    const content = seedContent?.(currentPath, run.timestamp)
            ?? backupSeedWriteFor(records, currentPath, run.timestamp, reader)?.content
            ?? backupSeedWriteFor(records, write.target, run.timestamp, reader)?.content
            ?? write.content;
    state.set(computeScriptStateKey(currentPath, run.cwd), content);
  }
  for (const ref of parseScriptFileRefs(run.code)) {
    if (state.has(ref))
      continue;
    const absolutePath = findPathByBasename(records, extractPathBasename(ref));
    if (absolutePath === undefined)
      continue;
    const content = seedContent?.(absolutePath, run.timestamp)
            ?? backupSeedWriteFor(records, absolutePath, run.timestamp, reader)?.content;
    if (content !== undefined)
      state.set(ref, content);
  }
  return state;
}
