// The text of a file at one instant, split into numbered display lines for the View File box.

import assert from "node:assert/strict";
import { basename } from "node:path";
import { test, type TestContext } from "node:test";
import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { HIGHLIGHT_COLOR_BY_TOKEN_CLASS, buildFileViewLines, clampFileViewScrollTop, highlightFileLines, readFileTextAtInstant } from "../engineV3/tui/engineV3_tui_file_view_text.ts";
import { computeLanguageForPath } from "../webapp/highlight.ts";
import { makeEditRows, makeInstant, makeWriteCreateRows, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const STEP_COUNT = 3;

function writeWalkedProject(t: TestContext, diskText: string, makeRows: (projectFolder: string, filePath: string) => object[]): Project {
    const project = writeProject(t, diskText, makeRows);
    const projectFiles = [{ file: project.file, transcriptFile: project.file }];
    buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const events = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    const fileName = basename(project.file.toString());
    const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
    for (let stepNumber = 0; stepNumber < STEP_COUNT; stepNumber++) {
        stepFileAndWriteCommit(repoFolder, fileName, step, undefined);
    }
    return project;
}

// Disk text "three"; Edit one to two at second 10, Edit two to three at second 20.
function writeTwoEditProject(t: TestContext): Project {
    return writeWalkedProject(t, "three\n", (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 20),
    ]);
}

test("test_text_at_a_time_with_a_stored_commit_is_returned", (t) => {
    // Scenario: second 15 lies between the two edits, so the file reads "two".
    const project = writeTwoEditProject(t);
    // read the text at second 15.
    const text = readFileTextAtInstant(project.storeFolder, project.projectFolder, project.file, makeInstant(15));
    // the text is the state between the edits.
    assert.equal(text, "two\n");
});

test("test_text_is_undefined_for_a_time_with_no_stored_state", (t) => {
    // Scenario: second 5 lies before the first edit, where no state is stored.
    const project = writeTwoEditProject(t);
    // read the text at second 5.
    const text = readFileTextAtInstant(project.storeFolder, project.projectFolder, project.file, makeInstant(5));
    // there is no text.
    assert.equal(text, undefined);
});

test("test_text_is_undefined_for_a_time_before_the_file_was_created", (t) => {
    // Scenario: a Write creates the file at second 10; the repo stores an absent state before it.
    const project = writeWalkedProject(t, "hello\n", (projectFolder, filePath) => makeWriteCreateRows(projectFolder, "toolu_a", filePath, "hello\n", 10));
    // read the text at second 5, when the file does not exist yet.
    const text = readFileTextAtInstant(project.storeFolder, project.projectFolder, project.file, makeInstant(5));
    // there is no text.
    assert.equal(text, undefined);
});

test("test_a_long_line_wraps_and_only_its_first_display_line_has_the_number", () => {
    // Scenario: one line of 10 characters in a width of 4 becomes 3 display lines.
    const lines = buildFileViewLines(highlightFileLines("abcdefghij", undefined), 4);
    // the display lines hold the pieces of 4, 4 and 2 characters.
    assert.deepEqual(lines.map((line) => line.pieces.map((piece) => piece.text).join("")), ["abcd", "efgh", "ij"]);
    // only the first display line has the line number.
    assert.deepEqual(lines.map((line) => line.lineNumber), [1, undefined, undefined]);
});

test("test_each_file_line_gets_its_number_and_the_final_newline_adds_no_line", () => {
    // Scenario: two short lines end with a newline.
    const lines = buildFileViewLines(highlightFileLines("one\ntwo\n", undefined), 80);
    // two display lines, numbered 1 and 2.
    assert.deepEqual(lines, [
        { lineNumber: 1, pieces: [{ text: "one", color: undefined }] },
        { lineNumber: 2, pieces: [{ text: "two", color: undefined }] },
    ]);
});

test("test_a_blank_line_stays_a_numbered_display_line", () => {
    // Scenario: a blank line lies between two lines.
    const lines = buildFileViewLines(highlightFileLines("a\n\nb", undefined), 80);
    // the blank line has number 2 and no pieces.
    assert.deepEqual(lines[1], { lineNumber: 2, pieces: [] });
});

test("test_a_wrapped_line_keeps_the_color_of_each_piece", () => {
    // Scenario: one file line of a red piece "ab" and a blue piece "cdef", in a width of 4.
    const fileLine = [{ text: "ab", color: "red" }, { text: "cdef", color: "blue" }];
    const lines = buildFileViewLines([fileLine], 4);
    // the first display line holds the red "ab" and the first 2 characters of the blue piece.
    assert.deepEqual(lines[0], { lineNumber: 1, pieces: [{ text: "ab", color: "red" }, { text: "cd", color: "blue" }] });
    // the second display line holds the rest of the blue piece and has no number.
    assert.deepEqual(lines[1], { lineNumber: undefined, pieces: [{ text: "ef", color: "blue" }] });
});

test("test_unknown_language_gives_plain_pieces_without_a_color", () => {
    // Scenario: the language of "notes.unknownext" is not known.
    const language = computeLanguageForPath("notes.unknownext");
    // highlight two lines with it.
    const fileLines = highlightFileLines("a b\nc\n", language);
    // each line is one piece without a color, and the final newline adds no line.
    assert.deepEqual(fileLines, [[{ text: "a b", color: undefined }], [{ text: "c", color: undefined }]]);
});

test("test_a_keyword_gets_the_keyword_color", () => {
    // Scenario: the language of "a.ts" is typescript.
    const language = computeLanguageForPath("a.ts");
    // highlight one line of code.
    const fileLines = highlightFileLines("const x = 1;\n", language);
    // the piece "const" has the keyword color.
    const constPiece = fileLines[0]!.find((piece) => piece.text === "const");
    assert.equal(constPiece!.color, HIGHLIGHT_COLOR_BY_TOKEN_CLASS["hljs-keyword"]);
});

test("test_a_comment_over_two_lines_is_colored_on_both_lines", () => {
    // Scenario: a block comment starts on line 1 and ends on line 2.
    const fileLines = highlightFileLines("/* a\n b */\n", "typescript");
    // both lines hold pieces in the comment color.
    const commentColor = HIGHLIGHT_COLOR_BY_TOKEN_CLASS["hljs-comment"];
    assert.ok(commentColor !== undefined);
    assert.deepEqual(fileLines.map((fileLine) => fileLine.map((piece) => piece.color)), [[commentColor], [commentColor]]);
});

test("test_clamp_raises_a_negative_scroll_top_to_zero", () => {
    // Scenario: 10 lines, 4 visible, scroll top -3.
    assert.equal(clampFileViewScrollTop(-3, 10, 4), 0);
});

test("test_clamp_lowers_a_scroll_top_past_the_end_to_the_last_full_page", () => {
    // Scenario: 10 lines, 4 visible: the last full page starts at line 6.
    assert.equal(clampFileViewScrollTop(99, 10, 4), 6);
});

test("test_clamp_gives_zero_when_all_lines_fit", () => {
    // Scenario: 3 lines, 4 visible.
    assert.equal(clampFileViewScrollTop(2, 3, 4), 0);
});
