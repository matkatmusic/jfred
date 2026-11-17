export function splitCommandLineAtJoiners(commandLine: string): string[] {
    const pieces: string[] = [];
    let currentPiece = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let index = 0;
    while (index < commandLine.length) {
        const character = commandLine[index];
        const twoCharacters = commandLine.slice(index, index + 2);
        if (character === "\\") {
            if (!inSingleQuote) {
                currentPiece += twoCharacters;
                index += 2;
                continue;
            }
        }
        if (character === "'") {
            if (!inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                currentPiece += character;
                index += 1;
                continue;
            }
        }
        if (character === '"') {
            if (!inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                currentPiece += character;
                index += 1;
                continue;
            }
        }
        if (inSingleQuote) {
            currentPiece += character;
            index += 1;
            continue;
        }
        if (inDoubleQuote) {
            currentPiece += character;
            index += 1;
            continue;
        }
        // ponytail: a line with a paren, backtick or heredoc outside quotes is not cut; upgrade by skipping the heredoc body and handling paren groups
        if (character === "(") {
            return [commandLine];
        }
        if (character === "`") {
            return [commandLine];
        }
        if (twoCharacters === "<<") {
            return [commandLine];
        }
        let joinerLength = 0;
        if (twoCharacters === "&&") {
            joinerLength = 2;
        } else if (twoCharacters === "||") {
            joinerLength = 2;
        } else if (character === "|") {
            joinerLength = 1;
        } else if (character === ";") {
            joinerLength = 1;
        } else if (character === "\n") {
            joinerLength = 1;
        }
        if (joinerLength > 0) {
            pieces.push(currentPiece.trim());
            currentPiece = "";
            index += joinerLength;
            continue;
        }
        currentPiece += character;
        index += 1;
    }
    pieces.push(currentPiece.trim());
    return pieces.filter((piece) => piece !== "");
}
