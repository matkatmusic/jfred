// Starts the replay at event M: rebuilds the files from the snapshot store, then skips the events before M.

import type { Path } from "../src/structures/domain.ts";
import { TimelineEventKind, type TimelineEvent } from "./engineV3.ts";
import { recordPendingWritesOfSkippedLine } from "./engineV3_replay_apply.ts";
import type { ScriptReplayContext } from "./engineV3_replay_script.ts";
import { listSkipFolders, removeTimeStampPrefix, type SnapshotLoop } from "./engineV3_replay_snapshot_loop.ts";
import { applyEventSnapshots, moveLaterEventsToOld, readEventSnapshotText } from "./engineV3_replay_snapshot_restore.ts";
import { scanWatchedFolders } from "./engineV3_replay_snapshot_scan.ts";
import { listTouchedAbsolutePaths } from "./engineV3_replay_touched.ts";

// watchPaths holds every folder to watch besides the state folder, the /tmp folder included
export function createSnapshotLoopAtEvent(store: Path, state: Path, watchPaths: Path[], startAtEvent: number): SnapshotLoop {
  const previousEventFileName = applyEventSnapshots(store, startAtEvent);
  moveLaterEventsToOld(store, startAtEvent);
  const watchedFolders = [state, ...watchPaths];
  const previousScan = scanWatchedFolders(watchedFolders, listSkipFolders(store), new Map());
  const touchedCount = listTouchedAbsolutePaths().length;
  return { store, watchedFolders, previousScan, eventNumber: startAtEvent - 1, previousEventFileName, touchedCount };
}

export function assertEventTextMatchesStore(store: Path, eventFileName: string, eventText: string): void {
  const replayedText = removeTimeStampPrefix(eventText);
  const storedText = readEventSnapshotText(store, eventFileName);
  if (replayedText !== storedText) {
    throw new Error(`assertEventTextMatchesStore: the timeline changed, so the store cannot be used.\nstored event text: ${storedText}\nreplayed event text: ${replayedText}`);
  }
}

export function recordPendingWritesOfSkippedEvent(state: Path, event: TimelineEvent, context: ScriptReplayContext): void {
  if (event.type === TimelineEventKind.JSONLLine) {
    recordPendingWritesOfSkippedLine(state, event.line, context);
  }
}

export function skipEventBeforeStartAt(snapshotLoop: SnapshotLoop | undefined, eventText: string, eventNumber: number, startAtEvent: number | undefined): boolean {
  if (startAtEvent === undefined) {
    return false;
  }
  if (eventNumber >= startAtEvent) {
    return false;
  }
  if (eventNumber === startAtEvent - 1) {
    if (snapshotLoop === undefined) {
      throw new Error("skipEventBeforeStartAt: a start-at replay needs a snapshot loop");
    }
    assertEventTextMatchesStore(snapshotLoop.store, snapshotLoop.previousEventFileName, eventText);
  }
  return true;
}
