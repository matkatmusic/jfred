// Unit tests for src/reconstruction_labels.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getBaseName, trimChangeId } from "../src/reconstruction_labels.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

test("test_trimChangeId_drops_toolu_prefix_and_keeps_eight_chars", () => {
    assert.equal(trimChangeId(new Uuid("toolu_0123456789abcdef")), "01234567");
});

test("test_trimChangeId_keeps_unprefixed_id_start", () => {
    assert.equal(trimChangeId(new Uuid("abcdefghijkl")), "abcdefgh");
});

test("test_getBaseName_returns_last_path_component", () => {
    assert.equal(getBaseName(new Path("/a/b/file.ts")), "file.ts");
});
