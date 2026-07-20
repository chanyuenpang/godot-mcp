import test from 'node:test';
import assert from 'node:assert/strict';

import type { GodotServer } from '../core/godot-server.js';
import { ACTIONS_LIST_TOOL, ACTIONS_RUN_TOOL } from '../core/action-protocol.js';
import { handleRunActionAndWait } from '../handlers/actions.js';

function mcpResponse(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function createServer(responses: Array<unknown | Error>) {
  const calls: Array<{ method: string; params: any }> = [];
  const server = {
    bridge: {
      isConnected: () => true,
      sendRequest: async (method: string, params: any) => {
        calls.push({ method, params });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
    },
  } as unknown as GodotServer;
  return { server, calls };
}

test('共享 run-and-wait 按 list/run/list 顺序执行并传递 arguments', async () => {
  const before = { revision: 'r1', actions: [{ id: 'wave', label: '挥手' }] };
  const after = { revision: 'r2', actions: [{ id: 'stop', label: '停止' }] };
  const { server, calls } = createServer([
    mcpResponse(before),
    mcpResponse({ ok: true, action_id: 'wave' }),
    mcpResponse(after),
  ]);

  const result = await handleRunActionAndWait(server, 'wave', { intensity: 2 }, {
    pollDelaysMs: [0],
    sleep: async () => {},
  });

  assert.deepEqual(calls.map(call => call.params.name), [
    ACTIONS_LIST_TOOL,
    ACTIONS_RUN_TOOL,
    ACTIONS_LIST_TOOL,
  ]);
  assert.deepEqual(calls[1].params.arguments, {
    action_id: 'wave',
    arguments: { intensity: 2 },
  });
  assert.deepEqual(result, {
    success: true,
    data: {
      execution: { ok: true, action_id: 'wave' },
      ...after,
      changed: true,
    },
  });
});

test('共享 run-and-wait 在列表不变时返回 changed=false', async () => {
  const actions = { revision: 'same', actions: [{ id: 'wait', label: '等待' }] };
  const { server } = createServer([
    mcpResponse(actions),
    mcpResponse({ ok: true }),
    mcpResponse(actions),
    mcpResponse(actions),
  ]);

  const result = await handleRunActionAndWait(server, 'wait', {}, {
    pollDelaysMs: [0, 0],
    sleep: async () => {},
  });

  assert.deepEqual(result.data, {
    execution: { ok: true },
    ...actions,
    changed: false,
  });
});

test('共享 run-and-wait 会重试瞬时轮询失败', async () => {
  const before = { revision: 'r1', actions: [{ id: 'go', label: '出发' }] };
  const after = { revision: 'r2', actions: [{ id: 'arrive', label: '到达' }] };
  const { server } = createServer([
    mcpResponse(before),
    mcpResponse({ ok: true }),
    new Error('temporary disconnect'),
    mcpResponse(after),
  ]);

  const result = await handleRunActionAndWait(server, 'go', {}, {
    pollDelaysMs: [0, 0],
    sleep: async () => {},
  });

  assert.equal(result.success, true);
  assert.equal(result.data.changed, true);
  assert.equal(result.data.revision, 'r2');
});
