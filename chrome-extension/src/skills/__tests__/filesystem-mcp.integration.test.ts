/**
 * Integration test: spin up the REAL @modelcontextprotocol/server-filesystem
 * and drive the REAL loader code (`loadSkillsFromFilesystemServer`) against it.
 *
 * This proves the filesystem-MCP skills path actually works end-to-end:
 *   list_allowed_directories -> list_directory -> read_text_file -> parseSkillMarkdown
 *
 * NOTE on the `filesystem.` prefix: in production the proxy namespaces tools by
 * their config key ("filesystem"), so the loader calls `filesystem.list_directory`.
 * Connected directly to the bare server the tool names have no prefix, so the
 * callTool wrapper here strips it. That keeps the test focused on the
 * loader+server contract; the proxy prefix layer is exercised in the live extension.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSkillsFromFilesystemServer, setSkillsPaths, parseAllowedDirectories } from '../loader';
import { parseSkillMarkdown } from '../parser';

// --- minimal chrome.storage stub (loader reads/writes skills paths via it) ---
const mem: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in mem) out[k] = mem[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(mem, items);
      },
    },
  },
};

function findServerBin(): string {
  const npxRoot = path.join(os.homedir(), '.npm/_npx');
  if (!fs.existsSync(npxRoot)) {
    throw new Error('npx cache not found; run `npx -y @modelcontextprotocol/server-filesystem --help` once to populate it');
  }
  for (const entry of fs.readdirSync(npxRoot)) {
    const candidate = path.join(
      npxRoot,
      entry,
      'node_modules/@modelcontextprotocol/server-filesystem/dist/index.js',
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('@modelcontextprotocol/server-filesystem not found in npx cache');
}

let client: Client;
let transport: StdioClientTransport;
let tmpDir: string;

const SKILL_MD = [
  '---',
  'name: demo-skill',
  'description: A demo skill for integration testing',
  '---',
  '# Demo Skill',
  '',
  'Do the thing. Reference ./references/notes.md for details.',
  '',
].join('\n');

beforeAll(async () => {
  // 1. build a temp skills tree. Resolve the realpath because macOS os.tmpdir()
  // returns /var/folders/... (a symlink to /private/var/...); the server's
  // validatePath uses realpath, so a symlinked allowed dir makes read_text_file
  // reject every file as "outside allowed directories".
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-skills-')));
  fs.mkdirSync(path.join(tmpDir, 'demo-skill/references'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'demo-skill/SKILL.md'), SKILL_MD);
  fs.writeFileSync(path.join(tmpDir, 'demo-skill/references/notes.md'), 'nested asset body');

  // 2. point the loader at the temp dir
  await setSkillsPaths([tmpDir]);

  // 3. spawn the real filesystem MCP server over stdio, rooted at tmpDir
  const bin = findServerBin();
  transport = new StdioClientTransport({ command: 'node', args: [bin, tmpDir] });
  client = new Client({ name: 'skills-integration-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  try { await client?.close(); } catch { /* noop */ }
  try { await transport?.close(); } catch { /* noop */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
}, 30_000);

describe('filesystem MCP server contract (raw tools)', () => {
  it('exposes the three tools the loader depends on', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('list_allowed_directories');
    expect(names).toContain('list_directory');
    expect(names).toContain('read_text_file');
  });

  it('list_allowed_directories emits the format parseAllowedDirectories handles', async () => {
    const res: any = await client.callTool({ name: 'list_allowed_directories', arguments: {} });
    const text = (res.content as Array<{ type: string; text: string }>)
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    // Header line must be filtered, real dir kept
    expect(parseAllowedDirectories(text)).toEqual([tmpDir]);
  });

  it('list_directory emits [DIR]/[FILE] lines the loader regex matches', async () => {
    const res: any = await client.callTool({ name: 'list_directory', arguments: { path: tmpDir } });
    const text = (res.content as Array<{ type: string; text: string }>).map(c => c.text).join('\n');
    expect(text).toMatch(/\[DIR\]\s+demo-skill/);
  });

  it('read_text_file returns SKILL.md content parseSkillMarkdown accepts', async () => {
    const skillPath = path.join(tmpDir, 'demo-skill/SKILL.md');
    const res: any = await client.callTool({ name: 'read_text_file', arguments: { path: skillPath } });
    const text = (res.content as Array<{ type: string; text: string }>).map(c => c.text).join('\n');
    const skill = parseSkillMarkdown(text, skillPath);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('demo-skill');
    expect(skill!.description).toBe('A demo skill for integration testing');
  });
}, 30_000);

describe('loadSkillsFromFilesystemServer end-to-end', () => {
  // Strips the proxy-added `filesystem.` prefix so we can talk to the bare server.
  const callTool = async (_url: string, toolName: string, args: Record<string, unknown>) => {
    const bare = toolName.replace(/^filesystem\./, '');
    return client.callTool({ name: bare, arguments: args });
  };

  it('discovers and parses the demo skill from a real filesystem MCP server', async () => {
    const skills = await loadSkillsFromFilesystemServer('http://test-proxy', callTool as any);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('demo-skill');
    expect(skills[0].content).toContain('# Demo Skill');
    // sourceDir is set so skill_read_asset can resolve files later
    expect(skills[0].sourceDir).toBe(path.join(tmpDir, 'demo-skill'));
    // listAllFiles manifest is appended -> nested asset is advertised
    expect(skills[0].content).toContain('references/notes.md');
  }, 30_000);
});
