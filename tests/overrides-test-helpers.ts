// Shared temp-dir helper for the overrides and file-history-root test files.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeTempDir(): string {
    return mkdtempSync(join(tmpdir(), "reveng-overrides-"));
}
