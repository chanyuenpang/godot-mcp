import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AUTOLOAD_NAME = 'GodotMCPIngame';
const AUTOLOAD_RES_PATH = 'res://addons/godot_mcp_ingame/godot_mcp_ingame.gd';

function getTemplateDir(): string {
  return join(__dirname, '..', 'ingame-addon', 'addons', 'godot_mcp_ingame');
}

export function ensureIngameAddonInstalled(projectPath: string): {
  changed: boolean;
  addonDir: string;
  autoloadName: string;
} {
  const projectFile = join(projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    throw new Error(`Not a valid Godot project: ${projectPath}`);
  }

  const addonDir = join(projectPath, 'addons', 'godot_mcp_ingame');
  mkdirSync(join(projectPath, 'addons'), { recursive: true });
  cpSync(getTemplateDir(), addonDir, { recursive: true, force: true });

  const changed = ensureAutoload(projectFile);
  return { changed, addonDir, autoloadName: AUTOLOAD_NAME };
}

function ensureAutoload(projectFile: string): boolean {
  const original = readFileSync(projectFile, 'utf8');
  const lines = original.split(/\r?\n/);
  const desired = `${AUTOLOAD_NAME}="*${AUTOLOAD_RES_PATH}"`;
  const sectionIndex = lines.findIndex(line => line.trim() === '[autoload]');

  if (sectionIndex === -1) {
    const suffix = original.endsWith('\n') ? '' : '\n';
    writeFileSync(projectFile, `${original}${suffix}\n[autoload]\n${desired}\n`, 'utf8');
    return true;
  }

  let endIndex = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index++) {
    if (lines[index].startsWith('[')) {
      endIndex = index;
      break;
    }
  }

  const existingIndex = lines.findIndex((line, index) =>
    index > sectionIndex && index < endIndex && line.startsWith(`${AUTOLOAD_NAME}=`));
  if (existingIndex >= 0 && lines[existingIndex] === desired) {
    return false;
  }
  if (existingIndex >= 0) {
    lines[existingIndex] = desired;
  } else {
    lines.splice(sectionIndex + 1, 0, desired);
  }
  writeFileSync(projectFile, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return true;
}
