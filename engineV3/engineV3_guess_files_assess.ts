// Gathers the facts of one project file and gives its guess category and the details the report lists.

import type { Path } from "../src/structures/domain.ts";
import type { GuessCategory } from "../src/structures/vocabulary.ts";
import { readFileTextAtBoundary, type EarliestBoundary } from "./engineV3_earliest_boundary.ts";
import type { FileKnownState } from "./engineV3_file_known_states.ts";
import { chooseGuessCategory, describeEventsAfterBoundary, listGuessStatesOfFile } from "./engineV3_guess_files.ts";
import { listPathsNamedInLines } from "./engineV3_guess_files_paths.ts";
import type { FileEvent } from "./engineV3_replay_reverse_events.ts";

// const MAXIMUM_OTHER_PATHS = 3;

export type GuessAssessment = { file: Path; category: GuessCategory | undefined; guessStates: FileKnownState[]; otherPaths: string[] };

// Only the files that need guesses have an entry.
export function mapGuessCategoriesByFile(assessments: GuessAssessment[]): Map<string, GuessCategory> {
    const categoryByFile = new Map<string, GuessCategory>();
    for (const assessment of assessments) {
        if (assessment.category !== undefined) {
            categoryByFile.set(assessment.file.toString(), assessment.category);
        }
    }
    return categoryByFile;
}

// The events are those of the TUI (the boundary is already applied); the lines are the log lines that name the file name.
export function assessFileGuesses(file: Path, events: FileEvent[], lines: unknown[], boundary: EarliestBoundary | undefined): GuessAssessment {
    const afterBoundary = describeEventsAfterBoundary(events, boundary?.instant);
    let guessStates: FileKnownState[] = [];
    let isAbsentAtBoundary = false;
    let isPathNamedInLines = true;
    let otherPaths: string[] = [];
    if (afterBoundary.hasModifyingEvent) {
        guessStates = listGuessStatesOfFile(events);
    } else {
        if (boundary !== undefined) {
            const fileAtBoundary = readFileTextAtBoundary(boundary, file);
            if (fileAtBoundary.isInsideRepo) {
                isAbsentAtBoundary = fileAtBoundary.text === undefined;
            }
        }
        const namedPaths = listPathsNamedInLines(lines, file);
        isPathNamedInLines = namedPaths.includes(file.toString());
        // otherPaths = namedPaths.filter((namedPath) => namedPath !== file.toString()).slice(0, MAXIMUM_OTHER_PATHS);
        otherPaths = namedPaths.filter((namedPath) => namedPath !== file.toString());
    }
    const category = chooseGuessCategory({ hasModifyingEventAfterBoundary: afterBoundary.hasModifyingEvent, hasReadEventAfterBoundary: afterBoundary.hasReadEvent, guessStateCount: guessStates.length, isAbsentAtBoundary, lineCount: lines.length, isPathNamedInLines });
    return { file, category, guessStates, otherPaths };
}
