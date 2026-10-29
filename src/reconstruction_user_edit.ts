// Turns an `edited_text_file` attachment (a user's out-of-band file edit) into a UserEditEvent.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { getAttachmentEntry } from "./structures/session-meta.ts";
import { AttachmentPayloadType, EventKind } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { UserEditEvent } from "./reconstruction_events.ts";
import { lineNumberPrefix, numberedLine } from "./regex_expressions.ts";

// One numbered line of an `edited_text_file` snippet (`lineNo` is the file line the harness showed).
export type BeaconLine = { lineNo: number; text: string };
// A parsed beacon snippet: its numbered lines, line numbers kept, and whether a `...` elision line exists.
export type BeaconSnippet = { lines: BeaconLine[]; hasEllipsis: boolean };

// Strip the `<lineNo>\t` prefix from every snippet line, giving the file's post-edit text.
function removeLineNumberPrefixes(snippet: string): string {
  const strippedLines: string[] = [];
  for (const line of snippet.split("\n")) {
    strippedLines.push(line.replace(lineNumberPrefix, ""));
  }
  return strippedLines.join("\n");
}

// Turn an `edited_text_file` attachment record into a UserEditEvent, or undefined. The changeId is the record's own uuid.
export function getUserEditEvent(record: TranscriptRecord): UserEditEvent | undefined {
  const entry = getAttachmentEntry(record);
  if (entry === undefined) {
    return undefined;
  }
  if (entry.attachment.type !== AttachmentPayloadType.edited_text_file) {
    return undefined;
  }
  const filename = entry.attachment.filename as string;
  const snippet = entry.attachment.snippet as string;
  return {
    kind: EventKind.userEdit,
    changeId: entry.uuid,
    target: new Path(filename),
    content: removeLineNumberPrefixes(snippet),
    timestamp: entry.timestamp,
  };
}

// Parse the snippet of the attachment whose uuid equals `changeId`, or return undefined when none exists.
export function getBeaconSnippet(
  records: TranscriptRecord[],
  changeId: Uuid,
): BeaconSnippet | undefined {
  const changeIdText = changeId.toString();
  for (const record of records) {
    const entry = getAttachmentEntry(record);
    if (entry === undefined) {
      continue;
    }
    const isEditedTextFile = entry.attachment.type === AttachmentPayloadType.edited_text_file;
    if (!isEditedTextFile) {
      continue;
    }
    const entryIdText = entry.uuid.toString();
    if (entryIdText !== changeIdText) {
      continue;
    }
    return parseNumberedSnippet(entry.attachment.snippet as string);
  }
  return undefined;
}

// Split a `cat -n` snippet into numbered lines + ellipsis flag (see getBeaconSnippet).
function parseNumberedSnippet(snippet: string): BeaconSnippet {
  const lines: BeaconLine[] = [];
  let hasEllipsis = false;
  for (const raw of snippet.split("\n")) {
    const match = raw.match(numberedLine);
    if (match) {
      lines.push({ lineNo: Number(match[1]), text: match[2]! });
    }
    else if (raw === "...") {
      hasEllipsis = true;
    }
  }
  return { lines, hasEllipsis };
}

