import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sendEditorCommand } from '../core/editor-integration.js';

function createProjectWithEditorSession() {
  const projectPath = mkdtempSync(join(tmpdir(), 'godot-mcp-editor-command-'));
  const sessionDir = join(projectPath, '.godot', 'godot-mcp');
  const responsesDir = join(sessionDir, 'responses');
  const commandPath = join(sessionDir, 'command.json');
  mkdirSync(responsesDir, { recursive: true });
  writeFileSync(join(sessionDir, 'editor-session.json'), JSON.stringify({
    sessionId: 'test-session',
    pluginVersion: '0.1.2',
    projectPath,
    editorPid: process.pid,
    updatedAt: Date.now() / 1000,
    isPlaying: false,
    playingScene: '',
    logPath: '',
    commandPath,
    responsesDir,
    capabilities: {
      playMainScene: true,
      playCustomScene: true,
      stopPlay: true,
      readOutputSnapshot: true,
    },
  }), 'utf8');

  return { projectPath, commandPath };
}

test('sendEditorCommand removes its command file when the editor never responds', async () => {
  const { projectPath, commandPath } = createProjectWithEditorSession();

  try {
    await assert.rejects(
      sendEditorCommand(projectPath, { command: 'play_main' }, 20),
      /Editor command timed out/,
    );
    assert.equal(existsSync(commandPath), false);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test('editor plugin rejects stale command files before executing play commands', () => {
  const pluginSource = readFileSync(
    join(process.cwd(), 'src', 'editor-plugin', 'addons', 'godot_mcp', 'plugin.gd'),
    'utf8',
  );

  assert.match(pluginSource, /COMMAND_MAX_AGE_SECONDS/);
  assert.match(pluginSource, /issuedAt/);
  assert.match(pluginSource, /command_age_seconds/);
  assert.match(pluginSource, /DirAccess\.remove_absolute\(_command_path\(\)\)/);
});
