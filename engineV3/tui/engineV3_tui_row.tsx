import { Box, Text } from "ink";
import { FileWalkStatus } from "../../src/structures/vocabulary.ts";
import { computeFillPercent, BarMarkKind, type BarFileModel } from "../../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { computeBarPercent } from "../../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { BarDotKind } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { Barbershop } from "./engineV3_tui_barbershop.tsx";
import { ROW_MARK_WIDTH, ROW_PREFIX_WIDTH } from "./engineV3_tui_row_columns.ts";

export const ROW_MARKS: Record<FileWalkStatus, string> = {
    [FileWalkStatus.Idle]: "✔",
    [FileWalkStatus.Stopped]: "!",
    [FileWalkStatus.Crashed]: "x",
    [FileWalkStatus.Queued]: " ",
    [FileWalkStatus.Running]: "⠿",
};

export const DOT_COLORS: Record<BarDotKind, string> = {
    [BarDotKind.commit]: "blue",
    [BarDotKind.snapshot]: "green",
    [BarDotKind.edit]: "yellow",
    [BarDotKind.write]: "yellow",
    [BarDotKind.read]: "gray",
    [BarDotKind.script]: "magenta",
    [BarDotKind.disk]: "white",
    [BarDotKind.deleted]: "white",
    [BarDotKind.created]: "white",
};

export type RowProps = {
    fileName: string;
    model: BarFileModel;
    status: FileWalkStatus;
    markerRowIndex: number;
    rulerRowCount: number;
    barWidth: number;
    nameWidth: number;
    stateWidth: number;
    isCursor: boolean;
    isSelected: boolean;
    stateText: string;
};

export type BarCell = { character: string; color: string | undefined; isDim: boolean };

function computeCellIndexOfRow(rowIndex: number, rulerRowCount: number, barWidth: number): number {
    return Math.round(computeBarPercent(rowIndex, rulerRowCount) / 100 * (barWidth - 1));
}

export function listBarCells(model: BarFileModel, markerRowIndex: number, rulerRowCount: number, barWidth: number): BarCell[] {
    const cells: BarCell[] = Array.from({ length: barWidth }, () => ({ character: " ", color: undefined, isDim: false }));
    const startCell = computeCellIndexOfRow(model.startRowIndex, rulerRowCount, barWidth);
    const bornCell = computeCellIndexOfRow(model.bornRowIndex, rulerRowCount, barWidth);
    for (let cellIndex = startCell; cellIndex <= bornCell; cellIndex++) {
        cells[cellIndex] = { character: "─", color: undefined, isDim: false };
    }
    const fillPercent = Math.min(computeFillPercent(model, markerRowIndex), 100);
    const fillEndCell = Math.round(startCell + fillPercent / 100 * (bornCell - startCell));
    for (let cellIndex = startCell; cellIndex <= fillEndCell; cellIndex++) {
        cells[cellIndex] = { character: "█", color: undefined, isDim: false };
    }
    for (const dot of model.dots) {
        const dotCell = computeCellIndexOfRow(dot.rowIndex, rulerRowCount, barWidth);
        cells[dotCell] = { character: "●", color: DOT_COLORS[dot.kind], isDim: dot.alpha < 1 };
    }
    for (const mark of model.marks) {
        const markCell = computeCellIndexOfRow(mark.rowIndex, rulerRowCount, barWidth);
        const markCharacter = mark.kind === BarMarkKind.removed ? "-" : "←";
        cells[markCell] = { character: markCharacter, color: undefined, isDim: false };
    }
    if (model.isPlusShown) {
        cells[bornCell] = { character: "+", color: undefined, isDim: false };
    }
    const markerCell = computeCellIndexOfRow(markerRowIndex, rulerRowCount, barWidth);
    cells[markerCell] = { character: "│", color: undefined, isDim: false };
    return cells;
}

export function Row(props: RowProps) {
    const cursorPrefix = props.isCursor ? "> " : "  ";
    const selectionPrefix = props.isSelected ? "*" : " ";
    const isBarbershopShown = props.status === FileWalkStatus.Running || props.status === FileWalkStatus.Queued;
    const barElement = isBarbershopShown
        ? <Barbershop width={props.barWidth} />
        : <Box>{listBarCells(props.model, props.markerRowIndex, props.rulerRowCount, props.barWidth).map((cell, cellIndex) => (
            <Text key={cellIndex} color={cell.color} dimColor={cell.isDim}>{cell.character}</Text>
        ))}</Box>;
    return (
        <Box gap={1}>
            <Box width={ROW_PREFIX_WIDTH} flexShrink={0}><Text>{cursorPrefix}{selectionPrefix}</Text></Box>
            <Box width={props.nameWidth} flexShrink={0}><Text wrap="truncate-end">{props.fileName}</Text></Box>
            <Box width={ROW_MARK_WIDTH} flexShrink={0}><Text>{ROW_MARKS[props.status]}</Text></Box>
            <Box width={props.barWidth} flexShrink={0}>{barElement}</Box>
            <Box width={props.stateWidth} flexShrink={0}><Text wrap="truncate-end">{props.stateText}</Text></Box>
        </Box>
    );
}
