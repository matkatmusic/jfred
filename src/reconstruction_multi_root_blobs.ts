// Task 301: first configured root wins; differing later bytes report to the health sink.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Path, type Uuid } from "./structures/domain.ts";
import { FailureScope } from "./structures/vocabulary.ts";
import { noteReconstructionFailure } from "./reconstruction_health.ts";

function readBlobIfPresent(root: Path, sessionId: Uuid, backupFileName: Path): string | undefined {
    const blobPath = join(root.toString(), sessionId.toString(), backupFileName.toString());
    if (!existsSync(blobPath)) {
        return undefined;
    }
    return readFileSync(blobPath, "utf8");
}

// A blob missing in an earlier root falls through to the next; undefined when no root holds it.
export function resolveBlobAcrossRoots(
    roots: readonly Path[],
    sessionId: Uuid,
    backupFileName: Path,
): string | undefined {
    let winner: { root: Path; content: string } | undefined;
    for (const root of roots) {
        const content = readBlobIfPresent(root, sessionId, backupFileName);
        if (content === undefined) {
            continue;
        }
        if (winner === undefined) {
            winner = { root, content };
            continue;
        }
        if (content !== winner.content) {
            noteReconstructionFailure({
                scope: FailureScope.fileStage,
                stage: "resolveBlobAcrossRoots",
                target: new Path(join(sessionId.toString(), backupFileName.toString())),
                reason: `cross-root snapshot conflict: bytes in ${root.toString()} differ from earlier root ${winner.root.toString()}; using the earlier root`,
            });
        }
    }
    return winner?.content;
}
