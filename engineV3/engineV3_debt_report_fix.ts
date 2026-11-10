// Stand-in for debt-ratchet-report.ts: the report's only effect on disk is eslint --fix on each tracked file, done here in one eslint run.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const HOOKS_FOLDER = "/Users/matkatmusicllc/Programming/dotfiles/claude/claude_hooks";
// Imported through a variable so that tsc does not check the dotfiles source under this project's settings.
const DEBT_FILES_MODULE = `${HOOKS_FOLDER}/shared/debt-files.ts`;
const { filterUniqueDebtCheckedFiles } = (await import(DEBT_FILES_MODULE)) as { filterUniqueDebtCheckedFiles: (paths: string[]) => string[] };
const ESLINT_BIN = `${HOOKS_FOLDER}/node_modules/.bin/eslint`;
const ESLINT_CONFIG = `${HOOKS_FOLDER}/debt-ratchet/eslint.config.js`;
const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

function runDebtReportFix(): void {
  const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" });
  if (gitRoot.error) {
    throw gitRoot.error;
  }
  const repoRoot = gitRoot.stdout.trim();
  const lsFiles = spawnSync("git", ["ls-files", "*.ts", "*.html", "*.css"], { cwd: repoRoot, encoding: "utf8" });
  if (lsFiles.error) {
    throw lsFiles.error;
  }
  const absolutePaths: string[] = [];
  for (const line of lsFiles.stdout.split("\n")) {
    if (line.length > 0) {
      const absolutePath = resolve(repoRoot, line);
      if (existsSync(absolutePath)) {
        absolutePaths.push(absolutePath);
      }
    }
  }
  const files = filterUniqueDebtCheckedFiles(absolutePaths);
  const fixed = spawnSync(ESLINT_BIN, ["--config", ESLINT_CONFIG, "--fix", "--no-warn-ignored", ...files], { cwd: repoRoot, encoding: "utf8", maxBuffer: MAX_BUFFER_BYTES });
  if (fixed.error) {
    throw fixed.error;
  }
}

if (import.meta.main) {
  runDebtReportFix();
}
