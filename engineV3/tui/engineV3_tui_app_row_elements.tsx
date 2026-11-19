// The visible file rows of the root component.

import type { Path } from "../../src/structures/domain.ts";
import type { BarFileModel } from "../../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { findRulerRowIndexForInstant } from "../../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { getRelativePathInProject } from "../engineV3_inverse_repos_for_project.ts";
import { describeRowState } from "./engineV3_tui_app_rows.ts";
import type { AppProps, SelectionState } from "./engineV3_tui_app_types.ts";
import { Row } from "./engineV3_tui_row.tsx";
import { countModifyingEvents } from "./engineV3_tui_bars.ts";
import { ROW_STATE_WIDTH, computeRowColumnWidths, formatRowFileName } from "./engineV3_tui_row_columns.ts";
import { foldEventsIntoRulerRows } from "./engineV3_tui_time_marker.ts";
import { getFileRunState } from "./engineV3_tui_walk_state.ts";

export type FileRowsInput = {
    props: AppProps;
    visibleFiles: Path[];
    rangeTop: number;
    selection: SelectionState;
    rulerRows: ReturnType<typeof foldEventsIntoRulerRows>;
    rowColumnWidths: ReturnType<typeof computeRowColumnWidths>;
    getModelOfFile: (file: Path) => BarFileModel;
    getTimeOfFile: (file: Path) => Date;
};

export function buildFileRowElements(input: FileRowsInput) {
    const { props, selection, rulerRows, rowColumnWidths, getModelOfFile, getTimeOfFile } = input;
    return input.visibleFiles.map((file, offset) => {
        const model = getModelOfFile(file);
        const markerRowIndex = findRulerRowIndexForInstant(rulerRows, getTimeOfFile(file).toISOString());
        return <Row key={file.value} fileName={formatRowFileName(getRelativePathInProject(props.projectFolder, file), countModifyingEvents(props.countsByFile.get(file.value)!), rowColumnWidths.nameWidth)} model={model} status={getFileRunState(props.walkState, file).status} markerRowIndex={markerRowIndex} rulerRowCount={rulerRows.length} barWidth={rowColumnWidths.barWidth} nameWidth={rowColumnWidths.nameWidth} stateWidth={ROW_STATE_WIDTH} isCursor={input.rangeTop + offset === selection.cursorIndex} isSelected={selection.selectedFiles.some((selectedFile) => selectedFile.value === file.value)} stateText={describeRowState(model, getTimeOfFile(file), markerRowIndex)} />;
    });
}
