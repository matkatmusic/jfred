// The text of the guess-files report: a count line per category, then one section per category, then the clear walk.

import { GuessCategory } from "../src/structures/vocabulary.ts";
import type { FileKnownState } from "./engineV3_file_known_states.ts";

const CLEAR_WALK_NAME = "clear walk";
const NO_INSTANT_TEXT = "no instant";
const DETAIL_INDENT = "    ";
const TITLE_BY_CATEGORY: Partial<Record<GuessCategory, string>> = { [GuessCategory.NoChangingEvents]: "No changing events" };

function getCategoryTitle(category: GuessCategory): string {
    return TITLE_BY_CATEGORY[category] ?? category;
}

export type GuessReportEntry = { relativePath: string; category: GuessCategory | undefined; guessStates: FileKnownState[]; otherPaths: string[] };

function describeGuessState(state: FileKnownState): string {
    const instantText = state.event.instant === undefined ? NO_INSTANT_TEXT : state.event.instant.toISOString();
    return `${DETAIL_INDENT}${state.confidence} ${state.event.type} ${instantText}`;
}

function listSectionLines(sectionName: string, sectionEntries: GuessReportEntry[]): string[] {
    const lines = ["", `== ${sectionName} (${sectionEntries.length}) ==`];
    for (const entry of sectionEntries) {
        lines.push(entry.relativePath);
        for (const state of entry.guessStates) {
            lines.push(describeGuessState(state));
        }
        for (const otherPath of entry.otherPaths) {
            lines.push(`${DETAIL_INDENT}other path ${otherPath}`);
        }
    }
    return lines;
}

export function buildGuessReportText(entries: GuessReportEntry[]): string {
    const categories = Object.values(GuessCategory);
    const lines: string[] = [];
    for (const category of categories) {
        lines.push(`${getCategoryTitle(category)}: ${entries.filter((entry) => entry.category === category).length}`);
    }
    lines.push(`${CLEAR_WALK_NAME}: ${entries.filter((entry) => entry.category === undefined).length}`);
    for (const category of categories) {
        lines.push(...listSectionLines(getCategoryTitle(category), entries.filter((entry) => entry.category === category)));
    }
    lines.push(...listSectionLines(CLEAR_WALK_NAME, entries.filter((entry) => entry.category === undefined)));
    return lines.join("\n") + "\n";
}
