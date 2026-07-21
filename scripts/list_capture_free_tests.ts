// Prints the test files that run WITHOUT the executed scenario captures, one repo-relative path
// per line. The captures (scenarios/executed/, 109MB of raw session transcripts) are deliberately
// gitignored in the scenarios submodule — they hold machine-local data and are never published —
// so a bare clone (CI) has no JSONLs. A test needs the captures exactly when its relative-import
// closure reaches a capture-dependent module; those files are excluded here, everything else runs.
// `npm run test:ci` feeds this list to the node test runner; `npm test` stays the full local suite.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// fixtures.ts resolves scenario JSONLs at import time and throws on a captureless clone, so ANY
// test whose import closure reaches it cannot load there.
const captureDependentModules: ReadonlySet<string> = new Set([
    resolve(repositoryRoot, "tests/fixtures.ts"),
]);

// coverage_scenarios.ts scans scenarios/executed/ LAZILY (only when its functions are called), so
// merely reaching it transitively — e.g. via check_scenario_coverage.ts helpers run on synthetic
// repos — is harmless. Only a test that imports it directly enumerates the captured scenarios.
// ponytail: direct-import heuristic; a helper that CALLED the scan at import time would slip
// through, and CI would then fail loudly on that file — tighten to call-site analysis if that happens.
const lazyCaptureScanModule = resolve(repositoryRoot, "scripts/coverage_scenarios.ts");

// The existing relative imports of one source file, resolved to absolute paths. Matches both
// `from "./x.ts"` (imports and re-exports) and bare side-effect `import "./x.ts"` forms.
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

// True when the test file needs no captures under either signal: its import closure never reaches
// fixtures.ts, and it does not directly import the lazy capture scanner.
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
