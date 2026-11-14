// Runs the real PostToolUse hook that rewrote a file on the Mac right after a Write/Edit, at the hook code version of that moment.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAttachmentEntry, type AttachmentEntry } from "../src/structures/session-meta.ts";
import { AttachmentPayloadType } from "../src/structures/vocabulary.ts";
import type { JSONLLine } from "./engineV3.ts";

const REWRITTEN_BY_HOOK_TEXT = "were rewritten by a hook";
const POST_TOOL_USE_EVENT = "PostToolUse";
// The record keeps the hook's statusMessage, not its command. taskTools hooks/hooks.json ran it as `node --no-inspect "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/reflow-comments-post.ts"`.
const REFLOW_COMMENTS_STATUS_MESSAGE = "Reflowing wrapped comments...";
const REFLOW_COMMENTS_HOOK_SCRIPT = "scripts/hooks/reflow-comments-post.ts";
// The docker script mounts it read-only at this same path.
const TASK_TOOLS_GIT_FOLDER = "/Users/matkatmusicllc/Programming/taskTools/.git";
// The submodule of the dotfiles folder, which the docker script mounts read-only at this same path.
const CLAUDE_HOOKS_FOLDER = "/Users/matkatmusicllc/Programming/dotfiles/claude/claude_hooks";
// The records keep "command hook 2" for the claude_hooks dispatcher; the plugin records keep its command text. Both ran the PostToolUse comment hook for Edit/Write.
const CLAUDE_HOOKS_DISPATCHER_COMMANDS = ["command hook 2", "node \"${CLAUDE_PLUGIN_ROOT}/dispatcher/dispatch.ts\""];
const CLAUDE_HOOKS_COMMENT_COMBINER_SCRIPT = "comment-length-limiter/commentCombiner.ts";
const GIT_ARCHIVE_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

type HookSource = { name: string; gitArguments: string[]; exportedPath: string; hookScript: string; nodeFlags: string[] };

const TASK_TOOLS_REFLOW_SOURCE: HookSource = { name: "taskTools", gitArguments: [`--git-dir=${TASK_TOOLS_GIT_FOLDER}`], exportedPath: "scripts", hookScript: REFLOW_COMMENTS_HOOK_SCRIPT, nodeFlags: ["--no-inspect"] };
const CLAUDE_HOOKS_COMMENT_COMBINER_SOURCE: HookSource = { name: "claude_hooks", gitArguments: ["-C", CLAUDE_HOOKS_FOLDER], exportedPath: "comment-length-limiter", hookScript: CLAUDE_HOOKS_COMMENT_COMBINER_SCRIPT, nodeFlags: [] };

const exportedFolderByCommit = new Map<string, string>();

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
function getHookRepoCommitAtTime(source: HookSource, time: Date): string {
    const commit = execFileSync("git", [...source.gitArguments, "rev-list", "-1", `--before=${time.toISOString()}`, "--all"], { encoding: "utf8" }).trim();
    if (commit === "") {
        throw new Error(`getHookRepoCommitAtTime: ${source.name} has no commit at or before ${time.toISOString()}`);
    }
    return commit;
}

function exportHookFolderAtCommit(source: HookSource, commit: string): string {
    const knownFolder = exportedFolderByCommit.get(`${source.name} ${commit}`);
    if (knownFolder !== undefined) {
        return knownFolder;
    }
    const folder = mkdtempSync(join(tmpdir(), `engine-v3-${source.name}-${commit}-`));
    const archive = execFileSync("git", [...source.gitArguments, "archive", commit, source.exportedPath], { maxBuffer: GIT_ARCHIVE_MAX_BUFFER_BYTES });
    execFileSync("tar", ["-x", "-C", folder], { input: archive });
    exportedFolderByCommit.set(`${source.name} ${commit}`, folder);
    return folder;
}

function findHookSource(command: string): HookSource | undefined {
    if (command === REFLOW_COMMENTS_STATUS_MESSAGE) {
        return TASK_TOOLS_REFLOW_SOURCE;
    }
    if (CLAUDE_HOOKS_DISPATCHER_COMMANDS.includes(command)) {
        return CLAUDE_HOOKS_COMMENT_COMBINER_SOURCE;
    }
    return undefined;
}

// The hook writes the file itself; its stdout must be the recorded stdout byte for byte.
export function runRecordedPostToolHook(file: string, rewrite: AttachmentEntry): void {
    const command = String(rewrite.attachment.command);
    const toolUseId = String(rewrite.attachment.toolUseID);
    const source = findHookSource(command);
    if (source === undefined) {
        throw new Error(`runRecordedPostToolHook: no replay rule for the PostToolUse hook "${command}" (tool use ${toolUseId}, ${rewrite.timestamp.toISOString()})`);
    }
    const commit = getHookRepoCommitAtTime(source, rewrite.timestamp);
    const hookScript = join(exportHookFolderAtCommit(source, commit), source.hookScript);
    const hookInput = JSON.stringify({ tool_input: { file_path: file } });
    const spawned = spawnSync("node", [...source.nodeFlags, hookScript], { input: hookInput, encoding: "utf8" });
    if (spawned.status !== 0) {
        throw new Error(`runRecordedPostToolHook: ${source.name} ${commit} ${source.hookScript} exited ${spawned.status} on ${file} (tool use ${toolUseId}): ${spawned.stderr}`);
    }
    if (spawned.stdout !== rewrite.attachment.stdout) {
        throw new Error(`runRecordedPostToolHook: ${source.name} ${commit} hook output on ${file} (tool use ${toolUseId}) differs from the recorded output\nreplay: ${spawned.stdout}\nrecord: ${String(rewrite.attachment.stdout)}`);
    }
}
