/**
 * 调试输出相关 handler
 * get_debug_output
 */

import type { ToolResult, LogEntry, MergedLogEntry } from '../core/types.js';
import type { GodotServer } from '../core/godot-server.js';

/**
 * 按模式过滤日志
 */
function filterLogs(logs: LogEntry[], pattern: string): LogEntry[] {
  if (pattern === '*') {
    return logs;
  }
  const lowerPattern = pattern.toLowerCase();
  return logs.filter(entry =>
    entry.text.toLowerCase().includes(lowerPattern)
  );
}

/**
 * 合并重复日志条目（带出现次数和时间戳）
 */
function mergeDuplicateLogs(logs: LogEntry[], processStartTime: number): MergedLogEntry[] {
  const grouped = new Map<string, LogEntry[]>();

  for (const entry of logs) {
    const normalizedText = entry.text.trim();
    if (!grouped.has(normalizedText)) {
      grouped.set(normalizedText, []);
    }
    grouped.get(normalizedText)!.push(entry);
  }

  const merged: MergedLogEntry[] = [];

  for (const [text, entries] of grouped) {
    const timestamps = entries.map(e => e.timestamp);
    merged.push({
      text,
      count: entries.length,
      timestamps: {
        first: timestamps[0],
        last: timestamps[timestamps.length - 1],
        intermediate: timestamps.length > 2
          ? timestamps.slice(1, -1).slice(0, 3)
          : [],
      },
      relativeTime: {
        first: timestamps[0] - processStartTime,
        last: timestamps[timestamps.length - 1] - processStartTime,
      },
    });
  }

  // 按首次出现时间排序
  merged.sort((a, b) => a.timestamps.first - b.timestamps.first);

  return merged;
}

/**
 * 截断日志（不合并，取最后 N 条）
 */
function truncateLogs(logs: LogEntry[], maxLines: number): LogEntry[] {
  return logs.slice(-maxLines);
}

/**
 * 获取调试输出（带过滤和去重）
 */
export async function handleGetDebugOutput(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!server.activeProcess) {
    return { success: false, error: 'No active Godot process.' };
  }

  const filter = args.filter;
  if (!filter) {
    return { success: false, error: 'filter parameter is REQUIRED to avoid retrieving excessive logs.' };
  }

  const mergeDuplicates = args.mergeDuplicates !== false;
  const maxLines = args.maxLines || 50;

  // 过滤日志
  const filteredOutput = filterLogs(server.activeProcess.output, filter);
  const filteredErrors = filterLogs(server.activeProcess.errors, filter);

  // 处理日志
  const processedOutput = mergeDuplicates
    ? mergeDuplicateLogs(filteredOutput, server.activeProcess.startTime)
    : truncateLogs(filteredOutput, maxLines);

  const processedErrors = mergeDuplicates
    ? mergeDuplicateLogs(filteredErrors, server.activeProcess.startTime)
    : truncateLogs(filteredErrors, maxLines);

  return {
    success: true,
    data: {
      filter,
      summary: {
        totalOutputEntries: server.activeProcess.output.length,
        totalErrorEntries: server.activeProcess.errors.length,
        filteredOutputCount: filteredOutput.length,
        filteredErrorCount: filteredErrors.length,
        uniqueOutputCount: processedOutput.length,
        uniqueErrorCount: processedErrors.length,
        processRunningTime: Date.now() - server.activeProcess.startTime,
      },
      output: (processedOutput as any[]).slice(0, maxLines),
      errors: (processedErrors as any[]).slice(0, maxLines),
    },
  };
}
