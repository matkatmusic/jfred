// A file moved or copied onto its path by a script: the old path holds the history from before that moment.

import type { Path } from "../src/structures/domain.ts";
import type { FileEvent } from "./engineV3_replay_reverse_events.ts";

export interface MoveOrigin {
    oldPath: Path;
    movedAt: Date;
}

export function listMoveOriginsNewestFirst(events: FileEvent[]): MoveOrigin[] {
    const moveOrigins: MoveOrigin[] = [];
    for (const event of events) {
        if (event.moveOrCopySourceFile !== undefined) {
            if (event.instant === undefined) {
                throw new Error(`listMoveOriginsNewestFirst: the event that moves ${event.moveOrCopySourceFile.toString()} has no instant`);
            }
            moveOrigins.push({ oldPath: event.moveOrCopySourceFile, movedAt: event.instant });
        }
    }
    return moveOrigins;
}
