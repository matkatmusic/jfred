// The terminal UI's per-file walk state: one run state per file path.

import { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus } from "../../src/structures/vocabulary.ts";

export type FileRunState = { status: FileWalkStatus; reasonText: string | undefined; failedReplayCount: number };

export class WalkState {
    private readonly runStateByPathString = new Map<string, FileRunState>();

    getRunState(file: Path): FileRunState | undefined {
        return this.runStateByPathString.get(file.toString());
    }

    setRunState(file: Path, runState: FileRunState): void {
        this.runStateByPathString.set(file.toString(), runState);
    }

    clearRunState(file: Path): void {
        this.runStateByPathString.delete(file.toString());
    }

    listFiles(): Path[] {
        const files: Path[] = [];
        for (const pathString of this.runStateByPathString.keys()) {
            files.push(new Path(pathString));
        }
        return files;
    }
}

export function createWalkState(): WalkState {
    return new WalkState();
}

export function getFileRunState(walkState: WalkState, file: Path): FileRunState {
    const knownRunState = walkState.getRunState(file);
    if (knownRunState === undefined) {
        return { status: FileWalkStatus.Idle, reasonText: undefined, failedReplayCount: 0 };
    }
    return knownRunState;
}

export function setFileRunState(walkState: WalkState, file: Path, runState: FileRunState): void {
    walkState.setRunState(file, runState);
}

export function clearFileRunState(walkState: WalkState, file: Path): void {
    walkState.clearRunState(file);
}

export function listFilesWithRunState(walkState: WalkState): Path[] {
    return walkState.listFiles();
}
