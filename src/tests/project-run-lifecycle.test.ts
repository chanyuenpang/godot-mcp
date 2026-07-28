import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GodotServer } from '../core/godot-server.js';
import { handleRunProject } from '../handlers/project.js';

function createProject(): string {
  const projectPath = mkdtempSync(join(tmpdir(), 'godot-mcp-run-lifecycle-'));
  writeFileSync(join(projectPath, 'project.godot'), '[application]\n', 'utf8');
  return projectPath;
}

test('editor-backed run stops the previous game before starting another one', async () => {
  const projectPath = createProject();
  const commands: string[] = [];
  const server = {
    normalizeParameters: (args: unknown) => args,
    validatePath: () => true,
    ensureEditorPlugin: () => ({ changed: false, pluginDir: '' }),
    hasFreshEditorSession: () => true,
    getEditorSession: () => ({ isPlaying: true }),
    stopEditorPlay: async () => {
      commands.push('stop_play');
      return { success: true };
    },
    runProjectViaEditor: async () => {
      commands.push('play_main');
      return { success: true };
    },
  } as unknown as GodotServer;

  try {
    const result = await handleRunProject(server, { projectPath });
    assert.equal(result.success, true);
    assert.deepEqual(commands, ['stop_play', 'play_main']);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test('detached run cleanup terminates the recorded game process tree', () => {
  const projectPath = createProject();
  const server = new GodotServer();
  const serverClass = GodotServer as any;
  const originalReadStateFile = serverClass.readStateFile;
  const originalClearStateFile = serverClass.clearStateFile;
  const originalKillProcessTree = serverClass.killProcessTree;
  const killedPids: number[] = [];
  let cleared = false;

  serverClass.readStateFile = () => ({
    projectPath,
    pid: 987654321,
    port: 9090,
    startTime: Date.now(),
    mode: 'run',
  });
  serverClass.clearStateFile = () => {
    cleared = true;
  };
  serverClass.killProcessTree = (pid: number) => {
    killedPids.push(pid);
  };

  try {
    (server as any).stopExistingDetachedRunForProject(projectPath);
    assert.deepEqual(killedPids, [987654321]);
    assert.equal(cleared, true);
  } finally {
    serverClass.readStateFile = originalReadStateFile;
    serverClass.clearStateFile = originalClearStateFile;
    serverClass.killProcessTree = originalKillProcessTree;
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test('starting a game does not terminate an active editor process', async () => {
  const projectPath = createProject();
  mkdirSync(join(projectPath, '.godot'), { recursive: true });
  const server = new GodotServer();
  let editorKilled = false;
  server.godotPath = process.execPath;
  server.activeProcess = {
    process: {
      pid: 987654322,
      kill: () => {
        editorKilled = true;
        return true;
      },
    } as any,
    output: [],
    errors: [],
    startTime: Date.now(),
    mode: 'editor',
  };

  try {
    server.runProject(projectPath, undefined, { detached: true });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(editorKilled, false);
  } finally {
    server.stopProject();
    rmSync(projectPath, { recursive: true, force: true });
  }
});
