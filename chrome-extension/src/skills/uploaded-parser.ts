import { parseSkillMarkdown, type Skill } from './parser';

export interface UploadedSkill {
  name: string;
  description: string;
  allowedTools?: string;
  content: string;
  source: 'uploaded';
  sourceDir?: string;
  uploadedAt: number;
  references: string[];
  run?: string;
}

export type ScriptLanguage = 'wasm' | 'py';

export interface ScriptBlob {
  path: string;
  blob: ArrayBuffer;
  language: ScriptLanguage;
}

export interface ParsedFolder {
  skill: UploadedSkill;
  references: Map<string, string>;
  scriptBlob?: ScriptBlob;
}

/** One parsed SKILL.md may yield multiple skills (a folder of skill folders). */
export type ParseResult = { skills: ParsedFolder[] } | { error: 'no-skill-md' | 'bad-frontmatter' };

export interface FileEntry {
  // Relative path including the folder root (e.g. 'my-skill/examples/demo.md').
  // Content-side extraction preserves webkitRelativePath BEFORE the message
  // clone, since File objects lose that property across sendMessage.
  path: string;
  text: string;
  // Present for binary/script files (.wasm, .py). `text` may be empty for those.
  blob?: ArrayBuffer;
}

const SKILL_MD_NAME = 'skill.md';
const TEXT_EXT = /\.(md|markdown|txt|text|json|ya?ml|csv|tsv|js|jsx|ts|tsx|mjs|cjs|rb|go|rs|java|c|cc|cpp|h|hpp|sh|bash|zsh|ps1|sql|html?|css|scss|less|xml|toml|ini|env)$/i;
const SCRIPT_EXT = /\.(wasm|py)$/i;

function baseName(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

function parentDir(p: string): string {
  return p.includes('/') ? p.replace(/\/?[^/]+$/, '') : '';
}

function relPath(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

/**
 * Shared multi-skill parser. Finds EVERY `SKILL.md` in `entries` (one per skill,
 * grouped by nearest skill root), parses each, and assigns each text reference
 * to the nearest (deepest) enclosing skill root. Supports:
 *  - a single SKILL.md (file-only upload, root = '')
 *  - one skill folder
 *  - a folder containing multiple skill subfolders
 *  - nested skills (a deeper SKILL.md claims its own subtree)
 */
async function parseEntries(entries: FileEntry[]): Promise<ParseResult> {
  const skillMds = entries.filter(e => baseName(e.path).toLowerCase() === SKILL_MD_NAME);
  if (skillMds.length === 0) return { error: 'no-skill-md' };

  // Parse each SKILL.md → a ParsedFolder keyed by its root dir ('' for top-level).
  const byRoot = new Map<string, ParsedFolder>();
  for (const e of skillMds) {
    const root = parentDir(e.path);
    const md = parseSkillMarkdown(e.text, 'uploaded');
    if (!md || !md.name) return { error: 'bad-frontmatter' };
    byRoot.set(root, {
      skill: {
        name: md.name,
        description: md.description,
        allowedTools: md.allowedTools,
        content: md.content,
        source: 'uploaded',
        sourceDir: root || undefined,
        uploadedAt: Date.now(),
        references: [],
        run: md.run,
      },
      references: new Map(),
    });
  }

  const roots = [...byRoot.keys()];

  // A file belongs to the DEEPEST skill root that encloses it (nearest owner).
  // Top-level root ('') claims only top-level files (no '/').
  const ownerRoot = (p: string): string | undefined => {
    let best: string | undefined;
    let bestDepth = -1;
    for (const r of roots) {
      const under = r === '' ? !p.includes('/') : p.startsWith(r + '/');
      if (under) {
        const depth = r === '' ? 0 : r.split('/').length;
        if (depth > bestDepth) {
          bestDepth = depth;
          best = r;
        }
      }
    }
    return best;
  };

  const skillMdPaths = new Set(skillMds.map(e => e.path));
  for (const e of entries) {
    if (skillMdPaths.has(e.path)) continue; // skip the SKILL.md files themselves
    const root = ownerRoot(e.path);
    if (root === undefined) continue; // orphan (no enclosing skill) → skip
    const pf = byRoot.get(root)!;
    const rel = root ? e.path.slice(root.length + 1) : e.path;

    // Script files (.wasm/.py): never text references. Only the one matching
    // the declared `run:` path is captured as the skill's scriptBlob.
    if (SCRIPT_EXT.test(baseName(e.path))) {
      if (pf.skill.run && pf.skill.run === rel) {
        const language: ScriptLanguage = /\.wasm$/i.test(baseName(e.path)) ? 'wasm' : 'py';
        // .wasm files arrive as ArrayBuffer (e.blob); .py files arrive as
        // text (e.text). Encode text to ArrayBuffer so the store/executor
        // interface is uniform.
        const blob = e.blob ?? new TextEncoder().encode(e.text || '').buffer;
        pf.scriptBlob = { path: rel, blob, language };
      }
      continue;
    }
    if (!TEXT_EXT.test(baseName(e.path))) continue; // Phase 1: text-only
    pf.references.set(rel, e.text);
  }

  for (const pf of byRoot.values()) {
    pf.skill.references = [...pf.references.keys()];
  }

  return { skills: [...byRoot.values()] };
}

/** File[] entry point (folder picker). Extracts {path, text} then delegates. */
export async function parseUploadedFolder(files: File[]): Promise<ParseResult> {
  const entries: FileEntry[] = [];
  for (const f of files) {
    const path = relPath(f);
    if (SCRIPT_EXT.test(baseName(path))) {
      entries.push({ path, text: '', blob: await f.arrayBuffer() });
    } else {
      entries.push({ path, text: await f.text() });
    }
  }
  return parseEntries(entries);
}

/** {path, text}[] entry point (drag-and-drop / messaging). */
export async function parseUploadedFiles(entries: FileEntry[]): Promise<ParseResult> {
  return parseEntries(entries);
}

export function uploadedSkillToSkill(u: UploadedSkill): Skill {
  // Append the available reference files to the content so the AI knows what
  // it can skill_read_asset — mirrors the disk-skill behavior (loader.ts:187).
  let content = u.content;
  if (u.references && u.references.length > 0) {
    content += `\n\n---\n\nAvailable reference files (use \`skill_read_asset\` with \`skill_name="${u.name}"\` to load any of these):\n`;
    content += u.references.map(r => ` - ${r}`).join('\n');
  }
  return {
    name: u.name,
    description: u.description,
    content,
    allowedTools: u.allowedTools,
    run: u.run,
    source: 'uploaded',
    sourceDir: u.sourceDir,
  };
}
