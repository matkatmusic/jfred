import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Path } from "../../src/structures/domain.ts";
import { executeGit } from "../engineV3.ts";
import { getLogFilesHash } from "../engineV3_inverse_repos_for_project.ts";
import type { TuiInput } from "./engineV3_tui_project_cache.ts";

function listFileHistoryFileLines(fileHistoryFolders: Path[]): string[] {
    const fileLines: string[] = [];
    for (const fileHistoryFolder of fileHistoryFolders) {
        const entries = readdirSync(fileHistoryFolder.toString(), { recursive: true, withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile()) {
                const filePath = join(entry.parentPath, entry.name);
                const fileStats = statSync(filePath);
                fileLines.push(`${filePath} ${fileStats.size} ${fileStats.mtimeMs}`);
            }
        }
    }
    return fileLines.sort();
}

export function computeProjectCacheInputsHash(input: TuiInput, projectFiles: Path[], transcriptsToParse: Path[]): string {
    const logFilesHash = getLogFilesHash(transcriptsToParse);
    const boundaryCommit = input.earliestBoundary === undefined ? "none" : input.earliestBoundary.commit.toString();
    const projectFolderText = input.projectFolder.toString();
    const headCommit = executeGit(input.projectFolder, ["rev-parse", "HEAD"]).toString("utf8").trim();
    const fileHistoryLines = listFileHistoryFileLines(input.fileHistoryFolders);
    const projectFilePaths = projectFiles.map((projectFile) => projectFile.toString()).sort();
    const hashedParts = [logFilesHash, boundaryCommit, projectFolderText, headCommit, fileHistoryLines.join("\n"), projectFilePaths.join("\n")];
    return createHash("sha256").update(hashedParts.join("\n")).digest("hex");
}
