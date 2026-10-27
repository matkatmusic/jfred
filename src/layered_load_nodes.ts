// Per-session node collection for the layered loader (S2 node mapping).

import { getRecordSource } from "./parse/loadTranscript.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import type { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType, EventKind } from "./structures/vocabulary.ts";
import { LayeredNodeKind } from "./structures/vocabulary_views.ts";
import { collectReadEchoNodes } from "./layered_anchor.ts";
import { checkEventIsLineageEdge } from "./layered_lineage.ts";
import type { LineageEvidence } from "./layered_lineage.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import type { JsonlRef, TimelineNode } from "./layered_types.ts";

// Register one record's tool_use block ids under its evidence line.
function collectToolUseRefsFromRecord(
  record: TranscriptRecord,
  sessionFile: Path,
  refsByChangeId: Map<string, JsonlRef>,
): void {
  const source = getRecordSource(record);
  if (source === undefined) {
    return;
  }
  for (const block of getContentBlocks(record)) {
    if (block.type !== BlockType.tool_use) {
      continue;
    }
    refsByChangeId.set(block.id.toString(), { sessionFile, line: source.lineNumber });
  }
}

// Build the tool_use block id to source JsonlRef index for evidence tracking.
function buildJsonlRefsByChangeId(records: TranscriptRecord[], sessionFile: Path): Map<string, JsonlRef> {
  const refsByChangeId = new Map<string, JsonlRef>();
  for (const record of records) {
    collectToolUseRefsFromRecord(record, sessionFile, refsByChangeId);
  }
  return refsByChangeId;
}

// Only write and userEdit carry full content at extraction time.
function isEventCarryingFullContent(event: FileEvent): boolean {
  return event.kind === EventKind.write || event.kind === EventKind.userEdit;
}

// Extracts Edit's originalFile when present (non-null string).
function findEditOriginalContent(event: FileEvent): string | undefined {
  if (event.kind !== EventKind.edit) {
    return undefined;
  }
  if (typeof event.originalFile === "string") {
    return event.originalFile;
  }
  return undefined;
}

// The layer-1 node for one file-touching event: full content -> beacon, anything else -> stub.
function buildNodeFromEvent(event: FileEvent, evidence: JsonlRef): TimelineNode {
  const carriesFullContent = isEventCarryingFullContent(event);
  if (carriesFullContent) {
    const content = (event as { content: string }).content;
    return { kind: LayeredNodeKind.beacon, instant: event.timestamp, content, evidence };
  }
  const originalContent = findEditOriginalContent(event);
  if (originalContent !== undefined) {
    return { kind: LayeredNodeKind.beacon, instant: event.timestamp, content: originalContent, evidence };
  }
  return { kind: LayeredNodeKind.preAnchorStub, instant: event.timestamp, evidence };
}

// The (file, session) node list out of the nested map, created on first touch.
function getOrCreateNodeList(
  nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>,
  fileKey: string,
  sessionKey: string,
): TimelineNode[] {
  const sessionNodeLists = nodesByFileThenSession.get(fileKey) ?? new Map<string, TimelineNode[]>();
  nodesByFileThenSession.set(fileKey, sessionNodeLists);
  const nodes = sessionNodeLists.get(sessionKey) ?? [];
  sessionNodeLists.set(sessionKey, nodes);
  return nodes;
}

// Populates file->session->nodes map; rename/copy events become lineage evidence instead.
export function collectSessionNodes(
  records: TranscriptRecord[],
  sessionFile: Path,
  nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>,
  lineageEvidence: LineageEvidence[],
): void {
  const refsByChangeId = buildJsonlRefsByChangeId(records, sessionFile);
  for (const event of extractFileEvents(records)) {
    const evidence = refsByChangeId.get(event.changeId.toString());
    if (evidence === undefined) {
      continue;
    }
    const isLineageEdge = checkEventIsLineageEdge(event);
    if (isLineageEdge) {
      lineageEvidence.push({ event, evidence });
      continue;
    }
    const target = (event as { target?: Path }).target;
    if (target === undefined) {
      continue;
    }
    getOrCreateNodeList(nodesByFileThenSession, target.toString(), sessionFile.toString())
      .push(buildNodeFromEvent(event, evidence));
  }
  for (const placement of collectReadEchoNodes(records, sessionFile)) {
    getOrCreateNodeList(nodesByFileThenSession, placement.target.toString(), sessionFile.toString())
      .push(placement.node);
  }
}
