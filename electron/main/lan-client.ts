import WebSocket from "ws";
import {
  DEFAULT_PORT,
  type ClientToServerMessage,
  type ConnectionStatus,
  type HostData,
  type ServerToClientMessage,
  type TaskScreenshot,
  type UserProfile
} from "../../src/shared/types";

type StateHandler = (state: HostData) => void;
type StatusHandler = (status: ConnectionStatus) => void;

function normalizeAddress(rawAddress: string): string {
  const trimmed = rawAddress.trim();
  if (!trimmed) {
    throw new Error("请输入主机地址。");
  }

  const withProtocol = /^wss?:\/\//i.test(trimmed)
    ? trimmed
    : /^https?:\/\//i.test(trimmed)
      ? trimmed.replace(/^http/i, "ws")
      : `ws://${trimmed}`;

  const url = new URL(withProtocol);
  if (!url.port) {
    url.port = String(DEFAULT_PORT);
  }

  return url.toString().replace(/\/$/, "");
}

export class LanClient {
  private socket: WebSocket | null = null;
  private currentUrl: string | undefined;
  private readonly onState: StateHandler;
  private readonly onStatus: StatusHandler;

  constructor(onState: StateHandler, onStatus: StatusHandler) {
    this.onState = onState;
    this.onStatus = onStatus;
  }

  async connect(rawAddress: string, profile: UserProfile): Promise<string> {
    const url = normalizeAddress(rawAddress);
    this.disconnect(false);
    this.currentUrl = url;
    this.onStatus({ phase: "connecting", url, message: "正在连接主机..." });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.terminate();
          reject(new Error("连接超时，请确认主机地址和防火墙设置。"));
        }
      }, 6000);

      socket.on("open", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.socket = socket;
        this.send({ type: "client:join", profile });
        this.onStatus({ phase: "connected", url, message: "已连接" });
        resolve();
      });

      socket.on("message", (raw) => this.handleMessage(raw.toString()));

      socket.on("close", () => {
        clearTimeout(timeout);
        if (this.socket === socket) {
          this.socket = null;
          this.onStatus({ phase: "disconnected", url, message: "连接已断开" });
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(new Error(`连接失败：${error.message}`));
          return;
        }
        this.onStatus({ phase: "error", url, message: error.message });
      });
    });

    return url;
  }

  disconnect(emitStatus = true): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "Client disconnected");

    if (emitStatus) {
      this.onStatus({ phase: "idle", message: "未连接" });
    }
  }

  createTask(title: string): void {
    this.send({ type: "task:create", title });
  }

  toggleTask(taskId: string, completed: boolean): void {
    this.send({ type: "task:toggle", taskId, completed });
  }

  assignTask(taskId: string, assigneeId: string): void {
    this.send({ type: "task:assign", taskId, assigneeId });
  }

  updateTaskDetails(taskId: string, title: string, description: string, screenshots: TaskScreenshot[]): void {
    this.send({ type: "task:updateDetails", taskId, title, description, screenshots });
  }

  private handleMessage(raw: string): void {
    let message: ServerToClientMessage;

    try {
      message = JSON.parse(raw) as ServerToClientMessage;
    } catch {
      this.onStatus({
        phase: "error",
        url: this.currentUrl,
        message: "收到无法解析的服务端消息。"
      });
      return;
    }

    if (message.type === "server:error") {
      this.onStatus({ phase: "error", url: this.currentUrl, message: message.message });
      return;
    }

    this.onState(message.state);
  }

  private send(message: ClientToServerMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("尚未连接主机。");
    }

    this.socket.send(JSON.stringify(message));
  }
}
