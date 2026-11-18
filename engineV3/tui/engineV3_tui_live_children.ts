// The registry of the live child processes of the terminal UI and the exit handler that ends them.

import type { ChildProcess } from "node:child_process";
import type { Path } from "../../src/structures/domain.ts";
import { removeLockFileOfThisProcessAtExit, setLockFileToRemoveAtExit } from "./engineV3_tui_exit_lock.ts";

export type LiveChild = { child: ChildProcess; file: Path | undefined };

export const liveChildren = new Map<number, LiveChild>();
let isExitHandlerRegistered = false;

function endAllProcessGroupsAtExit(): void {
    for (const childId of liveChildren.keys()) {
        process.kill(-childId, "SIGTERM");
    }
    removeLockFileOfThisProcessAtExit();
}

export function ensureExitHandlerIsRegistered(): void {
    if (!isExitHandlerRegistered) {
        process.on("exit", endAllProcessGroupsAtExit);
        isExitHandlerRegistered = true;
    }
}

export function registerLockFileForExit(lockFile: Path): void {
    setLockFileToRemoveAtExit(lockFile);
    ensureExitHandlerIsRegistered();
}
