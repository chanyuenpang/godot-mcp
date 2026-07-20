import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONS_LIST_TOOL,
  ACTIONS_RUN_TOOL,
  parseActionListResponse,
} from '../core/action-protocol.js';

function response(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

test('通用 actions 协议使用稳定的 addon 工具名', () => {
  assert.equal(ACTIONS_LIST_TOOL, 'godot_mcp_actions_list');
  assert.equal(ACTIONS_RUN_TOOL, 'godot_mcp_actions_run');
});

test('parseActionListResponse 接受规范 envelope', () => {
  assert.deepEqual(parseActionListResponse(response({
    revision: 'menu-2',
    actions: [{ id: 'open_menu', label: '打开菜单', enabled: true }],
  })), {
    revision: 'menu-2',
    actions: [{ id: 'open_menu', label: '打开菜单', enabled: true }],
  });
});

test('parseActionListResponse 拒绝旧式裸数组和重复 id', () => {
  assert.throws(() => parseActionListResponse(response([{ id: 'a', label: 'A' }])), /actions array/);
  assert.throws(() => parseActionListResponse(response({ actions: [
    { id: 'a', label: 'A' },
    { id: 'a', label: 'A2' },
  ] })), /duplicate action id/);
  assert.throws(() => parseActionListResponse(response({ actions: [
    { id: 'a', label: 'A', enabled: 'yes' },
  ] })), /enabled.*boolean/);
});
