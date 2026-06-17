import test from 'node:test';
import assert from 'node:assert/strict';

import type { ToolResult } from '../core/types.js';
import { applySuccessResultDiagnostics } from '../core/command-result-diagnostics.js';

test('applySuccessResultDiagnostics upgrades successful results when a new runtime error is detected', () => {
  const baseResult: ToolResult = {
    success: true,
    data: {
      content: [{ type: 'text', text: '{"ok":true}' }],
    },
  };

  const result = applySuccessResultDiagnostics(baseResult, {
    category: 'runtime_error',
    summary: '连接断开前的最近输出：ERROR: test failure',
    priorityLogLines: ['ERROR: test failure'],
    source: 'editor_session_log',
  });

  assert.equal(result.success, false);
  assert.equal(result.error, '连接断开前的最近输出：ERROR: test failure');
  assert.deepEqual(result.data?.content, baseResult.data?.content);
  assert.deepEqual(result.data?.diagnostic, {
    category: 'runtime_error',
    source: 'editor_session_log',
    transportError: undefined,
    priorityLogLines: ['ERROR: test failure'],
    sessionState: undefined,
    probe: undefined,
  });
});

test('applySuccessResultDiagnostics keeps successful results unchanged when there is no new error diagnostic', () => {
  const baseResult: ToolResult = {
    success: true,
    data: {
      content: [{ type: 'text', text: '{"ok":true}' }],
    },
  };

  const result = applySuccessResultDiagnostics(baseResult, null);

  assert.equal(result.success, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.data, baseResult.data);
});
