// Renderers for conversationDAG and fileDAG views (spec 40, s12).

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { shortUuid } from "./reconstruction_branch.ts";
import { getBaseName, shortenChangeId } from "./reconstruction_labels.ts";
import {
    buildConversationDag,
    buildFileDag,
    type ConversationDag,
    type ConvoBranch,
    type FileDag,
    type GraphTurn,
} from "./reconstruction_graph.ts";

const CONVO_HEADER = "══ conversationDAG ══";
const FILE_HEADER = "══ fileDAG ══";

// The column widths that align a set of turn lines: the longest kind and the longest file base name.
type TurnWidths = { kind: number; target: number };

function computeTurnWidths(turns: GraphTurn[]): TurnWidths {
    let kind = 0;
    let target = 0;
    for (const turn of turns) {
        kind = Math.max(kind, turn.kind.length);
        target = Math.max(target, getBaseName(turn.target).length);
    }
    return { kind, target };
}

// A short tip/root id, or a placeholder when absent (no rooted record).
function shortOrDash(uuid: Uuid | undefined): string {
    return uuid === undefined ? "????????" : shortUuid(uuid);
}

// Format a turn's core columns, aligned to the given widths.
function renderTurnCore(turn: GraphTurn, widths: TurnWidths): string {
    const kind = turn.kind.padEnd(widths.kind);
    const target = getBaseName(turn.target).padEnd(widths.target);
    return `${turn.letter}  ${kind}  ${target}  #${shortenChangeId(turn.changeId)}`;
}

// A branch wrapper's header: `branch <role> (<role>; tip #<tip>[; rewind @ #<rewindPoint>])`.
function renderBranchHeader(branch: ConvoBranch): string {
    let header = `branch ${branch.role} (${branch.role}; tip #${shortOrDash(branch.tip)}`;
    if (branch.rewindPoint !== undefined) {
        header += `; rewind @ #${shortOrDash(branch.rewindPoint)}`;
    }
    return `${header})`;
}

// Render one branch block with connector, header, and indented turn lines.
function renderBranchBlock(branch: ConvoBranch, isLast: boolean, widths: TurnWidths): string[] {
    const connector = isLast ? "└─" : "├─";
    const turnPrefix = isLast ? "   " : "│  ";
    const lines = ["│", `${connector} ${renderBranchHeader(branch)}`];
    if (branch.turns.length === 0) {
        lines.push(`${turnPrefix}(no file changes)`);
        return lines;
    }
    for (const turn of branch.turns) {
        lines.push(turnPrefix + renderTurnCore(turn, widths));
    }
    return lines;
}

// All the turns a conversationDAG renders (trunk plus every branch's turns) — the alignment scope.
function allConvoTurns(dag: ConversationDag): GraphTurn[] {
    return [...dag.trunk, ...dag.branches.flatMap((branch) => branch.turns)];
}

// The root line: `A  prompt  #<root>`, annotated `(rewind point)` when any branch is rewound.
function renderRootLine(dag: ConversationDag): string {
    const hasRewound = dag.branches.some((branch) => branch.rewindPoint !== undefined);
    const suffix = hasRewound ? "   (rewind point)" : "";
    return `${dag.rootLetter}  prompt  #${shortOrDash(dag.rootUuid)}${suffix}`;
}

// Render the conversationDAG oldest-at-top: header, root, then a linear trunk (no fork) or oldest-first branch wrappers.
export function renderConversationDag(dag: ConversationDag): string {
    const widths = computeTurnWidths(allConvoTurns(dag));
    const lines = [CONVO_HEADER, renderRootLine(dag)];
    for (const turn of dag.trunk) {
        lines.push(`  ${renderTurnCore(turn, widths)}`);
    }
    dag.branches.forEach((branch, index) => {
        const isLast = index === dag.branches.length - 1;
        lines.push(...renderBranchBlock(branch, isLast, widths));
    });
    return lines.join("\n");
}

// A fileDAG turn line: `  <letter>  <kind>  #<changeId>` (no file column — the file is the header).
function renderFileTurnLine(turn: GraphTurn, kindWidth: number): string {
    return `  ${turn.letter}  ${turn.kind.padEnd(kindWidth)}  #${shortenChangeId(turn.changeId)}`;
}

// Render the fileDAG: a header then, per file, its base-name line and its version-ordered turns.
export function renderFileDag(dag: FileDag): string {
    const allTurns = dag.files.flatMap((file) => file.turns);
    const kindWidth = computeTurnWidths(allTurns).kind;
    const lines = [FILE_HEADER];
    for (const file of dag.files) {
        lines.push(getBaseName(file.target));
        for (const turn of file.turns) {
            lines.push(renderFileTurnLine(turn, kindWidth));
        }
    }
    return lines.join("\n");
}

// Render the selected DAGs for a transcript, separated by a blank line.
export function renderGraphs(
    records: TranscriptRecord[],
    show: { convo: boolean; file: boolean },
    reader?: BackupReader,
): string {
    const parts: string[] = [];
    if (show.convo) {
        parts.push(renderConversationDag(buildConversationDag(records, reader)));
    }
    if (show.file) {
        parts.push(renderFileDag(buildFileDag(records, reader)));
    }
    return parts.join("\n\n");
}

