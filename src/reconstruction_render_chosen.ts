// Chosen-view rendering: narrow histories to --target, then render as list, verbose, or diff.

import type { FileHistory, FileRevision } from "./reconstruction_events.ts";
import type { Path } from "./structures/domain.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";
import { renderVerbose } from "./reconstruction_render.ts";
import { renderDiff } from "./reconstruction_render_diff.ts";
import { renderHistoryList } from "./reconstruction_render_list.ts";

// Render histories in the verbose/diff mode, each under its `### <path>` header.
function renderHistories(
  histories: FileHistory[],
  render: (revisions: FileRevision[]) => string,
): string {
  const sections: string[] = [];
  for (const history of histories) {
    sections.push(`### ${history.target}\n${render(history.revisions)}`);
  }
  return sections.join("\n\n");
}

// The histories matching --target (by exact final path), or all of them when no --target is given.
export function filterByTarget(
  histories: FileHistory[],
  target: Path | undefined,
): FileHistory[] {
  if (target === undefined) {
    return histories;
  }
  const matching: FileHistory[] = [];
  const targetText = target.toString();
  for (const history of histories) {
    const historyText = history.target.toString();
    if (historyText === targetText) {
      matching.push(history);
    }
  }
  return matching;
}

// Render a chosen set of histories in the selected view, narrowed to --target when given.
export function renderChosen(histories: FileHistory[], options: CliOptions): string {
  const chosen = filterByTarget(histories, options.target);
  if (options.diff) {
    return renderHistories(chosen, renderDiff);
  }
  if (options.verbose) {
    return renderHistories(chosen, renderVerbose);
  }
  return renderHistoryList(chosen);
}
