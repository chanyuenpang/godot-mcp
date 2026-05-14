/**
 * Actions 行动命令 handler
 * 包装游戏内 get_available_actions 和 execute_action 命令
 */

import type { ToolResult } from '../core/types.js';
import type { GodotServer } from '../core/godot-server.js';

export async function handleGetActions(server: GodotServer): Promise<ToolResult> {
  if (!server.bridge.isConnected()) {
    return { success: false, error: '游戏未运行或 WebSocket 未连接。请先使用 run_project 启动游戏。' };
  }
  const result = await server.bridge.sendRequest('tools/call', {
    name: 'get_available_actions',
    arguments: {},
  });
  return { success: true, data: result };
}

export async function handleRunAction(server: GodotServer, actionId: string): Promise<ToolResult> {
  if (!actionId) {
    return { success: false, error: 'action_id 参数是必需的' };
  }
  if (!server.bridge.isConnected()) {
    return { success: false, error: '游戏未运行或 WebSocket 未连接。请先使用 run_project 启动游戏。' };
  }
  const result = await server.bridge.sendRequest('tools/call', {
    name: 'execute_action',
    arguments: { action_id: actionId },
  });
  return { success: true, data: result };
}
