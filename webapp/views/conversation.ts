// Conversation view (#/project/<name>/jsonl/<file>): turns as bubbles, other records as stubs, edit markers linking to file history.

import { logProgress } from "../app-console.ts";
import { fetchDocument, fetchRawRecords } from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { openTranscriptInspector } from "../inspector.ts";
import { findLineForChangeId } from "./file-history-model.ts";
import { buildConversationViewModel } from "./conversation-model.ts";
import type { WireConversationDocument, WireLineVerdict } from "./conversation-model.ts";
import {
  appendEditMarkerLink,
  buildFilterBar,
  buildMessageBubbleNode,
  buildStubRowNode,
  createConversationColumn,
  renderBranchStrip,
} from "./conversation-nodes.ts";

// Maps raw line index to the file paths revised there, found by scanning each changeId back to its line.
function collectEditTargetsByLine(documentJson: WireConversationDocument, rawLines: string[]): Map<number, string[]> {
  const targetsByLine = new Map<number, string[]>();
  for (const history of documentJson.filesTouched) {
    for (const revision of history.revisions) {
      const line: number = findLineForChangeId(rawLines, revision.changeId);
      if (line < 0) {
        continue;
      }
      const hasTargets = targetsByLine.has(line);
      if (!hasTargets) {
        targetsByLine.set(line, []);
      }
      targetsByLine.get(line)!.push(history.target);
    }
  }
  return targetsByLine;
}

function createLineByUuid(lineVerdicts: WireLineVerdict[]): Map<string, number> {
  const lineByUuid = new Map<string, number>();
  for (const verdict of lineVerdicts) {
    lineByUuid.set(verdict.uuid, verdict.line);
  }
  return lineByUuid;
}

export async function renderConversationView(container: HTMLElement, project: string, jsonl: string, anchorLine: string | undefined): Promise<void> {
  const result = await fetchDocument<WireConversationDocument>(project, jsonl);
  if (result.baselineQuestion !== undefined) {
    renderBaselineQuestionDialog(container, project, result.baselineQuestion);
    return;
  }
  if (result.consentRequired !== undefined) {
    renderConsentDialog(container, project, result.consentRequired);
    return;
  }
  const documentJson: WireConversationDocument = result.document!;
  const rawLines: string[] = await fetchRawRecords(project, jsonl);

  // A log line written right before a long synchronous stretch never paints without a yield.
  logProgress("building view");
  await new Promise((resolve) => setTimeout(resolve, 0));

  container.append(buildFilterBar(project, jsonl));
  container.append(renderBranchStrip(documentJson.branches));

  const targetsByLine = collectEditTargetsByLine(documentJson, rawLines);

  // Inspector navigation (Prev/Next, jump-links) scrolls the conversation in step.
  const nodeByLine = new Map<number, HTMLElement>();
  const markLineAnchored = (line: number): void => {
    const node = nodeByLine.get(line);
    if (node === undefined) {
      return;
    }
    const staleNodes = container.querySelectorAll(".anchored");
    for (const staleNode of staleNodes) {
      staleNode.classList.remove("anchored");
    }
    node.classList.add("anchored");
    node.scrollIntoView({ block: "center" });
  };
  const openLineInspector = (line: number): void => openTranscriptInspector({ jsonlName: jsonl, rawLines, line, onJumpToLine: markLineAnchored });
  const lineByUuid = createLineByUuid(documentJson.lineVerdicts);

  logProgress("rendering");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const conversation = createConversationColumn();
  let anchorNode: HTMLElement | undefined;
  const appendEditMarkers = (line: number): void => {
    for (const path of targetsByLine.get(line) ?? []) {
      appendEditMarkerLink(conversation, project, path);
    }
  };
  for (const entry of buildConversationViewModel(documentJson).entries) {
    const entryLine = entry.kind === "message" ? lineByUuid.get(entry.message.uuid)! : entry.line;
    let node: HTMLElement;
    if (entry.kind === "message") {
      node = buildMessageBubbleNode(entry.message, entryLine, openLineInspector);
    }
    else {
      node = buildStubRowNode(entry, openLineInspector);
    }
    conversation.append(node);
    nodeByLine.set(entryLine, node);
    appendEditMarkers(entryLine);
    const isAnchorEntry = anchorLine !== undefined && entryLine === Number(anchorLine);
    if (isAnchorEntry) {
      anchorNode = node;
    }
  }
  container.append(conversation);
  if (anchorNode !== undefined) {
    anchorNode.classList.add("anchored");
    anchorNode.scrollIntoView({ block: "center" });
  }
}
