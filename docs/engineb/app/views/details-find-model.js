// Details-pane find widget (task 127) — pure model: match finding over text-node values plus
// the n/N cursor arithmetic. DOM-free so tests exercise it directly (same split as
// timeline-filter-model.ts); the DOM consumer is details-find.ts.
// Every case-insensitive occurrence of `term` across the pane's text-node values, in document
// order. Blank terms match nothing (the widget's idle state).
// ponytail: a match spanning two text nodes (e.g. across hljs spans) is not found; rebuild
// over concatenated values with a node-offset map if that ever matters.
// Every occurrence of `normalizedTerm` inside one value, appended in offset order.
function appendMatchesInValue(matches, nodeIndex, value, normalizedTerm) {
    const lowerValue = value.toLowerCase();
    let start = lowerValue.indexOf(normalizedTerm);
    while (start !== -1) {
        matches.push({ nodeIndex, start, end: start + normalizedTerm.length });
        start = lowerValue.indexOf(normalizedTerm, start + normalizedTerm.length);
    }
}
export function findMatchesInTextNodeValues(values, term) {
    const normalizedTerm = term.trim().toLowerCase();
    if (normalizedTerm === "") {
        return [];
    }
    const matches = [];
    for (const [nodeIndex, value] of values.entries()) {
        appendMatchesInValue(matches, nodeIndex, value, normalizedTerm);
    }
    return matches;
}
// The next current-match index after stepping `delta` (+1 next / -1 prev), wrapping at both
// ends; -1 when there are no matches.
export function computeWrappedMatchIndex(current, total, delta) {
    if (total === 0) {
        return -1;
    }
    return (((current + delta) % total) + total) % total;
}
// The widget's "n/N" counter text (1-based for display; current is the 0-based state, -1 = none).
export function computeMatchCounterLabel(current, total) {
    if (total === 0) {
        return "0/0";
    }
    return `${current + 1}/${total}`;
}
