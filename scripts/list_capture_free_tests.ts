// Lists tests runnable without gitignored scenario captures; `npm run test:ci` uses this.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// fixtures.ts throws at import time without captures, so anything reaching it is excluded.
const captureDependentModules: ReadonlySet<string> = new Set([
    resolve(repositoryRoot, "tests/fixtures.ts"),
]);

// coverage_scenarios.ts scans lazily, so only direct importers need captures.
// ponytail: direct-import heuristic; a helper that CALLED the scan at import time would slip through, and CI would then fail loudly on that file — tighten to call-site analysis if that happens.
const lazyCaptureScanModule = resolve(repositoryRoot, "scripts/coverage_scenarios.ts");

// Resolves relative imports (from and bare side-effect forms) to absolute paths.
function listRelativeImportPaths(sourceFilePath: string): string[] {
    const sourceText = readFileSync(sourceFilePath, "utf8");
    const importMatches = [...sourceText.matchAll(/(?:from|import)\s+"(\.[^"]+)"/g)];
    const importedPaths: string[] = [];
    for (const importMatch of importMatches) {
        const resolvedPath = resolve(dirname(sourceFilePath), importMatch[1]!);
        if (existsSync(resolvedPath)) {
            importedPaths.push(resolvedPath);
        }
    }
    return importedPaths;
}

// Queue every not-yet-visited relative import of one file for the closure walk.
function enqueueUnvisitedImports(sourceFilePath: string, visitedPaths: Set<string>, pathsToVisit: string[]): void {
    for (const importedPath of listRelativeImportPaths(sourceFilePath)) {
        if (!visitedPaths.has(importedPath)) {
            visitedPaths.add(importedPath);
            pathsToVisit.push(importedPath);
        }
    }
}

// Walk the test file's relative-import closure; true when any reached module is capture-dependent.
export function checkImportsReachCaptures(testFilePath: string): boolean {
    const visitedPaths = new Set<string>([testFilePath]);
    const pathsToVisit = [testFilePath];
    while (pathsToVisit.length > 0) {
        const currentPath = pathsToVisit.pop()!;
        if (captureDependentModules.has(currentPath)) {
            return true;
        }
        enqueueUnvisitedImports(currentPath, visitedPaths, pathsToVisit);
    }
    return false;
}

// True when the test file itself imports the lazy capture scanner to enumerate captured scenarios.
export function checkDirectlyImportsCaptureScan(testFilePath: string): boolean {
    return listRelativeImportPaths(testFilePath).includes(lazyCaptureScanModule);
}

// True when the test needs no captures under either signal.
export function checkTestFileIsCaptureFree(testFilePath: string): boolean {
    if (checkImportsReachCaptures(testFilePath)) {
        return false;
    }
    if (checkDirectlyImportsCaptureScan(testFilePath)) {
        return false;
    }
    return true;
}

// The repo-relative paths of every capture-free test file, in name order.
export function listCaptureFreeTestPaths(): string[] {
    const testsDirectory = join(repositoryRoot, "tests");
    const testFileNames = readdirSync(testsDirectory).filter((name) => name.endsWith(".test.ts")).sort();
    const captureFreePaths: string[] = [];
    for (const testFileName of testFileNames) {
        const testFilePath = join(testsDirectory, testFileName);
        if (checkTestFileIsCaptureFree(testFilePath)) {
            captureFreePaths.push(relative(repositoryRoot, testFilePath));
        }
    }
    return captureFreePaths;
}

if (process.argv[1] !== undefined) {
    if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
        for (const captureFreePath of listCaptureFreeTestPaths()) {
            console.log(captureFreePath);
        }
    }
}

