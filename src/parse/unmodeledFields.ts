import { UnmodeledFieldError, findUnmodeledTopLevelKeys } from "./recordKeys.ts";
import type { ProgressSink } from "./loadTranscript.ts";
import type { TranscriptRecord } from "../structures/envelope.ts";
import { DocumentResponseKind } from "../structures/vocabulary_views.ts";

export function assertOnlyKnownTopLevelKeys(record: TranscriptRecord): void {
  const unmodeled = findUnmodeledTopLevelKeys(record);
  if (unmodeled.length > 0) {
    throw new UnmodeledFieldError(record.type, unmodeled[0]!);
  }
}

// Strict mode guards the CLI/tests; tolerant mode lets the viewer open real sessions with unmodeled fields, reporting each once.
export function reportUnmodeledTopLevelFields(
  record: TranscriptRecord,
  reportedUnmodeled: Set<string>,
  onProgress: ProgressSink | undefined,
): void {
  for (const key of findUnmodeledTopLevelKeys(record)) {
    reportUnmodeledFieldOnce(record, key, reportedUnmodeled, onProgress);
  }
}

function reportUnmodeledFieldOnce(
  record: TranscriptRecord,
  key: string,
  reportedUnmodeled: Set<string>,
  onProgress: ProgressSink | undefined,
): void {
  const reportId = `${record.type}::${key}`;
  const isAlreadyReported = reportedUnmodeled.has(reportId);
  if (!isAlreadyReported) {
    reportedUnmodeled.add(reportId);
    onProgress?.({ kind: DocumentResponseKind.progress, label: `unmodeled field "${key}" on ${record.type} record` });
  }
}
