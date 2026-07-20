/** Godot MCP 通用 actions 协议。游戏项目通过 ingame addon 的 adapter 实现该协议。 */

export const ACTIONS_LIST_TOOL = 'godot_mcp_actions_list';
export const ACTIONS_RUN_TOOL = 'godot_mcp_actions_run';

export interface GodotMcpAction {
  id: string;
  label: string;
  description?: string;
  category?: string;
  enabled?: boolean;
  argumentsSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface GodotMcpActionList {
  actions: GodotMcpAction[];
  revision?: string;
}

export function readMcpToolPayload(raw: any): any {
  if (!raw || !Array.isArray(raw.content)) {
    throw new Error('Ingame addon returned an invalid MCP tool response: content[] is required.');
  }

  const textItem = raw.content.find((item: any) => item?.type === 'text' && typeof item.text === 'string');
  if (!textItem) {
    throw new Error('Ingame addon returned an invalid MCP tool response: text content is required.');
  }

  try {
    return JSON.parse(textItem.text);
  } catch {
    throw new Error('Ingame addon returned non-JSON text content.');
  }
}

export function parseActionListResponse(raw: any): GodotMcpActionList {
  const payload = readMcpToolPayload(raw);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.actions)) {
    throw new Error('Actions adapter must return an object with an actions array.');
  }

  const ids = new Set<string>();
  const actions = payload.actions.map((candidate: any, index: number): GodotMcpAction => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`Action at index ${index} must be an object.`);
    }
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '') {
      throw new Error(`Action at index ${index} must have a non-empty string id.`);
    }
    if (typeof candidate.label !== 'string' || candidate.label.trim() === '') {
      throw new Error(`Action '${candidate.id}' must have a non-empty string label.`);
    }
    if (ids.has(candidate.id)) {
      throw new Error(`Actions adapter returned duplicate action id '${candidate.id}'.`);
    }
    for (const field of ['description', 'category'] as const) {
      if (candidate[field] !== undefined && typeof candidate[field] !== 'string') {
        throw new Error(`Action '${candidate.id}' field '${field}' must be a string when provided.`);
      }
    }
    if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') {
      throw new Error(`Action '${candidate.id}' field 'enabled' must be a boolean when provided.`);
    }
    for (const field of ['argumentsSchema', 'metadata'] as const) {
      const value = candidate[field];
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
        throw new Error(`Action '${candidate.id}' field '${field}' must be an object when provided.`);
      }
    }
    ids.add(candidate.id);
    return candidate as GodotMcpAction;
  });

  if (payload.revision !== undefined && typeof payload.revision !== 'string') {
    throw new Error('Actions adapter revision must be a string when provided.');
  }

  return { actions, revision: payload.revision };
}
