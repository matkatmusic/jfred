// The viewer's diff/patch rendering layer: per-file revision diffs, diff-vs-base, the range
// patch over step snapshots, and the trust-boundary query parsing for those routes. Pure
// functions over the existing engine — the HTTP wiring lives in viewer_server.ts.

import { relative, sep } from "node:path";
import type { ReconstructionDocument } from "./reconstruction_json.ts";
import type { StepSnapshot } from "./reconstruction_json_steps.ts";
import { resolveFilesAtStep } from "./reconstruction_steps.ts";
import type { FileHistory } from "./reconstruction_engine.ts";
import { renderDiffWithContext, renderGitFileDiff } from "./reconstruction_render_unified.ts";
import type { Path } from "./structures/domain.ts";

// The document's reconstructed history for one file, or a loud error naming the path.
function findFileHistory(document: ReconstructionDocument, filePath: Path): FileHistory {
    const history = document.filesTouched.find((entry) => entry.target.equals(filePath));
    if (history === undefined) {
        throw new Error(`no reconstructed history for ${filePath.toString()}`);
    }
    return history;
}

// The revision-timeline view's text: consecutive-revision diffs for one file, with unified
// hunks + context so the client can render surrounding lines and line-number gutters.
export function renderRevisionDiff(document: ReconstructionDocument, filePath: Path, fullContext: boolean = false): string {
    return renderDiffWithContext(findFileHistory(document, filePath).revisions, fullContext);
}

// The Diff-vs-Base view's text: the file's first revision against the selected one (0-based).
export function renderDiffVsBase(document: ReconstructionDocument, filePath: Path, revisionIndex: number): string {
    const revisions = findFileHistory(document, filePath).revisions;
    const first = revisions[0];
    const selected = revisions[revisionIndex];
    if (first === undefined || selected === undefined) {
        throw new Error(`revision ${revisionIndex} out of range 0..${revisions.length - 1}`);
    }
    return renderDiffWithContext([first, selected]);
}

// Counts how many leading directory segments two segment lists share.
function countSharedLeadingSegments(prefix: string[], segments: string[]): number {
    let shared = 0;
    const limit = Math.min(prefix.length, segments.length);
    while (shared < limit) {
        if (prefix[shared] !== segments[shared]) {
            break;
        }
        shared += 1;
    }
    return shared;
}

// The directory every range-patch path is relativized against: the longest common directory
// prefix across every file the reconstruction ever tracked — in practice the session's cwd,
// since every tracked file lives under it. Stable for a given reconstruction regardless of the range.
// ponytail: prefix heuristic — carry the records' cwd on the document if multi-root projects appear.
export function computePatchRoot(stepFileHistories: FileHistory[]): string {
    const trackedPaths = new Set<string>();
    for (const history of stepFileHistories) {
        trackedPaths.add(history.target.toString());
    }
    const directorySegmentLists = [...trackedPaths].map((path) => path.split(sep).slice(0, -1));
    if (directorySegmentLists.length === 0) {
        return sep;
    }
    let prefix = directorySegmentLists[0]!;
    for (const segments of directorySegmentLists.slice(1)) {
        prefix = prefix.slice(0, countSharedLeadingSegments(prefix, segments));
    }
    return prefix.join(sep) || sep;
}

// One positive-integer query param, or a loud throw the server maps to 400.
function parsePositiveIntegerParam(query: URLSearchParams, name: string): number {
    const raw = query.get(name);
    if (raw === null) {
        throw new Error(`missing query param: ${name}`);
    }
    const value = Number(raw);
    if (!Number.isInteger(value)) {
        throw new Error(`${name} must be an integer, got: ${raw}`);
    }
    if (value < 1) {
        throw new Error(`${name} must be >= 1, got: ${raw}`);
    }
    return value;
}

// Trust-boundary parsing for GET /api/range-patch: both step params are required 1-based positive
// integers. Range validation against the document happens in renderRangePatch (it knows steps.length).
export function parseRangePatchQuery(query: URLSearchParams): { fromStep: number; toStep: number } {
    return {
        fromStep: parsePositiveIntegerParam(query, "fromStep"),
        toStep: parsePositiveIntegerParam(query, "toStep"),
    };
}

// Trust-boundary parsing for GET /api/step-files: `step` is a required 1-based positive integer.
export function parseStepFilesQuery(query: URLSearchParams): { step: number } {
    return { step: parsePositiveIntegerParam(query, "step") };
}

// The { path: content } map of every file present at a 1-based step, resolved ON DEMAND from the
// compact histories (skeleton steps carry no file map). One step's map is one repo snapshot — bounded,
// not multiplied. Loud throw (server -> 400) when the step is out of range.
export function resolveStepFiles(stepFileHistories: FileHistory[], steps: StepSnapshot[], stepNumber: number): Record<string, string> {
    if (stepNumber < 1 || stepNumber > steps.length) {
        throw new Error(`step ${stepNumber} out of range 1..${steps.length}`);
    }
    return resolveFilesAtStep(stepFileHistories, steps[stepNumber - 1]!.when);
}

// One git-apply-able unified diff covering every file whose content differs between the snapshot
// BEFORE `fromStep` and the snapshot AT `toStep` (1-based step indexes; the snapshot before step 1
// is empty). A path present only in `after` is a creation; only in `before`, a deletion.
export function renderRangePatch(stepFileHistories: FileHistory[], steps: StepSnapshot[], fromStep: number, toStep: number): string {
    if (fromStep < 1) {
        throw new Error(`fromStep ${fromStep} out of range 1..${steps.length}`);
    }
    if (toStep > steps.length) {
        throw new Error(`toStep ${toStep} out of range 1..${steps.length}`);
    }
    if (fromStep > toStep) {
        throw new Error(`fromStep ${fromStep} exceeds toStep ${toStep}`);
    }
    // The snapshot BEFORE step 1 is empty; otherwise resolve each endpoint's files on demand from the
    // compact histories (no per-step file map exists on the document anymore).
    const before: Record<string, string> = fromStep >= 2 ? resolveFilesAtStep(stepFileHistories, steps[fromStep - 2]!.when) : {};
    const after = resolveFilesAtStep(stepFileHistories, steps[toStep - 1]!.when);
    const root = computePatchRoot(stepFileHistories);
    const changedPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((path) => before[path] !== after[path])
        .sort();
    return changedPaths
        .map((path) => renderGitFileDiff(relative(root, path), before[path], after[path]))
        .join("");
}
