// Extraction of a user's out-of-band file edit (s15-user-edit-then-conv-rewind). A user editing a file on disk leaves no tool_use; the harness records it as an `edited_text_file` attachment whose `snippet` is the full post-edit content in `cat -n` form (`<lineNo>\t<line>`). This leaf module turns that attachment into a UserEditEvent. Used by reconstruction_extract.ts. Design: the engine file (reconstruction_engine.ts) + plans/s15/s15-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { getAttachmentEntry } from "./structures/session-meta.ts";
import { AttachmentPayloadType, EventKind } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { UserEditEvent } from "./reconstruction_engine.ts";
import { lineNumberPrefix, numberedLine } from "./regex_expressions.ts";

// One numbered line of an `edited_text_file` snippet (`lineNo` is the file line the harness showed).
export type BeaconLine = { lineNo: number; text: string };
// The PARSED `cat -n` snippet of a beacon: every numbered line plus whether a literal `...` elision separator is present. Unlike the UserEditEvent's `content`, the line NUMBERS are preserved here so the reseed stage can detect a windowed (elided) snippet. See plans/s28/s28-reconstruction-plan.md.
export type BeaconSnippet = { lines: BeaconLine[]; hasEllipsis: boolean };

// Strip the `<lineNo>\t` prefix every line of an `edited_text_file` snippet carries, recovering the file's actual post-edit text. `1\t# user edit\n2\tdef hello():` -> `# user edit\ndef hello():`.
function stripLineNumberPrefixes(snippet: string): string {
    const numberedLines = snippet.split("\n");
    const strippedLines = numberedLines.map((line) => line.replace(lineNumberPrefix, ""));
    return strippedLines.join("\n");
}

// Turn an `edited_text_file` attachment record into a UserEditEvent, or undefined when the record is not such an attachment. The event's changeId is the attachment record's own uuid (a user edit has no tool_use id); its content is the snippet with line-number prefixes stripped.
export function userEditEventFrom(record: TranscriptRecord): UserEditEvent | undefined {
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
        content: stripLineNumberPrefixes(snippet),
        timestamp: entry.timestamp,
    };
}

// Parse the raw `edited_text_file` snippet of the attachment whose record uuid === `changeId` into its numbered lines (preserving line numbers) plus an ellipsis flag. A snippet line carries an `N\t` prefix; an elision separator is a bare `...` line with NO prefix, so the two are unambiguous.  Returns undefined when no such attachment exists.
export function beaconSnippetFor(
    records: TranscriptRecord[],
    changeId: Uuid,
): BeaconSnippet | undefined {
    for (const record of records) {
        const entry = getAttachmentEntry(record);
        if (entry === undefined || entry.attachment.type !== AttachmentPayloadType.edited_text_file) {
            continue;
        }
        if (entry.uuid.toString() !== changeId.toString()) {
            continue;
        }
        return parseNumberedSnippet(entry.attachment.snippet as string);
    }
    return undefined;
}

// Split a `cat -n` snippet into numbered lines + ellipsis flag (see beaconSnippetFor).
function parseNumberedSnippet(snippet: string): BeaconSnippet {
    const lines: BeaconLine[] = [];
    let hasEllipsis = false;
    for (const raw of snippet.split("\n")) {
        const match = raw.match(numberedLine);
        if (match) {
            lines.push({ lineNo: Number(match[1]), text: match[2]! });
        } else if (raw === "...") {
            hasEllipsis = true;
        }
    }
    return { lines, hasEllipsis };
}

