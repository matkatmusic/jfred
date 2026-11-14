// Task 907: the page store and loader for every session's dot instants.

import type { SessionDotInstants } from "../ruler/layer1-session-dot-counts.ts";
import { decodeSessionDotInstants, type WireSessionDotInstants } from "./layer1-wire-session-instants.ts";

export interface SessionDotInstantsRequest {
  dir: string;
  jsonlFolders: readonly string[];
}

let storedInstants: SessionDotInstants | undefined = undefined;

export function storeSessionDotInstants(instants: SessionDotInstants): void {
  storedInstants = instants;
}

export function clearSessionDotInstants(): void {
  storedInstants = undefined;
}

export function readSessionDotInstants(): SessionDotInstants | undefined {
  return storedInstants;
}

export function readRequiredSessionDotInstants(): SessionDotInstants {
  if (storedInstants === undefined) {
    throw new Error("session dot instants are not loaded");
  }
  return storedInstants;
}

export function buildSessionDotInstantsUrl(request: SessionDotInstantsRequest): string {
  const params = new URLSearchParams();
  params.set("dir", request.dir);
  for (const folder of request.jsonlFolders) {
    params.append("jsonl", folder);
  }
  return `/api/layer1-session-dot-instants?${params.toString()}`;
}

export async function loadSessionDotInstants(request: SessionDotInstantsRequest): Promise<void> {
  const response = await fetch(buildSessionDotInstantsUrl(request));
  if (!response.ok) {
    throw new Error(`session dot instants ask failed: ${response.status}`);
  }
  const wire = await response.json() as WireSessionDotInstants;
  storeSessionDotInstants(decodeSessionDotInstants(wire));
}
