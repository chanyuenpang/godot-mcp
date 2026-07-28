/**
 * 项目管理相关 handler
 * run/stop/editor/version/info/list
 */

import { join, basename } from 'path';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';

import type { ToolResult } from '../core/types.js';
import type { GodotServer } from '../core/godot-server.js';

type LaunchHandlerOptions = {
  detachProcess?: boolean;
};

function shouldIgnoreEditorSessionGuards(): boolean {
  const raw = String(process.env.GODOT_MCP_IGNORE_EDITOR_SESSION ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * 启动 Godot 编辑器
 */
export async function handleLaunchEditor(server: GodotServer, args: any, options: LaunchHandlerOptions = {}): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath) {
    return { success: false, error: 'Project path is required' };
  }

  if (!server.validatePath(args.projectPath)) {
    return { success: false, error: 'Invalid project path' };
  }

  if (!await server.ensureGodotPath()) {
    return { success: false, error: 'Could not find a valid Godot executable path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const pluginInstall = server.ensureEditorPlugin(args.projectPath);
  if (!shouldIgnoreEditorSessionGuards() && server.hasFreshEditorSession(args.projectPath)) {
    return {
      success: true,
      data: {
        message: 'Attached to existing Godot editor session.',
        mode: 'editor_session',
        pluginChanged: pluginInstall.changed,
        session: server.getEditorSession(args.projectPath),
      },
    };
  }

  const existingEditors = await server.findProjectEditorProcesses(args.projectPath);
  if (!shouldIgnoreEditorSessionGuards() && existingEditors.length > 0) {
    return {
      success: false,
      error: 'Detected an existing Godot editor for this project, but no fresh editor session is available yet. Wait for the plugin to refresh or restart the editor manually.',
      data: {
        mode: 'editor_process_without_session',
        pluginChanged: pluginInstall.changed,
        existingEditors,
        staleSession: server.getEditorSession(args.projectPath),
      },
    };
  }

  server.launchEditor(args.projectPath, { detached: options.detachProcess === true });
  return {
    success: true,
    data: {
      message: `Godot editor launched for project at ${args.projectPath}`,
      mode: 'launched_editor',
      pluginChanged: pluginInstall.changed,
    },
  };
}

/**
 * 运行 Godot 项目
 */
export async function handleRunProject(server: GodotServer, args: any, options: LaunchHandlerOptions = {}): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath) {
    return { success: false, error: 'Project path is required' };
  }

  if (!server.validatePath(args.projectPath)) {
    return { success: false, error: 'Invalid project path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const pluginInstall = server.ensureEditorPlugin(args.projectPath);
  if (!shouldIgnoreEditorSessionGuards() && server.hasFreshEditorSession(args.projectPath)) {
    const editorSession = server.getEditorSession(args.projectPath);
    if (editorSession?.isPlaying) {
      const stopResponse = await server.stopEditorPlay(args.projectPath);
      if (!stopResponse.success) {
        return { success: false, error: stopResponse.error || 'Failed to stop the previous editor play session.' };
      }
    }

    const response = await server.runProjectViaEditor(args.projectPath, args.scene);
    if (!response.success) {
      return { success: false, error: response.error || 'Editor run command failed.' };
    }
    return {
      success: true,
      data: {
        message: 'Godot project started through attached editor session.',
        mode: 'editor_session',
        pluginChanged: pluginInstall.changed,
        response,
      },
    };
  }

  const existingEditors = await server.findProjectEditorProcesses(args.projectPath);
  if (!shouldIgnoreEditorSessionGuards() && existingEditors.length > 0) {
    return {
      success: false,
      error: 'Detected an existing Godot editor for this project, but no fresh editor session is available yet. Refusing to launch a separate run process. Wait for the plugin to refresh or restart the editor manually.',
      data: {
        mode: 'editor_process_without_session',
        pluginChanged: pluginInstall.changed,
        existingEditors,
        staleSession: server.getEditorSession(args.projectPath),
      },
    };
  }

  if (!await server.ensureGodotPath()) {
    return { success: false, error: 'Could not find a valid Godot executable path' };
  }

  server.runProject(args.projectPath, args.scene, { detached: options.detachProcess === true });
  return {
    success: true,
    data: {
      message: 'Godot project started in debug mode. Use get_debug_output to see output.',
      mode: 'detached_run',
      pluginChanged: pluginInstall.changed,
      note: pluginInstall.changed ? 'Editor plugin was installed. Restart an already-open editor to enable editor-session takeover.' : undefined,
    },
  };
}

/**
 * 停止 Godot 项目
 */
export async function handleStopProject(server: GodotServer, args: any = {}): Promise<ToolResult> {
  args = server.normalizeParameters(args);
  const projectPath = args.projectPath || process.cwd();
  if (!shouldIgnoreEditorSessionGuards() && server.hasFreshEditorSession(projectPath)) {
    const response = await server.stopEditorPlay(projectPath);
    if (!response.success) {
      return { success: false, error: response.error || 'Failed to stop editor play session.' };
    }
    return {
      success: true,
      data: {
        message: 'Stopped play session in attached editor.',
        mode: 'editor_session',
        response,
      },
    };
  }

  const result = server.stopProject();
  if (!result) {
    return { success: false, error: 'No active Godot process to stop.' };
  }
  return {
    success: true,
    data: {
      message: 'Godot project stopped',
      finalOutput: result.output,
      finalErrors: result.errors,
      mode: 'detached_run',
    },
  };
}

/**
 * 获取 Godot 版本
 */
export async function handleGetGodotVersion(server: GodotServer): Promise<ToolResult> {
  if (!await server.ensureGodotPath()) {
    return { success: false, error: 'Could not find a valid Godot executable path' };
  }

  const version = await server.getGodotVersion();
  return { success: true, data: version };
}

/**
 * 列出 Godot 项目
 */
export async function handleListProjects(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.directory) {
    return { success: false, error: 'Directory is required' };
  }

  if (!server.validatePath(args.directory)) {
    return { success: false, error: 'Invalid directory path' };
  }

  if (!existsSync(args.directory)) {
    return { success: false, error: `Directory does not exist: ${args.directory}` };
  }

  const recursive = args.recursive === true;
  const projects = server.findGodotProjects(args.directory, recursive);
  return { success: true, data: projects };
}

/**
 * 获取项目信息
 */
export async function handleGetProjectInfo(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath) {
    return { success: false, error: 'Project path is required' };
  }

  if (!server.validatePath(args.projectPath)) {
    return { success: false, error: 'Invalid project path' };
  }

  if (!await server.ensureGodotPath()) {
    return { success: false, error: 'Could not find a valid Godot executable path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const version = await server.getGodotVersion();
  const projectStructure = await server.getProjectStructureAsync(args.projectPath);

  // 提取项目名
  let projectName = basename(args.projectPath);
  try {
    const projectFileContent = readFileSync(projectFile, 'utf8');
    const configNameMatch = projectFileContent.match(/config\/name="([^"]+)"/);
    if (configNameMatch && configNameMatch[1]) {
      projectName = configNameMatch[1];
    }
  } catch {
    // 使用默认项目名
  }

  return {
    success: true,
    data: {
      name: projectName,
      path: args.projectPath,
      godotVersion: version,
      structure: projectStructure,
    },
  };
}
