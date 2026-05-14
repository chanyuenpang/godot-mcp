/**
 * 游戏内 WebSocket 桥接管理器
 * 连接到游戏内运行的 WebSocket Server，转发 AI 命令到游戏执行
 */

import WebSocket from 'ws';

export class InGameBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingRequests: Map<number, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();
  private requestId: number = 0;
  private connectTime: number | null = null;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_INTERVAL_MS = 5000;
  private serverUrl: string = 'ws://127.0.0.1:9090';
  public silent: boolean = false;

  /**
   * 连接到游戏内 WebSocket Server
   */
  connect(url: string = 'ws://127.0.0.1:9090'): Promise<void> {
    this.serverUrl = url;
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      // 清理旧连接
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.terminate();
        this.ws = null;
      }

      const ws = new WebSocket(url);

      const onOpen = () => {
        this.ws = ws;
        this.connectTime = Date.now();
        this.reconnectAttempts = 0;
        if (!this.silent) console.error(`[InGameBridge] 已连接到游戏 WebSocket Server: ${url}`);
        resolve();
      };

      const onError = (err: Error) => {
        console.error(`[InGameBridge] 连接错误: ${err.message}`);
        reject(err);
      };

      ws.once('open', onOpen);
      ws.once('error', onError);

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as { id?: number; result?: any; error?: any };
          if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const pending = this.pendingRequests.get(message.id)!;
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
            } else {
              pending.resolve(message.result);
            }
          }
        } catch (e) {
          console.error(`[InGameBridge] 解析消息失败: ${e}`);
        }
      });

      ws.on('close', () => {
        console.error(`[InGameBridge] 连接已断开`);
        this.ws = null;
        this.connectTime = null;
        // 拒绝所有待处理的请求
        for (const [id, pending] of this.pendingRequests.entries()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('WebSocket 连接已断开'));
          this.pendingRequests.delete(id);
        }
      });

      ws.on('error', (err: Error) => {
        console.error(`[InGameBridge] WebSocket 错误: ${err.message}`);
      });
    });
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    this.connectTime = null;
    this.reconnectAttempts = 0;
    console.error(`[InGameBridge] 已断开连接`);
  }

  /**
   * 发送 JSON-RPC 请求并等待响应
   */
  sendRequest(method: string, params?: any, timeoutMs: number = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('游戏未连接。请先运行游戏项目。'));
        return;
      }

      const id = ++this.requestId;
      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: params ?? {},
      });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时 (${timeoutMs}ms)：${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws.send(message);
    });
  }

  /**
   * 自动重连（每 5 秒尝试一次，最多 3 次）
   */
  autoReconnect(url?: string): void {
    const targetUrl = url ?? this.serverUrl;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[InGameBridge] 已达到最大重连次数 (${this.MAX_RECONNECT_ATTEMPTS})，停止重连`);
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      console.error(`[InGameBridge] 尝试第 ${this.reconnectAttempts} 次重连...`);
      try {
        await this.connect(targetUrl);
        this.reconnectTimer = null;
      } catch {
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
          this.autoReconnect(targetUrl);
        } else {
          console.error(`[InGameBridge] 重连失败，放弃重连`);
        }
      }
    }, this.RECONNECT_INTERVAL_MS);
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 获取已连接时长（毫秒）
   */
  getConnectedDuration(): number | null {
    if (this.connectTime === null) return null;
    return Date.now() - this.connectTime;
  }

  /**
   * 获取服务器地址
   */
  getServerUrl(): string {
    return this.serverUrl;
  }
}
