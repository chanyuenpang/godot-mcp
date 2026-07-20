/**
 * 通用 Actions 协议 handler。
 * 具体动作来源由 Godot 项目注册到 ingame addon 的 adapter 提供。
 */

import type { ToolResult } from '../core/types.js';
import { GodotServer } from '../core/godot-server.js';
import { ACTIONS_LIST_TOOL, ACTIONS_RUN_TOOL, parseActionListResponse, readMcpToolPayload } from '../core/action-protocol.js';

async function ensureBridgeConnected(server: GodotServer): Promise<boolean> {
  if (server.bridge.isConnected()) {
    return true;
  }
  return await GodotServer.tryConnectRunning(server.bridge);
}

export async function handleGetActions(server: GodotServer): Promise<ToolResult> {
  if (!await ensureBridgeConnected(server)) {
    return { success: false, error: '游戏未运行或 WebSocket 未连接。请先使用 run_project 启动游戏。' };
  }
  const result = await server.bridge.sendRequest('tools/call', {
    name: ACTIONS_LIST_TOOL,
    arguments: { context: {} },
  });
  return { success: true, data: parseActionListResponse(result) };
}

export async function handleRunAction(
  server: GodotServer,
  actionId: string,
  actionArguments: Record<string, unknown> = {},
): Promise<ToolResult> {
  if (!actionId) {
    return { success: false, error: 'action_id 参数是必需的。' };
  }
  if (!await ensureBridgeConnected(server)) {
    return { success: false, error: '游戏未运行或 WebSocket 未连接。请先使用 run_project 启动游戏。' };
  }
  const result = await server.bridge.sendRequest('tools/call', {
    name: ACTIONS_RUN_TOOL,
    arguments: { action_id: actionId, arguments: actionArguments },
  });
  return { success: true, data: readMcpToolPayload(result) };
}

export interface RunActionAndWaitOptions {
  pollDelaysMs?: number[];
  sleep?: (delayMs: number) => Promise<void>;
}

/**
 * CLI 与 MCP 共用的 action 执行语义：执行前快照、执行、等待列表变化、返回统一结果。
 */
export async function handleRunActionAndWait(
  server: GodotServer,
  actionId: string,
  actionArguments: Record<string, unknown> = {},
  options: RunActionAndWaitOptions = {},
): Promise<ToolResult> {
  const beforeResult = await handleGetActions(server);
  if (!beforeResult.success) {
    return beforeResult;
  }

  const executionResult = await handleRunAction(server, actionId, actionArguments);
  if (!executionResult.success) {
    return executionResult;
  }

  const beforeSnapshot = JSON.stringify(beforeResult.data);
  const delays = options.pollDelaysMs ?? [500, 1500, 3000];
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  let latestResult = beforeResult;
  let changed = false;
  let lastFailure: ToolResult | null = null;

  for (const delayMs of delays) {
    await sleep(delayMs);
    let candidate: ToolResult;
    try {
      candidate = await handleGetActions(server);
    } catch (error: unknown) {
      lastFailure = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      continue;
    }
    if (!candidate.success) {
      lastFailure = candidate;
      continue;
    }

    latestResult = candidate;
    lastFailure = null;
    if (JSON.stringify(candidate.data) !== beforeSnapshot) {
      changed = true;
      break;
    }
  }

  if (lastFailure) {
    return lastFailure;
  }

  return {
    success: true,
    data: {
      execution: executionResult.data,
      ...latestResult.data,
      changed,
    },
  };
}
