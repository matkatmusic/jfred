// Lets a live step carry on after a replay filled a gap.
import type { FileStep } from "./engineV3_file_step.ts";
import type { ReplayGap } from "./engineV3_script_replay_gaps.ts";

// textByPosition: one entry for every position of gap.droppedStates (the writer rule, engineV3_script_replay_writer.ts).
export function acceptReplayedTexts(step: FileStep, gap: ReplayGap, textByPosition: Map<number, string | undefined>): void {
    for (const droppedState of gap.droppedStates) {
        if (droppedState.position <= step.lastWrittenPosition) {
            throw new Error(`acceptReplayedTexts: dropped position ${droppedState.position} is not above the tip ${step.lastWrittenPosition}`);
        }
    }
    const oldestPosition = gap.droppedStates[gap.droppedStates.length - 1]!.position;
    const oldestText = textByPosition.get(oldestPosition);
    step.lastWrittenPosition = oldestPosition;
    step.lastWrittenText = oldestText;
    step.lastWrittenIsFileAbsent = oldestText === undefined;
    step.queue = step.queue.filter((queuedState) => queuedState.position > oldestPosition);
}
