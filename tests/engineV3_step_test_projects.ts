// Fixture projects for the step program tests: a git project, its session log and its folders.

import { type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { SESSION_A } from "./multi-source-test-helpers.ts";

export const PROJECT_FILE_NAME = "a.txt";

export type ProjectFolders = { rootFolder: string; projectFolder: Path; jsonlsFolder: Path; snapshotFolder: Path; storeFolder: Path; secondStoreFolder: Path };
export type Project = ProjectFolders & { file: Path };
export type ProjectWithFiles = ProjectFolders & { fileByName: Map<string, Path> };

export function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

export function makeEditRows(projectFolder: string, toolUseId: string, filePath: string, oldString: string, newString: string, originalFile: string | null, second: number): object[] {
    const toolUseResult = { filePath, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false, originalFile };
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Edit", input: { file_path: filePath }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [callRecord, resultRecord];
}

// The call record alone: a script run has no result record in the logs these tests need.
export function makeBashRows(projectFolder: string, toolUseId: string, command: string, second: number): object[] {
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Bash", input: { command }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    return [callRecord];
}

export function makeWriteCreateRows(projectFolder: string, toolUseId: string, filePath: string, content: string, second: number): object[] {
    const toolUseResult = { type: "create", filePath, content, originalFile: null, structuredPatch: [], userModified: false };
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Write", input: { file_path: filePath, content }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [callRecord, resultRecord];
}

// The layered search of the program needs a repo with a HEAD commit; the file stays untracked.
export function initGitRepo(folder: string): void {
    execFileSync("git", ["init", "-q"], { cwd: folder });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: folder });
}

function makeProjectFolders(t: TestContext): ProjectFolders {
    const rootFolder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-step-cli-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    const snapshotFolder = join(rootFolder, "file-history");
    mkdirSync(projectFolder);
    mkdirSync(jsonlsFolder);
    mkdirSync(snapshotFolder);
    initGitRepo(projectFolder);
    return {
        rootFolder,
        projectFolder: new Path(projectFolder),
        jsonlsFolder: new Path(jsonlsFolder),
        snapshotFolder: new Path(snapshotFolder),
        storeFolder: new Path(join(rootFolder, "store")),
        secondStoreFolder: new Path(join(rootFolder, "second-store")),
    };
}

function writeSessionLog(folders: ProjectFolders, rows: object[]): void {
    writeFileSync(join(folders.jsonlsFolder.toString(), "s1.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

// A git project holding a.txt with the given disk text, and a log folder holding one transcript made of the rows.
export function writeProject(t: TestContext, diskText: string, makeRows: (projectFolder: string, filePath: string) => object[]): Project {
    const folders = makeProjectFolders(t);
    const filePath = join(folders.projectFolder.toString(), PROJECT_FILE_NAME);
    writeFileSync(filePath, diskText);
    writeSessionLog(folders, makeRows(folders.projectFolder.toString(), filePath));
    return { ...folders, file: new Path(filePath) };
}

// Like writeProject, with one file on disk for each name of the map.
export function writeProjectFiles(t: TestContext, diskTextByFileName: Map<string, string>, makeRows: (projectFolder: string, filePathByFileName: Map<string, string>) => object[]): ProjectWithFiles {
    const folders = makeProjectFolders(t);
    const filePathByFileName = new Map<string, string>();
    const fileByName = new Map<string, Path>();
    for (const [fileName, diskText] of diskTextByFileName) {
        const filePath = join(folders.projectFolder.toString(), fileName);
        mkdirSync(join(filePath, ".."), { recursive: true });
        writeFileSync(filePath, diskText);
        filePathByFileName.set(fileName, filePath);
        fileByName.set(fileName, new Path(filePath));
    }
    writeSessionLog(folders, makeRows(folders.projectFolder.toString(), filePathByFileName));
    return { ...folders, fileByName };
}
