import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { GodotServer } from '../core/godot-server.js';

function createProject(parent: string, name: string): string {
  const projectPath = join(parent, name);
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, 'project.godot'), `[application]\nconfig/name="${name}"\n`);
  return projectPath;
}

test('项目扫描忽略隐藏 fixture，但不保留普通目录名称', () => {
  const root = mkdtempSync(join(tmpdir(), 'godot-project-scan-'));

  try {
    createProject(root, 'normal-project');
    createProject(root, 'tmp-smoke');
    createProject(root, '.hidden-fixture');

    const nestedRoot = join(root, 'nested');
    mkdirSync(nestedRoot);
    createProject(nestedRoot, 'nested-project');
    createProject(nestedRoot, '.nested-hidden-fixture');

    const server = new GodotServer();
    const nonRecursive = server.findGodotProjects(root, false).map(project => project.name).sort();
    const recursive = server.findGodotProjects(root, true).map(project => project.name).sort();

    assert.deepEqual(nonRecursive, ['normal-project', 'tmp-smoke']);
    assert.deepEqual(recursive, ['nested-project', 'normal-project', 'tmp-smoke']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
