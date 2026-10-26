// Script-file indirection: a run that only calls a written script file really runs that file's Write body.

import { BlockType, ToolName } from "./structures/vocabulary.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks, type ContentBlock } from "./structures/content-blocks.ts";
import { collectErroredToolUseIds } from "./structures/tool-results.ts";
import { readWriteInput } from "./structures/tool-result-shapes.ts";
import { singleWhitespace } from "./regex_expressions.ts";
import { ScriptExecutorKind, type ScriptRun } from "./reconstruction_script_execution.ts";

// The final path segment of a "/"-separated path string.
export function extractPathBasename(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

// One Write of a script file: its time and body. Rewrites keep every body.
type WrittenScriptBody = { timestamp: Date | undefined; content: string | undefined };

// Every Write body per file name, each with its time. One pass over the records.
function collectWrittenContentOfBlock(block: ContentBlock, timestamp: Date | undefined, writtenBodiesByBasename: Map<string, WrittenScriptBody[]>, erroredIds: Set<string>): void {
  if (block.type !== BlockType.tool_use) {
    return;
  }
  if (block.name !== ToolName.Write) {
    return;
  }
  if (erroredIds.has(block.id.toString())) {
    return;
  }
  const { filePath, content } = readWriteInput(block);
  const basename = extractPathBasename(filePath.toString());
  const bodies = writtenBodiesByBasename.get(basename);
  if (bodies === undefined) {
    writtenBodiesByBasename.set(basename, [{ timestamp, content }]);
    return;
  }
  bodies.push({ timestamp, content });
}

export function collectWrittenContentByBasename(records: TranscriptRecord[]): Map<string, WrittenScriptBody[]> {
  const writtenBodiesByBasename = new Map<string, WrittenScriptBody[]>();
  const erroredIds = collectErroredToolUseIds(records);
  for (const record of records) {
    for (const block of getContentBlocks(record)) {
      collectWrittenContentOfBlock(block, record.timestamp, writtenBodiesByBasename, erroredIds);
    }
  }
  return writtenBodiesByBasename;
}

// The latest body written at or before `when`, else the first body.
function findBodyAtInstant(bodies: WrittenScriptBody[], when: Date): string | undefined {
  let best: WrittenScriptBody | undefined;
  for (const body of bodies) {
    if (body.timestamp === undefined) {
      continue;
    }
    if (body.timestamp.getTime() > when.getTime()) {
      continue;
    }
    if (best === undefined) {
      best = body;
      continue;
    }
    if (body.timestamp.getTime() >= best.timestamp!.getTime()) {
      best = body;
    }
  }
  if (best !== undefined) {
    return best.content;
  }
  return bodies[0]?.content;
}

// The script file extensions we resolve through indirection.
const SCRIPT_EXTENSIONS = [".py", ".sh", ".js", ".ts"];

// Whether a filename ends with a known script extension.
function isScriptFile(name: string): boolean {
  for (const ext of SCRIPT_EXTENSIONS) {
    if (name.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

// Extract the invoked script filename from a direct-invocation command like `python3 script.py`, `bash script.sh`, `node script.js`, `npx tsx script.ts`.
function parseDirectInvocation(code: string): string | undefined {
  const runners = ["python3", "python", "bash", "sh", "node", "npx tsx"];
  for (const runner of runners) {
    if (!code.includes(runner)) {
      continue;
    }
    const after = code.slice(code.indexOf(runner) + runner.length).trimStart();
    // first word after the runner, e.g. "apply.py --dry-run" -> "apply.py".
    const filename = after.split(singleWhitespace)[0] ?? "";
    if (isScriptFile(filename)) {
      return filename;
    }
  }
  return undefined;
}

// Extract the script filename from an exec(open()) wrapper like `exec(open("rename_inv.py").read())` — the MCP ctx_execute form.
function parseExecOpenIndirection(code: string): string | undefined {
  const marker = 'exec(open("';
  let start = code.indexOf(marker);
  if (start < 0) {
    start = code.indexOf("exec(open('");
    if (start < 0) {
      return undefined;
    }
    start += "exec(open('".length;
  }
  else {
    start += marker.length;
  }
  const end = code.indexOf('"', start) !== -1 ? code.indexOf('"', start) : code.indexOf("'", start);
  if (end < 0) {
    return undefined;
  }
  const filename = code.slice(start, end);
  return isScriptFile(filename) ? filename : undefined;
}

// Replace a run's code with the body of the script file it calls, if any.
export function applyScriptIndirection(run: ScriptRun, writtenBodiesByBasename: Map<string, WrittenScriptBody[]>): ScriptRun {
  const filename = parseDirectInvocation(run.code) ?? parseExecOpenIndirection(run.code);
  if (filename === undefined) {
    return run;
  }
  const bodies = writtenBodiesByBasename.get(extractPathBasename(filename));
  if (bodies === undefined) {
    return run;
  }
  const body = findBodyAtInstant(bodies, run.timestamp);
  if (body === undefined) {
    return run;
  }
  // A bash run of a written .py file counts as Python. Other runs keep their kind.
  const resolvesToPython = run.executorKind === ScriptExecutorKind.bash && filename.endsWith(".py");
  const executorKind = resolvesToPython ? ScriptExecutorKind.python : run.executorKind;
  // A flip to python must also rewrite the language, or a shell-language run would keep reading as shell.
  const language = resolvesToPython ? "python" : run.language;
  return { ...run, code: body, executorKind, ...(language === undefined ? {} : { language }), invokedScriptFile: extractPathBasename(filename) };
}
