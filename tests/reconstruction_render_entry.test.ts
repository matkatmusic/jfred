import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEntry } from "../src/reconstruction_render_entry.ts";
import type { FileRevision } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const time = new Date("2026-01-01T00:00:00Z");

function createLines(count: number) {
  const lines = [];
  for (let index = 0; index < count; index++) {
    lines.push({ oldLineNum: DOES_NOT_EXIST_YET, values: [{ line: `l${index}`, timestamp: time }] });
  }
  return lines;
}

function createRevision(kind: EventKind, lineCount: number): FileRevision {
  return { kind, changeId: new Uuid("w1"), timestamp: time, lines: createLines(lineCount) };
}

// A create entry shows its label, line count, short time, and change id.
test("test_entry_shows_create_label_and_line_count", () => {
  const out = renderEntry(createRevision(EventKind.write, 2), 0, undefined);
  assert.ok(out.includes("create"));
  assert.ok(out.includes("2 lines"));
  assert.ok(out.includes("00:00:00Z"));
});

// A later entry shows the line-count change versus the previous entry.
test("test_entry_shows_line_delta", () => {
  const previous = createRevision(EventKind.write, 2);
  const out = renderEntry(createRevision(EventKind.edit, 6), 1, previous);
  assert.ok(out.includes("(+4)"));
});

// A rename entry shows its from and to base names.
test("test_entry_shows_rename_arrow", () => {
  const revision: FileRevision = {
    ...createRevision(EventKind.rename, 1),
    rename: { from: new Path("/x/a.py"), to: new Path("/x/b.py") },
  };
  assert.ok(renderEntry(revision, 1, undefined).includes("a.py → b.py"));
});
