/**
 * Web 控制器服务端
 * 提供 HTTP + WebSocket 服务，让手机通过局域网浏览器控制游戏
 */

import * as http from 'http';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { InGameBridge } from './core/bridge.js';
import { getControllerPage } from './web-controller-page.js';

/** 浏览器 WebSocket 消息类型 */
interface ClientMessage {
  type: 'get_actions' | 'run_action';
  action_id?: string;
}

/** 服务端响应消息类型 */
interface ServerMessage {
  type: 'actions_update' | 'error';
  actions?: any[];
  status?: string;
  message?: string;
}

/** WebController 配置选项 */
interface WebControllerOptions {
  port: number;
  host: string;
  gamePort?: number;
}

/**
 * 获取本机局域网 IPv4 地址列表
 */
export function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      // 只取非内部的 IPv4 地址
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  return ips;
}

/**
 * Web 控制器
 * 启动 HTTP 服务提供控制页面，通过 WebSocket 与浏览器通信，
 * 使用 InGameBridge 连接 Godot 游戏转发行动指令
 */
export class WebController {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private bridge: InGameBridge;
  private port: number;
  private host: string;
  private gamePort: number;
  private initialized: boolean = false;

  constructor(options: WebControllerOptions) {
    this.port = options.port;
    this.host = options.host;
    this.gamePort = options.gamePort ?? 9090;
    this.bridge = new InGameBridge();

    // 创建 HTTP 服务
    this.httpServer = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // 创建 WebSocket 服务，挂载在同一个 HTTP 服务上
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.handleWebSocketConnection(ws);
    });
  }

  /**
   * 启动 HTTP + WebSocket 服务
   */
  async start(): Promise<void> {
    // 连接到游戏 WebSocket
    await this.connectToGame();

    // 启动 HTTP 服务
    await new Promise<void>((resolve, reject) => {
      this.httpServer.on('error', reject);
      this.httpServer.listen(this.port, this.host, () => {
        resolve();
      });
    });

    // 输出启动信息
    this.printStartupInfo();
  }

  /**
   * 停止服务
   */
  stop(): void {
    // 关闭所有 WebSocket 连接
    this.wss.clients.forEach((client) => {
      client.close();
    });
    this.wss.close();
    this.httpServer.close();
    this.bridge.disconnect();
    console.log('[WebController] 服务已停止');
  }

  /**
   * 连接到 Godot 游戏并完成 MCP 握手
   */
  private async connectToGame(): Promise<void> {
    const gameUrl = `ws://127.0.0.1:${this.gamePort}`;
    console.log(`[WebController] 正在连接游戏 WebSocket: ${gameUrl}`);

    await this.bridge.connect(gameUrl);

    // MCP 握手初始化
    await this.bridge.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'web-controller',
        version: '1.0.0',
      },
    });
    this.initialized = true;
    console.log('[WebController] MCP 握手完成');
  }

  /**
   * 处理 HTTP 请求
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      const html = getControllerPage();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  }

  /**
   * 处理浏览器 WebSocket 连接
   */
  private handleWebSocketConnection(ws: WebSocket): void {
    console.log('[WebController] 浏览器客户端已连接');

    ws.on('message', async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        this.sendError(ws, '无效的 JSON 消息');
        return;
      }

      switch (msg.type) {
        case 'get_actions':
          await this.handleGetActions(ws);
          break;
        case 'run_action':
          if (!msg.action_id) {
            this.sendError(ws, 'action_id 参数是必需的');
            return;
          }
          await this.handleRunAction(ws, msg.action_id);
          break;
        default:
          this.sendError(ws, `未知的消息类型: ${(msg as any).type}`);
      }
    });

    ws.on('close', () => {
      console.log('[WebController] 浏览器客户端已断开');
    });
  }

  /**
   * 处理获取行动列表请求
   */
  private async handleGetActions(ws: WebSocket): Promise<void> {
    if (!this.bridge.isConnected()) {
      this.sendError(ws, '游戏未连接，请确保游戏正在运行');
      return;
    }

    try {
      const result = await this.bridge.sendRequest('tools/call', {
        name: 'get_available_actions',
        arguments: {},
      });

      const actions = this.extractActions(result);
      const response: ServerMessage = {
        type: 'actions_update',
        actions,
        status: 'connected',
      };
      ws.send(JSON.stringify(response));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(ws, '获取行动失败: ' + message);
    }
  }

  /**
   * 处理执行行动请求
   */
  private async handleRunAction(ws: WebSocket, actionId: string): Promise<void> {
    if (!this.bridge.isConnected()) {
      this.sendError(ws, '游戏未连接，请确保游戏正在运行');
      return;
    }

    try {
      // 执行行动
      await this.bridge.sendRequest('tools/call', {
        name: 'execute_action',
        arguments: { action_id: actionId },
      });

      // 执行成功后自动获取新行动列表
      const result = await this.bridge.sendRequest('tools/call', {
        name: 'get_available_actions',
        arguments: {},
      });

      const actions = this.extractActions(result);
      const response: ServerMessage = {
        type: 'actions_update',
        actions,
        status: 'connected',
      };
      ws.send(JSON.stringify(response));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(ws, '执行行动失败: ' + message);
    }
  }

  /**
   * 从 bridge 返回结果中提取行动列表
   */
  private extractActions(result: any): any[] {
    // bridge 返回的是 MCP tool call 的结果
    // 通常格式为 { content: [{ type: "text", text: "..." }] }
    if (!result) return [];

    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text' && item.text) {
          try {
            const parsed = JSON.parse(item.text);
            if (Array.isArray(parsed)) return parsed;
            if (parsed.actions && Array.isArray(parsed.actions)) return parsed.actions;
            return [parsed];
          } catch {
            // 非 JSON 文本，跳过
          }
        }
      }
    }

    // 如果结果本身就是数组
    if (Array.isArray(result)) return result;

    // 如果有 actions 字段
    if (result.actions && Array.isArray(result.actions)) return result.actions;

    return [];
  }

  /**
   * 向浏览器发送错误消息
   */
  private sendError(ws: WebSocket, message: string): void {
    const response: ServerMessage = {
      type: 'error',
      message,
    };
    ws.send(JSON.stringify(response));
  }

  /**
   * 输出启动信息
   */
  private printStartupInfo(): void {
    const localIPs = getLocalIPs();

    console.log('');
    console.log('🎮 Tiny World 手机控制器已启动！');
    console.log(`本机访问: http://localhost:${this.port}`);
    for (const ip of localIPs) {
      console.log(`手机访问: http://${ip}:${this.port}`);
    }
    console.log('');
  }
}
