// The View File box: a round-border box of numbered display lines, drawn from scrollTop.

import { Box, Text } from "ink";
import type { FileViewLine } from "./engineV3_tui_file_view_text.ts";
import { TitledBox } from "./engineV3_tui_titled_box.tsx";

const BORDER_ROW_COUNT = 2;

export type FileViewBoxProps = {
    lines: FileViewLine[];
    scrollTop: number;
    rowCount: number;
    columns: number;
    lineNumberColor: string;
    textColor: string;
    emptyText: string;
};

export function FileViewBox(props: FileViewBoxProps) {
    const visibleLineCount = props.rowCount - BORDER_ROW_COUNT;
    const visibleLines = props.lines.slice(props.scrollTop, props.scrollTop + visibleLineCount);
    const lastLineNumber = props.lines.reduce((largest, line) => Math.max(largest, line.lineNumber ?? 0), 0);
    const lineNumberWidth = String(lastLineNumber).length;
    return (
        // <Box borderStyle="round" flexDirection="column" width={props.columns} height={props.rowCount}>
        <TitledBox title="File Preview" flexDirection="column" columns={props.columns} height={props.rowCount}>
            {props.lines.length === 0 && <Text>{props.emptyText}</Text>}
            {visibleLines.map((line, index) => (
                <Box key={props.scrollTop + index}>
                    <Text color={props.lineNumberColor}>{String(line.lineNumber ?? "").padStart(lineNumberWidth)} </Text>
                    {line.pieces.map((piece, pieceIndex) => (
                        <Text key={pieceIndex} color={piece.color ?? props.textColor}>{piece.text}</Text>
                    ))}
                </Box>
            ))}
        </TitledBox>
    );
}
