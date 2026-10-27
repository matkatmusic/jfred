import type { Path } from "./structures/domain.ts";
import type { RepoSnapshot } from "./reconstruction_steps.ts";

// Matched on a path boundary so `s2_original.py` does not match `tests/test_s2_original.py`.
function matchKeyToPath(keyPath: Path, relativePath: string): boolean {
  const key = keyPath.toString();
  return key === relativePath || key.endsWith(`/${relativePath}`);
}

export function snapshotFileText(snapshot: RepoSnapshot, relativePath: string): string | undefined {
  for (const [path, text] of snapshot) {
    const isMatch = matchKeyToPath(path, relativePath);
    if (isMatch) {
      return text;
    }
  }
  return undefined;
}

// The engine's newline-joined text omits the trailing newline that on-disk ground-truth files keep.
export function stripTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function containsGroundTruth(snapshot: RepoSnapshot, groundTruth: ReadonlyMap<string, string>): boolean {
  for (const [relativePath, content] of groundTruth) {
    const reconstructed = snapshotFileText(snapshot, relativePath);
    const expected = stripTrailingNewline(content);
    if (reconstructed !== expected) {
      return false;
    }
  }
  return true;
}

// Pass/fail is "some step matches", never a positional alignment with instruction-numbered folders.
export function someStepReproduces(
  steps: RepoSnapshot[],
  groundTruth: ReadonlyMap<string, string>,
): boolean {
  for (const snapshot of steps) {
    const reproduces = containsGroundTruth(snapshot, groundTruth);
    if (reproduces) {
      return true;
    }
  }
  return false;
}

function comparePathText(a: Path, b: Path): number {
  return a.toString().localeCompare(b.toString());
}

// Uses the same `### <path>` framing as the verbose/diff views.
export function renderRepoSnapshot(snapshot: RepoSnapshot): string {
  const paths = [...snapshot.keys()].sort(comparePathText);
  const sections: string[] = [];
  for (const path of paths) {
    sections.push(`### ${path}\n${snapshot.get(path)}`);
  }
  return sections.join("\n\n");
}
