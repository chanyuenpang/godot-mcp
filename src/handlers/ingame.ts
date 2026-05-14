/**
 * 游戏内命令相关 handler
 * ingame_command/list_ingame_tools/get_ingame_status
 */

import type { ToolResult } from '../core/types.js';
import type { GodotServer } from '../core/godot-server.js';

/**
 * 转发命令到游戏内执行
 */
export async function handleIngameCommand(server: GodotServer, args: any): Promise<ToolResult> {
  if (!args?.tool_name) {
    return { success: false, error: 'tool_name 参数是必需的' };
  }

  if (!server.bridge.isConnected()) {
    return { success: false, error: '游戏未运行或 WebSocket 未连接。请先使用 run_project 启动游戏。' };
  }

  const result = await server.bridge.sendRequest('tools/call', {
    name: args.tool_name,
    arguments: args.arguments ?? {},
  });

  return { success: true, data: result };
}

/**
 * 获取游戏内可用命令列表
 */
export async function handleListIngameTools(server: GodotServer): Promise<ToolResult> {
  if (!server.bridge.isConnected()) {
    return { success: false, error: '游戏未运行或未连接。请先使用 run_project 启动游戏。' };
  }

  const result = await server.bridge.sendRequest('tools/list', {});
  return { success: true, data: result };
}

/**
 * 获取游戏内连接状态
 */
export async function handleGetIngameStatus(server: GodotServer): Promise<ToolResult> {
  const connected = server.bridge.isConnected();
  const duration = server.bridge.getConnectedDuration();
  const serverUrl = server.bridge.getServerUrl();

  return {
    success: true,
    data: {
      connected,
      serverUrl,
      connectedDurationMs: duration,
      connectedDurationSeconds: duration !== null ? Math.floor(duration / 1000) : null,
      // 只要 bridge 已连上，说明游戏在运行（即使 activeProcess 为 null）
      gameRunning: connected || server.activeProcess !== null,
    },
  };
}
