/**
 * 调试输出相关 handler
 * get_debug_output
 */

import type { ToolResult, LogEntry, MergedLogEntry } from '../core/types.js';
import { GodotServer } from '../core/godot-server.js';

function filterLogs(logs: LogEntry[], pattern: string): LogEntry[] {
  if (pattern === '*') {
    return logs;
  }
  const lowerPattern = pattern.toLowerCase();
  return logs.filter(entry => entry.text.toLowerCase().includes(lowerPattern));
}

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
    const timestamps = entries.map(entry => entry.timestamp);
    merged.push({
      text,
      count: entries.length,
      timestamps: {
        first: timestamps[0],
        last: timestamps[timestamps.length - 1],
        intermediate: timestamps.length > 2 ? timestamps.slice(1, -1).slice(0, 3) : [],
      },
      relativeTime: {
        first: timestamps[0] - processStartTime,
        last: timestamps[timestamps.length - 1] - processStartTime,
      },
    });
  }

  merged.sort((a, b) => a.timestamps.first - b.timestamps.first);
  return merged;
}

function truncateLogs(logs: LogEntry[], maxLines: number): LogEntry[] {
  return logs.slice(-maxLines);
}

export async function handleGetDebugOutput(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);
  const projectPath = args.projectPath || process.cwd();

  const filter = args.filter;
  if (!filter) {
    return { success: false, error: 'filter parameter is REQUIRED to avoid retrieving excessive logs.' };
  }

  const mergeDuplicates = args.mergeDuplicates !== false;
  const maxLines = args.maxLines || 50;
  const editorLogSource = server.getEditorSessionLogs(projectPath);
  const detachedState = GodotServer.readStateFile();
  const lastRunSnapshot = detachedState ? null : GodotServer.readLastRunSnapshot();
  const activeLogSource = server.activeProcess;
  const logSource = editorLogSource
    ?? activeLogSource
    ?? (detachedState ? GodotServer.readDetachedLogs(detachedState) : null)
    ?? (lastRunSnapshot ? GodotServer.readDetachedLogs(lastRunSnapshot) : null);
  const source = editorLogSource
    ? 'editor_session_log'
    : activeLogSource
      ? 'active_process'
    : detachedState
      ? 'detached_state'
      : lastRunSnapshot
        ? 'last_failed_run'
        : 'none';

  if (!logSource) {
    return { success: false, error: 'No active Godot process or preserved failed run logs.' };
  }

  const filteredOutput = filterLogs(logSource.output, filter);
  const filteredErrors = filterLogs(logSource.errors, filter);

  const processedOutput = mergeDuplicates
    ? mergeDuplicateLogs(filteredOutput, logSource.startTime)
    : truncateLogs(filteredOutput, maxLines);

  const processedErrors = mergeDuplicates
    ? mergeDuplicateLogs(filteredErrors, logSource.startTime)
    : truncateLogs(filteredErrors, maxLines);

  return {
    success: true,
    data: {
      filter,
      source,
      summary: {
        totalOutputEntries: logSource.output.length,
        totalErrorEntries: logSource.errors.length,
        filteredOutputCount: filteredOutput.length,
        filteredErrorCount: filteredErrors.length,
        uniqueOutputCount: processedOutput.length,
        uniqueErrorCount: processedErrors.length,
        processRunningTime: Date.now() - logSource.startTime,
      },
      output: (processedOutput as any[]).slice(0, maxLines),
      errors: (processedErrors as any[]).slice(0, maxLines),
    },
  };
}
