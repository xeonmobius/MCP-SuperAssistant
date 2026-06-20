import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@src/lib/utils';
import { uploadedSkillsClient } from '../../../skills/uploadedSkillsClient';
import { useSkillStore } from '@src/stores/skill.store';
import type { FileEntry, UploadedSkill } from '../../../../../../chrome-extension/src/skills/uploaded-parser';

const TEXT_ERR: Record<string, string> = {
  'no-skill-md': 'No SKILL.md found in the folder.',
  'bad-frontmatter': 'SKILL.md frontmatter is missing or has no name.',
  'name-exists': 'An uploaded skill with that name already exists. Delete it first or use Replace.',
  'conflicts-with-disk': 'A disk/MCP skill already uses that name. Rename the folder and re-upload.',
};

// ---- FileSystemEntry walker (drag-and-drop of a FOLDER) ----
// dataTransfer.files gives only the directory entry for a dropped folder (useless
// as a File). webkitGetAsEntry + a recursive directory read yields the leaf files
// with their relative paths — bypasses the native folder picker, which hides
// dot-prefixed dirs like ~/.agents so the user can't navigate into them.
const getFile = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));
const readBatch = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const walkEntry = async (entry: FileSystemEntry, prefix: string, out: FileEntry[]): Promise<void> => {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await getFile(entry as FileSystemFileEntry);
    if (path.endsWith('.wasm')) {
      out.push({ path, text: '', blob: await file.arrayBuffer() });
    } else {
      out.push({ path, text: await file.text() });
    }
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns in batches; loop until an empty batch.
    let batch = await readBatch(reader);
    while (batch.length > 0) {
      for (const child of batch) await walkEntry(child, path, out);
      batch = await readBatch(reader);
    }
  }
};

const collectDroppedEntries = async (items: DataTransferItemList): Promise<FileEntry[]> => {
  const out: FileEntry[] = [];
  const roots: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  for (const root of roots) await walkEntry(root, '', out);
  return out;
};

export const UploadedSkillsManager: React.FC = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [skills, setSkills] = useState<UploadedSkill[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const refresh = useCallback(async () => {
    const res = await uploadedSkillsClient.list();
    setSkills(res?.skills || []);
  }, []);

  useEffect(() => {
    refresh();
    // PULL model: request skills from background so the content-script skill store
    // (which InstructionManager reads) is populated even without an MCP server.
    uploadedSkillsClient.requestSkills().then(res => {
      if (!res?.ok || !res.tools?.length) return;
      const skillItems = res.tools
        .filter(t => t.name?.startsWith('skill_'))
        .map(t => ({
          name: (t as any)._skillName ?? t.name.replace(/^skill_/, '').replace(/_/g, '-'),
          description: t.description || '',
        }));
      if (skillItems.length > 0) {
        const store = useSkillStore.getState();
        store.setAvailableSkills(skillItems);
        // Auto-enable uploaded skills that aren't already enabled or explicitly
        // disabled. Without this, skill_read_asset (L3 disclosure) isn't added
        // to the tool list (buildCombinedToolList requires enabledSkills > 0).
        skillItems.forEach(s => {
          if (!store.enabledSkills.has(s.name)) {
            store.enableSkill(s.name);
          }
        });
      }
    });
  }, [refresh]);

  // webkitdirectory isn't a React-recognised attribute; set via callback-ref.
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

  const runUpload = useCallback(
    async (entries: FileEntry[]) => {
      if (!entries.length) {
        setError('No readable files found.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await uploadedSkillsClient.uploadEntries(entries);
        if (!res?.ok) setError(TEXT_ERR[res?.error] || res?.error || 'Upload failed');
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    // Reuse the picker path (File[] → entries via the client).
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

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const entries = await collectDroppedEntries(e.dataTransfer.items);
    await runUpload(entries);
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
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onUpload} />
      <div
        role="button"
        tabIndex={0}
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={e => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click();
        }}
        className={cn(
          'cursor-pointer rounded-card border-2 border-dashed p-3 text-center transition-colors',
          dragOver ? 'border-accent-from bg-off-soft' : 'border-line bg-surface hover:bg-ground',
          busy && 'opacity-50',
        )}>
        <p className="text-[11px] font-medium text-ink">
          {busy ? 'Working…' : dragOver ? 'Drop to upload' : 'Drag a skill folder here'}
        </p>
        <p className="mt-0.5 text-[10px] text-muted">or click to pick a folder</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => !busy && fileInputRef.current?.click()}
        className="w-full text-[10px] text-muted hover:text-ink">
        …or pick file(s)
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
