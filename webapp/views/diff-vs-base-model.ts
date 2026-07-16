// View models for the diff-vs-base view: unified diff text -> split/inline row structures,
// plus the shared diff display-mode vocabulary and its stored-value resolution. Pure — no DOM.

// Discriminates split-view rows: full-width (hunk headers, preamble, non-diff text) vs
// left/right pairs inside a hunk.
export const SplitRowKind = Object.freeze({ full: "full", pair: "pair" } as const);

type SplitCell = { text: string; lineClass: string; lineNumber?: number };
type SplitRow =
    | { kind: typeof SplitRowKind.full; text: string; lineClass: string }
    | { kind: typeof SplitRowKind.pair; left: SplitCell | undefined; right: SplitCell | undefined };

// The unified-diff line prefixes that classify a line for inline/full-width coloring.
function computeFullRowLineClass(line: string): string {
    if (line.startsWith("@@")) {
        return "diff-line-hunk";
    }
    if (line.startsWith("+")) {
        return "diff-line-add";
    }
    if (line.startsWith("-")) {
        return "diff-line-del";
    }
    return "";
}

// The standard numeric hunk header the server's context renderer emits inside a revision
// block; groups 1/2 are the 1-based old/new start lines that seed the gutter counters.
// git omits ",count" when a side's count is 1, so each count is optional (item 51).
// const NUMERIC_HUNK_HEADER = /^@@ -(\d+),\d+ \+(\d+),\d+ @@/;  // item 51: pre-git mandatory counts
const NUMERIC_HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// A split-view cell; lineNumber is set only when a numeric hunk header has seeded that side.
function buildSplitCell(text: string, lineClass: string, lineNumber: number | undefined): SplitCell {
    const cell: SplitCell = { text, lineClass };
    if (lineNumber !== undefined) {
        cell.lineNumber = lineNumber;
    }
    return cell;
}

// Unified diff text -> rows for the two-column split view. Deletion/addition runs are zipped
// row-by-row; the one-char unified prefix is stripped inside hunk cells; "@@ -a,b +c,d @@"
// headers seed the per-side line-number counters shown in the gutters.
export function computeSplitRows(diffText: string): SplitRow[] {
    const rows: SplitRow[] = [];
    let pendingDeletions: SplitCell[] = [];
    let pendingAdditions: SplitCell[] = [];
    let insideHunk = false;
    let oldLineCounter: number | undefined = undefined;
    let newLineCounter: number | undefined = undefined;
    const takeOldLineNumber = () => {
        if (oldLineCounter === undefined) {
            return undefined;
        }
        return oldLineCounter++;
    };
    const takeNewLineNumber = () => {
        if (newLineCounter === undefined) {
            return undefined;
        }
        return newLineCounter++;
    };
    const flushPendingChanges = () => {
        const pairCount = Math.max(pendingDeletions.length, pendingAdditions.length);
        for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
            rows.push({
                kind: SplitRowKind.pair,
                left: pendingDeletions[pairIndex],
                right: pendingAdditions[pairIndex],
            });
        }
        pendingDeletions = [];
        pendingAdditions = [];
    };
    for (const line of diffText.split("\n")) {
        if (line.startsWith("@@")) {
            flushPendingChanges();
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
        if (line.startsWith("-")) {
            pendingDeletions.push(buildSplitCell(line.slice(1), "diff-line-del", takeOldLineNumber()));
            continue;
        }
        if (line.startsWith("+")) {
            pendingAdditions.push(buildSplitCell(line.slice(1), "diff-line-add", takeNewLineNumber()));
            continue;
        }
        flushPendingChanges();
        const contextText = line.startsWith(" ") ? line.slice(1) : line;
        rows.push({
            kind: SplitRowKind.pair,
            left: buildSplitCell(contextText, "", takeOldLineNumber()),
            right: buildSplitCell(contextText, "", takeNewLineNumber()),
        });
    }
    flushPendingChanges();
    return rows;
}

// One rendered inline-view line; number fields are set only when a numeric hunk header has
// seeded that side's counter (item 40).
export type InlineRow = { text: string; lineClass: string; oldLineNumber?: number; newLineNumber?: number };

// Unified diff text -> inline rows in original line order, raw prefixes kept. "@@ -a,b +c,d @@"
// headers seed the per-side counters; "-" advances old only, "+" advances new only, context
// inside a hunk advances both; preamble lines and headers carry no numbers.
export function computeInlineRows(diffText: string): InlineRow[] {
    const rows: InlineRow[] = [];
    let insideHunk = false;
    let oldLineCounter: number | undefined = undefined;
    let newLineCounter: number | undefined = undefined;
    for (const line of diffText.split("\n")) {
        if (line.startsWith("@@")) {
            insideHunk = true;
            const numericHeader = NUMERIC_HUNK_HEADER.exec(line);
            oldLineCounter = numericHeader === null ? undefined : Number(numericHeader[1]);
            newLineCounter = numericHeader === null ? undefined : Number(numericHeader[2]);
            rows.push({ text: line, lineClass: "diff-line-hunk" });
            continue;
        }
        const row: InlineRow = { text: line, lineClass: computeFullRowLineClass(line) };
        if (insideHunk && line.startsWith("-") && oldLineCounter !== undefined) {
            row.oldLineNumber = oldLineCounter++;
        }
        if (insideHunk && line.startsWith("+") && newLineCounter !== undefined) {
            row.newLineNumber = newLineCounter++;
        }
        if (insideHunk && !line.startsWith("-") && !line.startsWith("+")) {
            if (oldLineCounter !== undefined) {
                row.oldLineNumber = oldLineCounter++;
            }
            if (newLineCounter !== undefined) {
                row.newLineNumber = newLineCounter++;
            }
        }
        rows.push(row);
    }
    return rows;
}

// Which layout every diff pane uses. Module-level so the choice sticks across re-renders, and
// mirrored to localStorage so it survives reloads (item 10f).
export const DiffDisplayMode = Object.freeze({ split: "split", inline: "inline" } as const);
export type DiffDisplayModeValue = (typeof DiffDisplayMode)[keyof typeof DiffDisplayMode];
// Exported (item 66): the Details pane's Columns/Inline toggle persists through the SAME key
// and value vocabulary, so both diff surfaces share one remembered preference.
export const DIFF_MODE_STORAGE_KEY = "diffDisplayMode";

// A stored value resolves to a mode: only the exact "inline" wire string opts out of the
// split default (null / garbage / absent all mean split).
export function resolveInitialDiffDisplayMode(storedValue: string | null | undefined): DiffDisplayModeValue {
    if (storedValue === DiffDisplayMode.inline) {
        return DiffDisplayMode.inline;
    }
    return DiffDisplayMode.split;
}
