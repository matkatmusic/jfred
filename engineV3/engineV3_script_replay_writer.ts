// Writer: turns the replayed texts of one gap into commits at the dropped positions of a file's inverse repo.

import type { Path } from "../src/structures/domain.ts";
import { StateConfidence, StateMoment } from "./engineV3_file_known_states.ts";
import { insertStatesIntoInverseRepo, listInverseCommits, type InverseCommit, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import { isGapHalfDropped, type ReplayGap } from "./engineV3_script_replay_gaps.ts";

export type GapWriteReport = { insertedPositions: number[]; confidence: StateConfidence; isEqualToNewerCommit: boolean };

// A step repo is sparse, so the newer commit of a gap may be the tip below gap.newerPosition.
export function findNewerCommitOfGap(commits: InverseCommit[], gap: ReplayGap): InverseCommit | undefined {
    let newerCommit: InverseCommit | undefined;
    for (const inverseCommit of commits) {
        if (inverseCommit.position <= gap.newerPosition) {
            if (newerCommit === undefined) {
                newerCommit = inverseCommit;
            } else {
                if (inverseCommit.position > newerCommit.position) {
                    newerCommit = inverseCommit;
                }
            }
        }
    }
    return newerCommit;
}

// textByPosition has one entry for every position in gap.droppedStates; undefined means the file is absent.
export function writeReplayedGapIntoInverseRepo(repoFolder: Path, fileName: string, gap: ReplayGap, textByPosition: Map<number, string | undefined>): GapWriteReport {
    // const newerCommit = listInverseCommits(repoFolder, fileName).find((inverseCommit) => inverseCommit.position === gap.newerPosition);
    const newerCommit = findNewerCommitOfGap(listInverseCommits(repoFolder, fileName), gap);
    if (newerCommit === undefined) {
        throw new Error(`writeReplayedGapIntoInverseRepo: ${fileName} has no commit at the newer position ${gap.newerPosition}`);
    }
    if (isGapHalfDropped(gap, newerCommit)) {
        throw new Error(`writeReplayedGapIntoInverseRepo: the gap of ${fileName} below position ${gap.newerPosition} is half dropped`);
    }
    for (const droppedState of gap.droppedStates) {
        if (!textByPosition.has(droppedState.position)) {
            throw new Error(`writeReplayedGapIntoInverseRepo: no text for position ${droppedState.position} of ${fileName}`);
        }
    }
    const finalText = textByPosition.get(gap.droppedStates[0]!.position);
    const isEqualToNewerCommit = finalText === newerCommit.text;
    let gapConfidence = StateConfidence.Derived;
    if (isEqualToNewerCommit) {
        gapConfidence = StateConfidence.Proven;
    }
    const orderedStates: OrderedKnownState[] = [];
    for (const [index, droppedState] of gap.droppedStates.entries()) {
        const text = textByPosition.get(droppedState.position);
        let confidence = gapConfidence;
        const isOldestDroppedState = index === gap.droppedStates.length - 1;
        if (gap.olderPosition === undefined) {
            if (isOldestDroppedState) {
                if (droppedState.state.moment === StateMoment.BeforeEvent) {
                    confidence = StateConfidence.Derived;
                }
            }
        }
        orderedStates.push({ state: { ...droppedState.state, confidence, isFileAbsent: text === undefined, text }, position: droppedState.position });
    }
    insertStatesIntoInverseRepo(repoFolder, fileName, orderedStates);
    return {
        insertedPositions: orderedStates.map((orderedState) => orderedState.position),
        confidence: orderedStates[0]!.state.confidence,
        isEqualToNewerCommit,
    };
}
