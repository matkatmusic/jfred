// Terminal screen control for the TUI start.

// 2J erases the whole screen; H moves the cursor to the top left.
export const CLEAR_SCREEN_SEQUENCE = "\x1b[2J\x1b[H";

export function clearTerminalScreen(output: { write: (text: string) => unknown }): void {
    output.write(CLEAR_SCREEN_SEQUENCE);
}
