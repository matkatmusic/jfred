// Default list view for the reconstruction engine: one block per touched file
// with its numbered entries (kind, line count or rename/copy detail, short time,
// short change id). Pure over FileHistory[]. Design: reconstruction_engine.ts.

import type {
    BranchedReconstruction,
    FileHistory,
    FileRevision,
} from "./reconstruction_engine.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { shortUuid } from "./reconstruction_branch.ts";
import { getBaseName, shortenChangeId } from "./reconstruction_labels.ts";
import type { Path } from "./structures/domain.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";
import { renderDiff, renderVerbose } from "./reconstruction_render.ts";

// Render histories in the verbose/diff mode, each under its `### <path>` header. (Moved from
// reconstruction_cli.ts with filterByTarget/renderChosen — task 192 line-cap split.)
function renderHistories(
    histories: FileHistory[],
    render: (revisions: FileRevision[]) => string,
): string {
    const sections = histories.map((history) => `### ${history.target}\n${render(history.revisions)}`);
    return sections.join("\n\n");
}

// The histories matching --target (by exact final path), or all of them when no --target is given.
export function filterByTarget(
    histories: FileHistory[],
    target: Path | undefined,
): FileHistory[] {
    if (target === undefined) {
        return histories;
    }
    return histories.filter((history) => history.target.toString() === target.toString());
}

// Render a chosen set of histories in the selected view (list/verbose/diff), narrowed to --target
// when one is given. Shared by every branch view so the flags compose uniformly.
export function renderChosen(histories: FileHistory[], options: CliOptions): string {
    const chosen = filterByTarget(histories, options.target);
    if (options.diff) {
        return renderHistories(chosen, renderDiff);
    }
    if (options.verbose) {
        return renderHistories(chosen, renderVerbose);
    }
    return renderHistoryList(chosen);
}

// The clock portion of a timestamp (HH:MM:SSZ).
function formatShortTime(date: Date): string {
    return `${date.toISOString().slice(11, 19)}Z`;
}

// A short label for the kind that produced an entry.
function getEntryLabel(kind: EventKind): string {
    if (kind === EventKind.write) {
        return "create";
    }
    if (kind === EventKind.edit) {
        return "edit";
    }
    if (kind === EventKind.rename) {
        return "rename";
    }
    if (kind === EventKind.copy) {
        return "copy";
    }
    if (kind === EventKind.overwrite) {
        return "overwrite";
    }
    if (kind === EventKind.append) {
        return "append";
    }
    if (kind === EventKind.userEdit) {
        return "user-edit";
    }
    return "delete";
}

// The line-count change versus the previous entry, e.g. `  (+4)` / `  (−1)`.
function getEntryDelta(
    previous: FileRevision | undefined,
    revision: FileRevision,
): string {
    if (!previous) {
        return "";
    }
    const diff = revision.lines.length - previous.lines.length;
    if (diff === 0) {
        return "";
    }
    return diff > 0 ? `  (+${diff})` : `  (−${-diff})`;
}

// The middle column: a rename shows its from -> to; others show their line count.
function getEntryDetail(
    previous: FileRevision | undefined,
    revision: FileRevision,
): string {
    if (revision.kind === EventKind.rename && revision.rename) {
        return `${getBaseName(revision.rename.from)} → ${getBaseName(revision.rename.to)}`;
    }
    if (revision.kind === EventKind.copy && revision.copy) {
        return `${revision.lines.length} lines  (copied from ${getBaseName(revision.copy.from)})`;
    }
    return `${revision.lines.length} lines${getEntryDelta(previous, revision)}`;
}

function renderEntry(
    revision: FileRevision,
    index: number,
    previous: FileRevision | undefined,
): string {
    const label = getEntryLabel(revision.kind).padEnd(6);
    const detail = getEntryDetail(previous, revision);
    return `  ${index}  ${label}  ${detail}   ${formatShortTime(revision.timestamp)}  #${shortenChangeId(revision.changeId)}`;
}

// The pre-rename path a history started life at, if it was ever renamed.
function findOriginalPath(revisions: FileRevision[]): Path | undefined {
    const renamed = revisions.find(
        (revision) => revision.kind === EventKind.rename && revision.rename,
    );
    return renamed?.rename?.from;
}

// The source path a copied history was born from, if it began as a copy.
function findCopyOrigin(revisions: FileRevision[]): Path | undefined {
    const copied = revisions.find(
        (revision) => revision.kind === EventKind.copy && revision.copy,
    );
    return copied?.copy?.from;
}

function renderHistoryBlock(history: FileHistory): string {
    const was = findOriginalPath(history.revisions);
    const copiedFrom = findCopyOrigin(history.revisions);
    let header = `${history.target}`;
    if (was) {
        header = `${history.target}   (was ${getBaseName(was)})`;
    } else if (copiedFrom) {
        header = `${history.target}   (copy of ${getBaseName(copiedFrom)})`;
    }
    const entries: string[] = [];
    let previous: FileRevision | undefined;
    history.revisions.forEach((revision, index) => {
        entries.push(renderEntry(revision, index, previous));
        previous = revision;
    });
    return `${header}\n${entries.join("\n")}`;
}

// The default view: each touched file with its numbered entries (kind, line
// count or rename arrow, short time, short change id).
export function renderHistoryList(histories: FileHistory[]): string {
    if (histories.length === 0) {
        return "no files touched";
    }
    return histories.map(renderHistoryBlock).join("\n\n");
}

// The basenames of the files a branch touched, comma-joined (its "files changed" column).
function summarizeBranchFiles(histories: FileHistory[]): string {
    return histories.map((history) => getBaseName(history.target)).join(", ");
}

// One summary line per branch (like `git branch`): kind, tip short id, for a rewound branch also
// its rewind point, then the files it touched. Used by the CLI `--list-branches` view.
export function renderBranchSummary(branched: BranchedReconstruction): string {
    const lines: string[] = [];
    if (branched.survivingTip !== undefined) {
        const files = summarizeBranchFiles(branched.surviving);
        lines.push(`surviving  tip #${shortUuid(branched.survivingTip)}    ${files}`);
    }
    for (const entry of branched.rewound) {
        const files = summarizeBranchFiles(entry.histories);
        lines.push(
            `rewound    tip #${shortUuid(entry.tip)}  rewind @ #${shortUuid(entry.rewindPoint)}    ${files}`,
        );
    }
    return lines.join("\n");
}

