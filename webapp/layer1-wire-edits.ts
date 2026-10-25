// Layer 1's Edit/Write/Read node vocabulary on the wire (task 343).

import type { WireInstantOf } from "./layer1-wire.ts";

// Task 343: which tool made an Edit/Write/Read node.
export const WireEditKind = {
  edit: "edit",
  write: "write",
  read: "read",
} as const;
export type WireEditKind = (typeof WireEditKind)[keyof typeof WireEditKind];

// Task 355: which side of an Edit node /api/layer1-file returns.
export const WireEditSide = { base: "base", target: "target" } as const;
export type WireEditSide = (typeof WireEditSide)[keyof typeof WireEditSide];

// Task 343: only the confidence states layer 3 emits; the other four arrive with their layers.
export const WireConfidence = {
  verified: "verified",
  derived: "derived",
  reseeded: "reseeded",
} as const;
export type WireConfidence = (typeof WireConfidence)[keyof typeof WireConfidence];

// Task 343: an Edit/Write/Read node; changeId is the tool_use id, so it identifies the node across sessions.
export interface WireEditOf<I, P, U> extends WireInstantOf<I> {
  kind: WireEditKind;
  changeId: U;
  confidence: WireConfidence;
  sessionId: U;
  sessionFile: P;
  line?: number;
}

// Task 343: /api/layer1-edits answers without axisPx: the endpoint cannot place nodes, the client does.
export interface WireEditsViewOf<I, P, U> {
  pairs: { path: P; edits: Omit<WireEditOf<I, P, U>, "axisPx">[] }[];
}

export type WireEdit = WireEditOf<string, string, string>;
export type WireEditsView = WireEditsViewOf<string, string, string>;
