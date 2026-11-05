// Wraps text at a column limit for hover popups (L9 redesign P5).

function listWordChunks(word: string, columns: number): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < word.length; start += columns)
    chunks.push(word.slice(start, start + columns));
  return chunks;
}

function listLinePieces(line: string, columns: number): string[] {
  const pieces: string[] = [];
  for (const word of line.split(" ")) {
    const isEmptyWord = word === "";
    const isLongWord = word.length > columns;
    if (isEmptyWord)
      continue;
    pieces.push(...(isLongWord ? listWordChunks(word, columns) : [word]));
  }
  return pieces;
}

function wrapLine(line: string, columns: number): string[] {
  const rows: string[] = [];
  let current = "";
  for (const piece of listLinePieces(line, columns)) {
    const isFirstPiece = current === "";
    const isRoomLeft = current.length + 1 + piece.length <= columns;
    if (isFirstPiece)
      current = piece;
    else if (isRoomLeft)
      current += ` ${piece}`;
    else {
      rows.push(current);
      current = piece;
    }
  }
  rows.push(current);
  return rows;
}

// Wraps each source line alone; keeps blank lines; breaks long words at the limit.
export function wrapTextAtColumns(text: string, columns: number): string {
  const rows: string[] = [];
  for (const line of text.split("\n"))
    rows.push(...wrapLine(line, columns));
  return rows.join("\n");
}
