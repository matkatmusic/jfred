// §a clone-on-write path remap for transcript records.

import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getRecordSource, setRecordSource } from "./parse/loadTranscript.ts";

function replaceInText(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}

// Recursive COW walk replacing `from` with `to`; never mutates cached input records.
// ponytail: string-replace also rewrites paths inside file content strings; revisit if content must stay verbatim.
function copyValueReplacingPath(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") {
    return replaceInText(value, from, to);
  }
  if (value instanceof Path) {
    const original = value.toString();
    const replaced = replaceInText(original, from, to);
    return replaced === original ? value : new Path(replaced);
  }
  const isAtomic = value instanceof Date || value instanceof Uuid;
  if (isAtomic) {
    return value;
  }
  const isArray = Array.isArray(value);
  if (isArray) {
    const copiedEntries: unknown[] = [];
    for (const entry of value) {
      copiedEntries.push(copyValueReplacingPath(entry, from, to));
    }
    return copiedEntries;
  }
  const isObject = value !== null && typeof value === "object";
  if (isObject) {
    const copied: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copied[key] = copyValueReplacingPath(entry, from, to);
    }
    return copied;
  }
  return value;
}

// Copy record rewriting fromPath to toPath, preserving transcript source stamp.
export function copyRecordReplacingPath(record: TranscriptRecord, fromPath: Path, toPath: Path): TranscriptRecord {
  const copy = copyValueReplacingPath(record, fromPath.toString(), toPath.toString()) as TranscriptRecord;
  const source = getRecordSource(record);
  if (source !== undefined) {
    setRecordSource(copy, source);
  }
  return copy;
}
