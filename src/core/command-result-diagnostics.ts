import type { ToolResult } from './types.js';
import type { FailureDiagnostic } from './failure-diagnostics.js';
import { withFailureDiagnostics } from './failure-diagnostics.js';

export function applySuccessResultDiagnostics(
  baseResult: ToolResult,
  diagnostic: FailureDiagnostic | null,
): ToolResult {
  if (!baseResult.success) {
    return baseResult;
  }

  if (!diagnostic || diagnostic.category === 'warning') {
    return baseResult;
  }

  return withFailureDiagnostics(baseResult, diagnostic);
}
