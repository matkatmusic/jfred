// Pure cursor and selection changes for the file rows of the terminal UI.

import type { Path } from "../../src/structures/domain.ts";
import type { SelectionState } from "./engineV3_tui_app_types.ts";

export function moveCursor(selection: SelectionState, files: Path[], step: number): SelectionState {
    const cursorIndex = Math.min(Math.max(selection.cursorIndex + step, 0), files.length - 1);
    return { ...selection, cursorIndex };
}

export function toggleCursorFile(selection: SelectionState, files: Path[]): SelectionState {
    const cursorFile = files[selection.cursorIndex]!;
    const isSelected = selection.selectedFiles.some((file) => file.value === cursorFile.value);
    const selectedFiles = isSelected ? selection.selectedFiles.filter((file) => file.value !== cursorFile.value) : [...selection.selectedFiles, cursorFile];
    return { ...selection, selectedFiles, lastToggledIndex: selection.cursorIndex };
}

export function extendSelectionToCursor(selection: SelectionState, files: Path[]): SelectionState {
    const fromIndex = selection.lastToggledIndex ?? selection.cursorIndex;
    const rangeFiles = files.slice(Math.min(fromIndex, selection.cursorIndex), Math.max(fromIndex, selection.cursorIndex) + 1);
    const newFiles = rangeFiles.filter((file) => !selection.selectedFiles.some((selectedFile) => selectedFile.value === file.value));
    return { ...selection, selectedFiles: [...selection.selectedFiles, ...newFiles] };
}
