#!/usr/bin/env node
/**
 * Godot MCP CLI 入口
 * 提供命令行接口访问所有 Godot MCP 功能
 */

import { Command } from 'commander';
import { resolve } from 'path';

import type { ToolResult } from './core/types.js';
import { GodotServer } from './core/godot-server.js';

// Handlers
import {
  handleRunProject,
  handleStopProject,
  handleLaunchEditor,
  handleGetGodotVersion,
  handleGetProjectInfo,
  handleListProjects,
} from './handlers/project.js';
import { handleCreateScene, handleAddNode } from './handlers/scene.js';
import {
  handleReadResource,
  handleEditResource,
  handleGetUid,
  handleUpdateProjectUids,
} from './handlers/resource.js';
import { handleGetDebugOutput } from './handlers/debug.js';
import {
  handleIngameCommand,
  handleListIngameTools,
  handleGetIngameStatus,
} from './handlers/ingame.js';

/**
 * 输出 JSON 结果到 stdout 并退出
 */
function output(result: ToolResult, exitCode?: number): void {
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = exitCode ?? (result.success ? 0 : 1);
}

/**
 * 创建并初始化 GodotServer 实例
 * 自动尝试发现并连接已运行的 Godot 进程 WebSocket 服务
 */
async function createServer(): Promise<GodotServer> {
  const server = new GodotServer();
  await server.ensureGodotPath();
  // 尝试连接已运行的 detached Godot 进程
  const connected = await GodotServer.tryConnectRunning(server.bridge);
  if (connected) {
    console.error('[CLI] Connected to running Godot process via WebSocket');
  }
  return server;
}

/**
 * 执行 handler 并输出结果
 */
async function run(handler: () => Promise<ToolResult>): Promise<void> {
  const result = await handler();
  output(result);
}

// 创建主命令
const program = new Command();
program
  .name('godot-mcp')
  .description('Godot MCP 命令行工具')
  .version('0.1.1');

// ─── 项目管理命令 ────────────────────────────────────────────

program
  .command('run')
  .description('运行 Godot 项目')
  .option('--path <dir>', '项目目录路径', '.')
  .option('--scene <scene>', '指定运行的场景')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleRunProject(server, {
        projectPath: resolve(opts.path),
        scene: opts.scene,
      }, {
        detachProcess: true,
      })
    );
  });

program
  .command('stop')
  .description('停止正在运行的 Godot 项目')
  .action(async () => {
    const server = await createServer();
    await run(() => handleStopProject(server));
  });

program
  .command('editor')
  .description('启动 Godot 编辑器')
  .option('--path <dir>', '项目目录路径', '.')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleLaunchEditor(server, {
        projectPath: resolve(opts.path),
      }, {
        detachProcess: true,
      })
    );
  });

program
  .command('version')
  .description('获取 Godot 版本')
  .action(async () => {
    const server = await createServer();
    await run(() => handleGetGodotVersion(server));
  });

program
  .command('info')
  .description('获取项目信息')
  .option('--path <dir>', '项目目录路径', '.')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleGetProjectInfo(server, {
        projectPath: resolve(opts.path),
      })
    );
  });

program
  .command('list')
  .description('列出 Godot 项目')
  .option('--dir <directory>', '搜索目录', '.')
  .option('--recursive', '递归搜索', false)
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleListProjects(server, {
        directory: resolve(opts.dir),
        recursive: opts.recursive,
      })
    );
  });

// ─── 游戏内命令 ─────────────────────────────────────────────

const ingame = program.command('ingame').description('游戏内命令');

ingame
  .command('exec')
  .description('执行游戏内命令')
  .requiredOption('--tool <name>', '工具名称')
  .option('--args <json>', '参数 JSON 字符串', '{}')
  .action(async (opts) => {
    const server = await createServer();
    let args: any = {};
    try {
      args = JSON.parse(opts.args);
    } catch {
      output({ success: false, error: `无效的 JSON 参数: ${opts.args}` });
    }
    await run(() =>
      handleIngameCommand(server, {
        tool_name: opts.tool,
        arguments: args,
      })
    );
  });

ingame
  .command('list')
  .description('列出游戏内可用工具')
  .action(async () => {
    const server = await createServer();
    await run(() => handleListIngameTools(server));
  });

ingame
  .command('status')
  .description('查看 WebSocket 连接状态')
  .action(async () => {
    const server = await createServer();
    await run(() => handleGetIngameStatus(server));
  });

// ─── 调试命令 ───────────────────────────────────────────────

program
  .command('debug')
  .description('获取调试日志')
  .requiredOption('--filter <text>', '日志过滤模式')
  .option('--max-lines <n>', '最大行数', '50')
  .option('--merge', '合并重复条目', true)
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleGetDebugOutput(server, {
        filter: opts.filter,
        maxLines: parseInt(opts.maxLines, 10),
        mergeDuplicates: opts.merge,
      })
    );
  });

// ─── 资源命令 ───────────────────────────────────────────────

const resource = program.command('resource').description('资源操作');

resource
  .command('read')
  .description('读取资源文件')
  .requiredOption('--path <file>', '资源文件路径（项目相对路径）')
  .option('--json-path <path>', 'JSON 路径（读取嵌套值）')
  .option('--project <dir>', '项目目录', '.')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleReadResource(server, {
        projectPath: resolve(opts.project),
        resourcePath: opts.path,
        path: opts.jsonPath,
      })
    );
  });

resource
  .command('edit')
  .description('编辑资源文件')
  .requiredOption('--path <file>', '资源文件路径（项目相对路径）')
  .requiredOption('--props <json>', '属性修改 JSON 数组')
  .option('--project <dir>', '项目目录', '.')
  .action(async (opts) => {
    const server = await createServer();
    let properties: any[];
    try {
      properties = JSON.parse(opts.props);
    } catch {
      output({ success: false, error: `无效的 JSON: ${opts.props}` });
      return;
    }
    await run(() =>
      handleEditResource(server, {
        projectPath: resolve(opts.project),
        resourcePath: opts.path,
        properties,
      })
    );
  });

// ─── 场景命令 ───────────────────────────────────────────────

const scene = program.command('scene').description('场景操作');

scene
  .command('create')
  .description('创建新场景')
  .requiredOption('--path <file>', '场景文件路径（项目相对路径）')
  .option('--root <type>', '根节点类型', 'Node2D')
  .option('--project <dir>', '项目目录', '.')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleCreateScene(server, {
        projectPath: resolve(opts.project),
        scenePath: opts.path,
        rootNodeType: opts.root,
      })
    );
  });

scene
  .command('add-node')
  .description('向场景添加节点')
  .requiredOption('--scene <file>', '场景文件路径')
  .requiredOption('--type <nodeType>', '节点类型')
  .requiredOption('--name <nodeName>', '节点名称')
  .option('--parent <path>', '父节点路径')
  .option('--project <dir>', '项目目录', '.')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleAddNode(server, {
        projectPath: resolve(opts.project),
        scenePath: opts.scene,
        nodeType: opts.type,
        nodeName: opts.name,
        parentNodePath: opts.parent,
      })
    );
  });

// ─── UID 命令 ───────────────────────────────────────────────

const uid = program.command('uid').description('UID 操作');

uid
  .command('get')
  .description('获取文件 UID')
  .requiredOption('--path <file>', '文件路径（项目相对路径）')
  .option('--project <dir>', '项目目录', '.')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleGetUid(server, {
        projectPath: resolve(opts.project),
        filePath: opts.path,
      })
    );
  });

uid
  .command('update')
  .description('更新项目 UID 引用')
  .option('--project <dir>', '项目目录', '.')
  .action(async (opts) => {
    const server = await createServer();
    await run(() =>
      handleUpdateProjectUids(server, {
        projectPath: resolve(opts.project),
      })
    );
  });

// ─── serve 命令（MCP stdio 模式）─────────────────────────────

program
  .command('serve')
  .description('启动 MCP stdio 服务（常驻模式）')
  .action(async () => {
    // 动态导入 index.ts 中的 MCP 启动逻辑
    await import('./index.js');
  });

// 解析命令行参数
program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  output({ success: false, error: message });
});
