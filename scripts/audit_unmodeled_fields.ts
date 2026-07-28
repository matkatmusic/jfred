// Drift check: reports JSONL record types and keys not yet modeled.

import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
    ALLOWED_TOP_LEVEL_KEYS,
    findUnmodeledTopLevelKeys,
} from "../src/parse/recordKeys.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

// Audit skips synthetic records so they don't pollute drift results.
export const SYNTHETIC_RECONSTRUCTED_VERSION = "0.0.0-reconstructed";

// One aggregated finding: how often, in how many files, and where first seen.
export type FindingTally = { count: number; files: Set<string>; example: string };

// The audit's mutable aggregate across all files.
export type AuditFindings = {
    unknownTypes: Map<string, FindingTally>;
    unmodeledFields: Map<string, FindingTally>;   // keyed "<type>::<field>"
    totalLines: number;
    unparseableLines: number;
    syntheticRecordsSkipped: number;
};

export function createAuditFindings(): AuditFindings {
    return {
        unknownTypes: new Map(),
        unmodeledFields: new Map(),
        totalLines: 0,
        unparseableLines: 0,
        syntheticRecordsSkipped: 0,
    };
}

// Count one occurrence under `key`, tracking the carrying file and first example.
function tallyFinding(
    findings: Map<string, FindingTally>,
    key: string,
    fileLabel: string,
    lineNumber: number,
): void {
    const existing = findings.get(key);
    if (existing === undefined) {
        findings.set(key, {
            count: 1,
            files: new Set([fileLabel]),
            example: `${fileLabel}:${lineNumber}`,
        });
        return;
    }
    existing.count += 1;
    existing.files.add(fileLabel);
}

// Audit one transcript's text into `findings`. Split from file walking so tests can feed fixture lines directly.
export function auditJsonlText(fileLabel: string, text: string, findings: AuditFindings): void {
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        if (line.trim().length === 0) {
            continue;
        }
        findings.totalLines += 1;
        let record: TranscriptRecord;
        try {
            record = JSON.parse(line) as TranscriptRecord;
        } catch {
            findings.unparseableLines += 1;
            continue;
        }
        if ((record as { version?: unknown }).version === SYNTHETIC_RECONSTRUCTED_VERSION) {
            findings.syntheticRecordsSkipped += 1;
            continue;
        }
        const allowed = ALLOWED_TOP_LEVEL_KEYS[record.type];
        if (allowed === undefined) {
            tallyFinding(findings.unknownTypes, String(record.type), fileLabel, lineNumber);
            continue;
        }
        for (const key of findUnmodeledTopLevelKeys(record)) {
            tallyFinding(findings.unmodeledFields, `${record.type}::${key}`, fileLabel, lineNumber);
        }
    }
}

// Every .jsonl under `root`, recursively; symlinks are skipped (e.g. project folders aliased into ~/.claude/projects).
function collectJsonlPaths(root: string): string[] {
    const collected: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const fullPath = join(root, entry.name);
        if (lstatSync(fullPath).isSymbolicLink()) {
            continue;
        }
        if (entry.isDirectory()) {
            collected.push(...collectJsonlPaths(fullPath));
            continue;
        }
        if (entry.name.endsWith(".jsonl")) {
            collected.push(fullPath);
        }
    }
    return collected;
}

// "<key>  count=… files=…  first: <file:line>" lines, most frequent first.
function formatFindingLines(findings: Map<string, FindingTally>): string[] {
    const entries = [...findings.entries()];
    entries.sort((a, b) => b[1].count - a[1].count);
    return entries.map(
        ([key, tally]) => `  ${key}  count=${tally.count} files=${tally.files.size}  first: ${tally.example}`,
    );
}

function main(): void {
    const projectsDir = process.argv[2];
    if (projectsDir === undefined) {
        console.error("usage: npx tsx scripts/audit_unmodeled_fields.ts <projectsDir>");
        process.exit(2);
    }
    const jsonlPaths = collectJsonlPaths(projectsDir);
    const findings = createAuditFindings();
    for (const jsonlPath of jsonlPaths) {
        auditJsonlText(relative(projectsDir, jsonlPath), readFileSync(jsonlPath, "utf8"), findings);
    }
    console.log(
        `scanned ${jsonlPaths.length} .jsonl files, ${findings.totalLines} lines ` +
        `(${findings.unparseableLines} unparseable, ${findings.syntheticRecordsSkipped} synthetic skipped)`,
    );
    console.log(`\nunknown record types: ${findings.unknownTypes.size}`);
    for (const line of formatFindingLines(findings.unknownTypes)) {
        console.log(line);
    }
    console.log(`\nunmodeled fields: ${findings.unmodeledFields.size}`);
    for (const line of formatFindingLines(findings.unmodeledFields)) {
        console.log(line);
    }
    const hasFindings = findings.unknownTypes.size > 0 || findings.unmodeledFields.size > 0;
    process.exit(hasFindings ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}


