// Built on the branch-agnostic core so disk keeps abandoned-branch writes after a conv-only rewind, matching the runner's `.step_states` snapshots.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path, Uuid } from "./structures/domain.ts";
import {
    lastRevisionAtOrBefore,
    linesTextOf,
} from "./reconstruction_revisions.ts";
import { reconstructFilesOver } from "./reconstruction_renderable.ts";
import type { FileHistory, FileRevision, RenameInfo } from "./reconstruction_engine.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

// A file absent at the step is simply not a key.
export type RepoSnapshot = ReadonlyMap<Path, string>;

// The engine drops the file's single trailing newline at replay, so this omits it too.
function renderRevisionText(revision: FileRevision): string {
    return linesTextOf(revision).join("\n");
}

// Two revisions sharing a timestamp are one step, so timestamps de-duplicate by millisecond value.
function collectChangeTimes(histories: FileHistory[]): Date[] {
    const byMillis = new Map<number, Date>();
    for (const history of histories) {
        for (const revision of history.revisions) {
            byMillis.set(revision.timestamp.getTime(), revision.timestamp);
        }
    }
    return [...byMillis.values()].sort((a, b) => a.getTime() - b.getTime());
}

// ponytail: two lineages resolving to the same name-at-time have the later win; impossible on a real disk, revisit if seen.
function pathAtTime(history: FileHistory, when: Date): Path {
    const renames = history.revisions.filter(
        (revision): revision is FileRevision & { rename: RenameInfo } => revision.rename !== undefined,
    );
    renames.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (renames.length === 0) {
        return history.target;
    }
    const renamesAtOrBefore = renames.filter((revision) => revision.timestamp.getTime() <= when.getTime());
    const latestAtOrBefore = renamesAtOrBefore.at(-1);
    if (latestAtOrBefore !== undefined) {
        return latestAtOrBefore.rename.to;
    }
    return renames[0]!.rename.from;
}

// Keyed by the name the file held AT `when`, so a step before a rename shows the old name.
export function produceRepoStateAtTime(histories: FileHistory[], when: Date): RepoSnapshot {
    const snapshot = new Map<Path, string>();
    for (const history of histories) {
        const revision = lastRevisionAtOrBefore(history.revisions, when);
        if (revision !== undefined) {
            snapshot.set(pathAtTime(history, when), renderRevisionText(revision));
        }
    }
    return snapshot;
}

// Plain-object form because a RepoSnapshot Map stringifies to `{}`; resolved on demand to bound wire size.
export function resolveFilesAtStep(histories: FileHistory[], when: Date): Record<string, string> {
    const files: Record<string, string> = {};
    for (const [path, text] of produceRepoStateAtTime(histories, when)) {
        files[path.toString()] = text;
    }
    return files;
}

// Both come from ONE reconstruction pass; per-step repo states are resolved on demand, not materialized.
export type StepTimeline = { histories: FileHistory[]; changes: StepChange[] };

export function reconstructStepTimeline(
    records: TranscriptRecord[],
    reader?: BackupReader,
): StepTimeline {
    reportReconstructionProgress(`reconstructing step states from ${records.length} transcript records`);
    const histories = reconstructFilesOver(records, reader);
    const changeTimes = collectChangeTimes(histories);
    return {
        histories,
        changes: changeTimes.map((when) => ({ when, changeIds: changeIdsAt(histories, when) })),
    };
}

// Reconstructs over EXACTLY the given records (no surviving-branch filter) so the timeline is literal disk.
export function reconstructStepStates(
    records: TranscriptRecord[],
    reader?: BackupReader,
): RepoSnapshot[] {
    const { histories, changes } = reconstructStepTimeline(records, reader);
    return changes.map((change) => produceRepoStateAtTime(histories, change.when));
}

// Counted from the change instants without materializing any repo state.
export function countStepsInTranscript(
    records: TranscriptRecord[],
    reader?: BackupReader,
): number {
    return reconstructStepTimeline(records, reader).changes.length;
}


// Matched on a path boundary so `s2_original.py` does not match `tests/test_s2_original.py`.
function keyDenotes(keyPath: Path, relativePath: string): boolean {
    const key = keyPath.toString();
    return key === relativePath || key.endsWith(`/${relativePath}`);
}

export function snapshotFileText(snapshot: RepoSnapshot, relativePath: string): string | undefined {
    for (const [path, text] of snapshot) {
        if (keyDenotes(path, relativePath)) {
            return text;
        }
    }
    return undefined;
}

// The engine's newline-joined text omits the trailing newline that on-disk ground-truth files keep.
export function stripTrailingNewline(text: string): string {
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function snapshotReproduces(snapshot: RepoSnapshot, groundTruth: ReadonlyMap<string, string>): boolean {
    return [...groundTruth].every(([relativePath, content]) => {
        const reconstructed = snapshotFileText(snapshot, relativePath);
        return reconstructed !== undefined && reconstructed === stripTrailingNewline(content);
    });
}

// Pass/fail is "some step matches", never a positional alignment with instruction-numbered folders.
export function someStepReproduces(
    steps: RepoSnapshot[],
    groundTruth: ReadonlyMap<string, string>,
): boolean {
    return steps.some((snapshot) => snapshotReproduces(snapshot, groundTruth));
}


// One step is one millisecond, so a mismatch can name the JSONL record(s) that produced the step's bytes.
export type StepChange = { when: Date; changeIds: Uuid[] };

function changeIdsAt(histories: FileHistory[], when: Date): Uuid[] {
    return histories.flatMap((history) => {
        const revisionsAtInstant = history.revisions.filter((revision) => revision.timestamp.getTime() === when.getTime());
        return revisionsAtInstant.map((revision) => revision.changeId);
    });
}

// Same order and count as reconstructStepStates (both map over collectChangeTimes), so stepChanges[i] explains steps[i].
export function reconstructStepChanges(
    records: TranscriptRecord[],
    reader?: BackupReader,
): StepChange[] {
    return reconstructStepTimeline(records, reader).changes;
}

// Uses the same `### <path>` framing as the verbose/diff views.
export function renderRepoSnapshot(snapshot: RepoSnapshot): string {
    const paths = [...snapshot.keys()].sort((a, b) => a.toString().localeCompare(b.toString()));
    return paths.map((path) => `### ${path}\n${snapshot.get(path)}`).join("\n\n");
}

