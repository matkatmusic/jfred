// Renders a file's revisions as a full line-state view (--verbose). Pure functions; no IO.

import type { FileRevision, LineEntry } from "./reconstruction_events.ts";
import { EventKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";

// A line's believed content right now is the last value in its history.
export function getCurrentText(entry: LineEntry): string {
  return entry.values[entry.values.length - 1]!.line;
}

function renderNumberedLine(entry: LineEntry, index: number): string {
  return `  ${String(index + 1).padStart(4)} | ${getCurrentText(entry)}`;
}

function renderNumberedLines(lines: LineEntry[]): string {
  const rendered: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    rendered.push(renderNumberedLine(lines[index]!, index));
  }
  return rendered.join("\n");
}

// Describe a path transition as `from → to`.
export function renderPathArrow(transition: { from: Path; to: Path }): string {
  return `${transition.from} → ${transition.to}`;
}

function renderRevisionState(revision: FileRevision, index: number): string {
  const stamp = revision.timestamp.toISOString();
  const rename = revision.rename;
  const copy = revision.copy;
  const isRename = revision.kind === EventKind.rename && rename !== undefined;
  if (isRename) {
    return `revision ${index}  rename  ${renderPathArrow(rename)}  @ ${stamp}`;
  }
  const isCopy = revision.kind === EventKind.copy && copy !== undefined;
  if (isCopy) {
    const count = revision.lines.length;
    const header = `revision ${index}  copy  ${renderPathArrow(copy)}  @ ${stamp}  (${count} lines)`;
    const body = renderNumberedLines(revision.lines);
    return `${header}\n${body}`;
  }
  const count = revision.lines.length;
  const header = `revision ${index}  @ ${stamp}  (${count} lines)`;
  if (count === 0) {
    return `${header}\n  (file absent — 0 lines)`;
  }
  const body = renderNumberedLines(revision.lines);
  return `${header}\n${body}`;
}

// Render each revision's full line state (the --verbose view).
export function renderVerbose(revisions: FileRevision[]): string {
  const states: string[] = [];
  for (let index = 0; index < revisions.length; index++) {
    states.push(renderRevisionState(revisions[index]!, index));
  }
  return states.join("\n\n");
}
