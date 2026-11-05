// Layer 1's session-annotation and tool-node vocabulary on the wire (task 382, fixture mode only).

import type { WireInstantOf } from "../../layer1-wire.ts";

// Values are the log spellings of RecordType and BlockType; `unknown` is the [?] fallback.
export const WireRecordKind = {
  user: "user",
  assistant: "assistant",
  toolUse: "tool_use",
  toolResult: "tool_result",
  attachment: "attachment",
  permissionMode: "permission-mode",
  customTitle: "custom-title",
  unknown: "unknown",
} as const;
export type WireRecordKind = (typeof WireRecordKind)[keyof typeof WireRecordKind];

// One session-column record: no file, no axisPx (the client places it from the ruler).
export interface WireAnnotationOf<I, U> {
  id: U;
  kind: WireRecordKind;
  instant: I;
  label: string;
  isIgnored?: boolean;
  // The instant is borrowed from the previous record.
  isStampless?: boolean;
  pairId?: U;
  sessionId: U;
  // The session title in effect at this record.
  sessionTitle: string;
  sessionFile: string;
  line: number;
}

// One tool node in a file's bubble: laid out like an edit, so it has axisPx.
export interface WireToolNodeOf<I, U> extends WireInstantOf<I> {
  id: U;
  kind: WireRecordKind;
  pairId: U;
  label: string;
}

export type WireAnnotation = WireAnnotationOf<string, string>;
export type WireToolNode = WireToolNodeOf<string, string>;
