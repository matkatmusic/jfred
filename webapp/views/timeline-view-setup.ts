// Pure inputs for one timeline render pass: project listing, session colors, header summary.

import { fetchJson } from "../app-fetch.ts";
import { SESSION_LANE_VARIABLES, type WireProjectListing } from "./timeline-sessions.ts";
import type { TimelineNode } from "./timeline-types.ts";

export async function fetchProjectListing(project: string): Promise<WireProjectListing | undefined> {
  const listings = await fetchJson<WireProjectListing[]>("/api/projects");
  for (const entry of listings) {
    if (entry.name === project) {
      return entry;
    }
  }
  return undefined;
}

export function buildSessionColors(nodes: TimelineNode[]): Map<string, string> {
  const sessionColors = new Map<string, string>();
  for (const node of nodes) {
    if (node.sessionId === undefined) {
      continue;
    }
    const isKnownSession = sessionColors.has(node.sessionId);
    if (isKnownSession) {
      continue;
    }
    const laneVariable = SESSION_LANE_VARIABLES[sessionColors.size % SESSION_LANE_VARIABLES.length];
    sessionColors.set(node.sessionId, `var(${laneVariable})`);
  }
  return sessionColors;
}

export function countNumberedSteps(nodes: TimelineNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.stepNumber !== undefined) {
      count++;
    }
  }
  return count;
}

export function countTouchedFiles(nodes: TimelineNode[]): number {
  const touchedPaths = new Set<string>();
  for (const node of nodes) {
    for (const change of node.fileChanges ?? []) {
      touchedPaths.add(change.path);
    }
  }
  return touchedPaths.size;
}

export function formatTimelineSummary(nodes: TimelineNode[], sessionCount: number): string {
  const sessionLabel = sessionCount === 1 ? "" : "s";
  return `${sessionCount} session${sessionLabel} · ${countNumberedSteps(nodes)} steps · ${countTouchedFiles(nodes)} files`;
}
