/**
 * 场景操作相关 handler
 * create_scene/add_node/load_sprite/save_scene/export_mesh
 */

import { join } from 'path';
import { existsSync } from 'fs';

import type { ToolResult } from '../core/types.js';
import type { GodotServer } from '../core/godot-server.js';

/**
 * 创建新场景
 */
export async function handleCreateScene(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath || !args.scenePath) {
    return { success: false, error: 'Project path and scene path are required' };
  }

  if (!server.validatePath(args.projectPath) || !server.validatePath(args.scenePath)) {
    return { success: false, error: 'Invalid path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const params = {
    scenePath: args.scenePath,
    rootNodeType: args.rootNodeType || 'Node2D',
  };

  const { stdout, stderr } = await server.executeOperation('create_scene', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to create scene: ${stderr}` };
  }

  return { success: true, data: `Scene created at: ${args.scenePath}\n${stdout}` };
}

/**
 * 向场景添加节点
 */
export async function handleAddNode(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath || !args.scenePath || !args.nodeType || !args.nodeName) {
    return { success: false, error: 'Missing required parameters: projectPath, scenePath, nodeType, nodeName' };
  }

  if (!server.validatePath(args.projectPath) || !server.validatePath(args.scenePath)) {
    return { success: false, error: 'Invalid path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const scenePath = join(args.projectPath, args.scenePath);
  if (!existsSync(scenePath)) {
    return { success: false, error: `Scene file does not exist: ${args.scenePath}` };
  }

  const params: any = {
    scenePath: args.scenePath,
    nodeType: args.nodeType,
    nodeName: args.nodeName,
  };

  if (args.parentNodePath) {
    params.parentNodePath = args.parentNodePath;
  }
  if (args.properties) {
    params.properties = args.properties;
  }

  const { stdout, stderr } = await server.executeOperation('add_node', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to add node: ${stderr}` };
  }

  return { success: true, data: `Node '${args.nodeName}' (${args.nodeType}) added to '${args.scenePath}'\n${stdout}` };
}

/**
 * 加载精灵纹理
 */
export async function handleLoadSprite(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath || !args.scenePath || !args.nodePath || !args.texturePath) {
    return { success: false, error: 'Missing required parameters: projectPath, scenePath, nodePath, texturePath' };
  }

  if (
    !server.validatePath(args.projectPath) ||
    !server.validatePath(args.scenePath) ||
    !server.validatePath(args.nodePath) ||
    !server.validatePath(args.texturePath)
  ) {
    return { success: false, error: 'Invalid path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const scenePath = join(args.projectPath, args.scenePath);
  if (!existsSync(scenePath)) {
    return { success: false, error: `Scene file does not exist: ${args.scenePath}` };
  }

  const texturePath = join(args.projectPath, args.texturePath);
  if (!existsSync(texturePath)) {
    return { success: false, error: `Texture file does not exist: ${args.texturePath}` };
  }

  const params = {
    scenePath: args.scenePath,
    nodePath: args.nodePath,
    texturePath: args.texturePath,
  };

  const { stdout, stderr } = await server.executeOperation('load_sprite', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to load sprite: ${stderr}` };
  }

  return { success: true, data: `Sprite loaded with texture: ${args.texturePath}\n${stdout}` };
}

/**
 * 保存场景
 */
export async function handleSaveScene(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath || !args.scenePath) {
    return { success: false, error: 'Missing required parameters: projectPath, scenePath' };
  }

  if (!server.validatePath(args.projectPath) || !server.validatePath(args.scenePath)) {
    return { success: false, error: 'Invalid path' };
  }

  if (args.newPath && !server.validatePath(args.newPath)) {
    return { success: false, error: 'Invalid new path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const scenePath = join(args.projectPath, args.scenePath);
  if (!existsSync(scenePath)) {
    return { success: false, error: `Scene file does not exist: ${args.scenePath}` };
  }

  const params: any = { scenePath: args.scenePath };
  if (args.newPath) {
    params.newPath = args.newPath;
  }

  const { stdout, stderr } = await server.executeOperation('save_scene', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to save scene: ${stderr}` };
  }

  const savePath = args.newPath || args.scenePath;
  return { success: true, data: `Scene saved to: ${savePath}\n${stdout}` };
}

/**
 * 导出 MeshLibrary
 */
export async function handleExportMeshLibrary(server: GodotServer, args: any): Promise<ToolResult> {
  args = server.normalizeParameters(args);

  if (!args.projectPath || !args.scenePath || !args.outputPath) {
    return { success: false, error: 'Missing required parameters: projectPath, scenePath, outputPath' };
  }

  if (
    !server.validatePath(args.projectPath) ||
    !server.validatePath(args.scenePath) ||
    !server.validatePath(args.outputPath)
  ) {
    return { success: false, error: 'Invalid path' };
  }

  const projectFile = join(args.projectPath, 'project.godot');
  if (!existsSync(projectFile)) {
    return { success: false, error: `Not a valid Godot project: ${args.projectPath}` };
  }

  const scenePath = join(args.projectPath, args.scenePath);
  if (!existsSync(scenePath)) {
    return { success: false, error: `Scene file does not exist: ${args.scenePath}` };
  }

  const params: any = {
    scenePath: args.scenePath,
    outputPath: args.outputPath,
  };

  if (args.meshItemNames && Array.isArray(args.meshItemNames)) {
    params.meshItemNames = args.meshItemNames;
  }

  const { stdout, stderr } = await server.executeOperation('export_mesh_library', params, args.projectPath);

  if (stderr && stderr.includes('Failed to')) {
    return { success: false, error: `Failed to export mesh library: ${stderr}` };
  }

  return { success: true, data: `MeshLibrary exported to: ${args.outputPath}\n${stdout}` };
}
