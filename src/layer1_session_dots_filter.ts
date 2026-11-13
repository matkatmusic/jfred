// Which logs and which lines belong to the loaded project.
import { Path } from "./structures/domain.ts";
import { encodeProjectFolderName } from "./reconstruction_repo_discovery.ts";

// A path character continues a longer name, so it is not a boundary.
const PATH_CHARACTER = /[A-Za-z0-9._-]/;

export function getProjectFolderKey(projectFolder: Path): string {
  return projectFolder.toString().replace(/\/$/, "");
}

// A whole path segment, never a prefix: "-jot" must not match "-jot-recovery".
export function isProjectLogPath(logFile: Path, projectFolder: Path): boolean {
  const folderName = encodeProjectFolderName(getProjectFolderKey(projectFolder));
  const segments = logFile.toString().split("/");
  return segments.includes(folderName);
}

export function isProjectFolderMentioned(text: string, projectFolder: Path): boolean {
  const key = getProjectFolderKey(projectFolder);
  let foundAt = text.indexOf(key);
  while (foundAt !== -1) {
    const nextCharacter = text[foundAt + key.length];
    if (nextCharacter === undefined) {
      return true;
    }
    const isPathCharacter = PATH_CHARACTER.test(nextCharacter);
    if (!isPathCharacter) {
      return true;
    }
    foundAt = text.indexOf(key, foundAt + 1);
  }
  return false;
}
