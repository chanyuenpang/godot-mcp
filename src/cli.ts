#!/usr/bin/env node
/**
 * Godot MCP CLI 入口
 * 提供命令行接口访问所有 Godot MCP 功能
 */

import { Command } from 'commander';
import { resolve } from 'path';

import type { ToolResult } from './core/types.js';
import { GodotServer } from './core/godot-server.js';
import { collectReadiness } from './core/readiness.js';
import {
  captureCommandLogBaseline,
  collectBestFailureDiagnostics,
  collectFailureDiagnostics,
  shouldDiagnoseError,
  waitForBridgeReadyOrDiagnose,
  withFailureDiagnostics,
} from './core/failure-diagnostics.js';
import { applySuccessResultDiagnostics } from './core/command-result-diagnostics.js';

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
import { handleGetActions, handleRunAction } from './handlers/actions.js';

/**
 * 输出 JSON 结果到 stdout 并退出
 */
function output(result: ToolResult, exitCode?: number): void {
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = exitCode ?? (result.success ? 0 : 1);
}

/**
 * 创建并初始化 GodotServer 实例
 * @param options.needGodotPath 是否需要检测 Godot 路径（默认 true）
 */
async function createServer(options: { needGodotPath?: boolean } = {}): Promise<GodotServer> {
  const { needGodotPath = true } = options;
  const server = new GodotServer();
  server.bridge.silent = true;
  if (needGodotPath) {
    await server.ensureGodotPath();
  }
  // 尝试连接已运行的 Godot 进程
  const connected = await GodotServer.tryConnectRunning(server.bridge);
  if (!connected) {
    try {
      await server.bridge.connect();
    } catch {
      // 连接失败是可接受的
    }
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

async function executeWithFailureDiagnostics(
  server: GodotServer,
  handler: () => Promise<ToolResult>,
  options: {
    projectPath: string;
    baseline: ReturnType<typeof captureCommandLogBaseline>;
  },
): Promise<ToolResult> {
  try {
    const result = await handler();
    if (result.success) {
      const diagnostic = collectFailureDiagnostics(server, {
        projectPath: options.projectPath,
        baseline: options.baseline,
      });
      return applySuccessResultDiagnostics(result, diagnostic);
    }

    if (!shouldDiagnoseError(result.error)) {
      return result;
    }

    const diagnostic = await collectBestFailureDiagnostics(server, {
      projectPath: options.projectPath,
      baseline: options.baseline,
      transportError: result.error,
    });
    return withFailureDiagnostics(result, diagnostic);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = await collectBestFailureDiagnostics(server, {
      projectPath: options.projectPath,
      baseline: options.baseline,
      transportError: message,
    });
    return withFailureDiagnostics({ success: false, error: message }, diagnostic);
  }
}

async function attachReadiness(
  server: GodotServer,
  result: ToolResult,
  options: {
    projectPath: string;
    probeActions?: boolean;
    editorProcessCount?: number | null;
  },
): Promise<ToolResult> {
  const readiness = await collectReadiness(server, {
    projectPath: options.projectPath,
    probeActions: options.probeActions,
    editorProcessCount: options.editorProcessCount,
  });
  return {
    ...result,
    data: {
      ...(result.data ?? {}),
      readiness,
    },
  };
}

// 创建主命令
const program = new Command();
program
  .name('godot-mcp')
  .description('Godot MCP 命令行工具')
  .version('0.1.2');

// ─── 项目管理命令 ────────────────────────────────────────────

program
  .command('run')
  .description('运行 Godot 项目')
  .option('--path <dir>', '项目目录路径', '.')
  .option('--scene <scene>', '指定运行的场景')
  .action(async (opts) => {
    const server = await createServer();
    const projectPath = resolve(opts.path);
    const baseline = captureCommandLogBaseline(server, projectPath);
    try {
      const editorProcesses = await server.findProjectEditorProcesses(projectPath);
      const initialResult = await executeWithFailureDiagnostics(server, () =>
        handleRunProject(server, {
          projectPath,
          scene: opts.scene,
        }, {
          detachProcess: true,
        }), {
          projectPath,
          baseline,
        }
      );
      const result = await attachReadiness(server, initialResult, {
        projectPath,
        probeActions: false,
        editorProcessCount: editorProcesses.length,
      });
      if (!result.success) {
        output(result);
        return;
      }

      const readinessResult = await waitForBridgeReadyOrDiagnose(server, {
        projectPath,
        baseline,
      });
      if (readinessResult) {
        output(await attachReadiness(server, readinessResult, {
          projectPath,
          probeActions: false,
          editorProcessCount: editorProcesses.length,
        }));
        return;
      }
      output(await attachReadiness(server, result, {
        projectPath,
        probeActions: true,
        editorProcessCount: editorProcesses.length,
      }));
    } finally {
      server.bridge.disconnect();
    }
  });

program
  .command('stop')
  .description('停止正在运行的 Godot 项目')
  .option('--path <dir>', '椤圭洰鐩綍璺緞', '.')
  .action(async (opts) => {
    const server = await createServer();
    try {
      await run(() =>
        handleStopProject(server, {
          projectPath: resolve(opts?.path ?? '.'),
        })
      );
    } finally {
      server.bridge.disconnect();
    }
  });

program
  .command('editor')
  .description('启动 Godot 编辑器')
  .option('--path <dir>', '项目目录路径', '.')
  .action(async (opts) => {
    const server = await createServer();
    try {
      await run(() =>
        handleLaunchEditor(server, {
          projectPath: resolve(opts.path),
        }, {
          detachProcess: true,
        })
      );
    } finally {
      server.bridge.disconnect();
    }
  });

program
  .command('version')
  .description('获取 Godot 版本')
  .action(async () => {
    const server = await createServer();
    try {
      await run(() => handleGetGodotVersion(server));
    } finally {
      server.bridge.disconnect();
    }
  });

program
  .command('info')
  .description('获取项目信息')
  .option('--path <dir>', '项目目录路径', '.')
  .action(async (opts) => {
    const server = await createServer();
    try {
      await run(() =>
        handleGetProjectInfo(server, {
          projectPath: resolve(opts.path),
        })
      );
    } finally {
      server.bridge.disconnect();
    }
  });

program
  .command('list')
  .description('列出 Godot 项目')
  .option('--dir <directory>', '搜索目录', '.')
  .option('--recursive', '递归搜索', false)
  .action(async (opts) => {
    const server = await createServer();
    try {
      await run(() =>
        handleListProjects(server, {
          directory: resolve(opts.dir),
          recursive: opts.recursive,
        })
      );
    } finally {
      server.bridge.disconnect();
    }
  });

// ─── 游戏内命令 ─────────────────────────────────────────────

const ingame = program.command('ingame').description('游戏内命令');

ingame
  .command('exec')
  .description('Execute an in-game tool command')
  .requiredOption('--tool <name>', 'Tool name')
  .option('--args <json>', 'Arguments JSON string', '{}')
  .action(async (opts) => {
    const server = await createServer({ needGodotPath: false });
    const projectPath = process.cwd();
    const baseline = captureCommandLogBaseline(server, projectPath);
    try {
      let args: any = {};
      try {
        args = JSON.parse(opts.args);
      } catch {
        output({ success: false, error: `Invalid JSON arguments: ${opts.args}` });
        return;
      }
      const result = await executeWithFailureDiagnostics(server, () =>
        handleIngameCommand(server, {
          tool_name: opts.tool,
          arguments: args,
        }), {
          projectPath,
          baseline,
        });
      output(await attachReadiness(server, result, {
        projectPath,
        probeActions: server.bridge.isConnected(),
      }));
    } finally {
      server.bridge.disconnect();
    }
  });

ingame
  .command('list')
  .description('List available in-game tools')
  .action(async () => {
    const server = await createServer({ needGodotPath: false });
    const projectPath = process.cwd();
    const baseline = captureCommandLogBaseline(server, projectPath);
    try {
      const result = await executeWithFailureDiagnostics(server, () => handleListIngameTools(server), {
        projectPath,
        baseline,
      });
      output(await attachReadiness(server, result, {
        projectPath,
        probeActions: server.bridge.isConnected(),
      }));
    } finally {
      server.bridge.disconnect();
    }
  });

ingame
  .command('status')
  .description('查看 WebSocket 连接状态')
  .action(async () => {
    const server = await createServer({ needGodotPath: false });
    try {
      await run(() => handleGetIngameStatus(server));
    } finally {
      server.bridge.disconnect();
    }
  });

// ─── 行动命令 ───────────────────────────────────────

const actions = program.command('actions').description('游戏行动命令');

actions
  .command('list')
  .description('获取当前可用行动列表')
  .action(async () => {
    const server = await createServer({ needGodotPath: false });
    const projectPath = process.cwd();
    const baseline = captureCommandLogBaseline(server, projectPath);
    try {
      const result = await executeWithFailureDiagnostics(server, () => handleGetActions(server), {
        projectPath,
        baseline,
      });
      output(await attachReadiness(server, result, {
        projectPath,
        probeActions: server.bridge.isConnected(),
      }));
    } finally {
      server.bridge.disconnect();
    }
  });

actions
  .command('run')
  .description('执行指定行动（成功后自动等待状态更新并返回下一步可用行动）')
  .argument('<id>', '行动 ID')
  .action(async (id: string) => {
    const server = await createServer({ needGodotPath: false });
    const projectPath = process.cwd();
    const baseline = captureCommandLogBaseline(server, projectPath);
    try {

    // 记录执行前的 actions 快照
    const beforeResult = await executeWithFailureDiagnostics(server, () => handleGetActions(server), {
      projectPath,
      baseline,
    });
    if (!beforeResult.success) {
      output(await attachReadiness(server, beforeResult, {
        projectPath,
        probeActions: server.bridge.isConnected(),
      }));
      return;
    }
    const beforeSnapshot = JSON.stringify(beforeResult.data);

    const result = await executeWithFailureDiagnostics(server, () => handleRunAction(server, id), {
      projectPath,
      baseline,
    });
    if (!result.success) {
      output(await attachReadiness(server, result, {
        projectPath,
        probeActions: server.bridge.isConnected(),
      }));
      return;
    }

    // 渐进等待：如果列表未变化则认为游戏仍在加载
    const delays = [500, 1500, 3000];
    for (let i = 0; i < delays.length; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      const listResult = await executeWithFailureDiagnostics(server, () => handleGetActions(server), {
        projectPath,
        baseline,
      });
      if (!listResult.success) {
        // 连接失败等情况，继续重试
        if (i === delays.length - 1) {
          output(await attachReadiness(server, listResult, {
            projectPath,
            probeActions: server.bridge.isConnected(),
          }));
          return;
        }
        continue;
      }
      const diagnostic = collectFailureDiagnostics(server, {
        projectPath,
        baseline,
      });
      if (diagnostic && diagnostic.category !== 'warning') {
        output(await attachReadiness(server, withFailureDiagnostics({ success: false, error: diagnostic.summary }, diagnostic), {
          projectPath,
          probeActions: server.bridge.isConnected(),
        }));
        return;
      }
      const currentSnapshot = JSON.stringify(listResult.data);
      // 列表变化了 → 立即返回
      if (currentSnapshot !== beforeSnapshot || i === delays.length - 1) {
        output(await attachReadiness(server, listResult, {
          projectPath,
          probeActions: true,
        }));
        return;
      }
      // 最后一次重试仍未变化 → 直接返回（可能该 action 确实不改变列表）
    }
    } finally {
      server.bridge.disconnect();
    }
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
    try {
      await run(() =>
        handleGetDebugOutput(server, {
          filter: opts.filter,
          maxLines: parseInt(opts.maxLines, 10),
          mergeDuplicates: opts.merge,
        })
      );
    } finally {
      server.bridge.disconnect();
    }
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

// ─── Web 控制器命令 ──────────────────────────────────────────

program
  .command('web')
  .description('启动手机 Web 控制器（局域网内手机点按钮控制游戏）')
  .option('-p, --port <port>', 'HTTP 服务端口', '8080')
  .option('--host <host>', '绑定地址', '0.0.0.0')
  .option('--game-port <port>', 'Godot 游戏 WebSocket 端口', '9090')
  .action(async (opts) => {
    const { WebController } = await import('./web-controller.js');

    const controller = new WebController({
      port: parseInt(opts.port, 10),
      host: opts.host,
      gamePort: parseInt(opts.gamePort, 10),
    });

    // 优雅关闭
    const shutdown = () => {
      console.log('\n正在关闭 Web 控制器...');
      controller.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      await controller.start();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`启动失败: ${message}`);
      process.exit(1);
    }
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
