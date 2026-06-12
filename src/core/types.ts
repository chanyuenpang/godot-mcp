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

/**
 * MCP 内容响应格式
 */
export interface MCPContent {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}
