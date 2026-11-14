// Task 907: every session's dot instants on the wire, as deltas, plus the demo builder.

import type { SessionDotInstants } from "../ruler/layer1-session-dot-counts.ts";
import type { WireAnnotation } from "./layer1-wire-annotations.ts";

export interface WireSessionDotInstantsEntry {
  sessionId: string;
  // First entry is the absolute epoch ms; each later entry is the step from the one before.
  deltasMs: number[];
}
export interface WireSessionDotInstants {
  sessions: WireSessionDotInstantsEntry[];
}

function encodeSession(sessionId: string, sortedMs: readonly number[]): WireSessionDotInstantsEntry {
  const deltasMs: number[] = [];
  let previousMs = 0;
  for (const ms of sortedMs) {
    deltasMs.push(ms - previousMs);
    previousMs = ms;
  }
  return { sessionId, deltasMs };
}

export function encodeSessionDotInstants(instants: SessionDotInstants): WireSessionDotInstants {
  const sessions: WireSessionDotInstantsEntry[] = [];
  for (const [sessionId, sortedMs] of instants) {
    sessions.push(encodeSession(sessionId, sortedMs));
  }
  return { sessions };
}

function decodeSession(entry: WireSessionDotInstantsEntry): number[] {
  const instantsMs: number[] = [];
  let runningMs = 0;
  for (const deltaMs of entry.deltasMs) {
    runningMs += deltaMs;
    instantsMs.push(runningMs);
  }
  return instantsMs;
}

export function decodeSessionDotInstants(wire: WireSessionDotInstants): Map<string, number[]> {
  const instants = new Map<string, number[]>();
  for (const entry of wire.sessions) {
    instants.set(entry.sessionId, decodeSession(entry));
  }
  return instants;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function groupInstantsBySession(annotations: readonly WireAnnotation[]): Map<string, number[]> {
  const instants = new Map<string, number[]>();
  for (const annotation of annotations) {
    const sessionMs = instants.get(annotation.sessionId) ?? [];
    sessionMs.push(Date.parse(annotation.instant));
    instants.set(annotation.sessionId, sessionMs);
  }
  return instants;
}

export function listSessionDotInstantsFromAnnotations(annotations: readonly WireAnnotation[]): Map<string, number[]> {
  const instants = groupInstantsBySession(annotations);
  for (const sessionMs of instants.values()) {
    sessionMs.sort(compareNumbers);
  }
  return instants;
}
