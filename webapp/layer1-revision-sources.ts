// Task 329: revision sources; a new node kind needs only a new DiffStep-returning function here.

import { getInputById } from "./app-dom.ts";
import { type DiffStep } from "./layer1-diff-pane.ts";

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
