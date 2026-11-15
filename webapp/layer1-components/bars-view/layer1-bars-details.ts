import { getRequiredElementById } from "../../app-dom.ts";
import { openDetailsPane } from "../details-drawer/layer1-details-pane.ts";
import { DiffPaneMode, type DiffStep } from "../details-drawer/layer1-diff-pane.ts";
import { buildDiffView, renderDetailView } from "../details-drawer/layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "../details-drawer/layer1-drawer-diff.ts";
import type { BarDotModel, BarFileModel } from "./layer1-bars-model.ts";
import { BAR_DOT_LABELS, BarDotKind, type InverseStateWire } from "./layer1-bars-wire.ts";

const INVERSE_STATE_PATH = "/api/layer1-inverse-state";

// GET /api/layer1-inverse-state. Returns reply.text, or "" when text is null.
export async function fetchInverseStateText(projectDir: string, path: string, atInstant: string): Promise<string> {
    const query = new URLSearchParams({ dir: projectDir, file: path, at: atInstant });
    const response = await fetch(`${INVERSE_STATE_PATH}?${query}`);
    if (!response.ok) {
        throw new Error(await response.text());
    }
    const reply = await response.json() as InverseStateWire;
    return reply.text ?? "";
}

function createStateStep(marker: string, path: string, loadContent: () => Promise<string>): DiffStep {
    return { marker, buildParams: () => new URLSearchParams({ path }), loadContent };
}

function showDrawerHeader(path: string, metaLine: string): void {
    clearDiffPair();
    for (const id of ["dprev", "dnext"] as const) {
        getRequiredElementById(id).hidden = true;
    }
    const header = getRequiredElementById("dpath");
    header.textContent = path;
    header.title = path;
    getRequiredElementById("dmeta").textContent = metaLine;
    setDrawerTools("none");
    openDetailsPane();
}

function showEmptyDetails(path: string, emptyText: string): void {
    renderDetailView([buildDiffView(path, [], { revisionControlsShown: false, mode: DiffPaneMode.inline, fullContents: false, baseIndex: 0, targetIndex: 0, emptyText })]);
}

function describeDotState(model: BarFileModel, dot: BarDotModel): string {
    return `state ${dot.commitIndex + 1} of ${model.commits.length} · ${BAR_DOT_LABELS[dot.kind]} · ${dot.instant ?? "now"}`;
}

// Opens the DetailsPane for one dot: target = state at the dot's instant, base = state at the next older commit's instant.
export function openBarDotDetails(model: BarFileModel, dotIndex: number, projectDir: string): void {
    const dot = model.dots[dotIndex]!;
    const olderCommit = model.commits[dot.commitIndex + 1];
    showDrawerHeader(model.path, describeDotState(model, dot));
    if (dot.kind === BarDotKind.created) {
        showEmptyDetails(model.path, "File did not exist before this point.");
        return;
    }
    const loadBase = async (): Promise<string> => {
        if (olderCommit === undefined) {
            return "";
        }
        if (olderCommit.instant === null) {
            throw new Error(`commit ${olderCommit.commitHash} of ${model.path} has no instant`);
        }
        return fetchInverseStateText(projectDir, model.path, olderCommit.instant);
    };
    const loadTarget = (): Promise<string> => fetchInverseStateText(projectDir, model.path, dot.instant ?? new Date().toISOString());
    const baseStep = createStateStep("older state", model.path, loadBase);
    const targetStep = createStateStep("this state", model.path, loadTarget);
    renderDetailView([buildDiffView(model.path, [baseStep, targetStep], { revisionControlsShown: true, mode: DiffPaneMode.inline, fullContents: false, baseIndex: 0, targetIndex: 1 })]);
}

// Picks the first dot with rowIndex >= selectedRowIndex and opens it like openBarDotDetails. No such dot: shows "File did not exist at this row."
export function openBarFileDetails(model: BarFileModel, selectedRowIndex: number, projectDir: string): void {
    const dotIndex = model.dots.findIndex((dot) => dot.rowIndex >= selectedRowIndex);
    if (dotIndex === -1) {
        showDrawerHeader(model.path, "");
        showEmptyDetails(model.path, "File did not exist at this row.");
        return;
    }
    openBarDotDetails(model, dotIndex, projectDir);
}
