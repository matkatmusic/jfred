// Types of the progress bar puzzle of one file: the hops that rebuild it and the reason it stops.

import { createHash } from "node:crypto";
import type { Path } from "../src/structures/domain.ts";
import type { PuzzleFailureReason } from "../src/structures/vocabulary.ts";

// sha256 hex of the bytes: the same hash the inverse repo stamp uses for the file on disk.
export function computeBytesHash(bytes: string | Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

export interface JSONLHop {
    jsonlFile: Path;
    lineNumber: number;
}

export interface GitHop {
    repo: Path;
    commit: string;
}

export interface Hop {
    jsonlHop?: JSONLHop;
    gitHop?: GitHop;
}

export interface OnDiskFile {
    file: Path;
    hashNow: string;
}

export interface FullyReconstructibleFile {
    hops: Hop[];
    onDiskFile: OnDiskFile;
}

export interface RequiresFurtherResearchFile {
    onDiskFile: OnDiskFile;
    hops: Hop[];
    lastAttemptedHop: JSONLHop | undefined;
    failureReason: PuzzleFailureReason;
    failureDetail: string | undefined;
}

export interface ProgressBarPuzzle {
    file: OnDiskFile;
    hops: Hop[];
    bytes: string;
    // true when the replay ends with the file absent; bytes is then "".
    isFileAbsentAtEnd?: boolean;
    lastAttemptedHop: JSONLHop | undefined;
    failureReason: PuzzleFailureReason | undefined;
    failureDetail: string | undefined;
}

export interface ReconstructionCache {
    fullyReconstructibleFiles: FullyReconstructibleFile[];
    requiresFurtherResearchFiles: RequiresFurtherResearchFile[];
}

// hashNow of a file that is not on disk now.
export const ABSENT_FILE_HASH = "absent";

export function isProgressBarPuzzleSolved(puzzle: ProgressBarPuzzle): boolean {
    if (puzzle.isFileAbsentAtEnd === true) {
        return puzzle.file.hashNow === ABSENT_FILE_HASH;
    }
    return computeBytesHash(puzzle.bytes) === puzzle.file.hashNow;
}
