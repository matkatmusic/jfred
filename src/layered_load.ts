// S1 source discovery + S2 node mapping + task 199 timeline completion.

import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { listSubagentTranscripts } from "./viewer_api_project_scan.ts";
import { findFirstRecordCwd } from "./reconstruction_base_commit.ts";
import { resolveFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { sortNodesOntoAxis } from "./layered_instants.ts";
import { completeLayer1Timeline } from "./layered_end_state.ts";
import { collectSessionNodes } from "./layered_load_nodes.ts";
import { buildLineageEdges } from "./layered_lineage.ts";
import type { LineageEvidence } from "./layered_lineage.ts";
import type {
  ReconstructionEntity,
  ReconstructionGraph,
  SessionTimeline,
  TimelineNode,
} from "./layered_types.ts";

// The S1 source overrides: any explicitly given path set wins over folder discovery.
export interface LayeredSourceOverrides {
  repoPath?: Path;
  jsonlPaths?: Path[];
  snapshotPaths?: Path[];
}

// Returns override paths verbatim, or discovers top-level .jsonl files.
export function findJsonlPaths(projectFolder: Path, override: Path[] | undefined): Path[] {
  if (override !== undefined) {
    return override;
  }
  const jsonlPaths: Path[] = [];
  for (const name of readdirSync(projectFolder.toString()).sort()) {
    const isJsonl = name.endsWith(".jsonl");
    if (isJsonl) {
      jsonlPaths.push(new Path(join(projectFolder.toString(), name)));
    }
  }
  return jsonlPaths;
}

// Resolves repo and snapshot roots for layers 2-3.
export function findEvidenceRoots(
  records: TranscriptRecord[],
  overrides: LayeredSourceOverrides,
): { repoPath: Path | undefined; snapshotPaths: Path[] } {
  const repoPath = overrides.repoPath ?? findFirstRecordCwd(records);
  const snapshotPaths = overrides.snapshotPaths ?? [resolveFileHistoryRoot(records)];
  return { repoPath, snapshotPaths };
}

// One session's sorted timeline for an entity, completed with the on-disk end state and presumption gaps (task 199).
function buildSessionTimeline(sessionFileKey: string, nodes: TimelineNode[], filename: Path): SessionTimeline {
  return {
    sessionFile: new Path(sessionFileKey),
    timeline: { nodes: completeLayer1Timeline(sortNodesOntoAxis(nodes), filename) },
  };
}

// Orders [sessionFile, nodes] entries by session-file name.
function compareEntriesBySessionFile(left: [string, TimelineNode[]], right: [string, TimelineNode[]]): number {
  return left[0].localeCompare(right[0]);
}

// One entity per distinct absolute path, its sessionTimelines in session-file name order.
function buildEntities(nodesByFileThenSession: Map<string, Map<string, TimelineNode[]>>): ReconstructionEntity[] {
  const entities: ReconstructionEntity[] = [];
  for (const [fileKey, sessionNodeLists] of nodesByFileThenSession) {
    const sortedEntries = [...sessionNodeLists.entries()].sort(compareEntriesBySessionFile);
    const sessionTimelines: SessionTimeline[] = [];
    for (const [sessionFileKey, nodes] of sortedEntries) {
      sessionTimelines.push(buildSessionTimeline(sessionFileKey, nodes, new Path(fileKey)));
    }
    entities.push({ filename: new Path(fileKey), sessionTimelines });
  }
  return entities;
}

// A session's own fork-subagent transcripts, if any (task 375/338).
function listSubagentPaths(projectFolder: Path, sessionJsonlPath: Path): Path[] {
  const sessionId = basename(sessionJsonlPath.toString(), ".jsonl");
  const subagentPaths: Path[] = [];
  for (const entry of listSubagentTranscripts(projectFolder.toString(), sessionId)) {
    subagentPaths.push(new Path(join(projectFolder.toString(), entry.fileName.toString())));
  }
  return subagentPaths;
}

// Entry point: loads all sessions and builds the per-file entity graph.
export function loadLayeredProject(projectFolder: Path, overrides: LayeredSourceOverrides): ReconstructionGraph {
  const nodesByFileThenSession = new Map<string, Map<string, TimelineNode[]>>();
  const lineageEvidence: LineageEvidence[] = [];
  for (const jsonlPath of findJsonlPaths(projectFolder, overrides.jsonlPaths)) {
    const { records } = loadTranscript(jsonlPath.toString());
    collectSessionNodes(records, jsonlPath, nodesByFileThenSession, lineageEvidence);
    for (const subagentPath of listSubagentPaths(projectFolder, jsonlPath)) {
      const { records: subagentRecords } = loadTranscript(subagentPath.toString());
      collectSessionNodes(subagentRecords, subagentPath, nodesByFileThenSession, lineageEvidence);
    }
  }
  // buildLineageEdges adds an entity for any rename/copy endpoint the node walk never saw.
  const entitiesByPath = new Map<string, ReconstructionEntity>();
  for (const entity of buildEntities(nodesByFileThenSession)) {
    entitiesByPath.set(entity.filename.toString(), entity);
  }
  const { renames, copies } = buildLineageEdges(lineageEvidence, entitiesByPath);
  return { entities: [...entitiesByPath.values()], renames, copies, scriptLinks: [] };
}
