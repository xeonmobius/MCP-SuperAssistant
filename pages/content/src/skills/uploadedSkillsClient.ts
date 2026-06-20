import type { UploadedSkill, FileEntry } from '../../../../chrome-extension/src/skills/uploaded-parser';

const send = (msg: unknown) =>
  new Promise<any>(resolve => chrome.runtime.sendMessage(msg, resolve));

// File → {path, text} extraction happens HERE (content side) because File
// objects don't survive the content→background message clone: the structured
// clone drops the non-enumerable `webkitRelativePath`, which would break the
// parser's root-prefix logic. Reading `.text()` here and shipping plain
// `{path, text}` is the fix.
const toEntries = async (files: File[]): Promise<FileEntry[]> => {
  const out: FileEntry[] = [];
  for (const f of files) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    out.push({ path, text: await f.text() });
  }
  return out;
};

const uploadEntries = (entries: FileEntry[]) =>
  send({ type: 'uploadedSkill:upload', files: entries });
const replaceEntries = (name: string, entries: FileEntry[]) =>
  send({ type: 'uploadedSkill:replace', name, files: entries });

export const uploadedSkillsClient = {
  // Folder-picker path: File[] → {path, text}[].
  upload: async (files: File[]) => uploadEntries(await toEntries(files)),
  // Drag-and-drop path: {path, text}[] already extracted via the FileSystemEntry
  // reader (dataTransfer.files gives only the directory entry for a dropped folder,
  // so the drop handler walks the entries itself and produces FileEntry[] directly).
  uploadEntries,
  list: () =>
    send({ type: 'uploadedSkill:list' }) as Promise<{
      ok: boolean;
      skills: UploadedSkill[];
    }>,
  delete: (name: string) => send({ type: 'uploadedSkill:delete', name }),
  replace: async (name: string, files: File[]) => replaceEntries(name, await toEntries(files)),
  replaceEntries,
};
