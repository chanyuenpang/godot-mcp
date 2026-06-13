/**
 * 游戏内命令相关 handler
 * ingame_command/list_ingame_tools/get_ingame_status
 */

import type { ToolResult } from '../core/types.js';
import { GodotServer } from '../core/godot-server.js';
import { collectReadiness } from '../core/readiness.js';

async function ensureBridgeConnected(server: GodotServer): Promise<boolean> {
  if (server.bridge.isConnected()) {
    return true;
  }
  return await GodotServer.tryConnectRunning(server.bridge);
}

/**
 * 转发命令到游戏内执行
 */
export async function handleIngameCommand(server: GodotServer, args: any): Promise<ToolResult> {
  if (!args?.tool_name) {
    return { success: false, error: 'tool_name 参数是必需的。' };
  }

  if (!await ensureBridgeConnected(server)) {
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
  if (!await ensureBridgeConnected(server)) {
    return { success: false, error: '游戏未运行或 WebSocket 未连接。请先使用 run_project 启动游戏。' };
  }

  const result = await server.bridge.sendRequest('tools/list', {});
  return { success: true, data: result };
}

/**
 * 获取游戏内连接状态
 */
export async function handleGetIngameStatus(server: GodotServer): Promise<ToolResult> {
  const projectPath = process.cwd();
  const connected = await ensureBridgeConnected(server);
  const duration = server.bridge.getConnectedDuration();
  const serverUrl = server.bridge.getServerUrl();
  const editorProcesses = await server.findProjectEditorProcesses(projectPath);
  const readiness = await collectReadiness(server, {
    projectPath,
    probeActions: connected,
    editorProcessCount: editorProcesses.length,
  });

  return {
    success: true,
    data: {
      connected,
      serverUrl,
      connectedDurationMs: duration,
      connectedDurationSeconds: duration !== null ? Math.floor(duration / 1000) : null,
      gameRunning: connected || server.activeProcess !== null,
      readiness,
    },
  };
}
