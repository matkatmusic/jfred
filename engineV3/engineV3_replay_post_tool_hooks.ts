// Runs the real PostToolUse hook that rewrote a file on the Mac right after a Write/Edit, at the hook code version of that moment.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAttachmentEntry, type AttachmentEntry } from "../src/structures/session-meta.ts";
import { AttachmentPayloadType } from "../src/structures/vocabulary.ts";
import type { JSONLLine } from "./engineV3.ts";
import { getRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";

const REWRITTEN_BY_HOOK_TEXT = "were rewritten by a hook";
const POST_TOOL_USE_EVENT = "PostToolUse";
// The record keeps the hook's statusMessage, not its command. taskTools hooks/hooks.json ran it as `node --no-inspect "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/reflow-comments-post.ts"`.
const REFLOW_COMMENTS_STATUS_MESSAGE = "Reflowing wrapped comments...";
const REFLOW_COMMENTS_HOOK_SCRIPT = "scripts/hooks/reflow-comments-post.ts";
// The docker script mounts it read-only at this same path.
const TASK_TOOLS_GIT_FOLDER = "/Users/matkatmusicllc/Programming/taskTools/.git";
const GIT_ARCHIVE_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

const scriptsFolderByCommit = new Map<string, string>();

// An index line keeps the attachment payload of hook_success records only.
function isRewriteRecord(entry: AttachmentEntry): boolean {
    if (entry.attachment === undefined) {
        return false;
    }
    if (entry.attachment.type !== AttachmentPayloadType.hook_success) {
        return false;
    }
    if (entry.attachment.hookEvent !== POST_TOOL_USE_EVENT) {
        return false;
    }
    const stdout = entry.attachment.stdout;
    if (typeof stdout !== "string") {
        return false;
    }
    return stdout.includes(REWRITTEN_BY_HOOK_TEXT);
}

// Keyed by the tool use id text of the Write/Edit that the hook ran after.
export function collectPostToolHookRewrites(lines: JSONLLine[]): Map<string, AttachmentEntry> {
    const rewrites = new Map<string, AttachmentEntry>();
    for (const line of lines) {
        const entry = getAttachmentEntry(line);
        if (entry !== undefined) {
            if (isRewriteRecord(entry)) {
                rewrites.set(String(entry.attachment.toolUseID), entry);
            }
        }
    }
    return rewrites;
}

// The newest commit on any ref at or before the time: the hook ran from a working tree, so no one branch is known.
function getHookRepoCommitAtTime(time: Date): string {
    const commit = execFileSync("git", [`--git-dir=${TASK_TOOLS_GIT_FOLDER}`, "rev-list", "-1", `--before=${time.toISOString()}`, "--all"], { encoding: "utf8" }).trim();
    if (commit === "") {
        throw new Error(`getHookRepoCommitAtTime: ${TASK_TOOLS_GIT_FOLDER} has no commit at or before ${time.toISOString()}`);
    }
    return commit;
}

function exportScriptsFolderAtCommit(commit: string): string {
    const knownFolder = scriptsFolderByCommit.get(commit);
    if (knownFolder !== undefined) {
        return knownFolder;
    }
    const folder = mkdtempSync(join(tmpdir(), `engine-v3-task-tools-${commit}-`));
    const archive = execFileSync("git", [`--git-dir=${TASK_TOOLS_GIT_FOLDER}`, "archive", commit, "scripts"], { maxBuffer: GIT_ARCHIVE_MAX_BUFFER_BYTES });
    execFileSync("tar", ["-x", "-C", folder], { input: archive });
    scriptsFolderByCommit.set(commit, folder);
    return folder;
}

// The hook writes the file itself; its stdout must be the recorded stdout byte for byte.
export function runRecordedPostToolHook(file: string, rewrite: AttachmentEntry): void {
    const command = String(rewrite.attachment.command);
    const toolUseId = String(rewrite.attachment.toolUseID);
    if (command !== REFLOW_COMMENTS_STATUS_MESSAGE) {
        throw new Error(`runRecordedPostToolHook: no replay rule for the PostToolUse hook "${command}" (tool use ${toolUseId}, ${rewrite.timestamp.toISOString()})`);
    }
    const commit = getHookRepoCommitAtTime(rewrite.timestamp);
    const hookScript = join(exportScriptsFolderAtCommit(commit), REFLOW_COMMENTS_HOOK_SCRIPT);
    const hookInput = JSON.stringify({ tool_input: { file_path: file } });
    const spawned = spawnSync("node", ["--no-inspect", hookScript], { input: hookInput, encoding: "utf8" });
    if (spawned.status !== 0) {
        throw new Error(`runRecordedPostToolHook: taskTools ${commit} ${REFLOW_COMMENTS_HOOK_SCRIPT} exited ${spawned.status} on ${file} (tool use ${toolUseId}): ${spawned.stderr}`);
    }
    if (spawned.stdout !== rewrite.attachment.stdout) {
        throw new Error(`runRecordedPostToolHook: taskTools ${commit} hook output on ${file} (tool use ${toolUseId}) differs from the recorded output\nreplay: ${spawned.stdout}\nrecord: ${String(rewrite.attachment.stdout)}`);
    }
}

// The dotfiles debt-ratchet Stop/SubagentStop hook (claude/hooks/debt-ratchet.ts) runs `eslint --fix` on the turn's edited .ts files and names the ones it changed.
const DOTFILES_HOOK_COMMAND = "node ${HOME}/.claude/hooks/dotfiles-hooks.ts";
const STOP_HOOK_EVENTS = new Set(["Stop", "SubagentStop"]);
const REFORMATTED_FILES_PATTERN = /This hook reformatted these files to the house layout: (.+?)\. Do not revert that reformatting\./;
// The docker script mounts it read-only at this same path, node_modules included.
const DOTFILES_FOLDER = "/Users/matkatmusicllc/Programming/dotfiles";
const ESLINT_BIN = `${DOTFILES_FOLDER}/node_modules/.bin/eslint`;
// eslint --fix exits 1 when lint errors that it cannot fix remain.
const ESLINT_EXIT_CODE_ERRORS_REMAIN = 1;

const eslintConfigByCommit = new Map<string, string>();

type StopHookOutput = { command: unknown; text: unknown };

// A hook that reformatted and then blocked the stop is a hook_blocking_error record, with its text and command under blockingError.
function getStopHookOutput(entry: AttachmentEntry): StopHookOutput | undefined {
    if (entry.attachment.type === AttachmentPayloadType.hook_success) {
        return { command: entry.attachment.command, text: entry.attachment.stdout };
    }
    if (entry.attachment.type === AttachmentPayloadType.hook_blocking_error) {
        const blockingError = entry.attachment.blockingError as { blockingError: unknown; command: unknown };
        return { command: blockingError.command, text: blockingError.blockingError };
    }
    return undefined;
}

export function listStopHookReformattedFiles(entry: AttachmentEntry): string[] {
    // if (entry.attachment.type !== AttachmentPayloadType.hook_success) {
    //     return [];
    // }
    const output = getStopHookOutput(entry);
    if (output === undefined) {
        return [];
    }
    if (!STOP_HOOK_EVENTS.has(String(entry.attachment.hookEvent))) {
        return [];
    }
    // if (entry.attachment.command !== DOTFILES_HOOK_COMMAND) {
    if (output.command !== DOTFILES_HOOK_COMMAND) {
        return [];
    }
    // const match = String(entry.attachment.stdout).match(REFORMATTED_FILES_PATTERN);
    const match = String(output.text).match(REFORMATTED_FILES_PATTERN);
    if (match === null) {
        return [];
    }
    return (match[1] as string).split(", ");
}

function getDotfilesCommitAtTime(time: Date): string {
    const commit = execFileSync("git", ["-C", DOTFILES_FOLDER, "rev-list", "-1", `--before=${time.toISOString()}`, "--all"], { encoding: "utf8" }).trim();
    if (commit === "") {
        throw new Error(`getDotfilesCommitAtTime: ${DOTFILES_FOLDER} has no commit at or before ${time.toISOString()}`);
    }
    return commit;
}

// The config imports typescript-eslint and @stylistic, so its folder links to the dotfiles node_modules.
function exportEslintConfigAtCommit(commit: string): string {
    const knownConfig = eslintConfigByCommit.get(commit);
    if (knownConfig !== undefined) {
        return knownConfig;
    }
    const folder = mkdtempSync(join(tmpdir(), `engine-v3-dotfiles-${commit}-`));
    const configText = execFileSync("git", ["-C", DOTFILES_FOLDER, "show", `${commit}:eslint.config.js`], { encoding: "utf8" });
    const config = join(folder, "eslint.config.js");
    writeFileSync(config, configText);
    symlinkSync(join(DOTFILES_FOLDER, "node_modules"), join(folder, "node_modules"));
    eslintConfigByCommit.set(commit, config);
    return config;
}

type ToolWriteOfFile = { source: RecordSource; time: Date };
const lastToolWriteByFile = new Map<string, ToolWriteOfFile>();

export function recordToolWriteOfFile(file: string, resultLine: JSONLLine): void {
    const source = getRecordSource(resultLine);
    if (source === undefined) {
        return;
    }
    if (resultLine.timestamp === undefined) {
        throw new Error(`recordToolWriteOfFile: the Write/Edit result at ${source.filePath}:${source.lineNumber} has no timestamp`);
    }
    lastToolWriteByFile.set(file, { source, time: resultLine.timestamp });
}

// The hook starts after the stopping agent's last turn line, the line before the record.
function getStopHookStartTime(recordSource: RecordSource): Date {
    const transcriptLines = readFileSync(recordSource.filePath, "utf8").split("\n");
    const lastTurnLine = JSON.parse(transcriptLines[recordSource.lineNumber - 2] as string) as { timestamp: string };
    return new Date(lastTurnLine.timestamp);
}

// The hook reads the file before and after eslint --fix, so another agent's Edit/Write between the two reads looks like a reformat.
function findOtherAgentWriteDuringStopHook(file: string, record: AttachmentEntry): ToolWriteOfFile | undefined {
    const recordSource = getRecordSource(record as unknown as JSONLLine);
    if (recordSource === undefined) {
        return undefined;
    }
    const write = lastToolWriteByFile.get(file);
    if (write === undefined) {
        return undefined;
    }
    if (write.source.filePath === recordSource.filePath) {
        return undefined;
    }
    if (write.time.getTime() <= getStopHookStartTime(recordSource).getTime()) {
        return undefined;
    }
    if (write.time.getTime() > record.timestamp.getTime()) {
        return undefined;
    }
    return write;
}

// Runs only the hook's eslint --fix step: its printed text also depends on a ledger file and the transcript of that time.
export function runRecordedStopHookReformat(file: string, record: AttachmentEntry): void {
    const commit = getDotfilesCommitAtTime(record.timestamp);
    const config = exportEslintConfigAtCommit(commit);
    const bytesBefore = readFileSync(file);
    // Like the hook: eslint ignores a path through a symlink as outside its base path.
    const realFile = realpathSync(file);
    const spawned = spawnSync(ESLINT_BIN, ["--config", config, "--fix", realFile], { cwd: dirname(realFile), encoding: "utf8" });
    if (spawned.error !== undefined) {
        throw spawned.error;
    }
    if (spawned.status !== 0) {
        if (spawned.status !== ESLINT_EXIT_CODE_ERRORS_REMAIN) {
            throw new Error(`runRecordedStopHookReformat: dotfiles ${commit} eslint --fix exited ${spawned.status} on ${file} (${record.timestamp.toISOString()}): ${spawned.stderr}`);
        }
    }
    if (bytesBefore.equals(readFileSync(file))) {
        const otherAgentWrite = findOtherAgentWriteDuringStopHook(file, record);
        if (otherAgentWrite !== undefined) {
            console.log(`stop hook reformat record is another agent's edit during the hook: ${file}, eslint --fix changed nothing, edit at ${otherAgentWrite.source.filePath}:${otherAgentWrite.source.lineNumber} (${otherAgentWrite.time.toISOString()}) before the ${record.attachment.hookEvent} record at ${record.timestamp.toISOString()}`);
            return;
        }
        throw new Error(`runRecordedStopHookReformat: the record says the ${record.attachment.hookEvent} hook reformatted ${file} at ${record.timestamp.toISOString()}, but dotfiles ${commit} eslint --fix changed nothing`);
    }
}
