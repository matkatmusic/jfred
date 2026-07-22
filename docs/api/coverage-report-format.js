// coverage-report-format: render the batch coverage rows to markdown (primary,
// human-readable) and JSON (array-shaped sidecar). Pure string building — no I/O.
// A row is { path, status, inGitAtSha, inJsonl, onDisk, matchedObserved,
// matchedPresumed, mismatched, neverObserved, tailUncertain, seeded,
// contributingPaths, firstMismatchLine, conflictTimestamp, conflictWindow,
// missingData, rerunCommand }.

// Count rows per status, always reporting all three buckets.
function countByStatus(rows) {
    var counts = { PASS: 0, FAIL: 0, INDETERMINATE: 0 };
    for (var i = 0; i < rows.length; i++) {
        if (counts[rows[i].status] === undefined) { counts[rows[i].status] = 0; }
        counts[rows[i].status]++;
    }
    return counts;
}

// 'yes'/'no' for a membership flag.
function formatYesNo(flag) {
    if (flag) { return 'yes'; }
    return 'no';
}

// '-' for a null line number, else the number as a string.
function formatLineCell(lineNumber) {
    if (lineNumber === null) { return '-'; }
    return String(lineNumber);
}

// The summary header: the run's seeds, detected jot roots, and status counts.
function buildSummaryLines(rows, meta) {
    var counts = countByStatus(rows);
    var lines = [];
    lines.push('# Reconstruction coverage report');
    lines.push('');
    lines.push('- Repo: ' + meta.repoRoot);
    lines.push('- Seed commit: ' + meta.sha);
    lines.push('- Projects dir: ' + meta.projectsDir);
    lines.push('- Universe: ' + rows.length + ' files — PASS ' + counts.PASS + ', FAIL ' + counts.FAIL + ', INDETERMINATE ' + counts.INDETERMINATE);
    lines.push('');
    return lines;
}

// One markdown table row for a file.
function buildTableRow(row) {
    var cells = [
        row.path,
        row.status,
        formatYesNo(row.inGitAtSha),
        formatYesNo(row.inJsonl),
        formatYesNo(row.onDisk),
        String(row.matchedObserved),
        String(row.matchedPresumed),
        String(row.mismatched),
        String(row.neverObserved),
        formatYesNo(row.tailUncertain),
        row.seeded,
        String(row.contributingPaths.length),
        formatLineCell(row.firstMismatchLine)
    ];
    return '| ' + cells.join(' | ') + ' |';
}

// The per-file table (header + one row per file).
function buildTableLines(rows) {
    var lines = [];
    lines.push('## Per-file coverage');
    lines.push('');
    lines.push('| file | status | git@SHA | jsonl | disk | obs | presumed | mismatched | neverObserved | tail | seeded | paths | firstMismatch |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (var i = 0; i < rows.length; i++) {
        lines.push(buildTableRow(rows[i]));
    }
    lines.push('');
    return lines;
}

// A "where it broke" phrase from the mismatch line and/or conflict instant.
function describeBreakLocation(row) {
    if (row.firstMismatchLine !== null) {
        if (row.conflictTimestamp !== null) {
            return 'line ' + row.firstMismatchLine + ' (conflict ~' + row.conflictTimestamp + ')';
        }
        return 'line ' + row.firstMismatchLine;
    }
    if (row.conflictTimestamp !== null) {
        return 'conflict ~' + row.conflictTimestamp;
    }
    return 'no single line — see counters';
}

// The detail block for one non-PASS row.
function buildDetailLines(row) {
    var lines = [];
    lines.push('### ' + row.path + ' — ' + row.status);
    lines.push('- where it broke: ' + describeBreakLocation(row));
    lines.push('- missing data: ' + row.missingData);
    lines.push('- contributing paths: ' + row.contributingPaths.join(', '));
    lines.push('- rerun: `' + row.rerunCommand + '`');
    lines.push('');
    return lines;
}

// The details section: one block per FAIL/INDETERMINATE row.
function buildDetailsSection(rows) {
    var lines = [];
    lines.push('## Failures & indeterminate details');
    lines.push('');
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].status === 'PASS') { continue; }
        Array.prototype.push.apply(lines, buildDetailLines(rows[i]));
    }
    return lines;
}

// Render the full markdown report: summary + per-file table + per-failure details.
function formatCoverageMarkdown(rows, meta) {
    var lines = [];
    Array.prototype.push.apply(lines, buildSummaryLines(rows, meta));
    Array.prototype.push.apply(lines, buildTableLines(rows));
    Array.prototype.push.apply(lines, buildDetailsSection(rows));
    return lines.join('\n');
}

// Render the array-shaped JSON sidecar (one entry per row).
function formatCoverageJson(rows, meta) {
    return JSON.stringify(rows, null, 2);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatCoverageMarkdown: formatCoverageMarkdown,
        formatCoverageJson: formatCoverageJson
    };
}
