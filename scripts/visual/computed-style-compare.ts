// Computed-style before/after proof. Usage: capture <out.json> | compare <before.json> <after.json>  (exit 1 on any difference).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listStyleDifferences, type StyleCapture, type StyleDifference } from "./computed-style-diff.ts";
import { listCssTextPropertyNames, listLonghandNames, selectComparedProperties } from "./computed-style-property-list.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// `--properties-from-git <rev:path>` limits the compare to the longhands that sheet text sets.
function readComparedNames(gitSpec: string | undefined, before: StyleCapture, after: StyleCapture): string[] | undefined {
  if (gitSpec === undefined) {
    return undefined;
  }
  const cssText = execFileSync("git", ["-C", JFRED_ROOT, "show", gitSpec], { encoding: "utf8" });
  const longhands = listLonghandNames(listCssTextPropertyNames(cssText), [...new Set([...before.properties, ...after.properties])]);
  const selected = selectComparedProperties(longhands, before.properties, after.properties);
  console.log(`compared properties: ${selected.names.length}; skipped custom names in one capture only: ${selected.skippedCustomNames.length} ${selected.skippedCustomNames.join(" ")}`);
  return selected.names;
}

export function countCapture(capture: StyleCapture): { stateCount: number; elementCount: number } {
  let stateCount = 0;
  let elementCount = 0;
  for (const entries of Object.values(capture.states)) {
    stateCount += 1;
    elementCount += Object.keys(entries).length;
  }
  return { stateCount, elementCount };
}

// An empty capture must never pass as a clean compare.
export function assertCaptureHasContent(capture: StyleCapture, label: string): void {
  const counts = countCapture(capture);
  if (counts.stateCount === 0) {
    throw new Error(`${label} holds no states`);
  }
  for (const [state, entries] of Object.entries(capture.states)) {
    const entryCount = Object.keys(entries).length;
    if (entryCount === 0) {
      throw new Error(`${label} state ${state} holds no elements`);
    }
  }
}

export function formatStyleDifference(difference: StyleDifference): string {
  return [difference.state, difference.path, difference.property, difference.before, difference.after].join("\t");
}

function readCapture(file: string): StyleCapture {
  const capture = JSON.parse(readFileSync(file, "utf8")) as StyleCapture;
  assertCaptureHasContent(capture, file);
  return capture;
}

function printCounts(label: string, capture: StyleCapture): void {
  const counts = countCapture(capture);
  console.log(`${label}: ${counts.stateCount} states, ${counts.elementCount} element-style entries, ${capture.styles.length} distinct styles, ${capture.properties.length} properties`);
}

function executeCompare(beforeFile: string, afterFile: string, gitSpec: string | undefined): number {
  const before = readCapture(beforeFile);
  const after = readCapture(afterFile);
  printCounts("before", before);
  printCounts("after", after);
  const differences = listStyleDifferences(before, after, readComparedNames(gitSpec, before, after));
  console.log("state\tpath\tproperty\tbefore\tafter");
  for (const difference of differences) {
    console.log(formatStyleDifference(difference));
  }
  console.log(`${differences.length} differences`);
  return differences.length === 0 ? 0 : 1;
}

async function executeCapture(outFile: string): Promise<number> {
  const { collectAllCaptures } = await import("./computed-style-capture.ts");
  const capture = await collectAllCaptures();
  assertCaptureHasContent(capture, outFile);
  writeFileSync(outFile, JSON.stringify(capture));
  printCounts("captured", capture);
  return 0;
}

async function executeCommand(argv: string[]): Promise<number> {
  const [command, first, second, option, gitSpec] = argv;
  const isCapture = command === "capture" && first !== undefined;
  if (isCapture) {
    return executeCapture(first);
  }
  const isCompare = command === "compare" && first !== undefined && second !== undefined;
  if (isCompare) {
    return executeCompare(first, second, option === "--properties-from-git" ? gitSpec : undefined);
  }
  throw new Error("usage: capture <out.json> | compare <before.json> <after.json> [--properties-from-git <rev:path>]");
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  process.exitCode = await executeCommand(process.argv.slice(2));
}
