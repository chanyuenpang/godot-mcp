import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ensureIngameAddonInstalled } from '../core/ingame-addon.js';

test('ensureIngameAddonInstalled 安装 addon 并幂等注册 autoload', () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'godot-mcp-ingame-addon-'));
  try {
    writeFileSync(join(projectPath, 'project.godot'), '[application]\nconfig/name="Fixture"\n', 'utf8');

    const first = ensureIngameAddonInstalled(projectPath);
    assert.equal(first.changed, true);
    assert.equal(existsSync(join(first.addonDir, 'godot_mcp_ingame.gd')), true);
    assert.equal(existsSync(join(first.addonDir, 'action_adapter.gd')), true);

    const second = ensureIngameAddonInstalled(projectPath);
    assert.equal(second.changed, false);
    const projectFile = readFileSync(join(projectPath, 'project.godot'), 'utf8');
    assert.equal((projectFile.match(/^GodotMCPIngame=/gm) ?? []).length, 1);
    assert.match(projectFile, /GodotMCPIngame="\*res:\/\/addons\/godot_mcp_ingame\/godot_mcp_ingame\.gd"/);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test('addon 源码只依赖通用 adapter 方法，不引用 tiny-world ActionProvider', () => {
  const server = readFileSync(
    join(process.cwd(), 'src', 'ingame-addon', 'addons', 'godot_mcp_ingame', 'godot_mcp_ingame.gd'),
    'utf8',
  );
  assert.match(server, /list_actions/);
  assert.match(server, /run_action/);
  assert.doesNotMatch(server, /ActionProvider|get_available_actions|execute_action|TinyWorld/);
});
