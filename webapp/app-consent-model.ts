// Consent-dialog view-model: pure helpers with no DOM; app-consent.ts renders the dialog.

import type { WireConsentScript } from "./app-fetch.ts";

// A consent list block: one modifying row, or a collapsed run of read-only scripts (item 69).
export enum ConsentBlockKind {
  modifying = "modifying",
  readOnlyRun = "read-only-run",
}
export type ConsentDisplayBlock =
    | { kind: ConsentBlockKind.modifying; script: WireConsentScript }
    | { kind: ConsentBlockKind.readOnlyRun; scripts: WireConsentScript[] };

// Each run of consecutive read-only scripts becomes one block; every other script is its own block.
export function splitConsentScriptsIntoBlocks(scripts: WireConsentScript[]): ConsentDisplayBlock[] {
  const blocks: ConsentDisplayBlock[] = [];
  for (const script of scripts) {
    const lastBlock = blocks[blocks.length - 1];
    const hasLastBlock = lastBlock !== undefined;
    const isLastBlockReadOnlyRun = hasLastBlock && lastBlock.kind === ConsentBlockKind.readOnlyRun;
    if (script.readOnly !== true) {
      blocks.push({ kind: ConsentBlockKind.modifying, script });
    }
    else if (isLastBlockReadOnlyRun) {
      lastBlock.scripts.push(script);
    }
    else {
      blocks.push({ kind: ConsentBlockKind.readOnlyRun, scripts: [script] });
    }
  }
  return blocks;
}

// Lines the clipped consent preview shows: styles.css max-height 200px is about 12 lines.
// ponytail: line-count heuristic; measure scrollHeight if wrapped lines misjudge previews.
const CONSENT_PREVIEW_MAX_LINES = 12;

// True when the code has more lines than the preview shows, so the row needs Expand (item 70).
export function isConsentScriptOverflowingPreview(code: string): boolean {
  return code.split("\n").length > CONSENT_PREVIEW_MAX_LINES;
}

// Pseudo-path for renderCodeInto: every recorded run executes as `python3 __script__.py`.
export const CONSENT_SCRIPT_LANGUAGE_PATH = "__script__.py";

// Wrapper before, inline code, and wrapper after, plus the body's language pseudo-path.
export type InlineInterpreterSegments = {
  prefix: string;
  body: string;
  suffix: string;
  languagePath: string;
};

// Splits `python3 -c "…" 2>&1` into wrapper and inline code; undefined if not an inline interpreter.
// ponytail: greedy-to-last-quote split; revisit if a second quoted argument follows the body.
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

// Client mirror of formatRecordSourceToken: " [file.jsonl:123]" for a known source, else "" (task 97).
export function formatConsentSourceToken(source: { filePath: string; lineNumber: number } | undefined): string {
  if (source === undefined) {
    return "";
  }
  const fileName = source.filePath.split("/").pop()!;
  return ` [${fileName}:${source.lineNumber}]`;
}

// Index of the first modifying script (item 73); undefined when every script is read-only.
export function findDefaultConsentSelectionIndex(scripts: WireConsentScript[]): number | undefined {
  for (let index = 0; index < scripts.length; index++) {
    if (scripts[index]!.readOnly !== true) {
      return index;
    }
  }
  return undefined;
}

// Prev/Next step over visible rows, clamped at both ends; currentIndex -1 enters at row 0 (item 73).
export function computeConsentSelectionStep(currentIndex: number, delta: number, visibleRowCount: number): number {
  return Math.min(visibleRowCount - 1, Math.max(0, currentIndex + delta));
}
