// The name shown for each Ink key in the hotkeys box and the footer.
import type { INK_KEY_NAMES } from "./engineV3_tui_keymap.ts";

export const KEY_DISPLAY_NAMES: Record<(typeof INK_KEY_NAMES)[number], string> = {
    upArrow: "Up",
    downArrow: "Down",
    leftArrow: "Left",
    rightArrow: "Right",
    pageDown: "PageDown",
    pageUp: "PageUp",
    home: "Home",
    end: "End",
    return: "Enter",
    escape: "Esc",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
};
