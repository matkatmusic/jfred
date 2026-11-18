// The consent question as a popup in the middle of the screen, with a yes/no picker (up/down to select, enter to choose).
import { Box, Text, useInput } from "ink";
import { useState } from "react";

const YES_LABEL = "yes";
const NO_LABEL = "no";
const LONGEST_LABEL_LENGTH = Math.max(YES_LABEL.length, NO_LABEL.length);
const QUESTION_ENDING = " (y/n)";
const POPUP_MAXIMUM_WIDTH = 70;

function formatChoiceRow(label: string, isSelected: boolean): string {
    const rowWidth = LONGEST_LABEL_LENGTH + 4;
    if (isSelected) {
        return `> ${label} <`.padEnd(rowWidth);
    }
    return `  ${label}`.padEnd(rowWidth);
}

export function ConsentPopup({ questionText, terminalRows, terminalColumns, onAnswer }: { questionText: string; terminalRows: number; terminalColumns: number; onAnswer: (answer: boolean) => void }) {
    const [isYesSelected, setIsYesSelected] = useState(true);
    useInput((_input, key) => {
        if (key.upArrow) {
            setIsYesSelected(true);
        }
        if (key.downArrow) {
            setIsYesSelected(false);
        }
        if (key.return) {
            onAnswer(isYesSelected);
        }
    });
    const shownQuestionText = questionText.endsWith(QUESTION_ENDING) ? questionText.slice(0, -QUESTION_ENDING.length) : questionText;
    return (
        <Box height={terminalRows} width={terminalColumns} alignItems="center" justifyContent="center">
            <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1} width={Math.min(POPUP_MAXIMUM_WIDTH, terminalColumns)}>
                <Text color="yellow">{shownQuestionText}</Text>
                <Text> </Text>
                <Text>use up/down to select, enter to choose.</Text>
                <Box borderStyle="single" alignSelf="flex-start" flexDirection="column">
                    <Text>{formatChoiceRow(YES_LABEL, isYesSelected)}</Text>
                    <Text>{formatChoiceRow(NO_LABEL, !isYesSelected)}</Text>
                </Box>
            </Box>
        </Box>
    );
}
