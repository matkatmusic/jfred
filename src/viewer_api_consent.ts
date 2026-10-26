// Consent and baseline-question gates that decide whether a document build may start.

import { getPathOverrides } from "./reconstruction_overrides.ts";
import { findScriptExecutionRuns, type ScriptRun } from "./reconstruction_script_execution.ts";
import { isScriptCodeWriteCapable } from "./reconstruction_script_prestate.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Item 68: the read-only verdict uses the conservative classifier — uncertain code counts as may-write.
export type ConsentScript = ScriptRun & { readOnly: boolean };

export type DocumentDecision =
    | { kind: DocumentResponseKind.consentRequired; scripts: ConsentScript[] }
    | { kind: DocumentResponseKind.document };

// The scripts ride along so the consent dialog can show each one's code.
export function decideDocumentResponse(records: TranscriptRecord[], allowScripts: boolean): DocumentDecision {
  const scripts = findScriptExecutionRuns(records);
  if (scripts.length > 0 && !allowScripts) {
    const taggedScripts = scripts.map((run) => ({ ...run, readOnly: !isScriptCodeWriteCapable(run.code) }));
    return { kind: DocumentResponseKind.consentRequired, scripts: taggedScripts };
  }
  return { kind: DocumentResponseKind.document };
}

// Task 56: asked BEFORE the consent gate — the scope-of-work decision precedes the run-scripts one.
export type BaselineQuestion = {
  kind: DocumentResponseKind.baselineQuestionRequired;
  baseCommit: string;
  repo: string;
};

export function decideBaselineQuestion(choiceMade: boolean): BaselineQuestion | undefined {
  if (choiceMade) {
    return undefined;
  }
  const { repoDir, baseCommit } = getPathOverrides();
  if (repoDir === undefined) {
    return undefined;
  }
  if (baseCommit === undefined) {
    return undefined;
  }
  return {
    kind: DocumentResponseKind.baselineQuestionRequired,
    baseCommit: baseCommit.toString(),
    repo: repoDir.toString(),
  };
}
