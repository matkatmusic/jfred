// Remembers the reverse walk of each file path the server sent.

import type { WireReverseState, WireReverseWalk } from "./layer1-wire-reverse.ts";

const walksByPath = new Map<string, WireReverseWalk>();

export function storeReverseWalk(walk: WireReverseWalk): void {
  walksByPath.set(walk.path, walk);
}

export function readReverseWalk(path: string): WireReverseWalk | undefined {
  return walksByPath.get(path);
}

export function readReverseState(path: string, index: number): WireReverseState | undefined {
  const walk = readReverseWalk(path);
  if (walk === undefined) {
    return undefined;
  }
  return walk.states.find((state) => state.index === index);
}

export function clearReverseWalks(): void {
  walksByPath.clear();
}
