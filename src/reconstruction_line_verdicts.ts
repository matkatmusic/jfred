// Per-line engine verdicts, split from reconstruction_json.ts for the 250-line cap.

import type { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { RecordType, Verdict } from "./structures/vocabulary.ts";
import { getRecordSource, type RecordSource } from "./parse/loadTranscript.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import { getRecordVerdict } from "./reconstruction_parse_lines.ts";

export type LineVerdict = {
  line: number;
  uuid: Uuid | undefined;
  type: RecordType;
  verdict: Verdict;
  isGenuinePrompt: boolean;
  // task 134: the timeline's raw-line rows sort by timestamp and tint by session lane.
  timestamp: Date | undefined;
  sessionId: Uuid | undefined;
  // task 160: physical location so the webapp can open uuid-less rows by line.
  source: RecordSource | undefined;
};

// Surfaces getRecordVerdict + isGenuineUserPrompt per record, line-aligned.
export function buildLineVerdicts(records: TranscriptRecord[]): LineVerdict[] {
  const verdicts: LineVerdict[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    verdicts.push({
      line: index,
      uuid: record.uuid,
      type: record.type,
      verdict: getRecordVerdict(record),
      isGenuinePrompt: isGenuineUserPrompt(record),
      timestamp: record.timestamp,
      sessionId: record.sessionId,
      source: getRecordSource(record),
    });
  }
  return verdicts;
}
