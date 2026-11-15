import assert from "node:assert/strict";
import { test } from "node:test";
import {
    BARS_HISTORY_STAGES,
    BARS_LAST_STAGE_INDEX,
    BarDotKind,
    InverseEventType,
    InverseProgressLineKind,
    classifyInverseProgressLine,
    findGoneCommitIndex,
    getBarDotGroup,
    getBarDotKind,
    getBarsHistoryStageIndex,
    getConfidenceAlpha,
    readInverseEventType,
    type InverseCommitWire,
} from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { ShowRowKind } from "../webapp/layer1-components/show-row/layer1-show-row.ts";
import { buildDiskNowCommit, buildInverseCommit } from "./layer1-bars-test-helpers.ts";

function buildPresent(eventType: string = InverseEventType.gitCommit): InverseCommitWire {
    return buildInverseCommit({ eventType, isFileAbsent: false });
}

function buildAbsent(overrides: Partial<InverseCommitWire> = {}): InverseCommitWire {
    return buildInverseCommit({ isFileAbsent: true, ...overrides });
}

const eventTypeRows: { eventType: string; kind: BarDotKind; stage: number }[] = [
    { eventType: InverseEventType.gitCommit, kind: BarDotKind.commit, stage: 1 },
    { eventType: InverseEventType.backupSnapshot, kind: BarDotKind.snapshot, stage: 2 },
    { eventType: InverseEventType.readWhole, kind: BarDotKind.read, stage: 3 },
    { eventType: InverseEventType.writeRow, kind: BarDotKind.write, stage: 4 },
    { eventType: InverseEventType.editRow, kind: BarDotKind.edit, stage: 4 },
    { eventType: InverseEventType.readPartial, kind: BarDotKind.read, stage: 4 },
    { eventType: InverseEventType.userEditNotice, kind: BarDotKind.edit, stage: 4 },
    { eventType: InverseEventType.otherRow, kind: BarDotKind.edit, stage: 4 },
    { eventType: InverseEventType.scriptReadOnly, kind: BarDotKind.script, stage: 5 },
    { eventType: InverseEventType.scriptMayWrite, kind: BarDotKind.script, stage: 5 },
];

test("test_classify_a_line_with_file_and_no_counts_as_a_file_step", () => {
    // A line has a file and no current.
    const line = { kind: "progress" as const, label: "x", file: "a.ts", fileStepsDone: 1, fileStepsTotal: 3 };
    // It is a file step.
    assert.equal(classifyInverseProgressLine(line), InverseProgressLineKind.fileStep);
});

test("test_classify_a_line_with_file_and_counts_as_a_file_done", () => {
    // A line has a file and a current.
    const line = { kind: "progress" as const, label: "x", file: "a.ts", current: 2, total: 5, fileStepsDone: 3, fileStepsTotal: 3 };
    // It is a file done.
    assert.equal(classifyInverseProgressLine(line), InverseProgressLineKind.fileDone);
});

test("test_classify_the_first_line_with_current_zero_as_started", () => {
    // A line has no file and current 0.
    const line = { kind: "progress" as const, label: "x", current: 0, total: 5, steps: ["a"] };
    // It is started.
    assert.equal(classifyInverseProgressLine(line), InverseProgressLineKind.started);
});

test("test_classify_a_line_with_no_file_and_no_zero_current_as_other", () => {
    // A line has no file and current 3.
    const line = { kind: "progress" as const, label: "x", current: 3, total: 5 };
    // It is other.
    assert.equal(classifyInverseProgressLine(line), InverseProgressLineKind.other);
});

test("test_kind_of_each_event_type_follows_the_kind_table", () => {
    for (const row of eventTypeRows) {
        // A present commit of this event type, the only commit.
        const commits = [buildPresent(row.eventType)];
        // Its kind is the table kind.
        assert.equal(getBarDotKind(commits, 0), row.kind, row.eventType);
    }
});

test("test_the_oldest_commit_is_a_created_dot_when_it_is_absent_and_another_commit_is_present", () => {
    // List [P, A].
    const commits = [buildPresent(), buildAbsent()];
    // The absent oldest commit is created.
    assert.equal(getBarDotKind(commits, 1), BarDotKind.created);
});

test("test_the_oldest_absent_commit_is_a_created_dot_whatever_its_event_type", () => {
    // List [P, A, A] where the oldest A is a read-only script.
    const commits = [buildPresent(), buildAbsent(), buildAbsent({ eventType: InverseEventType.scriptReadOnly })];
    // The oldest is created.
    assert.equal(getBarDotKind(commits, 2), BarDotKind.created);
});

test("test_an_absent_commit_that_is_not_the_oldest_keeps_the_kind_of_its_event_type", () => {
    // List [P, A(EditRow), A].
    const commits = [buildPresent(), buildAbsent({ eventType: InverseEventType.editRow }), buildAbsent()];
    // The middle commit keeps its event type kind.
    assert.equal(getBarDotKind(commits, 1), BarDotKind.edit);
});

test("test_the_oldest_commit_is_not_a_created_dot_when_it_is_present", () => {
    // List [P, P].
    const commits = [buildPresent(), buildPresent()];
    // The oldest is a commit dot.
    assert.equal(getBarDotKind(commits, 1), BarDotKind.commit);
});

test("test_the_oldest_commit_is_not_a_created_dot_when_every_commit_is_absent", () => {
    // List [A, A].
    const commits = [buildAbsent(), buildAbsent()];
    // The oldest keeps its event type kind.
    assert.equal(getBarDotKind(commits, 1), BarDotKind.commit);
});

test("test_a_removed_commit_is_never_a_created_dot", () => {
    // List [P, A+R] where the oldest is flagged removed.
    const commits = [buildPresent(), buildAbsent({ isRemoved: true })];
    // The oldest is not created.
    assert.notEqual(getBarDotKind(commits, 1), BarDotKind.created);
});

test("test_a_moved_away_commit_is_never_a_created_dot", () => {
    // List [P, A+moved] where the oldest is flagged moved away.
    const commits = [buildPresent(), buildAbsent({ movedAwayTo: "/x/b.ts" })];
    // The oldest is not created.
    assert.notEqual(getBarDotKind(commits, 1), BarDotKind.created);
});

test("test_a_deleted_file_with_a_removed_commit_has_one_created_dot_at_the_oldest_commit", () => {
    // List [A(DiskNow), A+R, P, A].
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildAbsent({ isRemoved: true }), buildPresent(), buildAbsent()];
    // The kinds are disk, deleted, commit, created.
    const kinds = commits.map((_, commitIndex) => getBarDotKind(commits, commitIndex));
    assert.deepEqual(kinds, [BarDotKind.disk, BarDotKind.deleted, BarDotKind.commit, BarDotKind.created]);
});

test("test_a_file_removed_and_made_again_has_one_created_dot_at_the_oldest_commit", () => {
    // List [P, A, A+R, P, A].
    const commits = [buildPresent(), buildAbsent(), buildAbsent({ isRemoved: true }), buildPresent(), buildAbsent()];
    // Only the last commit is created.
    const kinds = commits.map((_, commitIndex) => getBarDotKind(commits, commitIndex));
    assert.deepEqual(kinds, [BarDotKind.commit, BarDotKind.commit, BarDotKind.commit, BarDotKind.commit, BarDotKind.created]);
});

test("test_the_disk_now_commit_is_a_disk_dot", () => {
    // List [DiskNow present, P].
    const commits = [buildDiskNowCommit(), buildPresent()];
    // The first is disk.
    assert.equal(getBarDotKind(commits, 0), BarDotKind.disk);
});

test("test_the_disk_now_commit_of_a_file_gone_now_with_no_flag_is_a_disk_dot", () => {
    // List [A(DiskNow), P, A] with no flag.
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildPresent(), buildAbsent()];
    // The first is disk.
    assert.equal(getBarDotKind(commits, 0), BarDotKind.disk);
});

test("test_find_gone_commit_of_a_file_on_disk_now_is_undefined", () => {
    // List [DiskNow present, A+R].
    const commits = [buildDiskNowCommit(), buildAbsent({ isRemoved: true })];
    // No gone commit.
    assert.equal(findGoneCommitIndex(commits), undefined);
});

test("test_find_gone_commit_skips_newer_absent_commits_without_a_flag", () => {
    // List [A(DiskNow), A, A+R, P].
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildAbsent(), buildAbsent({ isRemoved: true }), buildPresent()];
    // The gone commit is index 2.
    assert.equal(findGoneCommitIndex(commits), 2);
});

test("test_find_gone_commit_of_a_file_gone_now_with_no_flag_is_undefined", () => {
    // List [A(DiskNow), A, P].
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildAbsent(), buildPresent()];
    // No gone commit.
    assert.equal(findGoneCommitIndex(commits), undefined);
});

test("test_find_gone_commit_ignores_a_flagged_commit_after_a_present_commit", () => {
    // List [A(DiskNow), P, A+R].
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildPresent(), buildAbsent({ isRemoved: true })];
    // No gone commit.
    assert.equal(findGoneCommitIndex(commits), undefined);
});

test("test_the_gone_commit_is_a_deleted_dot", () => {
    // List [A(DiskNow), A+R, P].
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildAbsent({ isRemoved: true }), buildPresent()];
    // The gone commit is deleted.
    assert.equal(getBarDotKind(commits, 1), BarDotKind.deleted);
});

test("test_a_moved_away_gone_commit_is_a_deleted_dot", () => {
    // List [A(DiskNow), A+moved, P].
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildAbsent({ movedAwayTo: "/x/b.ts" }), buildPresent()];
    // The gone commit is deleted.
    assert.equal(getBarDotKind(commits, 1), BarDotKind.deleted);
});

test("test_a_row_bytes_unknown_commit_throws", () => {
    // A present commit of event type RowBytesUnknown.
    const commits = [buildPresent(InverseEventType.rowBytesUnknown)];
    // Asking for its kind throws.
    assert.throws(() => getBarDotKind(commits, 0));
});

test("test_group_of_each_kind", () => {
    // Each kind maps to its show row group.
    assert.equal(getBarDotGroup(BarDotKind.commit), ShowRowKind.commit);
    assert.equal(getBarDotGroup(BarDotKind.snapshot), ShowRowKind.snapshot);
    assert.equal(getBarDotGroup(BarDotKind.disk), ShowRowKind.disk);
    assert.equal(getBarDotGroup(BarDotKind.created), ShowRowKind.created);
    assert.equal(getBarDotGroup(BarDotKind.edit), ShowRowKind.edit);
    assert.equal(getBarDotGroup(BarDotKind.write), ShowRowKind.edit);
    assert.equal(getBarDotGroup(BarDotKind.read), ShowRowKind.edit);
    assert.equal(getBarDotGroup(BarDotKind.script), ShowRowKind.scriptRun);
    assert.equal(ShowRowKind.scriptRun, "script-run");
});

test("test_group_of_the_deleted_kind_is_created", () => {
    // The deleted kind has the created group.
    assert.equal(getBarDotGroup(BarDotKind.deleted), ShowRowKind.created);
});

test("test_alpha_of_proven_confirmed_and_derived", () => {
    // The three known confidences.
    assert.equal(getConfidenceAlpha("proven"), 1);
    assert.equal(getConfidenceAlpha("confirmed"), 0.75);
    assert.equal(getConfidenceAlpha("derived"), 0.4);
});

test("test_alpha_of_unknown_throws", () => {
    // Unknown and a made-up word both throw.
    assert.throws(() => getConfidenceAlpha("unknown"));
    assert.throws(() => getConfidenceAlpha("surely"));
});

test("test_stage_index_of_each_event_type_follows_the_kind_table", () => {
    for (const row of eventTypeRows) {
        // A present commit, the only commit.
        const commits = [buildPresent(row.eventType)];
        // Its stage is the table stage.
        assert.equal(getBarsHistoryStageIndex(commits, 0), row.stage, row.eventType);
    }
});

test("test_stage_index_of_disk_and_created_dots_is_the_last_stage", () => {
    // List [DiskNow present, P, A].
    const commits = [buildDiskNowCommit(), buildPresent(), buildAbsent()];
    // The disk dot and the created dot are in the last stage.
    assert.equal(getBarsHistoryStageIndex(commits, 0), BARS_LAST_STAGE_INDEX);
    assert.equal(getBarsHistoryStageIndex(commits, 2), BARS_LAST_STAGE_INDEX);
    assert.equal(BARS_LAST_STAGE_INDEX, BARS_HISTORY_STAGES.length - 1);
});

test("test_stage_index_of_a_deleted_dot_is_the_last_stage", () => {
    // List [A(DiskNow), A+R, P].
    const commits = [buildDiskNowCommit({ isFileAbsent: true }), buildAbsent({ isRemoved: true }), buildPresent()];
    // The gone commit is in the last stage.
    assert.equal(getBarsHistoryStageIndex(commits, 1), BARS_LAST_STAGE_INDEX);
});

test("test_stage_index_of_an_absent_commit_that_is_not_created_follows_its_event_type", () => {
    // List [P, A(EditRow), A].
    const commits = [buildPresent(), buildAbsent({ eventType: InverseEventType.editRow }), buildAbsent()];
    // The middle commit is in the edit stage.
    assert.equal(getBarsHistoryStageIndex(commits, 1), 4);
});

test("test_an_unknown_event_type_string_throws", () => {
    // A made-up event type string.
    assert.throws(() => readInverseEventType("Nonsense"));
    // A known string comes back unchanged.
    assert.equal(readInverseEventType("GitCommit"), InverseEventType.gitCommit);
});
