// View model for the split diff view: unified diff text -> left/right row structures, plus helpers shared with the inline view. Pure — no DOM.

// Discriminates split-view rows: full-width (hunk headers, preamble, non-diff text) vs left/right pairs inside a hunk.
export const SplitRowKind = Object.freeze({ full: "full", pair: "pair" } as const);

type SplitCell = { text: string; lineClass: string; lineNumber?: number };
type SplitRow =
    | { kind: typeof SplitRowKind.full; text: string; lineClass: string }
    | { kind: typeof SplitRowKind.pair; left: SplitCell | undefined; right: SplitCell | undefined };

// The unified-diff line prefixes that classify a line for inline/full-width coloring.
export function computeFullRowLineClass(line: string): string {
  const isHunkHeader = line.startsWith("@@");
  if (isHunkHeader) {
    return "diff-line-hunk";
  }
  const isAddition = line.startsWith("+");
  if (isAddition) {
    return "diff-line-add";
  }
  const isDeletion = line.startsWith("-");
  if (isDeletion) {
    return "diff-line-del";
  }
  return "";
}

// The standard numeric hunk header the server's context renderer emits inside a revision block; groups 1/2 are the 1-based old/new start lines that seed the gutter counters.  git omits ",count" when a side's count is 1, so each count is optional (item 51).  const NUMERIC_HUNK_HEADER = /^@@ -(\d+),\d+ \+(\d+),\d+ @@/;  // item 51: pre-git mandatory counts
export const NUMERIC_HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// A split-view cell; lineNumber is set only when a numeric hunk header has seeded that side.
function buildSplitCell(text: string, lineClass: string, lineNumber: number | undefined): SplitCell {
  const cell: SplitCell = { text, lineClass };
  if (lineNumber !== undefined) {
    cell.lineNumber = lineNumber;
  }
  return cell;
}

// Pushes one zipped deletion/addition pair row; either side may be undefined when the runs have unequal lengths.
function pushPendingPairRow(rows: SplitRow[], pendingDeletions: SplitCell[], pendingAdditions: SplitCell[], pairIndex: number): void {
  rows.push({
    kind: SplitRowKind.pair,
    left: pendingDeletions[pairIndex],
    right: pendingAdditions[pairIndex],
  });
}

// Unified diff text -> rows for the two-column split view. Deletion/addition runs are zipped row-by-row; the one-char unified prefix is stripped inside hunk cells; "@@ -a,b +c,d @@" headers seed the per-side line-number counters shown in the gutters.
export function computeSplitRows(diffText: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let pendingDeletions: SplitCell[] = [];
  let pendingAdditions: SplitCell[] = [];
  let insideHunk = false;
  let oldLineCounter: number | undefined = undefined;
  let newLineCounter: number | undefined = undefined;
  const getNextOldLineNumber = () => {
    if (oldLineCounter === undefined) {
      return undefined;
    }
    return oldLineCounter++;
  };
  const getNextNewLineNumber = () => {
    if (newLineCounter === undefined) {
      return undefined;
    }
    return newLineCounter++;
  };
  const appendPendingPairRows = () => {
    const pairCount = Math.max(pendingDeletions.length, pendingAdditions.length);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
      pushPendingPairRow(rows, pendingDeletions, pendingAdditions, pairIndex);
    }
    pendingDeletions = [];
    pendingAdditions = [];
  };
  for (const line of diffText.split("\n")) {
    const isHunkHeader = line.startsWith("@@");
    if (isHunkHeader) {
      appendPendingPairRows();
      insideHunk = true;
      const numericHeader = NUMERIC_HUNK_HEADER.exec(line);
      oldLineCounter = numericHeader === null ? undefined : Number(numericHeader[1]);
      newLineCounter = numericHeader === null ? undefined : Number(numericHeader[2]);
      rows.push({ kind: SplitRowKind.full, text: line, lineClass: "diff-line-hunk" });
      continue;
    }
    if (!insideHunk) {
      rows.push({ kind: SplitRowKind.full, text: line, lineClass: computeFullRowLineClass(line) });
      continue;
    }
    const isDeletion = line.startsWith("-");
    if (isDeletion) {
      pendingDeletions.push(buildSplitCell(line.slice(1), "diff-line-del", getNextOldLineNumber()));
      continue;
    }
    const isAddition = line.startsWith("+");
    if (isAddition) {
      pendingAdditions.push(buildSplitCell(line.slice(1), "diff-line-add", getNextNewLineNumber()));
      continue;
    }
    appendPendingPairRows();
    const hasContextPrefix = line.startsWith(" ");
    const contextText = hasContextPrefix ? line.slice(1) : line;
    rows.push({
      kind: SplitRowKind.pair,
      left: buildSplitCell(contextText, "", getNextOldLineNumber()),
      right: buildSplitCell(contextText, "", getNextNewLineNumber()),
    });
  }
  appendPendingPairRows();
  return rows;
}
