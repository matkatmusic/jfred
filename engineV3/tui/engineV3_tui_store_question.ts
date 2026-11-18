// The start question when the store holds a full-build repo: an up/down/enter menu to abort the load or reset the store.

import { Box, Text, useInput } from "ink";
import { createElement, useState } from "react";

export enum StoreAnswer {
    Abort = "abort",
    Reset = "reset",
}

type StoreChoice = { answer: StoreAnswer; label: string };

const STORE_CHOICES: StoreChoice[] = [
    { answer: StoreAnswer.Abort, label: "abort the build and exit the program" },
    { answer: StoreAnswer.Reset, label: "reset the store and continue the load" },
];
const LONGEST_LABEL_LENGTH = Math.max(...STORE_CHOICES.map((choice) => choice.label.length));

function formatChoiceRow(choice: StoreChoice, isSelected: boolean): string {
    const rowWidth = LONGEST_LABEL_LENGTH + 4;
    if (isSelected) {
        return `> ${choice.label} <`.padEnd(rowWidth);
    }
    return `  ${choice.label}`.padEnd(rowWidth);
}

export function StoreQuestion({ onAnswer }: { onAnswer: (answer: StoreAnswer) => void }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    useInput((_input, key) => {
        if (key.upArrow) {
            setSelectedIndex(0);
        }
        if (key.downArrow) {
            setSelectedIndex(1);
        }
        if (key.return) {
            onAnswer(STORE_CHOICES[selectedIndex]!.answer);
        }
    });
    const choiceRows = STORE_CHOICES.map((choice, index) => createElement(Text, { key: choice.answer }, formatChoiceRow(choice, index === selectedIndex)));
    return createElement(
        Box,
        { flexDirection: "column" },
        createElement(Text, null, "the store holds a full-build repo."),
        createElement(Text, null, "Do you wish to abort the build or Reset the store?"),
        createElement(Text, null, "use up/down to select, enter to choose."),
        createElement(Box, { flexDirection: "column", borderStyle: "single", alignSelf: "flex-start" }, ...choiceRows),
    );
}
