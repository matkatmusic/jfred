// Task 382: one CSS class and one label letter per session record kind; the CSS owner styles the shapes.

import { WireRecordKind } from "./layer1-wire-annotations.ts";

export interface AnnotationLook {
  cssClass: string;
  letter: string;
  dotLetter: string;
}

export const ANNOTATION_LOOKS: Record<WireRecordKind, AnnotationLook> = {
  [WireRecordKind.user]: { cssClass: "a-user", letter: "[u]", dotLetter: "u" },
  [WireRecordKind.assistant]: { cssClass: "a-assistant", letter: "[a]", dotLetter: "a" },
  [WireRecordKind.toolUse]: { cssClass: "a-tool-use", letter: "[t]", dotLetter: "t" },
  [WireRecordKind.toolResult]: { cssClass: "a-tool-result", letter: "[r]", dotLetter: "r" },
  [WireRecordKind.attachment]: { cssClass: "a-attachment", letter: "[h]", dotLetter: "h" },
  [WireRecordKind.permissionMode]: { cssClass: "a-permission-mode", letter: "[m]", dotLetter: "m" },
  [WireRecordKind.customTitle]: { cssClass: "a-custom-title", letter: "[n]", dotLetter: "n" },
  [WireRecordKind.unknown]: { cssClass: "a-unknown", letter: "[?]", dotLetter: "?" },
};
