// Terminal screen control for the TUI start.

// 2J erases the whole screen; H moves the cursor to the top left.
export const CLEAR_SCREEN_SEQUENCE = "\x1b[2J\x1b[H";

// 1049 switches to a blank second screen and back, so the old shell text returns when the TUI ends.
export const ENTER_ALTERNATE_SCREEN_SEQUENCE = "\x1b[?1049h";
export const LEAVE_ALTERNATE_SCREEN_SEQUENCE = "\x1b[?1049l";

export function enterAlternateScreen(output: { write: (text: string) => unknown }): void {
    output.write(ENTER_ALTERNATE_SCREEN_SEQUENCE);
}

export function leaveAlternateScreen(output: { write: (text: string) => unknown }): void {
    output.write(LEAVE_ALTERNATE_SCREEN_SEQUENCE);
}

export function clearTerminalScreen(output: { write: (text: string) => unknown }): void {
    output.write(CLEAR_SCREEN_SEQUENCE);
}
