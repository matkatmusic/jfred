// Task 329: revision sources; a new node kind needs only a new DiffStep-returning function here.

import { getInputById } from "./app-dom.ts";
import { type DiffStep } from "./layer1-diff-pane.ts";
import { readSourceParams } from "./layer1-sources.ts";

const SHORT_HASH_LENGTH = 8;

// One fetch per step, memoized: toggling context width or stepping back never re-reads a side.
function loadViaFileRoute(buildParams: () => URLSearchParams): () => Promise<string> {
    let cached: Promise<string> | undefined;
    return () => {
        cached ??= fetch(`/api/layer1-file?${buildParams()}`).then(async (response) => {
            if (!response.ok) {
                throw new Error(await response.text());
            }
            return (await response.json() as { content: string }).content;
        });
        return cached;
    };
}

export function describeCommitStep(path: string, hash: string): DiffStep {
    const buildParams = (): URLSearchParams =>
        new URLSearchParams({ repo: getInputById("repo").value.trim(), path, hash });
    return { marker: hash.slice(0, SHORT_HASH_LENGTH), buildParams, loadContent: loadViaFileRoute(buildParams) };
}

export function describeDiskStep(path: string): DiffStep {
    const buildParams = (): URLSearchParams =>
        new URLSearchParams({ dir: getInputById("dir").value.trim(), path });
    return { marker: "on disk", buildParams, loadContent: loadViaFileRoute(buildParams) };
}

// Task 343: one side of an Edit/Write/Read node, replayed by the server; the changeId is the node's identity.
export function describeEditSide(path: string, changeId: string, side: "base" | "target", marker: string, isBranch = false): DiffStep {
    const buildParams = (): URLSearchParams => {
        const params = new URLSearchParams({
            editChangeId: changeId,
            side,
            path,
            dir: getInputById("dir").value.trim(),
        });
        // Task 357: a branch lane node reads the disk timeline revision, not the trunk replay.
        if (isBranch) {
            params.set("branch", "1");
        }
        for (const folder of readSourceParams().getAll("jsonl")) {
            params.append("jsonl", folder);
        }
        return params;
    };
    return { marker, buildParams, loadContent: loadViaFileRoute(buildParams) };
}

export function describeEditSteps(path: string, changeId: string, isBranch = false): DiffStep[] {
    return [describeEditSide(path, changeId, "base", "before", isBranch), describeEditSide(path, changeId, "target", "after", isBranch)];
}

export type SnapshotIdentity = { sessionFile: string; sessionId: string; version: number };

export function describeSnapshotStep(path: string, snapshot: SnapshotIdentity): DiffStep {
    const buildParams = (): URLSearchParams => new URLSearchParams({
        snapshotSession: snapshot.sessionFile,
        sessionId: snapshot.sessionId,
        version: String(snapshot.version),
        path,
        dir: getInputById("dir").value.trim(),
    });
    return { marker: `@v${snapshot.version} 📸`, buildParams, loadContent: loadViaFileRoute(buildParams) };
}
