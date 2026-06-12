import type { GodotLogSourceSnapshot, LogEntry, ToolResult } from './types.js';
import { GodotServer } from './godot-server.js';

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
};

type MergedDiagnosticLine = {
  text: string;
  count: number;
  firstTimestamp: number;
};

const PRIORITY_PATTERNS: Array<{ category: FailureCategory; pattern: RegExp }> = [
  {
    category: 'compile_error',
    pattern: /parser error|parse error|failed to compile|compilation failed|could not preload resource script|script error|unexpected .+ in class body|identifier .+ not declared|function not found in base self/i,
  },
  {
    category: 'resource_error',
    pattern: /could not load|failed loading resource|no loader found|extresource|resource file not found|invalid resource/i,
  },
  {
    category: 'runtime_error',
    pattern: /invalid call|attempt to call function|attempt to index|invalid get index|null instance|stack overflow|error calling|division by zero|method failed|condition ".+" is true/i,
  },
  {
    category: 'warning',
    pattern: /\bwarning\b/i,
  },
];

const GENERIC_ERROR_PATTERN = /\berror\b|\bexception\b|\bfailed\b|\binvalid\b|debugger break/i;
const TRANSPORT_ERROR_PATTERN = /timeout|timed out|websocket|ws\b|not connected|connection closed|bridge|editor run command failed/i;
const MAX_PRIORITY_LINES = 6;
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
  return lines.map((line) => line.count > 1 ? `${line.text} (重复 ${line.count} 次)` : line.text);
}

function buildSummary(lines: string[]): string {
  const firstLine = lines[0] ?? 'Unknown Godot failure.';
  return firstLine.length > MAX_SUMMARY_LENGTH
    ? `${firstLine.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
    : firstLine;
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

  const diagnostic = classifyEntries(getNewEntries(snapshot, options.baseline ?? null));
  if (!diagnostic) {
    return null;
  }

  return {
    ...diagnostic,
    source: snapshot.source,
    transportError: options.transportError,
  };
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
    if (diagnostic && diagnostic.category !== 'warning') {
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
