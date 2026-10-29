import { test } from "node:test";
import assert from "node:assert/strict";
import {
    findOutOfWindowEditSeed,
    findReversedEditBaseSeed,
    ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX,
} from "../src/reconstruction_reseed_seeds.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { EditEvent, WriteEvent } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const target = new Path("/work/a.txt");
const noBackup: BackupReader = () => "";

const write: WriteEvent = {
    kind: EventKind.write,
    changeId: new Uuid("w1"),
    target,
    content: "hello\nworld\n",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
};

function buildEdit(originalFile: string | null): EditEvent {
    return {
        kind: EventKind.edit,
        changeId: new Uuid("e1"),
        target,
        hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" hello", " world", "+tail"] }],
        originalFile,
        timestamp: new Date("2026-01-01T00:00:05.000Z"),
    } as EditEvent;
}

test("test_find_out_of_window_edit_seed_uses_original_file_that_extends_base", () => {
    const seed = findOutOfWindowEditSeed([], buildEdit("hello\nworld\nextra\n"), [write], noBackup);
    assert.equal(seed?.changeId.toString(), `${ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX}e1`);
    assert.equal(seed?.content, "hello\nworld\nextra\n");
});

test("test_find_out_of_window_edit_seed_rejects_diverging_original_file", () => {
    assert.equal(findOutOfWindowEditSeed([], buildEdit("hello\nchanged\nextra\n"), [write], noBackup), undefined);
    assert.equal(findOutOfWindowEditSeed([], buildEdit(null), [write], noBackup), undefined);
});

test("test_find_reversed_edit_base_seed_returns_undefined_without_backup", () => {
    assert.equal(findReversedEditBaseSeed([], buildEdit(null), noBackup), undefined);
});
