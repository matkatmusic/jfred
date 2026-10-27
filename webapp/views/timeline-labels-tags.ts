// Step tags, diff fallback text, and tool-activity tags for the revision timeline (split from timeline-labels.ts).

import { SCRIPT_EXECUTION_EVENT_KIND } from "./timeline-labels-pills.ts";
import { AGENT_TURN_NODE_KIND } from "./timeline-types.ts";
import type { FileChange } from "./timeline-node-types.ts";

function formatEventKindForTag(kind: string): string {
  if (kind === SCRIPT_EXECUTION_EVENT_KIND) {
    return "script run";
  }
  return kind.replaceAll("-", " ");
}

// The inline tag naming what an unattributed-lane step is (item 10d).
export function computeUnattributedStepTag(eventKinds: string[]): string | undefined {
  const humanizedKinds: string[] = [];
  for (const kind of new Set(eventKinds)) {
    humanizedKinds.push(formatEventKindForTag(kind));
  }
  if (humanizedKinds.length === 0) {
    return undefined;
  }
  return humanizedKinds.join(" · ");
}

// A hunk-less block (a rename block is just its header) needs prose, or the pane looks empty (item 47).
export function computeRevisionDiffFallbackText(block: string | undefined, change: FileChange): string | undefined {
  if (block === undefined) {
    return "(no diff block for this revision)";
  }
  const trimmedBlock = block.trim();
  const blockLineCount = trimmedBlock.split("\n").length;
  if (blockLineCount > 1) {
    return undefined;
  }
  if (change.renamedFrom !== undefined) {
    return `renamed ${change.renamedFrom} → ${change.path} (content unchanged)`;
  }
  return `${trimmedBlock}\n(no content change in this revision)`;
}

// An agent turn with no reply text is tool activity, not a reply (item 52).
export function computeToolActivityTag(node: {
  kind: string;
  text: string;
  fileChanges?: FileChange[];
  gitOperations?: readonly unknown[];
}): string | undefined {
  if (node.kind !== AGENT_TURN_NODE_KIND) {
    return undefined;
  }
  const replyText = node.text.trim();
  if (replyText !== "") {
    return undefined;
  }
  if ((node.fileChanges ?? []).length > 0) {
    return "tool result";
  }
  // (item 55) old: if ((node.gitOperations ?? []).length > 0) { return "tool call"; }
  return undefined;
}
