// The play queue of the step pool: play requests run strictly one after the other, each as a whole unit.

import type { PlayOutcome } from "./engineV3_tui_walk_types.ts";

export interface PlayQueue {
    enqueuePlay(startPlay: () => Promise<PlayOutcome>): Promise<PlayOutcome>;
}

export function createPlayQueue(): PlayQueue {
    let previousPlay: Promise<PlayOutcome | void> = Promise.resolve();

    function enqueuePlay(startPlay: () => Promise<PlayOutcome>): Promise<PlayOutcome> {
        // The same function runs after a fulfilled or a rejected previous play, so one failed play does not block the next.
        const thisPlay = previousPlay.then(startPlay, startPlay);
        previousPlay = thisPlay;
        return thisPlay;
    }

    return { enqueuePlay };
}
