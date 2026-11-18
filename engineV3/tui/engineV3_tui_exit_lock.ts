// The lock file the viewer removes when its process ends, so a crash does not leave a lock behind.

import { existsSync, readFileSync, rmSync } from "node:fs";
import type { Path } from "../../src/structures/domain.ts";

let lockFileToRemoveAtExit: Path | undefined = undefined;

export function setLockFileToRemoveAtExit(lockFile: Path): void {
    lockFileToRemoveAtExit = lockFile;
}

export function removeLockFileOfThisProcessAtExit(): void {
    if (lockFileToRemoveAtExit !== undefined) {
        if (existsSync(lockFileToRemoveAtExit.toString())) {
            if (readFileSync(lockFileToRemoveAtExit.toString(), "utf8").trim() === String(process.pid)) {
                rmSync(lockFileToRemoveAtExit.toString());
            }
        }
    }
}
