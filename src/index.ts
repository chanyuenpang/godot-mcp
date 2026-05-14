#!/usr/bin/env node
/**
 * Godot MCP Server 入口
 * 精简薄壳：MCP Server 创建、tool schema 注册、CallToolRequest 分发
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import type { ToolResult } from './core/types.js';
import { GodotServer } from './core/godot-server.js';

// Handlers
import { handleLaunchEditor, handleRunProject, handleStopProject, handleGetGodotVersion, handleListProjects, handleGetProjectInfo } from './handlers/project.js';
import { handleCreateScene, handleAddNode, handleLoadSprite, handleSaveScene, handleExportMeshLibrary } from './handlers/scene.js';
import { handleReadResource, handleEditResource, handleGetUid, handleUpdateProjectUids } from './handlers/resource.js';
import { handleGetDebugOutput } from './handlers/debug.js';
import { handleIngameCommand, handleListIngameTools, handleGetIngameStatus } from './handlers/ingame.js';
import { handleGetActions, handleRunAction } from './handlers/actions.js';

/**
 * ToolResult → MCP Content 格式转换
 */
function toMCPContent(result: ToolResult) {
  if (result.success) {
    const text = typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data, null, 2);
    return {
      content: [{ type: 'text', text }],
    };
  } else {
    return {
      content: [{ type: 'text', text: result.error || 'Unknown error' }],
      isError: true,
    };
  }
}

// Tool schema 定义
const TOOL_DEFINITIONS = [
  {
    name: 'launch_editor',
    description: 'Launch Godot editor for a specific project',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'run_project',
    description: 'Run the Godot project and capture output',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scene: { type: 'string', description: 'Optional: Specific scene to run' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'get_debug_output',
    description: 'Get the current debug output and errors with filtering and deduplication support. REQUIRED: Provide a filter parameter to avoid retrieving excessive logs.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'REQUIRED: Filter pattern to match log entries (e.g., "error", "warning", "player", specific function name). Use "*" only if you really need all logs.' },
        mergeDuplicates: { type: 'boolean', description: 'Whether to merge duplicate log entries and show occurrence count with timestamps (default: true)' },
        maxLines: { type: 'number', description: 'Maximum number of unique log entries to return (default: 50)' },
      },
      required: ['filter'],
    },
  },
  {
    name: 'stop_project',
    description: 'Stop the currently running Godot project',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_godot_version',
    description: 'Get the installed Godot version',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_projects',
    description: 'List Godot projects in a directory',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to search for Godot projects' },
        recursive: { type: 'boolean', description: 'Whether to search recursively (default: false)' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'get_project_info',
    description: 'Retrieve metadata about a Godot project',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'create_scene',
    description: 'Create a new Godot scene file',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path where the scene file will be saved (relative to project)' },
        rootNodeType: { type: 'string', description: 'Type of the root node (e.g., Node2D, Node3D)' },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'add_node',
    description: 'Add a node to an existing scene',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the scene file (relative to project)' },
        parentNodePath: { type: 'string', description: 'Path to the parent node (e.g., "root" or "root/Player")' },
        nodeType: { type: 'string', description: 'Type of node to add (e.g., Sprite2D, CollisionShape2D)' },
        nodeName: { type: 'string', description: 'Name for the new node' },
        properties: { type: 'object', description: 'Optional properties to set on the node' },
      },
      required: ['projectPath', 'scenePath', 'nodeType', 'nodeName'],
    },
  },
  {
    name: 'load_sprite',
    description: 'Load a sprite into a Sprite2D node',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the scene file (relative to project)' },
        nodePath: { type: 'string', description: 'Path to the Sprite2D node (e.g., "root/Player/Sprite2D")' },
        texturePath: { type: 'string', description: 'Path to the texture file (relative to project)' },
      },
      required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
    },
  },
  {
    name: 'export_mesh_library',
    description: 'Export a scene as a MeshLibrary resource',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the scene file (.tscn) to export' },
        outputPath: { type: 'string', description: 'Path where the mesh library (.res) will be saved' },
        meshItemNames: { type: 'array', items: { type: 'string' }, description: 'Optional: Names of specific mesh items to include (defaults to all)' },
      },
      required: ['projectPath', 'scenePath', 'outputPath'],
    },
  },
  {
    name: 'save_scene',
    description: 'Save changes to a scene file',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        scenePath: { type: 'string', description: 'Path to the scene file (relative to project)' },
        newPath: { type: 'string', description: 'Optional: New path to save the scene to (for creating variants)' },
      },
      required: ['projectPath', 'scenePath'],
    },
  },
  {
    name: 'get_uid',
    description: 'Get the UID for a specific file in a Godot project (for Godot 4.4+)',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        filePath: { type: 'string', description: 'Path to the file (relative to project) for which to get the UID' },
      },
      required: ['projectPath', 'filePath'],
    },
  },
  {
    name: 'update_project_uids',
    description: 'Update UID references in a Godot project by resaving resources (for Godot 4.4+)',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
      },
      required: ['projectPath'],
    },
  },
  {
    name: 'read_resource',
    description: 'Read properties from a Godot resource file (.tres, .res). Supports JSON path to read nested values.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        resourcePath: { type: 'string', description: 'Path to the resource file (relative to project, e.g., "data/buffs/fire_damage.tres")' },
        path: { type: 'string', description: 'Optional JSON path to read a specific nested value. Examples: "metadata.author", "items[0]", "items[0].name". If omitted, returns all properties.' },
      },
      required: ['projectPath', 'resourcePath'],
    },
  },
  {
    name: 'edit_resource',
    description: 'Edit properties of a Godot resource file (.tres, .res). Supports JSON path operations: set/delete/append.',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: { type: 'string', description: 'Path to the Godot project directory' },
        resourcePath: { type: 'string', description: 'Path to the resource file (relative to project)' },
        properties: {
          type: 'array',
          description: 'Array of properties to modify. Each property supports: key (property name), value (new value), path (JSON path for nested access), operation (set/delete/append).',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Property name to modify' },
              value: { description: 'New value for the property (type should match original)' },
              path: { type: 'string', description: 'Optional JSON path for nested access. Examples: "metadata.author", "items[0]", "items[0].name"' },
              operation: { type: 'string', enum: ['set', 'delete', 'append'], description: 'Operation type: "set" (default), "delete" (remove property/array item), "append" (add to array)' },
            },
            required: ['key'],
          },
        },
      },
      required: ['projectPath', 'resourcePath', 'properties'],
    },
  },
  {
    name: 'ingame_command',
    description: '转发命令到游戏内执行。需要游戏已运行并通过 WebSocket 连接（端口 9090）。',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: '要调用的游戏内工具名称（如 get_player_info、spawn_enemy 等）' },
        arguments: { type: 'object', description: '传递给游戏内工具的参数（可选）' },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'list_ingame_tools',
    description: '查询游戏内当前可用的命令列表。需要游戏已运行并通过 WebSocket 连接。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_ingame_status',
    description: '查询与游戏内 WebSocket Server 的连接状态，包括连接状态、游戏端口、已连接时长等信息。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_actions',
    description: '获取当前游戏内所有可用行动选项列表（Actions）',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'run_action',
    description: '执行指定的游戏行动',
    inputSchema: {
      type: 'object',
      properties: {
        action_id: { type: 'string', description: '行动 ID' },
      },
      required: ['action_id'],
    },
  },
];

/**
 * 分发 tool 请求到对应 handler
 */
async function dispatch(godotServer: GodotServer, toolName: string, args: any): Promise<ToolResult> {
  switch (toolName) {
    case 'launch_editor':
      return await handleLaunchEditor(godotServer, args);
    case 'run_project':
      return await handleRunProject(godotServer, args);
    case 'get_debug_output':
      return await handleGetDebugOutput(godotServer, args);
    case 'stop_project':
      return await handleStopProject(godotServer);
    case 'get_godot_version':
      return await handleGetGodotVersion(godotServer);
    case 'list_projects':
      return await handleListProjects(godotServer, args);
    case 'get_project_info':
      return await handleGetProjectInfo(godotServer, args);
    case 'create_scene':
      return await handleCreateScene(godotServer, args);
    case 'add_node':
      return await handleAddNode(godotServer, args);
    case 'load_sprite':
      return await handleLoadSprite(godotServer, args);
    case 'export_mesh_library':
      return await handleExportMeshLibrary(godotServer, args);
    case 'save_scene':
      return await handleSaveScene(godotServer, args);
    case 'get_uid':
      return await handleGetUid(godotServer, args);
    case 'update_project_uids':
      return await handleUpdateProjectUids(godotServer, args);
    case 'read_resource':
      return await handleReadResource(godotServer, args);
    case 'edit_resource':
      return await handleEditResource(godotServer, args);
    case 'ingame_command':
      return await handleIngameCommand(godotServer, args);
    case 'list_ingame_tools':
      return await handleListIngameTools(godotServer);
    case 'get_ingame_status':
      return await handleGetIngameStatus(godotServer);
    case 'get_actions':
      return await handleGetActions(godotServer);
    case 'run_action':
      return await handleRunAction(godotServer, args.action_id);
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
  }
}

/**
 * 启动 MCP Server
 */
async function main() {
  const godotServer = new GodotServer();

  // 初始化 Godot 路径
  await godotServer.ensureGodotPath();

  if (!godotServer.godotPath) {
    console.error('[SERVER] Failed to find a valid Godot executable path');
    console.error('[SERVER] Please set GODOT_PATH environment variable or provide a valid path');
    process.exit(1);
  }

  const isValid = await godotServer.validateGodotPath();
  if (!isValid) {
    if (godotServer.strictPathValidation) {
      console.error(`[SERVER] Invalid Godot path: ${godotServer.godotPath}`);
      process.exit(1);
    } else {
      console.error(`[SERVER] Warning: Using potentially invalid Godot path: ${godotServer.godotPath}`);
    }
  }

  console.error(`[SERVER] Using Godot at: ${godotServer.godotPath}`);

  // 创建 MCP Server
  const mcpServer = new Server(
    { name: 'godot-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // 注册 tool 列表
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // 注册 tool 调用分发
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await dispatch(godotServer, request.params.name, request.params.arguments);
    return toMCPContent(result);
  });

  // 错误处理
  mcpServer.onerror = (error) => console.error('[MCP Error]', error);

  // 退出清理
  process.on('SIGINT', async () => {
    await godotServer.cleanup();
    await mcpServer.close();
    process.exit(0);
  });

  // 启动传输
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('Godot MCP server running on stdio');
}

// 运行
main().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error('Failed to run server:', errorMessage);
  process.exit(1);
});
