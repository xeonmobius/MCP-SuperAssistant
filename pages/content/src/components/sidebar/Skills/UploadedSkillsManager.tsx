import React, { useCallback, useEffect, useRef, useState } from 'react';
import { uploadedSkillsClient } from '../../../skills/uploadedSkillsClient';
import type { UploadedSkill } from '../../../../../../chrome-extension/src/skills/uploaded-parser';

const TEXT_ERR: Record<string, string> = {
  'no-skill-md': 'No SKILL.md found in the folder.',
  'bad-frontmatter': 'SKILL.md frontmatter is missing or has no name.',
  'name-exists': 'A skill with that name already exists. Delete it first or use Replace.',
};

export const UploadedSkillsManager: React.FC = () => {
  // One ref holds the upload input element; the callback-ref ALSO sets the
  // non-standard webkitdirectory attribute (React doesn't recognise it as a
  // JSX prop, and a separate useEffect-based wiring is fragile if the hidden
  // input ever remounts). Merging "store node" + "set attributes" in one
  // callback-ref fires reliably on mount in both Chrome and Firefox.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [skills, setSkills] = useState<UploadedSkill[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await uploadedSkillsClient.list();
    setSkills(res?.skills || []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setUploadInput = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);

  const setReplaceInput = useCallback(
    (name: string) => (el: HTMLInputElement | null) => {
      replaceRefs.current[name] = el;
    },
    [],
  );

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadedSkillsClient.upload(files);
      if (!res?.ok) setError(TEXT_ERR[res?.error] || res?.error || 'Upload failed');
      await refresh();
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const onReplace = async (name: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadedSkillsClient.replace(name, files);
      if (!res?.ok) setError(TEXT_ERR[res?.error] || res?.error || 'Replace failed');
      await refresh();
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const onDelete = async (name: string) => {
    setBusy(true);
    try {
      await uploadedSkillsClient.delete(name);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-2">
      <input ref={setUploadInput} type="file" multiple className="hidden" onChange={onUpload} />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-pill bg-ink px-3 py-1.5 text-[11px] font-semibold text-surface disabled:opacity-40">
        + Upload skill folder
      </button>
      {error && <p className="text-[10px] text-err">{error}</p>}
      {skills.map(s => (
        <div
          key={s.name}
          className="flex items-center gap-2 rounded-card border border-line bg-surface p-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{s.name}</span>
          <input
            ref={setReplaceInput(s.name)}
            type="file"
            className="hidden"
            onChange={e => onReplace(s.name, e)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => replaceRefs.current[s.name]?.click()}
            className="text-[10px] text-muted hover:text-ink">
            Replace
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(s.name)}
            className="text-[10px] text-off hover:text-err">
            Delete
          </button>
        </div>
      ))}
    </div>
  );
};

export default UploadedSkillsManager;
