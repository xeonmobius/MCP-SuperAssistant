import type { UploadedSkill } from '../../../../chrome-extension/src/skills/uploaded-parser';

const send = (msg: unknown) =>
  new Promise<any>(resolve => chrome.runtime.sendMessage(msg, resolve));

// File → {path, text} extraction happens HERE (content side) because File
// objects don't survive the content→background message clone: the structured
// clone drops the non-enumerable `webkitRelativePath`, which would break the
// parser's root-prefix logic. Reading `.text()` here and shipping plain
// `{path, text}` is the fix.
const toEntries = async (
  files: File[],
): Promise<{ path: string; text: string }[]> => {
  const out: { path: string; text: string }[] = [];
  for (const f of files) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    out.push({ path, text: await f.text() });
  }
  return out;
};

export const uploadedSkillsClient = {
  upload: async (files: File[]) =>
    send({ type: 'uploadedSkill:upload', files: await toEntries(files) }),
  list: () =>
    send({ type: 'uploadedSkill:list' }) as Promise<{
      ok: boolean;
      skills: UploadedSkill[];
    }>,
  delete: (name: string) => send({ type: 'uploadedSkill:delete', name }),
  replace: async (name: string, files: File[]) =>
    send({ type: 'uploadedSkill:replace', name, files: await toEntries(files) }),
};
