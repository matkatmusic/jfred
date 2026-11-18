// The row split of the screen while a drawer (View File or Engine Console) is open: the info box starts at the halfway row.

export type DrawerLayout = { aboveInfoRowCount: number; drawerRowCount: number };

export function computeDrawerLayout(terminalRows: number, infoRowCount: number, hotKeysRowCount: number): DrawerLayout {
    const aboveInfoRowCount = Math.floor(terminalRows / 2);
    return { aboveInfoRowCount, drawerRowCount: terminalRows - aboveInfoRowCount - infoRowCount - hotKeysRowCount };
}
