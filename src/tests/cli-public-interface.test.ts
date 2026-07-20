import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();

test('CLI 是唯一公开入口，不再发布 stdio MCP server', () => {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
  const rootHelp = execFileSync(process.execPath, [resolve(projectRoot, 'build/cli.js'), '--help'], {
    encoding: 'utf8',
  });

  assert.deepEqual(packageJson.bin, { 'godot-mcp': './build/cli.js' });
  assert.equal(packageJson.dependencies?.['@modelcontextprotocol/sdk'], undefined);
  assert.equal(packageJson.scripts?.inspector, undefined);
  assert.equal(existsSync(resolve(projectRoot, 'src/index.ts')), false);
  assert.equal(existsSync(resolve(projectRoot, 'build/index.js')), false);
  assert.doesNotMatch(rootHelp, /^\s+serve\b/m);
});

test('scene CLI 覆盖原公开 MCP 的全部场景能力', () => {
  const sceneHelp = execFileSync(process.execPath, [resolve(projectRoot, 'build/cli.js'), 'scene', '--help'], {
    encoding: 'utf8',
  });

  for (const command of ['create', 'add-node', 'load-sprite', 'save', 'export-mesh-library']) {
    assert.match(sceneHelp, new RegExp(`^\\s+${command}\\b`, 'm'));
  }
});
