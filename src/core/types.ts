/**
 * Godot MCP 共享类型定义
 */

/**
 * 统一的 handler 返回类型
 */
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * 单条日志条目（带时间戳）
 */
export interface LogEntry {
  text: string;
  timestamp: number;
}

/**
 * 合并后的日志条目（带出现次数统计）
 */
export interface MergedLogEntry {
  text: string;
  count: number;
  timestamps: {
    first: number;
    last: number;
    intermediate: number[];
  };
  relativeTime: {
    first: number;
    last: number;
  };
}

/**
 * 运行中的 Godot 进程
 */
export interface GodotProcess {
  process: any;
  output: LogEntry[];
  errors: LogEntry[];
  startTime: number;
  outputLogPath?: string;
  errorLogPath?: string;
  mode?: 'editor' | 'run';
}

export interface GodotDetachedState {
  pid: number;
  projectPath: string;
  port: number;
  startTime: number;
  outputLogPath?: string;
  errorLogPath?: string;
  mode?: 'editor' | 'run';
}

export interface GodotLogSourceSnapshot {
  source: 'editor_session_log' | 'active_process' | 'detached_state' | 'last_failed_run';
  output: LogEntry[];
  errors: LogEntry[];
  startTime: number;
}

export interface GodotEditorSession {
  sessionId: string;
  pluginVersion: string;
  projectPath: string;
  editorPid: number;
  updatedAt: number;
  isPlaying: boolean;
  playingScene?: string;
  logPath?: string;
  commandPath?: string;
  responsesDir?: string;
  capabilities?: {
    playMainScene?: boolean;
    playCustomScene?: boolean;
    stopPlay?: boolean;
    readOutputSnapshot?: boolean;
  };
}

export interface GodotEditorCommand {
  id: string;
  command: 'play_main' | 'play_scene' | 'stop_play' | 'get_output_snapshot' | 'inspect_output_targets';
  scene?: string;
  issuedAt: number;
}

export interface GodotEditorCommandResponse {
  id: string;
  success: boolean;
  error?: string;
  handledAt: number;
  isPlaying?: boolean;
  playingScene?: string;
  outputLines?: string[];
  targets?: Array<{
    path: string;
    name: string;
    score: number;
    lineCount: number;
    sample: string;
  }>;
}

export interface GodotEditorProcessInfo {
  pid: number;
  commandLine: string;
}

export type GodotReadinessLevel =
  | 'not_ready'
  | 'editor_attached'
  | 'bridge_connected'
  | 'action_ready'
  | 'world_ready';

export type GodotReadinessCheckState = 'ready' | 'blocked' | 'unknown' | 'unchecked';

export interface GodotReadiness {
  projectPath: string;
  level: GodotReadinessLevel;
  summary: string;
  modeHint: 'none' | 'editor_session' | 'editor_process_without_session' | 'detached_run' | 'active_run';
  editor: {
    attached: boolean;
    staleSession: boolean;
    processCount: number | null;
    isPlaying: boolean | null;
    playingScene: string | null;
    updatedAt: number | null;
  };
  bridge: {
    connected: boolean;
    serverUrl: string;
    connectedDurationMs: number | null;
    gameRunning: boolean;
  };
  actions: {
    state: GodotReadinessCheckState;
    includeBlocked: boolean;
    actionCount: number | null;
    error?: string;
  };
  world: {
    state: GodotReadinessCheckState;
    reason: string;
  };
  process: {
    activeRunProcess: boolean;
    detachedRunState: boolean;
    lastRunSnapshot: boolean;
    preferredLogSource: GodotLogSourceSnapshot['source'] | 'none';
  };
}

/**
 * 服务器配置
 */
export interface GodotServerConfig {
  godotPath?: string;
  debugMode?: boolean;
  godotDebugMode?: boolean;
  strictPathValidation?: boolean;
}

/**
 * 操作参数（通用字典类型）
 */
export interface OperationParams {
  [key: string]: any;
}
