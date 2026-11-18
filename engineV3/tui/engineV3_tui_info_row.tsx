// The TUI info row: one line of counts, state, own time and run reasons for the selected file.

import { Text } from "ink";
import type { BarInfo } from "./engineV3_tui_bars.ts";
import { BOX_SIDE_COLUMNS, ENTRY_GAP_COLUMNS, LABEL_VALUE_SEPARATOR, type FooterEntry } from "./engineV3_tui_footer.tsx";
import type { FileRunState } from "./engineV3_tui_walk_state.ts";

export type InfoRowInput = {
    fileName: string;
    barInfo: BarInfo | undefined;
    runState: FileRunState;
    ownTime: Date | undefined;
    isTimeSpanned: boolean;
    scriptRefusalText: string | undefined;
};

export function buildInfoRowText(input: InfoRowInput): string {
    const textPieces: string[] = [input.fileName];
    if (input.runState.reasonText !== undefined) {
        textPieces.push(input.runState.reasonText);
    }
    if (input.scriptRefusalText !== undefined) {
        textPieces.push(input.scriptRefusalText);
    }
    if (input.ownTime !== undefined) {
        textPieces.push(`own time ${input.ownTime.toISOString()}`);
    }
    if (input.isTimeSpanned === false) {
        textPieces.push("not walked to this time");
    }
    if (input.barInfo !== undefined) {
        const barInfo = input.barInfo;
        textPieces.push(
            `commits ${barInfo.commitCount}`,
            `modifying events in the logs ${barInfo.modifyingEventCount}`,
            `snapshots ${barInfo.snapshotCount}`,
            `scripts ${barInfo.scriptCount}`,
            `failed replays ${barInfo.failedReplayCount}`,
            barInfo.stateText,
        );
    }
    return textPieces.join("  ");
}

export function buildInfoEntries(input: InfoRowInput): FooterEntry[] {
    const entries: FooterEntry[] = [{ label: "file", value: input.fileName }];
    if (input.runState.reasonText !== undefined) {
        entries.push({ label: "reason", value: input.runState.reasonText });
    }
    if (input.scriptRefusalText !== undefined) {
        entries.push({ label: "script", value: input.scriptRefusalText });
    }
    if (input.ownTime !== undefined) {
        entries.push({ label: "own time", value: input.ownTime.toISOString() });
    }
    if (input.isTimeSpanned === false) {
        entries.push({ label: "walk", value: "not walked to this time" });
    }
    if (input.barInfo !== undefined) {
        const barInfo = input.barInfo;
        entries.push(
            { label: "commits", value: String(barInfo.commitCount) },
            { label: "modifying events in the logs", value: String(barInfo.modifyingEventCount) },
            { label: "snapshots", value: String(barInfo.snapshotCount) },
            { label: "scripts", value: String(barInfo.scriptCount) },
            { label: "failed replays", value: String(barInfo.failedReplayCount) },
            { label: "state", value: barInfo.stateText },
        );
    }
    return entries;
}

const COUNT_SLOT_WIDTH = 4;
const THIRD_LINE_LABELS = ["reason", "script", "own time", "walk"];

function cutOrPadText(text: string, width: number): string {
    if (text.length > width) {
        return text.slice(0, Math.max(width - 1, 0)) + "…";
    }
    return text.padEnd(width);
}

function buildCountValue(count: number | undefined): string {
    if (count === undefined) {
        return "".padEnd(COUNT_SLOT_WIDTH);
    }
    return String(count).padEnd(COUNT_SLOT_WIDTH);
}

export function buildInfoBoxLines(input: InfoRowInput, columns: number): FooterEntry[][] {
    const innerWidth = columns - BOX_SIDE_COLUMNS;
    const barInfo = input.barInfo;
    let stateText = "";
    if (barInfo !== undefined) {
        stateText = barInfo.stateText;
    }
    const fixedWidth = "file".length + LABEL_VALUE_SEPARATOR.length + ENTRY_GAP_COLUMNS + "state".length + LABEL_VALUE_SEPARATOR.length + stateText.length;
    const firstLine: FooterEntry[] = [
        { label: "file", value: cutOrPadText(input.fileName, Math.max(innerWidth - fixedWidth, 0)) },
        { label: "state", value: stateText },
    ];
    const secondLine: FooterEntry[] = [
        { label: "commits", value: buildCountValue(barInfo?.commitCount) },
        { label: "modifying events in the log", value: buildCountValue(barInfo?.modifyingEventCount) },
        { label: "snapshots", value: buildCountValue(barInfo?.snapshotCount) },
        { label: "scripts", value: buildCountValue(barInfo?.scriptCount) },
        { label: "failed replays", value: buildCountValue(barInfo?.failedReplayCount) },
    ];
    const thirdLine = buildInfoEntries(input).filter((entry) => THIRD_LINE_LABELS.includes(entry.label));
    return [firstLine, secondLine, thirdLine];
}

export function InfoRow({ text }: { text: string }) {
    return <Text>{text}</Text>;
}
