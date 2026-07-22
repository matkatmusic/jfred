// numbered-entries: low-level parsing of numbered result lines into
// {lineNum, text, startIndex, endIndex} entries. Shared by two prefix dialects:
// Read-tool output ("N\tcontent") and cat -n output ("  N | content").
//
// The Read tool numbers the empty string AFTER a file's final newline as a
// phantom trailing line "N\t" (no content), present for ANY file ending in a
// single '\n'. dropTrailingReadPhantom removes only that one terminal artifact
// so a Read's belief EOF matches the real file — mirroring how
// line-state-evidence.splitContentIntoLineSpans treats a trailing newline as a
// terminator. The cat path does NOT call it: cat -n emits a trailing numbered-
// empty line only for a GENUINE blank line, which must be kept.

// One {lineNum, text, startIndex, endIndex} entry from a numbered raw line; the
// span covers content AFTER the prefix (the text, not its decoration).
function buildNumberedEntry(match, rawLine, offset) {
    return {
        lineNum: parseInt(match[1], 10),
        text: rawLine.slice(match[0].length),
        startIndex: offset + match[0].length,
        endIndex: offset + rawLine.length
    };
}

// Entries for every prefix-matching line of rawText, with global offsets.
// Non-matching lines (reminders, notices) are not file content — skipped.
function buildNumberedEntries(rawText, pattern) {
    var rawLines = rawText.split('\n');
    var entries = [];
    var offset = 0;
    for (var i = 0; i < rawLines.length; i++) {
        var match = pattern.exec(rawLines[i]);
        if (match) { entries.push(buildNumberedEntry(match, rawLines[i], offset)); }
        offset += rawLines[i].length + 1;
    }
    return entries;
}

// Drop ONLY the terminal Read phantom. Single-condition guards, each its own
// early-return: there must be a predecessor to prove contiguity; the last entry
// must be empty; it must be the very end of the result text (endIndex ===
// rawText.length, i.e. NO trailing newline after it — the Read phantom's
// signature); and its line number must be the predecessor's + 1. A genuine
// interior blank line is always followed by another numbered line, so it never
// satisfies endIndex === rawText.length and is preserved.
function dropTrailingReadPhantom(entries, rawText) {
    if (entries.length < 2) { return entries; }
    var last = entries[entries.length - 1];
    if (last.text !== '') { return entries; }
    if (last.endIndex !== rawText.length) { return entries; }
    var previous = entries[entries.length - 2];
    if (last.lineNum !== previous.lineNum + 1) { return entries; }
    return entries.slice(0, entries.length - 1);
}

module.exports = {
    buildNumberedEntry: buildNumberedEntry,
    buildNumberedEntries: buildNumberedEntries,
    dropTrailingReadPhantom: dropTrailingReadPhantom
};
