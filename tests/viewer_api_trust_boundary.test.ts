import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Path, Uuid } from "../src/structures/domain.ts";
import { findProjectFile, readBlobSnapshot } from "../src/viewer_api_trust_boundary.ts";

test("test_findProjectFile_resolves_names_and_rejects_traversal", () => {
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-trust-"));
    mkdirSync(join(projectsDir, "alpha"));
    writeFileSync(join(projectsDir, "alpha", "one.jsonl"), "{}\n");
    const resolved = findProjectFile(new Path(projectsDir), "alpha", "one.jsonl");
    assert.equal(resolved.toString(), join(realpathSync(projectsDir), "alpha", "one.jsonl"));
    assert.throws(() => findProjectFile(new Path(projectsDir), "alpha", "../../etc/passwd"));
});

test("test_readBlobSnapshot_rejects_malformed_blob_and_session_names", () => {
    const sessionId = new Uuid("11111111-2222-3333-4444-555555555555");
    assert.throws(() => readBlobSnapshot(sessionId, new Path("../escape")), /not a backup blob name/);
    assert.throws(() => readBlobSnapshot(new Uuid("../x"), new Path("0123456789abcdef@v1")), /not a session id/);
});
