// The h key: the file rows show only the files that need guesses.

import type { Path } from "../../src/structures/domain.ts";
import type { GuessCategory } from "../../src/structures/vocabulary.ts";

export function listShownFiles(files: Path[], guessCategoryByFile: Map<string, GuessCategory>, isGuessFilterOn: boolean): Path[] {
    if (!isGuessFilterOn) {
        return files;
    }
    return files.filter((file) => guessCategoryByFile.has(file.toString()));
}

// The cursor stays on its file when that file is shown, and goes to the first row otherwise.
export function findCursorIndexOfFile(shownFiles: Path[], cursorFile: Path): number {
    const index = shownFiles.findIndex((file) => file.value === cursorFile.value);
    if (index === -1) {
        return 0;
    }
    return index;
}
