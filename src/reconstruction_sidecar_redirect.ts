import type { TranscriptRecord } from "./structures/envelope.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import { buildBackupTimeline, findBackupAfter, findCwd } from "./reconstruction_backup_timeline.ts";
import type { FileEvent } from "./reconstruction_events.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";

// A redirect with no resolvable backup keeps its empty content, defensive since a tracked file should always resolve.
export function fillRedirectContent(
  records: TranscriptRecord[],
  events: FileEvent[],
  reader: BackupReader,
): FileEvent[] {
  const cwd = findCwd(records);
  const timeline = buildBackupTimeline(records, cwd);
  const filledEvents: FileEvent[] = [];
  for (const event of events) {
    const isAppend = event.kind === EventKind.append;
    const isOverwrite = event.kind === EventKind.overwrite;
    const isRedirect = isAppend || isOverwrite;
    if (!isRedirect) {
      filledEvents.push(event);
      continue;
    }
    const backupFileName = findBackupAfter(timeline, cwd, event.target, event.timestamp);
    if (!backupFileName) {
      filledEvents.push(event);
      continue;
    }
    noteStage({ stage: "fillRedirectContent", target: event.target, changeId: event.changeId, detail: `filled ${event.kind} content from the file-history backup` });
    filledEvents.push({ ...event, content: reader(backupFileName) });
  }
  return filledEvents;
}
