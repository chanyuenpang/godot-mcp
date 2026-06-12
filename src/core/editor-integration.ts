import { fileURLToPath } from 'url';
import { dirname, join, normalize } from 'path';
import { cpSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

import type { GodotEditorCommand, GodotEditorCommandResponse, GodotEditorSession, LogEntry } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLUGIN_RES_PATH = 'res://addons/godot_mcp/plugin.cfg';
const SESSION_ROOT_PARTS = ['.godot', 'godot-mcp'];
const SESSION_FILE_NAME = 'editor-session.json';
const COMMAND_FILE_NAME = 'command.json';
const RESPONSES_DIR_NAME = 'responses';
const SESSION_MAX_AGE_MS = 10_000;

export function getEditorSessionDir(projectPath: string): string {
  return join(projectPath, ...SESSION_ROOT_PARTS);
}

function getPluginTemplateDir(): string {
  return join(__dirname, '..', 'editor-plugin', 'addons', 'godot_mcp');
}

function getProjectPluginDir(projectPath: string): string {
  return join(projectPath, 'addons', 'godot_mcp');
}

function getProjectGodotFile(projectPath: string): string {
  return join(projectPath, 'project.godot');
}

function getSessionFilePath(projectPath: string): string {
  return join(getEditorSessionDir(projectPath), SESSION_FILE_NAME);
}

function getCommandFilePath(projectPath: string): string {
  return join(getEditorSessionDir(projectPath), COMMAND_FILE_NAME);
}

function getResponsesDir(projectPath: string): string {
  return join(getEditorSessionDir(projectPath), RESPONSES_DIR_NAME);
}

export function ensureEditorPluginInstalled(projectPath: string): { changed: boolean; pluginDir: string } {
  const pluginTemplateDir = getPluginTemplateDir();
  const pluginDir = getProjectPluginDir(projectPath);
  mkdirSync(join(projectPath, 'addons'), { recursive: true });
  cpSync(pluginTemplateDir, pluginDir, { recursive: true, force: true });

  const changed = ensureEditorPluginEnabled(getProjectGodotFile(projectPath));
  return { changed, pluginDir };
}

function ensureEditorPluginEnabled(projectFilePath: string): boolean {
  const original = readFileSync(projectFilePath, 'utf8');
  const lines = original.split(/\r?\n/);
  const sectionIndex = lines.findIndex(line => line.trim() === '[editor_plugins]');

  if (sectionIndex === -1) {
    const suffix = original.endsWith('\n') ? '' : '\n';
    const appended = `${original}${suffix}\n[editor_plugins]\nenabled=PackedStringArray("${PLUGIN_RES_PATH}")\n`;
    if (appended !== original) {
      writeFileSync(projectFilePath, appended, 'utf8');
      return true;
    }
    return false;
  }

  let endIndex = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('[')) {
      endIndex = i;
      break;
    }
  }

  const enabledIndex = lines.findIndex((line, index) => index > sectionIndex && index < endIndex && line.startsWith('enabled='));
  if (enabledIndex === -1) {
    lines.splice(sectionIndex + 1, 0, `enabled=PackedStringArray("${PLUGIN_RES_PATH}")`);
    writeFileSync(projectFilePath, `${lines.join('\n')}\n`, 'utf8');
    return true;
  }

  const currentLine = lines[enabledIndex];
  const entries = Array.from(currentLine.matchAll(/"([^"]+)"/g)).map(match => match[1]);
  if (entries.includes(PLUGIN_RES_PATH)) {
    return false;
  }

  entries.push(PLUGIN_RES_PATH);
  lines[enabledIndex] = `enabled=PackedStringArray(${entries.map(entry => `"${entry}"`).join(', ')})`;
  writeFileSync(projectFilePath, `${lines.join('\n')}\n`, 'utf8');
  return true;
}

export function readEditorSession(projectPath: string): GodotEditorSession | null {
  const sessionPath = getSessionFilePath(projectPath);
  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    const session = JSON.parse(readFileSync(sessionPath, 'utf8')) as GodotEditorSession;
    const normalizedProjectPath = normalize(projectPath).replace(/[\\/]+$/, '');
    const normalizedSessionProjectPath = normalize(session.projectPath).replace(/[\\/]+$/, '');
    if (normalizedProjectPath !== normalizedSessionProjectPath) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function hasFreshEditorSession(projectPath: string): boolean {
  const session = readEditorSession(projectPath);
  if (!session) {
    return false;
  }
  if (Date.now() - session.updatedAt * 1000 >= SESSION_MAX_AGE_MS) {
    return false;
  }
  if (!Number.isInteger(session.editorPid) || session.editorPid <= 0) {
    return false;
  }

  try {
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Get-Process -Id ${session.editorPid} | Out-Null`,
      ], { stdio: 'ignore' });
      return true;
    }
    process.kill(session.editorPid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function sendEditorCommand(
  projectPath: string,
  command: Omit<GodotEditorCommand, 'id' | 'issuedAt'>,
  timeoutMs: number = 5000,
): Promise<GodotEditorCommandResponse> {
  const session = readEditorSession(projectPath);
  if (!session) {
    throw new Error('No active editor session detected.');
  }

  mkdirSync(getEditorSessionDir(projectPath), { recursive: true });
  mkdirSync(getResponsesDir(projectPath), { recursive: true });

  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const fullCommand: GodotEditorCommand = {
    ...command,
    id,
    issuedAt: Date.now(),
  };
  const commandPath = session.commandPath || getCommandFilePath(projectPath);
  const responsePath = join(session.responsesDir || getResponsesDir(projectPath), `${id}.json`);

  if (existsSync(responsePath)) {
    unlinkSync(responsePath);
  }
  writeFileSync(commandPath, JSON.stringify(fullCommand, null, 2), 'utf8');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(responsePath)) {
      const response = JSON.parse(readFileSync(responsePath, 'utf8')) as GodotEditorCommandResponse;
      unlinkSync(responsePath);
      return response;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Editor command timed out after ${timeoutMs}ms.`);
}

export function readEditorSessionLogs(projectPath: string): { output: LogEntry[]; errors: LogEntry[]; startTime: number } | null {
  const session = readEditorSession(projectPath);
  if (!session?.logPath || !existsSync(session.logPath)) {
    return null;
  }

  const raw = readFileSync(session.logPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
  const output: LogEntry[] = [];
  const errors: LogEntry[] = [];

  for (let index = 0; index < lines.length; index++) {
    const entry: LogEntry = {
      text: lines[index],
      timestamp: Date.now() - (lines.length - index),
    };
    if (/(SCRIPT ERROR|ERROR|WARNING|Parser Error|Parse Error)/i.test(lines[index])) {
      errors.push(entry);
    } else {
      output.push(entry);
    }
  }

  return {
    output,
    errors,
    startTime: Date.now() - lines.length,
  };
}
