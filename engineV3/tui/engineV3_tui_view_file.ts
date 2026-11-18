// The View File box data: when the box can open, which instant it reads, and its lines.

import { existsSync } from "node:fs";
import type { Path } from "../../src/structures/domain.ts";
import { computeLanguageForPath } from "../../webapp/highlight.ts";
import { getInverseRepoFolderForFile } from "../engineV3_inverse_repos_for_project.ts";
import { buildFileViewLines, highlightFileLines, type FileViewLine } from "./engineV3_tui_file_view_text.ts";

const BOX_BORDER_COLUMNS = 2;
const NUMBER_GAP_COLUMNS = 1;

// readFileTextAtInstant throws on a missing repo folder, so the box does not open then.
export function canOpenViewFile(storeFolder: Path, projectFolder: Path, file: Path, isTimeSpanned: boolean): boolean {
    if (!existsSync(getInverseRepoFolderForFile(storeFolder, projectFolder, file).toString())) {
        return false;
    }
    return isTimeSpanned;
}

// The newest event time is Now. No commit is stored at that time: the disk-now commit holds the text, so Now is read at the current instant.
export function computeViewFileInstant(fileTime: Date, nowTime: Date, currentInstant: Date): Date {
    if (fileTime.getTime() >= nowTime.getTime()) {
        return currentInstant;
    }
    return fileTime;
}

export function buildViewFileLines(text: string | undefined, file: Path, columns: number): FileViewLine[] {
    if (text === undefined) {
        return [];
    }
    const fileLines = highlightFileLines(text, computeLanguageForPath(file.toString()));
    const lineNumberWidth = String(fileLines.length).length;
    const contentWidth = Math.max(1, columns - BOX_BORDER_COLUMNS - lineNumberWidth - NUMBER_GAP_COLUMNS);
    return buildFileViewLines(fileLines, contentWidth);
}
