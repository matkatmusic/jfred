// Per-line verdicts: the engine's classification of every transcript line, line-aligned to the
// parsed records array. Moved out of reconstruction_json.ts (its one canonical home, no
// re-export shim) when task 134 pushed that file past the 250-line cap.

import type { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { RecordType, Verdict } from "./structures/vocabulary.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { recordVerdict } from "./reconstruction_parse_lines.ts";

export type LineVerdict = {
    line: number;
    uuid: Uuid | undefined;
    type: RecordType;
    verdict: Verdict;
    isGenuinePrompt: boolean;
    // task 134: the timeline's raw-line rows sort by timestamp and tint by session lane.
    timestamp: Date | undefined;
    sessionId: Uuid | undefined;
};

// The engine's per-line classification, line-aligned to the parsed records array. Pure surfacing of
// recordVerdict + isGenuineUserPrompt (both per-record, no transcript context) — no new logic.
export function buildLineVerdicts(records: TranscriptRecord[]): LineVerdict[] {
    return records.map((record, index) => ({
        line: index,
        uuid: record.uuid,
        type: record.type,
        verdict: recordVerdict(record),
        isGenuinePrompt: isGenuineUserPrompt(record),
        timestamp: record.timestamp,
        sessionId: record.sessionId,
    }));
}
