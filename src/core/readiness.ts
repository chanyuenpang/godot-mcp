import { normalize } from 'path';

import type { GodotReadiness, GodotReadinessLevel } from './types.js';
import { GodotServer } from './godot-server.js';
import { ACTIONS_LIST_TOOL, parseActionListResponse } from './action-protocol.js';

type ReadinessOptions = {
  projectPath: string;
  probeActions?: boolean;
  includeBlockedActions?: boolean;
  editorProcessCount?: number | null;
};

function buildSummary(level: GodotReadinessLevel, readiness: GodotReadiness): string {
  switch (level) {
    case 'world_ready':
      return `世界已就绪，可见 actions=${readiness.actions.actionCount ?? 0}`;
    case 'action_ready':
      return readiness.actions.actionCount === 0
        ? '动作面已响应，但当前 actions 为空'
        : `动作面已响应，actions=${readiness.actions.actionCount}`;
    case 'bridge_connected':
      return readiness.actions.state === 'blocked'
        ? `WebSocket 已连接，但动作探针失败：${readiness.world.reason}`
        : 'WebSocket 已连接，尚未探测动作面';
    case 'editor_attached':
      return '已附着编辑器会话，但游戏桥尚未就绪';
    default:
      if (readiness.editor.staleSession) {
        return '检测到旧编辑器会话，需等待插件刷新或重启编辑器';
      }
      if ((readiness.editor.processCount ?? 0) > 0) {
        return '检测到编辑器进程，但没有可接管的 fresh session';
      }
      return '尚未检测到可用的编辑器会话或游戏桥';
  }
}

export async function collectReadiness(
  server: GodotServer,
  options: ReadinessOptions,
): Promise<GodotReadiness> {
  const projectPath = options.projectPath;
  const detachedState = GodotServer.readStateFile();
  const lastRunSnapshot = GodotServer.readLastRunSnapshot();
  const editorSessionFresh = server.hasFreshEditorSession(projectPath);
  const editorSession = server.getEditorSession(projectPath);
  const bridgeConnected = server.bridge.isConnected();
  const detachedRunState = Boolean(
    detachedState
    && detachedState.mode === 'run'
    && normalize(detachedState.projectPath) === normalize(projectPath),
  );
  const activeRunProcess = server.activeProcess?.mode === 'run';

  const readiness: GodotReadiness = {
    projectPath,
    level: 'not_ready',
    summary: '',
    modeHint: 'none',
    editor: {
      attached: editorSessionFresh,
      staleSession: Boolean(editorSession && !editorSessionFresh),
      processCount: options.editorProcessCount ?? null,
      isPlaying: editorSession?.isPlaying ?? null,
      playingScene: editorSession?.playingScene ?? null,
      updatedAt: editorSession?.updatedAt ?? null,
    },
    bridge: {
      connected: bridgeConnected,
      serverUrl: server.bridge.getServerUrl(),
      connectedDurationMs: server.bridge.getConnectedDuration(),
      gameRunning: bridgeConnected || activeRunProcess || detachedRunState,
    },
    actions: {
      state: options.probeActions ? 'unknown' : 'unchecked',
      includeBlocked: options.includeBlockedActions !== false,
      actionCount: null,
    },
    world: {
      state: options.probeActions ? 'unknown' : 'unchecked',
      reason: options.probeActions ? '尚未执行动作探针' : '未请求动作探针',
    },
    process: {
      activeRunProcess,
      detachedRunState,
      lastRunSnapshot: Boolean(lastRunSnapshot),
      preferredLogSource: server.getPreferredLogSource(projectPath)?.source ?? 'none',
    },
  };

  if (editorSessionFresh) {
    readiness.level = 'editor_attached';
    readiness.modeHint = 'editor_session';
  } else if ((readiness.editor.processCount ?? 0) > 0) {
    readiness.modeHint = 'editor_process_without_session';
  } else if (detachedRunState) {
    readiness.modeHint = 'detached_run';
  } else if (activeRunProcess) {
    readiness.modeHint = 'active_run';
  }

  if (bridgeConnected) {
    readiness.level = 'bridge_connected';
    if (readiness.modeHint === 'none') {
      readiness.modeHint = detachedRunState ? 'detached_run' : 'active_run';
    }
  }

  if (bridgeConnected && options.probeActions) {
    try {
      const raw = await server.bridge.sendRequest('tools/call', {
        name: ACTIONS_LIST_TOOL,
        arguments: { context: { include_blocked: readiness.actions.includeBlocked } },
      });
      const actions = parseActionListResponse(raw).actions;
      readiness.actions.state = 'ready';
      readiness.actions.actionCount = actions.length;
      readiness.level = 'action_ready';
      readiness.world = actions.length > 0
        ? { state: 'ready', reason: '动作面已响应，且当前存在可观测 actions' }
        : { state: 'blocked', reason: '动作面已响应，但当前 actions 为空' };
      if (actions.length > 0) {
        readiness.level = 'world_ready';
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      readiness.actions.state = 'blocked';
      readiness.actions.error = message;
      readiness.world = {
        state: 'unknown',
        reason: message,
      };
    }
  }

  readiness.summary = buildSummary(readiness.level, readiness);
  return readiness;
}
