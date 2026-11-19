// The side-by-side diff in the View File box: two titled boxes, the newer text on the left and the marker text on the right. Each side shows line numbers, token colors and wrapped lines; the row kind is the background color.

import { Box, Text } from "ink";
import { DiffRowKind, DiffSideName } from "../../src/structures/vocabulary.ts";
import type { DiffDisplayLine } from "./engineV3_tui_diff_display.ts";
import type { FileViewLine } from "./engineV3_tui_file_view_text.ts";
import { TitledBox } from "./engineV3_tui_titled_box.tsx";

const BORDER_ROW_COUNT = 2;

export type DiffBoxProps = {
    lines: DiffDisplayLine[];
    scrollTop: number;
    rowCount: number;
    columns: number;
    textColor: string;
    lineNumberColor: string;
    newerOnlyBackgroundColor: string;
    markerOnlyBackgroundColor: string;
    changedBackgroundColor: string;
};

// undefined: the row has no background.
function pickBackgroundColor(kind: DiffRowKind, sideName: DiffSideName, props: DiffBoxProps): string | undefined {
    if (kind === DiffRowKind.Changed) {
        return props.changedBackgroundColor;
    }
    if (kind === DiffRowKind.OnlyNewer) {
        if (sideName === DiffSideName.Newer) {
            return props.newerOnlyBackgroundColor;
        }
    }
    if (kind === DiffRowKind.OnlyMarker) {
        if (sideName === DiffSideName.Marker) {
            return props.markerOnlyBackgroundColor;
        }
    }
    return undefined;
}

function DiffSide({ title, sideName, sideLines, kinds, lineNumberWidth, columns, props }: { title: string; sideName: DiffSideName; sideLines: FileViewLine[]; kinds: DiffRowKind[]; lineNumberWidth: number; columns: number; props: DiffBoxProps }) {
    return (
        <TitledBox title={title} flexDirection="column" columns={columns} height={props.rowCount}>
            {sideLines.map((line, index) => {
                const backgroundColor = pickBackgroundColor(kinds[index]!, sideName, props);
                return (
                    <Box key={props.scrollTop + index} backgroundColor={backgroundColor}>
                        <Text color={props.lineNumberColor}>{String(line.lineNumber ?? "").padStart(lineNumberWidth)} </Text>
                        {line.pieces.map((piece, pieceIndex) => (
                            // Token colors are unreadable on a red or green background: a row with a background uses the plain text color.
                            <Text key={pieceIndex} color={backgroundColor === undefined ? piece.color ?? props.textColor : props.textColor}>{piece.text}</Text>
                        ))}
                    </Box>
                );
            })}
        </TitledBox>
    );
}

function computeLineNumberWidth(sideLines: FileViewLine[]): number {
    const lastLineNumber = sideLines.reduce((largest, line) => Math.max(largest, line.lineNumber ?? 0), 0);
    return String(lastLineNumber).length;
}

export function DiffBox(props: DiffBoxProps) {
    const visibleLines = props.lines.slice(props.scrollTop, props.scrollTop + props.rowCount - BORDER_ROW_COUNT);
    const kinds = visibleLines.map((line) => line.kind);
    const newerColumns = Math.floor(props.columns / 2);
    const newerLineNumberWidth = computeLineNumberWidth(props.lines.map((line) => line.newer));
    const markerLineNumberWidth = computeLineNumberWidth(props.lines.map((line) => line.marker));
    return (
        <Box width={props.columns} height={props.rowCount}>
            <DiffSide title="newer" sideName={DiffSideName.Newer} sideLines={visibleLines.map((line) => line.newer)} kinds={kinds} lineNumberWidth={newerLineNumberWidth} columns={newerColumns} props={props} />
            <DiffSide title="Marker" sideName={DiffSideName.Marker} sideLines={visibleLines.map((line) => line.marker)} kinds={kinds} lineNumberWidth={markerLineNumberWidth} columns={props.columns - newerColumns} props={props} />
        </Box>
    );
}
