// Consent-dialog view-model: pure helpers for grouping, preview overflow, inline-interpreter
// splitting, source tokens, and selection stepping — no DOM. The dialog itself renders in
// app-consent.ts.

import type { WireConsentScript } from "./app-fetch.ts";

// How one stretch of the consent list renders: a full modifying row, or a collapsed
// run of consecutive read-only scripts behind one expandable summary line (item 69).
export enum ConsentBlockKind {
    modifying = "modifying",
    readOnlyRun = "read-only-run",
}
export type ConsentDisplayBlock =
    | { kind: ConsentBlockKind.modifying; script: WireConsentScript }
    | { kind: ConsentBlockKind.readOnlyRun; scripts: WireConsentScript[] };

// Group the chronological script list into display blocks: each maximal run of consecutive
// read-only scripts becomes one collapsed block; every other script is its own row.
export function groupConsentScriptsIntoBlocks(scripts: WireConsentScript[]): ConsentDisplayBlock[] {
    const blocks: ConsentDisplayBlock[] = [];
    for (const script of scripts) {
        const lastBlock = blocks[blocks.length - 1];
        if (script.readOnly !== true) {
            blocks.push({ kind: ConsentBlockKind.modifying, script });
        } else if (lastBlock !== undefined && lastBlock.kind === ConsentBlockKind.readOnlyRun) {
            lastBlock.scripts.push(script);
        } else {
            blocks.push({ kind: ConsentBlockKind.readOnlyRun, scripts: [script] });
        }
    }
    return blocks;
}

// Preview capacity of a consent-script <pre> in code lines. styles.css clips the pre at
// max-height 200px; at 12px font / ~1.4 line-height plus 8px paddings that is ~12 lines.
// ponytail: line-count heuristic, not a scrollHeight measurement — switch to measuring the
// rendered element if wrapped/oversized lines ever make this misjudge real previews.
const CONSENT_PREVIEW_MAX_LINES = 12;

// True when a consent script's code has more lines than the clipped preview can show,
// i.e. the row needs an Expand button (item 70).
export function checkConsentScriptOverflowsPreview(code: string): boolean {
    return code.split("\n").length > CONSENT_PREVIEW_MAX_LINES;
}

// Pseudo-path handed to renderCodeInto so consent code highlights as Python — every
// recorded run executes as `python3 __script__.py` (reconstruction_script_execution.ts).
export const CONSENT_SCRIPT_LANGUAGE_PATH = "__script__.py";

// The three segments of a shell line like `python3 -c "…" 2>&1`: the wrapper before the
// quoted inline code, the inline code itself, and the wrapper after it, plus the pseudo-path
// naming the body's real language for renderCodeInto.
export type InlineInterpreterSegments = {
    prefix: string;
    body: string;
    suffix: string;
    languagePath: string;
};

// Splits a shell line like `python3 -c "…" 2>&1` into wrapper + inline code so the body can
// be highlighted in its real language — highlighted whole, the quoted body tokenizes as one
// giant string literal. undefined = not an inline-interpreter invocation.
// ponytail: greedy-to-last-quote split, no shell parsing — revisit if runs ever put an
// unescaped double quote after the body (e.g. a second quoted argument).
export function splitInlineInterpreterCode(code: string): InlineInterpreterSegments | undefined {
    const match = /^((python3?|node)[^\n]*?\s-[ce]\s+")([\s\S]*)("[^"]*)$/.exec(code);
    if (match === null) {
        return undefined;
    }
    return {
        // Groups 1/3/4 are non-optional in the pattern, so a successful match always fills them.
        prefix: match[1]!,
        body: match[3]!,
        suffix: match[4]!,
        languagePath: match[2] === "node" ? "__script__.js" : CONSENT_SCRIPT_LANGUAGE_PATH,
    };
}

// Client mirror of the server's formatRecordSourceToken (loadTranscript.ts): " [file.jsonl:123]"
// for a known source, "" otherwise — appended to the consent row's muted header (task 97).
export function formatConsentSourceToken(source: { filePath: string; lineNumber: number } | undefined): string {
    if (source === undefined) {
        return "";
    }
    const fileName = source.filePath.split("/").pop()!;
    return ` [${fileName}:${source.lineNumber}]`;
}

// Default consent-header selection (item 73): the first modifying script, matching the
// missing-flag rule used by groupConsentScriptsIntoBlocks. undefined when every script is
// read-only — read-only rows start hidden inside closed <details>, so nothing is selectable.
export function findDefaultConsentSelectionIndex(scripts: WireConsentScript[]): number | undefined {
    const firstModifyingIndex = scripts.findIndex((script) => script.readOnly !== true);
    return firstModifyingIndex === -1 ? undefined : firstModifyingIndex;
}

// Prev/Next stepping over the currently visible consent rows (item 73): clamps at both ends
// instead of wrapping; a currentIndex of -1 (no selection yet) enters the list at row 0.
export function clampConsentSelectionStep(currentIndex: number, delta: number, visibleRowCount: number): number {
    return Math.min(visibleRowCount - 1, Math.max(0, currentIndex + delta));
}
