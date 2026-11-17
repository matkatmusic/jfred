// The commit list of a finished step walk: it answers like a full build at every instant, and writes no commit.

import { Path } from "../src/structures/domain.ts";
import { StateConfidence, type FileKnownState } from "./engineV3_file_known_states.ts";
import type { InverseCommit } from "./engineV3_inverse_repo.ts";

// Step writes in ascending position and skips only equal-text states, so the last commit at or before the position holds the state's text.
function findStoredCommitAtOrBeforePosition(stepCommits: InverseCommit[], position: number): InverseCommit {
    let storedCommit: InverseCommit | undefined;
    for (const stepCommit of stepCommits) {
        if (stepCommit.position <= position) {
            if (storedCommit === undefined) {
                storedCommit = stepCommit;
            } else {
                if (stepCommit.position > storedCommit.position) {
                    storedCommit = stepCommit;
                }
            }
        }
    }
    if (storedCommit === undefined) {
        throw new Error(`findStoredCommitAtOrBeforePosition: no stored commit at or before position ${position}`);
    }
    return storedCommit;
}

// states: the finished walk (step.walk.knownStates). stepCommits: listInverseCommits(repoFolder, fileName, true) of the step repo, first = position 0.
export function listInverseCommitsFromWalkedStates(states: FileKnownState[], stepCommits: InverseCommit[]): InverseCommit[] {
    const diskNowInstant = stepCommits[0]!.instant;
    const derivedCommits: InverseCommit[] = [];
    for (const [position, state] of states.entries()) {
        if (state.confidence !== StateConfidence.Unknown) {
            const storedCommit = findStoredCommitAtOrBeforePosition(stepCommits, position);
            if (state.isFileAbsent !== storedCommit.isFileAbsent) {
                throw new Error(`listInverseCommitsFromWalkedStates: the absence of state ${position} differs from its stored commit ${storedCommit.position}`);
            }
            if (state.text !== storedCommit.text) {
                throw new Error(`listInverseCommitsFromWalkedStates: the text of state ${position} differs from its stored commit ${storedCommit.position}`);
            }
            let instant = state.event.instant;
            if (position === 0) {
                instant = diskNowInstant;
            }
            let jsonlPath: Path | undefined;
            let line: number | undefined;
            if (state.event.source !== undefined) {
                jsonlPath = new Path(state.event.source.filePath);
                line = state.event.source.lineNumber;
            }
            derivedCommits.push({
                commitHash: storedCommit.commitHash,
                treeHash: storedCommit.treeHash,
                position,
                eventType: state.event.type,
                moment: state.moment,
                confidence: state.confidence,
                instant,
                jsonlPath,
                line,
                isFileAbsent: state.isFileAbsent,
                removedByScript: state.event.removedByScript,
                movedAwayToFile: state.event.movedAwayToFile,
                text: state.text,
            });
        }
    }
    return derivedCommits;
}
