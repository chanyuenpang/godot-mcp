/**
 * 资源操作相关 handler
 * read_resource/edit_resource/get_uid/update_project_uids
 */

import { join } from 'path';
import { existsSync } from 'fs';

import type { ToolResult } from '../core/types.js';
import type { GodotServer } from '../core/godot-server.js';

/**
 * 读取资源文件属性
 */
export async function handleReadResource(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath) {
    return { success: false, error: 'Project path is required' };
  }

  if (!args.resourcePath) {
    return { success: false, error: 'Resource path is required' };
  }

  if (!server.validatePath(args.projectPath) || !server.validatePath(args.resourcePath)) {
    return { success: false, error: 'Invalid path' };
  }

  if (!await server.ensureGodotPath()) {
    return { success: false, error: 'Could not find a valid Godot executable path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const params: any = { resourcePath: args.resourcePath };
  if (args.path) {
    params.path = args.path;
  }

  const { stdout, stderr } = await server.executeOperation('read_resource', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to read resource: ${stderr}` };
  }

  // 提取 JSON 结果
  const jsonResult = server.extractJsonFromOutput(stdout);
  if (jsonResult) {
    try {
      const result = JSON.parse(jsonResult);
      if (result.success) {
        return { success: true, data: result };
      } else {
        return { success: false, error: `Failed to read resource: ${result.error || 'Unknown error'}` };
      }
    } catch {
      // JSON 解析失败，返回原始输出
    }
  }

  // 无法解析 JSON，返回原始输出
  return { success: true, data: stdout };
}

/**
 * 编辑资源文件属性
 */
export async function handleEditResource(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath) {
    return { success: false, error: 'Project path is required' };
  }

  if (!args.resourcePath) {
    return { success: false, error: 'Resource path is required' };
  }

  if (!args.properties || !Array.isArray(args.properties)) {
    return { success: false, error: 'Properties array is required' };
  }

  if (!server.validatePath(args.projectPath) || !server.validatePath(args.resourcePath)) {
    return { success: false, error: 'Invalid path' };
  }

  if (!await server.ensureGodotPath()) {
    return { success: false, error: 'Could not find a valid Godot executable path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const params = {
    resourcePath: args.resourcePath,
    properties: args.properties,
  };

  const { stdout, stderr } = await server.executeOperation('edit_resource', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to edit resource: ${stderr}` };
  }

  // 提取 JSON 结果
  const jsonResult = server.extractJsonFromOutput(stdout);
  if (jsonResult) {
    const result = JSON.parse(jsonResult);
    if (result.success) {
      return {
        success: true,
        data: {
          success: true,
          resource_path: result.resource_path,
          modified_count: result.modified?.length || 0,
          modified: result.modified,
          errors: result.errors?.length > 0 ? result.errors : undefined,
        },
      };
    } else {
      return { success: false, error: `Failed to edit resource: ${result.error || 'Unknown error'}` };
    }
  }

  // 无法解析 JSON，返回原始输出
  return { success: true, data: stdout };
}

/**
 * 获取文件 UID（Godot 4.4+）
 */
export async function handleGetUid(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath || !args.filePath) {
    return { success: false, error: 'Missing required parameters: projectPath, filePath' };
  }

  if (!server.validatePath(args.projectPath) || !server.validatePath(args.filePath)) {
    return { success: false, error: 'Invalid path' };
  }

  if (!await server.ensureGodotPath()) {
    return { success: false, error: 'Could not find a valid Godot executable path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const filePath = join(args.projectPath, args.filePath);
  if (!existsSync(filePath)) {
    return { success: false, error: `File does not exist: ${args.filePath}` };
  }

  // 检查版本
  const version = await server.getGodotVersion();
  if (!server.isGodot44OrLater(version)) {
    return { success: false, error: `UIDs are only supported in Godot 4.4 or later. Current version: ${version}` };
  }

  const params = { filePath: args.filePath };
  const { stdout, stderr } = await server.executeOperation('get_uid', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to get UID: ${stderr}` };
  }

  return { success: true, data: `UID for ${args.filePath}: ${stdout.trim()}` };
}

/**
 * 更新项目 UID 引用（Godot 4.4+）
 */
export async function handleUpdateProjectUids(server: GodotServer, args: any): Promise<ToolResult> {
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

  // 检查版本
  const version = await server.getGodotVersion();
  if (!server.isGodot44OrLater(version)) {
    return { success: false, error: `UIDs are only supported in Godot 4.4 or later. Current version: ${version}` };
  }

  const params = { projectPath: args.projectPath };
  const { stdout, stderr } = await server.executeOperation('resave_resources', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to update project UIDs: ${stderr}` };
  }

  return { success: true, data: `Project UIDs updated successfully.\n${stdout}` };
}
