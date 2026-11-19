// Entry that writes <store>/guess-files-report.txt: the files that need guesses in the reconstruction, grouped by category, and the files with a clear walk.
// usage: node --import tsx engineV3/engineV3_guess_files_report.ts --settings <file.json>   (or the same flags as the TUI)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readEarliestBoundary, type EarliestBoundary } from "./engineV3_earliest_boundary.ts";
import { buildGuessReportText, type GuessReportEntry } from "./engineV3_guess_files_report_text.ts";
import { getRelativePathInProject } from "./engineV3_inverse_repos_for_project.ts";
import { buildProjectCache } from "./tui/engineV3_tui_project_cache.ts";
import { readTuiSettings } from "./tui/engineV3_tui_settings.ts";

const REPORT_FILE_NAME = "guess-files-report.txt";

function main(): void {
    const settings = readTuiSettings(process.argv.slice(2));
    let earliestBoundary: EarliestBoundary | undefined;
    if (settings.repoFolder !== undefined) {
        earliestBoundary = readEarliestBoundary(settings.repoFolder, settings.commit!);
    }
    const cache = buildProjectCache({ projectFolder: settings.projectFolder, jsonlsFolders: settings.jsonlsFolders, fileHistoryFolders: settings.fileHistoryFolders, storeFolder: settings.storeFolder, earliestBoundary });
    const entries: GuessReportEntry[] = cache.guessAssessments!.map((assessment) => ({ relativePath: getRelativePathInProject(settings.projectFolder, assessment.file), category: assessment.category, guessStates: assessment.guessStates, otherPaths: assessment.otherPaths }));
    entries.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
    const reportFile = join(settings.storeFolder.toString(), REPORT_FILE_NAME);
    mkdirSync(settings.storeFolder.toString(), { recursive: true });
    writeFileSync(reportFile, buildGuessReportText(entries));
    console.log(reportFile);
    process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
    main();
}
