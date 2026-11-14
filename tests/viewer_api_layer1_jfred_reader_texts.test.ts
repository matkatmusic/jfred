// S4a: the reader texts at a Commit Mode mark: texts, absent paths, and the next changing instant.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "../engineV3/engineV3_file_known_states.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, type OrderedKnownState } from "../engineV3/engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { findNextChangingInstantInRepos, formatNotProvenSection, readProjectFilesAtMark, type NotProvenFile } from "../src/viewer_api_layer1_jfred_reader_texts.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

interface Fixture {
  projectFolder: Path;
  storeFolder: Path;
}

function makeFixture(t: TestContext): Fixture {
  const rootFolder = mkdtempSync(join(tmpdir(), "reader-texts-"));
  t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
  return { projectFolder: new Path(join(rootFolder, "project")), storeFolder: new Path(join(rootFolder, "store")) };
}

function makeInstant(second: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeOrderedState(position: number, second: number | undefined, moment: StateMoment, text: string | undefined): OrderedKnownState {
  let eventType = FileEventType.GitCommit;
  let instant: Date | undefined;
  if (second === undefined) {
    eventType = FileEventType.DiskNow;
  } else {
    instant = makeInstant(second);
  }
  const event = { type: eventType, instant, source: undefined, commitHash: undefined, bytes: text, row: undefined, moveOrCopySourceFile: undefined };
  const state: FileKnownState = { event, moment, confidence: StateConfidence.Proven, isFileAbsent: text === undefined, text };
  return { state, position };
}

// Position 0 is the disk-now state; a larger position is older.
function makeRepo(repoFolder: Path, fileName: string, diskNowText: string | undefined, olderStates: OrderedKnownState[]): void {
  createInverseRepo(repoFolder, fileName, makeOrderedState(0, undefined, StateMoment.AtEvent, diskNowText), DISK_NOW_INSTANT);
  insertStatesIntoInverseRepo(repoFolder, fileName, olderStates);
}

// stateTexts holds [second, text] pairs, oldest first; an undefined text is an absent file.
function makeProjectFileWithRepo(fixture: Fixture, relativePath: string, diskNowText: string | undefined, stateTexts: [number, string | undefined][]): ProjectFile {
  const file = new Path(join(fixture.projectFolder.toString(), relativePath));
  const fileName = relativePath.split("/").pop()!;
  const newestFirst = [...stateTexts].reverse();
  const olderStates = newestFirst.map(([second, text], index) => makeOrderedState(index + 1, second, StateMoment.AtEvent, text));
  makeRepo(getInverseRepoFolderForFile(fixture.storeFolder, fixture.projectFolder, file), fileName, diskNowText, olderStates);
  return { file, transcriptFile: file };
}

test("test_texts_hold_the_bytes_of_the_commit_at_the_mark", (t) => {
  // Scenario: a file has the states "one" at second 100 and "two" at second 200.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", "now\n", [[100, "one\n"], [200, "two\n"]]);
  // The mark is second 150.
  const filesAtMark = readProjectFilesAtMark(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(150));
  // The text of the file is "one", under its project-relative path with `/`.
  assert.deepEqual([...filesAtMark.texts], [["src/a.txt", "one\n"]]);
});

test("test_absent_file_is_in_absent_paths_and_not_in_texts", (t) => {
  // Scenario: a file is absent at second 100 and has text at second 200.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", "now\n", [[100, undefined], [200, "two\n"]]);
  // The mark is second 150.
  const filesAtMark = readProjectFilesAtMark(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(150));
  // The path is in absentPaths.
  assert.deepEqual([...filesAtMark.absentPaths], ["src/a.txt"]);
  // The path is not in texts.
  assert.equal(filesAtMark.texts.size, 0);
});

test("test_file_without_a_commit_at_the_mark_is_in_neither_texts_nor_absent_paths", (t) => {
  // Scenario: a file has its oldest state at second 100.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", "now\n", [[100, "one\n"]]);
  // The mark is second 50, before every state.
  const filesAtMark = readProjectFilesAtMark(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(50));
  // The path is in neither texts nor absentPaths.
  assert.equal(filesAtMark.texts.size, 0);
  assert.equal(filesAtMark.absentPaths.size, 0);
});

test("test_gone_file_listed_in_project_files_is_read_from_its_repo", (t) => {
  // Scenario: the project folder does not exist on disk, so the listed file is gone.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "gone/b.txt", undefined, [[100, "kept in the repo\n"]]);
  // The mark is second 150.
  const filesAtMark = readProjectFilesAtMark(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(150));
  // The text comes from the repo.
  assert.deepEqual([...filesAtMark.texts], [["gone/b.txt", "kept in the repo\n"]]);
});

test("test_not_proven_is_empty_in_this_section", (t) => {
  // Scenario: one file with text at the mark.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", "now\n", [[100, "one\n"]]);
  // The mark is second 150.
  const filesAtMark = readProjectFilesAtMark(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(150));
  // notProven is an empty list.
  assert.deepEqual(filesAtMark.notProven, []);
});

test("test_format_of_the_not_proven_section_matches_the_contract", () => {
  // Scenario: two not-proven files, one with older bytes and one without.
  const notProven: NotProvenFile[] = [
    { relativePath: "src/a.txt", bytesFromInstant: makeInstant(100), firstScriptInstant: makeInstant(200) },
    { relativePath: "b.txt", bytesFromInstant: undefined, firstScriptInstant: makeInstant(300) },
  ];
  // The section is built.
  const section = formatNotProvenSection(notProven);
  // It is two newlines, the header line, and one line per file.
  const expected = "\n\nNot proven: a recorded script was not replayed for these files. The bytes are the nearest older known bytes.\n"
    + "- src/a.txt (bytes from 2026-01-01T00:01:40.000Z, script at 2026-01-01T00:03:20.000Z)\n"
    + "- b.txt (bytes from none, script at 2026-01-01T00:05:00.000Z)";
  assert.equal(section, expected);
});

test("test_empty_not_proven_list_gives_an_empty_text", () => {
  // Scenario: no not-proven files.
  // The section is built from an empty list.
  const section = formatNotProvenSection([]);
  // It is the empty text.
  assert.equal(section, "");
});

test("test_next_changing_instant_is_the_first_later_commit_with_other_bytes", (t) => {
  // Scenario: a file has "one" at second 100, "one" again at 200, and "three" at 300.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", "now\n", [[100, "one\n"], [200, "one\n"], [300, "three\n"]]);
  // The mark is second 150, where the text is "one".
  const markTexts = new Map([["src/a.txt", "one\n"]]);
  const nextInstant = findNextChangingInstantInRepos(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(150), markTexts, new Set());
  // The second 200 commit has the same bytes, so the answer is second 300.
  assert.equal(nextInstant!.getTime(), makeInstant(300).getTime());
});

test("test_next_changing_instant_counts_a_later_text_commit_of_a_file_absent_at_the_mark", (t) => {
  // Scenario: a file is absent at second 100 and has text at second 200.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", "now\n", [[100, undefined], [200, "two\n"]]);
  // The mark is second 150, where the file is absent.
  const nextInstant = findNextChangingInstantInRepos(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(150), new Map(), new Set(["src/a.txt"]));
  // The text commit at second 200 is a change.
  assert.equal(nextInstant!.getTime(), makeInstant(200).getTime());
});

test("test_next_changing_instant_counts_a_later_text_commit_of_a_file_unknown_at_the_mark", (t) => {
  // Scenario: a file has its oldest state, text, at second 100.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", "now\n", [[100, "one\n"]]);
  // The mark is second 50, where the file is in neither texts nor absentPaths.
  const nextInstant = findNextChangingInstantInRepos(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(50), new Map(), new Set());
  // The text commit at second 100 is a change: the file appears.
  assert.equal(nextInstant!.getTime(), makeInstant(100).getTime());
});

test("test_next_changing_instant_skips_a_later_absent_commit_of_a_file_unknown_at_the_mark", (t) => {
  // Scenario: a file is absent at second 100 and absent on disk now.
  const fixture = makeFixture(t);
  const projectFile = makeProjectFileWithRepo(fixture, "src/a.txt", undefined, [[100, undefined]]);
  // The mark is second 50, where the file is in neither texts nor absentPaths.
  const nextInstant = findNextChangingInstantInRepos(fixture.projectFolder, fixture.storeFolder, [projectFile], makeInstant(50), new Map(), new Set());
  // Every later commit is absent, so nothing changes.
  assert.equal(nextInstant, undefined);
});
