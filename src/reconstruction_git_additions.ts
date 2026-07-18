// Pure line-addition diffs for the git-evidence placement stage (split from
// reconstruction_git_placement.ts, 250-line cap): a blob explained as the base plus inserted
// lines, and the re-anchoring of those insertions onto another base.

// One line the blob carries beyond the base, anchored to the base line it follows (undefined =
// inserted at the start of the file).
export type LineAddition = { anchor: string | undefined; line: string };

// The blob as the base plus pure line insertions, or undefined when the blob deletes or changes
// any base line (then the diff is not "unexplained additions" and the stage must stay silent).
export function pureAdditionsFrom(baseLines: string[], blobLines: string[]): LineAddition[] | undefined {
    const additions: LineAddition[] = [];
    let baseIndex = 0;
    for (const line of blobLines) {
        if (baseIndex < baseLines.length && line === baseLines[baseIndex]) {
            baseIndex += 1;
            continue;
        }
        additions.push({ anchor: baseIndex > 0 ? baseLines[baseIndex - 1] : undefined, line });
    }
    if (baseIndex !== baseLines.length || additions.length === 0) return undefined;
    return additions;
}

// `lines` with each addition inserted after the LAST occurrence of its anchor (or at the start),
// or undefined when an anchor line is absent — the addition cannot be re-anchored onto this base.
export function applyAdditions(lines: string[], additions: LineAddition[]): string[] | undefined {
    const result = [...lines];
    for (const { anchor, line } of additions) {
        if (anchor === undefined) {
            result.unshift(line);
            continue;
        }
        const at = result.lastIndexOf(anchor);
        if (at < 0) return undefined;
        result.splice(at + 1, 0, line);
    }
    return result;
}
