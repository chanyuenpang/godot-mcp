import { execFile } from 'child_process';
import { promisify } from 'util';

import type { GodotEditorSession, GodotLogSourceSnapshot, LogEntry, ToolResult } from './types.js';
import { GodotServer } from './godot-server.js';

const execFileAsync = promisify(execFile);

type CommandLogBaseline = {
  capturedAt: number;
  source: GodotLogSourceSnapshot['source'] | 'none';
  outputCount: number;
  errorCount: number;
};

type FailureCategory =
  | 'compile_error'
  | 'resource_error'
  | 'runtime_error'
  | 'warning'
  | 'transport_error'
  | 'unknown_error';

type FailureDiagnostic = {
  category: FailureCategory;
  summary: string;
  priorityLogLines: string[];
  source: GodotLogSourceSnapshot['source'];
  transportError?: string;
  sessionState?: Pick<GodotEditorSession, 'isPlaying' | 'playingScene' | 'updatedAt'>;
  probe?: 'check_only' | 'editor_ui_log' | 'editor_ui_targets';
};

type MergedDiagnosticLine = {
  text: string;
  count: number;
  firstTimestamp: number;
};

const ZH_GAME_NOT_RUNNING = '\u6e38\u620f\u672a\u8fd0\u884c';
const ZH_NOT_CONNECTED = '\u672a\u8fde\u63a5';
const ZH_DUPLICATED = '\u91cd\u590d';
const ZH_EDITOR_TEST_STOPPED = '\u7f16\u8f91\u5668\u4e2d\u7684\u6e38\u620f\u6d4b\u8bd5\u5df2\u505c\u6b62';
const ZH_RECENT_OUTPUT = '\u6700\u8fd1\u8f93\u51fa';
const ZH_CANNOT_CONTINUE = 'MCP \u65e0\u6cd5\u7ee7\u7eed\u8fde\u63a5';
const ZH_BEFORE_DISCONNECT = '\u8fde\u63a5\u65ad\u5f00\u524d\u7684\u6700\u8fd1\u8f93\u51fa';
const ZH_EDITOR_STILL_PLAYING = '\u7f16\u8f91\u5668\u4ecd\u5728\u64ad\u653e\uff0c\u4f46 MCP \u8fde\u63a5\u5df2\u65ad\u5f00';
const ZH_EDITOR_OUTPUT_RECENT = '\u7f16\u8f91\u5668 Output \u6700\u8fd1\u5185\u5bb9';
const ZH_OLD_PLUGIN = '\u5f53\u524d\u7f16\u8f91\u5668\u4ecd\u5728\u8fd0\u884c\u65e7\u7248 godot_mcp \u63d2\u4ef6\uff0c\u9700\u91cd\u542f\u7f16\u8f91\u5668\u540e\u624d\u80fd\u81ea\u52a8\u91c7\u96c6 Output \u9519\u8bef\u3002';
const ZH_EDITOR_RETURNED = '\u7f16\u8f91\u5668\u8fd4\u56de';

const PRIORITY_PATTERNS: Array<{ category: FailureCategory; pattern: RegExp }> = [
  {
    category: 'compile_error',
    pattern: /parser error|parse error|failed to compile|compilation failed|could not preload resource script|script error|could not parse global class|unexpected .+ in class body|identifier .+ not declared|function not found in base self/i,
  },
  {
    category: 'resource_error',
    pattern: /could not load|failed loading resource|no loader found|extresource|resource file not found|invalid resource/i,
  },
  {
    category: 'runtime_error',
    pattern: /invalid call|attempt to call function|attempt to index|null instance|stack overflow|division by zero|method failed|condition ".+" is true/i,
  },
  {
    category: 'warning',
    pattern: /\bwarning\b/i,
  },
];

const GENERIC_ERROR_PATTERN = /\berror\b|\bexception\b|\bfailed\b|\binvalid\b|debugger break/i;
const TRANSPORT_ERROR_PATTERN = new RegExp(
  `timeout|timed out|websocket|ws\\b|not connected|connection closed|bridge|editor run command failed|${ZH_GAME_NOT_RUNNING}|${ZH_NOT_CONNECTED}`,
  'i',
);
const DIAGNOSTIC_NOISE_PATTERNS = [
  /^\[MCPGameServer\].*(\u5ba2\u6237\u7aef\u8fde\u63a5|\u5ba2\u6237\u7aef\u65ad\u5f00|\u6536\u5230\u8bf7\u6c42)/,
  /^\[MCPGameServer\].*TCP \u76d1\u542c\u5df2\u542f\u52a8/,
  /^\[MCPCommandRegistry\].*\u6ce8\u518c\u547d\u4ee4/,
];
const MAX_PRIORITY_LINES = 6;
const MAX_RECENT_CONTEXT_LINES = 4;
const MAX_SUMMARY_LENGTH = 180;

function normalizeDiagnosticText(text: string): string {
  return text
    .trim()
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^debug>\s*/i, '')
    .replace(/^Debugger Break, Reason:\s*/i, '')
    .replace(/^SCRIPT ERROR:\s*/i, 'SCRIPT ERROR: ')
    .replace(/^\*Frame \d+\s*-\s*/i, 'Frame: ');
}

function mergeDiagnosticLines(entries: LogEntry[], limit: number = MAX_PRIORITY_LINES): MergedDiagnosticLine[] {
  const merged = new Map<string, MergedDiagnosticLine>();
  for (const entry of entries) {
    const text = normalizeDiagnosticText(entry.text);
    if (!text) {
      continue;
    }
    const existing = merged.get(text);
    if (existing) {
      existing.count += 1;
      continue;
    }
    merged.set(text, {
      text,
      count: 1,
      firstTimestamp: entry.timestamp,
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.firstTimestamp - b.firstTimestamp;
    })
    .slice(0, limit);
}

function formatMergedLines(lines: MergedDiagnosticLine[]): string[] {
  return lines.map((line) => line.count > 1 ? `${line.text} (${ZH_DUPLICATED} ${line.count} \u6b21)` : line.text);
}

function buildSummary(lines: string[]): string {
  const firstLine = lines[0] ?? 'Unknown Godot failure.';
  return firstLine.length > MAX_SUMMARY_LENGTH
    ? `${firstLine.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
    : firstLine;
}

function mergePriorityLines(primary: string[], secondary: string[]): string[] {
  const merged: string[] = [];
  for (const line of [...primary, ...secondary]) {
    if (!line || merged.includes(line)) {
      continue;
    }
    merged.push(line);
  }
  return merged.slice(0, MAX_PRIORITY_LINES);
}

function getNewEntries(snapshot: GodotLogSourceSnapshot, baseline: CommandLogBaseline | null): LogEntry[] {
  const newErrors = baseline && baseline.source === snapshot.source
    ? snapshot.errors.slice(Math.min(baseline.errorCount, snapshot.errors.length))
    : snapshot.errors.filter((entry) => entry.timestamp >= (baseline?.capturedAt ?? snapshot.startTime));
  const newOutput = baseline && baseline.source === snapshot.source
    ? snapshot.output.slice(Math.min(baseline.outputCount, snapshot.output.length))
    : snapshot.output.filter((entry) => entry.timestamp >= (baseline?.capturedAt ?? snapshot.startTime));
  return [...newErrors, ...newOutput].sort((a, b) => a.timestamp - b.timestamp);
}

function classifyEntries(entries: LogEntry[]): FailureDiagnostic | null {
  for (const { category, pattern } of PRIORITY_PATTERNS) {
    const matched = entries.filter((entry) => pattern.test(entry.text));
    if (matched.length > 0) {
      const priorityLogLines = formatMergedLines(mergeDiagnosticLines(matched, category === 'warning' ? 4 : MAX_PRIORITY_LINES));
      return {
        category,
        summary: buildSummary(priorityLogLines),
        priorityLogLines,
        source: 'active_process',
      };
    }
  }

  const fallback = entries.filter((entry) => GENERIC_ERROR_PATTERN.test(entry.text));
  if (fallback.length > 0) {
    const priorityLogLines = formatMergedLines(mergeDiagnosticLines(fallback));
    return {
      category: 'unknown_error',
      summary: buildSummary(priorityLogLines),
      priorityLogLines,
      source: 'active_process',
    };
  }

  return null;
}

function isDiagnosticNoise(text: string): boolean {
  return DIAGNOSTIC_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function pickRecentContextLines(entries: LogEntry[], limit: number = MAX_RECENT_CONTEXT_LINES): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index--) {
    const text = normalizeDiagnosticText(entries[index].text);
    if (!text || isDiagnosticNoise(text) || seen.has(text)) {
      continue;
    }
    seen.add(text);
    deduped.push(text);
    if (deduped.length >= limit) {
      break;
    }
  }
  return deduped.reverse();
}

function getSessionState(server: GodotServer, projectPath: string): FailureDiagnostic['sessionState'] | undefined {
  const session = server.getEditorSession(projectPath);
  if (!session) {
    return undefined;
  }
  return {
    isPlaying: session.isPlaying,
    playingScene: session.playingScene,
    updatedAt: session.updatedAt,
  };
}

function buildTransportFallback(
  server: GodotServer,
  snapshot: GodotLogSourceSnapshot,
  options: {
    projectPath: string;
    baseline?: CommandLogBaseline | null;
    transportError?: string;
  },
): FailureDiagnostic | null {
  if (!options.transportError) {
    return null;
  }

  const newEntries = getNewEntries(snapshot, options.baseline ?? null);
  const recentContextLines = pickRecentContextLines(newEntries.length > 0 ? newEntries : [...snapshot.errors, ...snapshot.output]);
  const sessionState = getSessionState(server, options.projectPath);

  if (sessionState && !sessionState.isPlaying) {
    const summary = recentContextLines[0]
      ? `${ZH_EDITOR_TEST_STOPPED}\uff0c${ZH_RECENT_OUTPUT}\uff1a${recentContextLines[0]}`
      : `${ZH_EDITOR_TEST_STOPPED}\uff0c${ZH_CANNOT_CONTINUE}\u3002`;
    return {
      category: 'transport_error',
      summary,
      priorityLogLines: recentContextLines,
      source: snapshot.source,
      transportError: options.transportError,
      sessionState,
    };
  }

  if (recentContextLines.length > 0) {
    return {
      category: 'transport_error',
      summary: `${ZH_BEFORE_DISCONNECT}\uff1a${recentContextLines[0]}`,
      priorityLogLines: recentContextLines,
      source: snapshot.source,
      transportError: options.transportError,
      sessionState,
    };
  }

  if (sessionState) {
    return {
      category: 'transport_error',
      summary: sessionState.isPlaying
        ? `${ZH_EDITOR_STILL_PLAYING}\u3002`
        : `${ZH_EDITOR_TEST_STOPPED}\uff0c${ZH_CANNOT_CONTINUE}\u3002`,
      priorityLogLines: [],
      source: snapshot.source,
      transportError: options.transportError,
      sessionState,
    };
  }

  return null;
}

function createLogEntriesFromText(raw: string): LogEntry[] {
  const now = Date.now();
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text, index) => ({
      text,
      timestamp: now + index,
    }));
}

async function collectEditorOutputDiagnostic(
  server: GodotServer,
  options: {
    projectPath: string;
    transportError?: string;
  },
): Promise<FailureDiagnostic | null> {
  if (!options.transportError || !shouldDiagnoseError(options.transportError)) {
    return null;
  }

  const session = server.getEditorSession(options.projectPath);
  if (!session) {
    return null;
  }

  let outputLines: string[] = [];
  try {
    outputLines = await server.getEditorOutputSnapshot(options.projectPath, 3000);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unknown command:\s*get_output_snapshot/i.test(message)) {
      return {
        category: 'transport_error',
        summary: ZH_OLD_PLUGIN,
        priorityLogLines: [`${ZH_EDITOR_RETURNED}\uff1aunknown command: get_output_snapshot`],
        source: 'editor_session_log',
        transportError: options.transportError,
        sessionState: getSessionState(server, options.projectPath),
      };
    }
    return null;
  }

  if (outputLines.length === 0) {
    return null;
  }

  const entries = createLogEntriesFromText(outputLines.join('\n'));
  const diagnostic = classifyEntries(entries);
  if (diagnostic) {
    return {
      ...diagnostic,
      source: 'editor_session_log',
      transportError: options.transportError,
      sessionState: getSessionState(server, options.projectPath),
      probe: 'editor_ui_log',
    };
  }
  return null;
}

async function collectEditorTargetDiagnostic(
  server: GodotServer,
  options: {
    projectPath: string;
    transportError?: string;
  },
): Promise<FailureDiagnostic | null> {
  if (!options.transportError || !shouldDiagnoseError(options.transportError)) {
    return null;
  }

  const session = server.getEditorSession(options.projectPath);
  if (!session) {
    return null;
  }

  let targets: Array<{ path: string; name: string; score: number; lineCount: number; sample: string }> = [];
  try {
    targets = await server.inspectEditorOutputTargets(options.projectPath, 3000);
  } catch {
    return null;
  }

  const relevantLines: string[] = [];
  for (const target of targets) {
    const isScriptEditor = /ScriptEditor|ScriptTextEditor|CodeTextEditor/i.test(target.path);
    const hasCompileSignal = /Unexpected identifier|Parse Error|Failed to load script|Could not parse global class|error\s*\(|错误\s*\(|第\s*\d+\s*行/i.test(target.sample);
    if (!isScriptEditor || !hasCompileSignal) {
      continue;
    }

    for (const rawLine of target.sample.split(/\r?\n/)) {
      const normalized = rawLine.trim();
      if (!normalized || relevantLines.includes(normalized)) {
        continue;
      }
      relevantLines.push(normalized);
    }
  }

  if (relevantLines.length === 0) {
    return null;
  }

  const entries = createLogEntriesFromText(relevantLines.join('\n'));
  const diagnostic = classifyEntries(entries);
  if (!diagnostic) {
    return null;
  }

  return {
    ...diagnostic,
    source: 'editor_session_log',
    transportError: options.transportError,
    sessionState: getSessionState(server, options.projectPath),
    probe: 'editor_ui_targets',
  };
}

async function collectCompileProbeDiagnostic(
  server: GodotServer,
  options: {
    projectPath: string;
    transportError?: string;
  },
): Promise<FailureDiagnostic | null> {
  if (!options.transportError || !shouldDiagnoseError(options.transportError)) {
    return null;
  }

  if (!await server.ensureGodotPath() || !server.godotPath) {
    return null;
  }

  const args = ['--headless', '--path', options.projectPath, '--check-only', '--quit'];
  let combined = '';
  try {
    const { stdout = '', stderr = '' } = await execFileAsync(server.godotPath, args, {
      timeout: 20000,
      windowsHide: true,
    });
    combined = `${stdout}\n${stderr}`;
  } catch (error: unknown) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const execError = error as Error & { stdout?: string; stderr?: string };
      combined = `${execError.stdout ?? ''}\n${execError.stderr ?? ''}`;
    } else {
      return null;
    }
  }

  const entries = createLogEntriesFromText(combined);
  if (entries.length === 0) {
    return null;
  }

  const diagnostic = classifyEntries(entries);
  if (!diagnostic) {
    return null;
  }

  return {
    ...diagnostic,
    source: server.getPreferredLogSource(options.projectPath)?.source ?? 'editor_session_log',
    transportError: options.transportError,
    sessionState: getSessionState(server, options.projectPath),
    probe: 'check_only',
  };
}

export function captureCommandLogBaseline(server: GodotServer, projectPath: string): CommandLogBaseline {
  const snapshot = server.getPreferredLogSource(projectPath);
  if (!snapshot) {
    return {
      capturedAt: Date.now(),
      source: 'none',
      outputCount: 0,
      errorCount: 0,
    };
  }

  return {
    capturedAt: Date.now(),
    source: snapshot.source,
    outputCount: snapshot.output.length,
    errorCount: snapshot.errors.length,
  };
}

export function collectFailureDiagnostics(
  server: GodotServer,
  options: {
    projectPath: string;
    baseline?: CommandLogBaseline | null;
    transportError?: string;
  },
): FailureDiagnostic | null {
  const snapshot = server.getPreferredLogSource(options.projectPath);
  if (!snapshot) {
    return null;
  }

  const sessionState = getSessionState(server, options.projectPath);
  const diagnostic = classifyEntries(getNewEntries(snapshot, options.baseline ?? null));
  if (diagnostic) {
    return {
      ...diagnostic,
      source: snapshot.source,
      transportError: options.transportError,
      sessionState,
    };
  }

  return buildTransportFallback(server, snapshot, options);
}

export async function collectBestFailureDiagnostics(
  server: GodotServer,
  options: {
    projectPath: string;
    baseline?: CommandLogBaseline | null;
    transportError?: string;
  },
): Promise<FailureDiagnostic | null> {
  const directDiagnostic = collectFailureDiagnostics(server, options);
  if (directDiagnostic && directDiagnostic.category !== 'transport_error') {
    return directDiagnostic;
  }

  const editorOutputDiagnostic = await collectEditorOutputDiagnostic(server, options);
  const editorTargetDiagnostic = await collectEditorTargetDiagnostic(server, options);
  const hasEditorOutputError = editorOutputDiagnostic && editorOutputDiagnostic.category !== 'transport_error';
  const hasEditorTargetError = editorTargetDiagnostic && editorTargetDiagnostic.category !== 'transport_error';

  if (hasEditorTargetError && hasEditorOutputError) {
    const mergedLines = mergePriorityLines(
      editorTargetDiagnostic.priorityLogLines,
      editorOutputDiagnostic.priorityLogLines,
    );
    return {
      ...editorTargetDiagnostic,
      summary: buildSummary(mergedLines),
      priorityLogLines: mergedLines,
      probe: 'editor_ui_targets',
    };
  }

  if (hasEditorTargetError) {
    return editorTargetDiagnostic;
  }

  if (hasEditorOutputError) {
    return editorOutputDiagnostic;
  }

  const compileProbeDiagnostic = await collectCompileProbeDiagnostic(server, options);
  if (compileProbeDiagnostic) {
    return compileProbeDiagnostic;
  }

  return editorOutputDiagnostic ?? editorTargetDiagnostic ?? directDiagnostic;
}

export function withFailureDiagnostics(
  baseResult: ToolResult,
  diagnostic: FailureDiagnostic | null,
): ToolResult {
  if (!diagnostic || diagnostic.category === 'warning') {
    return baseResult;
  }

  return {
    success: false,
    error: diagnostic.summary,
    data: {
      ...(baseResult.data ?? {}),
      diagnostic: {
        category: diagnostic.category,
        source: diagnostic.source,
        transportError: diagnostic.transportError,
        priorityLogLines: diagnostic.priorityLogLines,
        sessionState: diagnostic.sessionState,
        probe: diagnostic.probe,
      },
    },
  };
}

export function shouldDiagnoseError(errorMessage?: string): boolean {
  if (!errorMessage) {
    return true;
  }
  return TRANSPORT_ERROR_PATTERN.test(errorMessage);
}

export async function waitForBridgeReadyOrDiagnose(
  server: GodotServer,
  options: {
    projectPath: string;
    baseline: CommandLogBaseline;
    timeoutMs?: number;
    pollMs?: number;
  },
): Promise<ToolResult | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const pollMs = options.pollMs ?? 400;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const diagnostic = collectFailureDiagnostics(server, {
      projectPath: options.projectPath,
      baseline: options.baseline,
      transportError: 'Bridge was not ready before the startup wait deadline.',
    });
    const shouldFailEarly = diagnostic
      && diagnostic.category !== 'warning'
      && (
        diagnostic.category !== 'transport_error'
        || diagnostic.sessionState?.isPlaying === false
      );
    if (shouldFailEarly) {
      return withFailureDiagnostics(
        {
          success: false,
          error: 'Godot process failed before the bridge became ready.',
        },
        diagnostic,
      );
    }

    if (server.bridge.isConnected() || await GodotServer.tryConnectRunning(server.bridge)) {
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const timeoutDiagnostic = await collectBestFailureDiagnostics(server, {
    projectPath: options.projectPath,
    baseline: options.baseline,
    transportError: 'Bridge startup timeout.',
  });
  if (timeoutDiagnostic) {
    return withFailureDiagnostics(
      {
        success: false,
        error: 'Godot started but did not establish the bridge in time.',
      },
      timeoutDiagnostic,
    );
  }

  return {
    success: false,
    error: 'Godot started but did not establish the bridge in time.',
    data: {
      diagnostic: {
        category: 'transport_error',
        source: 'none',
        transportError: 'Bridge startup timeout.',
        priorityLogLines: [],
      },
    },
  };
}
