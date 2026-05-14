/**
 * GodotServer 核心类
 * 管理进程、bridge、参数映射、godot 命令执行等核心能力
 */

import { fileURLToPath } from 'url';
import { join, dirname, basename, normalize } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawn, execFile } from 'child_process';
import type { StdioOptions } from 'child_process';
import { promisify } from 'util';

import type { GodotProcess, GodotServerConfig, OperationParams, LogEntry } from './types.js';
import { InGameBridge } from './bridge.js';
import { detectGodotPath, isValidGodotPath, isValidGodotPathSync, isGodot44OrLater } from './godot-path.js';

const execFileAsync = promisify(execFile);

type GodotLaunchOptions = {
  detached?: boolean;
};

// 调试模式常量
const DEBUG_MODE: boolean = process.env.DEBUG === 'true';
const GODOT_DEBUG_MODE: boolean = true;

// ESM 路径推导
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * GodotServer 核心类 - 提供进程管理、bridge 管理、Godot 命令执行等能力
 * 不包含 MCP schema 注册和 handler 方法
 */
export class GodotServer {
  public activeProcess: GodotProcess | null = null;
  public godotPath: string | null = null;
  public bridge: InGameBridge = new InGameBridge();
  public operationsScriptPath: string;
  public strictPathValidation: boolean = false;

  private validatedPaths: Map<string, boolean> = new Map();

  /**
   * snake_case → camelCase 参数映射
   */
  private parameterMappings: Record<string, string> = {
    'project_path': 'projectPath',
    'scene_path': 'scenePath',
    'root_node_type': 'rootNodeType',
    'parent_node_path': 'parentNodePath',
    'node_type': 'nodeType',
    'node_name': 'nodeName',
    'texture_path': 'texturePath',
    'node_path': 'nodePath',
    'output_path': 'outputPath',
    'mesh_item_names': 'meshItemNames',
    'new_path': 'newPath',
    'file_path': 'filePath',
    'directory': 'directory',
    'recursive': 'recursive',
    'scene': 'scene',
    'resource_path': 'resourcePath',
    'filter': 'filter',
    'merge_duplicates': 'mergeDuplicates',
    'max_lines': 'maxLines',
  };

  /**
   * camelCase → snake_case 反向映射
   */
  private reverseParameterMappings: Record<string, string> = {};

  constructor(config?: GodotServerConfig) {
    // 初始化反向映射
    for (const [snakeCase, camelCase] of Object.entries(this.parameterMappings)) {
      this.reverseParameterMappings[camelCase] = snakeCase;
    }

    if (config) {
      if (config.strictPathValidation !== undefined) {
        this.strictPathValidation = config.strictPathValidation;
      }

      // 如果配置提供了自定义 Godot 路径，验证并设置
      if (config.godotPath) {
        const normalizedPath = normalize(config.godotPath);
        this.godotPath = normalizedPath;
        this.logDebug(`Custom Godot path provided: ${this.godotPath}`);

        if (!isValidGodotPathSync(this.godotPath)) {
          console.warn(`[SERVER] Invalid custom Godot path provided: ${this.godotPath}`);
          this.godotPath = null;
        }
      }
    }

    // 操作脚本路径（build 后相对于 core/ 目录）
    this.operationsScriptPath = join(__dirname, '..', 'scripts', 'godot_operations.gd');
    if (DEBUG_MODE) console.error(`[DEBUG] Operations script path: ${this.operationsScriptPath}`);
  }

  /**
   * 调试日志输出（使用 stderr 避免干扰 JSON-RPC 通信）
   */
  public logDebug(message: string): void {
    if (DEBUG_MODE) {
      console.error(`[DEBUG] ${message}`);
    }
  }

  /**
   * 确保 godotPath 已设置
   */
  public async ensureGodotPath(): Promise<boolean> {
    if (!this.godotPath) {
      this.godotPath = await detectGodotPath(
        this.godotPath,
        this.validatedPaths,
        this.strictPathValidation
      );
    }
    return this.godotPath !== null;
  }

  /**
   * 验证 Godot 路径是否可用
   */
  public async validateGodotPath(): Promise<boolean> {
    if (!this.godotPath) return false;
    return await isValidGodotPath(this.godotPath, this.validatedPaths);
  }

  /**
   * 设置自定义 Godot 路径
   */
  public async setGodotPath(customPath: string): Promise<boolean> {
    if (!customPath) return false;
    const normalizedPath = normalize(customPath);
    if (await isValidGodotPath(normalizedPath, this.validatedPaths)) {
      this.godotPath = normalizedPath;
      this.logDebug(`Godot path set to: ${normalizedPath}`);
      return true;
    }
    this.logDebug(`Failed to set invalid Godot path: ${normalizedPath}`);
    return false;
  }

  /**
   * 验证路径安全性（防止路径遍历攻击）
   */
  public validatePath(path: string): boolean {
    if (!path || path.includes('..')) {
      return false;
    }
    return true;
  }

  /**
   * 参数标准化为 camelCase 格式
   */
  public normalizeParameters(params: OperationParams): OperationParams {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const result: OperationParams = {};

    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        let normalizedKey = key;

        if (key.includes('_') && this.parameterMappings[key]) {
          normalizedKey = this.parameterMappings[key];
        }

        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[normalizedKey] = this.normalizeParameters(params[key] as OperationParams);
        } else {
          result[normalizedKey] = params[key];
        }
      }
    }

    return result;
  }

  /**
   * 将 camelCase 参数转为 snake_case（供 Godot 脚本使用）
   */
  private convertCamelToSnakeCase(params: OperationParams): OperationParams {
    const result: OperationParams = {};

    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        const snakeKey = this.reverseParameterMappings[key] || key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

        if (typeof params[key] === 'object' && params[key] !== null && !Array.isArray(params[key])) {
          result[snakeKey] = this.convertCamelToSnakeCase(params[key] as OperationParams);
        } else {
          result[snakeKey] = params[key];
        }
      }
    }

    return result;
  }

  /**
   * 执行 Godot 操作脚本
   */
  public async executeOperation(
    operation: string,
    params: OperationParams,
    projectPath: string
  ): Promise<{ stdout: string; stderr: string }> {
    this.logDebug(`Executing operation: ${operation} in project: ${projectPath}`);
    this.logDebug(`Original operation params: ${JSON.stringify(params)}`);

    const snakeCaseParams = this.convertCamelToSnakeCase(params);
    this.logDebug(`Converted snake_case params: ${JSON.stringify(snakeCaseParams)}`);

    if (!this.godotPath) {
      await this.ensureGodotPath();
      if (!this.godotPath) {
        throw new Error('Could not find a valid Godot executable path');
      }
    }

    try {
      const paramsJson = JSON.stringify(snakeCaseParams);
      const args = [
        '--headless',
        '--path',
        projectPath,
        '--script',
        this.operationsScriptPath,
        operation,
        paramsJson,
      ];

      if (GODOT_DEBUG_MODE) {
        args.push('--debug-godot');
      }

      this.logDebug(`Executing: ${this.godotPath} ${args.join(' ')}`);
      const { stdout, stderr } = await execFileAsync(this.godotPath!, args);
      return { stdout: stdout ?? '', stderr: stderr ?? '' };
    } catch (error: unknown) {
      if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
        const execError = error as Error & { stdout: string; stderr: string };
        return {
          stdout: execError.stdout ?? '',
          stderr: execError.stderr ?? '',
        };
      }
      throw error;
    }
  }

  /**
   * 从 Godot 操作输出中提取 JSON（忽略 [INFO]/[DEBUG] 日志行）
   */
  public extractJsonFromOutput(output: string): string | null {
    const normalizedOutput = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedOutput.split('\n');

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.success !== undefined || parsed.error !== undefined) {
            return line;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * 获取 Godot 版本
   */
  public async getGodotVersion(): Promise<string> {
    if (!this.godotPath) {
      throw new Error('Godot path not set');
    }
    const { stdout } = await execFileAsync(this.godotPath, ['--version']);
    return stdout.trim();
  }

  /**
   * 检查 Godot 版本是否 >= 4.4
   */
  public isGodot44OrLater(version: string): boolean {
    return isGodot44OrLater(version);
  }

  /**
   * 启动 Godot 编辑器
   */
  public launchEditor(projectPath: string, options: GodotLaunchOptions = {}): void {
    this.logDebug(`Launching Godot editor for project: ${projectPath}`);
    const detached = options.detached === true;
    const proc = spawn(this.godotPath!, ['-e', '--path', projectPath], {
      detached,
      stdio: detached ? 'ignore' : 'pipe',
    });
    proc.on('error', (err: Error) => {
      console.error('Failed to start Godot editor:', err);
    });
    if (detached) {
      proc.unref();
    }
  }

  /**
   * 运行 Godot 项目（debug 模式）
   */
  public runProject(projectPath: string, scene?: string, options: GodotLaunchOptions = {}): void {
    // 杀掉已有进程
    if (this.activeProcess) {
      this.logDebug('Killing existing Godot process before starting a new one');
      this.activeProcess.process.kill();
    }

    const cmdArgs = ['-d', '--path', projectPath];
    if (scene && this.validatePath(scene)) {
      this.logDebug(`Adding scene parameter: ${scene}`);
      cmdArgs.push(scene);
    }

    this.logDebug(`Running Godot project: ${projectPath}`);
    const detached = options.detached === true;
    const stdio: StdioOptions = detached ? 'ignore' : 'pipe';
    const proc = spawn(this.godotPath!, cmdArgs, { detached, stdio });
    const output: LogEntry[] = [];
    const errors: LogEntry[] = [];

    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      const now = Date.now();
      lines.forEach((line: string) => {
        if (line.trim()) {
          output.push({ text: line, timestamp: now });
          this.logDebug(`[Godot stdout] ${line}`);
        }
      });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      const now = Date.now();
      lines.forEach((line: string) => {
        if (line.trim()) {
          errors.push({ text: line, timestamp: now });
          this.logDebug(`[Godot stderr] ${line}`);
        }
      });
    });

    proc.on('exit', (code: number | null) => {
      this.logDebug(`Godot process exited with code ${code}`);
      if (this.activeProcess && this.activeProcess.process === proc) {
        this.activeProcess = null;
      }
    });

    proc.on('error', (err: Error) => {
      console.error('Failed to start Godot process:', err);
      if (this.activeProcess && this.activeProcess.process === proc) {
        this.activeProcess = null;
      }
    });

    this.activeProcess = { process: proc, output, errors, startTime: Date.now() };
    if (detached) {
      proc.unref();
      // detached 模式下写入共享状态文件，供后续 CLI 命令发现进程
      GodotServer.writeStateFile(projectPath, proc.pid ?? process.pid, 9090);
    }

    if (!detached) {
      // 延迟 3 秒后尝试连接游戏内 WebSocket Server
      setTimeout(async () => {
        try {
          await this.bridge.connect('ws://127.0.0.1:9090');
          console.error('[SERVER] 已自动连接到游戏内 WebSocket Server');
        } catch {
          console.error('[SERVER] 游戏内 WebSocket 连接失败，将尝试重连...');
          this.bridge.autoReconnect('ws://127.0.0.1:9090');
        }
      }, 3000);
    }
  }

  /**
   * 停止当前运行的 Godot 进程
   */
  public stopProject(): { output: LogEntry[]; errors: LogEntry[] } | null {
    if (!this.activeProcess) return null;

    this.logDebug('Stopping active Godot process');
    this.activeProcess.process.kill();
    const output = this.activeProcess.output;
    const errors = this.activeProcess.errors;
    this.activeProcess = null;
    this.bridge.disconnect();
    return { output, errors };
  }

  /**
   * 查找目录中的 Godot 项目
   */
  public findGodotProjects(directory: string, recursive: boolean): Array<{ path: string; name: string }> {
    const projects: Array<{ path: string; name: string }> = [];

    try {
      const projectFile = join(directory, 'project.godot');
      if (existsSync(projectFile)) {
        projects.push({ path: directory, name: basename(directory) });
      }

      if (!recursive) {
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subdir = join(directory, entry.name);
            const subProjectFile = join(subdir, 'project.godot');
            if (existsSync(subProjectFile)) {
              projects.push({ path: subdir, name: entry.name });
            }
          }
        }
      } else {
        const entries = readdirSync(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue;
            const subdir = join(directory, entry.name);
            const subProjectFile = join(subdir, 'project.godot');
            if (existsSync(subProjectFile)) {
              projects.push({ path: subdir, name: entry.name });
            } else {
              const subProjects = this.findGodotProjects(subdir, true);
              projects.push(...subProjects);
            }
          }
        }
      }
    } catch (error) {
      this.logDebug(`Error searching directory ${directory}: ${error}`);
    }

    return projects;
  }

  /**
   * 获取项目文件统计结构
   */
  public getProjectStructureAsync(projectPath: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        const structure = { scenes: 0, scripts: 0, assets: 0, other: 0 };

        const scanDirectory = (currentPath: string) => {
          const entries = readdirSync(currentPath, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const entryPath = join(currentPath, entry.name);

            if (entry.isDirectory()) {
              scanDirectory(entryPath);
            } else if (entry.isFile()) {
              const ext = entry.name.split('.').pop()?.toLowerCase();
              if (ext === 'tscn') {
                structure.scenes++;
              } else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') {
                structure.scripts++;
              } else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext || '')) {
                structure.assets++;
              } else {
                structure.other++;
              }
            }
          }
        };

        scanDirectory(projectPath);
        resolve(structure);
      } catch (error) {
        this.logDebug(`Error getting project structure asynchronously: ${error}`);
        resolve({ error: 'Failed to get project structure', scenes: 0, scripts: 0, assets: 0, other: 0 });
      }
    });
  }

  /**
   * 清理资源
   */
    // ─── 共享状态文件管理（detached 进程发现）────────────

  /** 共享状态文件路径 */
  static readonly STATE_FILE = '/tmp/.godot-mcp-run.json';

  /**
   * 写入状态文件（detached 启动后调用）
   */
  static writeStateFile(projectPath: string, pid: number, port: number = 9090): void {
    try {
      const state = {
        pid,
        projectPath,
        port,
        startTime: Date.now(),
      };
      writeFileSync(GodotServer.STATE_FILE, JSON.stringify(state, null, 2));
      console.error(`[GodotServer] Wrote state file: PID=${pid}, port=${port}`);
    } catch (e) {
      console.error(`[GodotServer] Failed to write state file: ${e}`);
    }
  }

  /**
   * 清除状态文件
   */
  static clearStateFile(): void {
    try {
      if (existsSync(GodotServer.STATE_FILE)) {
        unlinkSync(GodotServer.STATE_FILE);
      }
    } catch { /* ignore */ }
  }

  /**
   * 尝试连接到已运行的 Godot 进程的 WebSocket 服务
   * @returns true 如果成功连接
   */
  static async tryConnectRunning(bridge: InGameBridge): Promise<boolean> {
    // 1) 检查状态文件
    const state = GodotServer.readStateFile();
    if (!state) return false;

    const { pid, port } = state;

    // 2) 检查 PID 是否存活
    try {
      process.kill(pid, 0); // 信号 0 只检查存在性
    } catch {
      if (!bridge.silent) console.error(`[GodotServer] State file has dead PID=${pid}, cleaning up`);
      GodotServer.clearStateFile();
      return false;
    }

    // 3) 尝试连接 WebSocket
    try {
      await bridge.connect(`ws://127.0.0.1:${port}`);
      return true;
    } catch (e) {
      if (!bridge.silent) console.error(`[GodotServer] Bridge connect failed: ${e}`);
      return false;
    }
  }

  /**
   * 读取共享状态文件
   */
  private static readStateFile(): { pid: number; projectPath: string; port: number; startTime: number } | null {
    try {
      if (!existsSync(GodotServer.STATE_FILE)) return null;
      const raw = readFileSync(GodotServer.STATE_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public async cleanup(): Promise<void> {
    this.logDebug('Cleaning up resources');
    if (this.activeProcess) {
      this.logDebug('Killing active Godot process');
      this.activeProcess.process.kill();
      this.activeProcess = null;
    }
    GodotServer.clearStateFile();
    this.bridge.disconnect();
  }
}
