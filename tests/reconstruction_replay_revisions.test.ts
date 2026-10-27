import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendRevision,
  createDeleteRevision,
  createUnrecoverableRevision,
  isUserEditChangingContent,
  renameRevision,
  writeRevision,
} from "../src/reconstruction_replay_revisions.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { AppendEvent, DeleteEvent, RenameEvent, UserEditEvent, WriteEvent } from "../src/reconstruction_events.ts";

const timestamp = new Date("2026-01-01T00:00:00Z");
const target = new Path("/a/b.py");

const writeEvent: WriteEvent = { kind: EventKind.write, changeId: new Uuid("w"), target, content: "x\ny\n", timestamp };

test("test_write_revision_is_write_when_absent_and_overwrite_when_present", () => {
  assert.equal(writeRevision(writeEvent, false).kind, EventKind.write);
  const overwritten = writeRevision(writeEvent, true);
  assert.equal(overwritten.kind, EventKind.overwrite);
  assert.equal(overwritten.lines.length, 2);
  assert.equal(overwritten.lines[0]!.oldLineNum, DOES_NOT_EXIST_YET);
});

test("test_delete_revision_has_no_lines", () => {
  const event: DeleteEvent = { kind: EventKind.delete, changeId: new Uuid("d"), target, timestamp };
  const revision = createDeleteRevision(event);
  assert.equal(revision.kind, EventKind.delete);
  assert.deepEqual(revision.lines, []);
});

test("test_rename_revision_carries_prior_lines_with_identity_indices", () => {
  const event: RenameEvent = { kind: EventKind.rename, changeId: new Uuid("r"), from: target, to: new Path("/a/c.py"), timestamp };
  const revision = renameRevision(event, [writeRevision(writeEvent, false)]);
  assert.equal(revision.lines.length, 2);
  assert.equal(revision.lines[1]!.oldLineNum, 1);
  assert.equal(revision.rename!.to.toString(), "/a/c.py");
});

test("test_append_revision_adds_only_the_new_tail_as_genesis", () => {
  const event: AppendEvent = { kind: EventKind.append, changeId: new Uuid("a"), target, content: "x\ny\nz\n", timestamp };
  const revision = appendRevision(event, [writeRevision(writeEvent, false)], true);
  assert.equal(revision.kind, EventKind.append);
  assert.equal(revision.lines.length, 3);
  assert.equal(revision.lines[1]!.oldLineNum, 1);
  assert.equal(revision.lines[2]!.oldLineNum, DOES_NOT_EXIST_YET);
});

test("test_append_revision_on_absent_file_is_a_write", () => {
  const event: AppendEvent = { kind: EventKind.append, changeId: new Uuid("a"), target, content: "z\n", timestamp };
  assert.equal(appendRevision(event, [], false).kind, EventKind.write);
});

test("test_user_edit_matching_current_text_is_not_a_change", () => {
  const revisions = [writeRevision(writeEvent, false)];
  const same: UserEditEvent = { kind: EventKind.userEdit, changeId: new Uuid("u"), target, content: "x\ny\n", timestamp };
  const different: UserEditEvent = { ...same, content: "x\nq\n" };
  assert.equal(isUserEditChangingContent(same, revisions), false);
  assert.equal(isUserEditChangingContent(different, revisions), true);
  assert.equal(isUserEditChangingContent(same, []), true);
});

test("test_unrecoverable_revision_carries_prior_lines_and_reason", () => {
  const revision = createUnrecoverableRevision(writeEvent, [writeRevision(writeEvent, false)], "boom");
  assert.equal(revision.lines.length, 2);
  assert.equal(revision.unrecoverable!.reason, "boom");
});
