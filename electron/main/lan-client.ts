import WebSocket from "ws";
import {
  DEFAULT_PORT,
  type AccountAuthResult,
  type ClientToServerMessage,
  type ConnectionStatus,
  type HostData,
  type ProfileUpdateRequest,
  type ServerToClientMessage,
  type TaskScreenshot,
  type UserProfile
} from "../../src/shared/types";

type StateHandler = (state: HostData) => void;
type StatusHandler = (status: ConnectionStatus) => void;
type PendingAccountRequest = {
  resolve: (result: AccountAuthResult) => void;
  reject: (error: Error) => void;
};
type PendingProfileRequest = {
  resolve: (profile: UserProfile) => void;
  reject: (error: Error) => void;
};

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
  private pendingAccountRequest: PendingAccountRequest | null = null;
  private pendingProfileRequest: PendingProfileRequest | null = null;
  private readonly onState: StateHandler;
  private readonly onStatus: StatusHandler;

  constructor(onState: StateHandler, onStatus: StatusHandler) {
    this.onState = onState;
    this.onStatus = onStatus;
  }

  async connect(rawAddress: string): Promise<string> {
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
    this.rejectPendingRequests(new Error("连接已断开。"));
    socket?.close(1000, "Client disconnected");

    if (emitStatus) {
      this.onStatus({ phase: "idle", message: "未连接" });
    }
  }

  loginAccount(accountId: string): Promise<AccountAuthResult> {
    return this.sendAccountRequest({ type: "account:login", accountId });
  }

  registerAccount(accountId: string): Promise<AccountAuthResult> {
    return this.sendAccountRequest({ type: "account:register", accountId });
  }

  updateAccountProfile(profile: ProfileUpdateRequest): Promise<UserProfile> {
    if (this.pendingProfileRequest) {
      throw new Error("已有资料保存请求正在进行。");
    }

    return new Promise<UserProfile>((resolve, reject) => {
      this.pendingProfileRequest = { resolve, reject };
      try {
        this.send({ type: "account:updateProfile", profile });
      } catch (error) {
        this.pendingProfileRequest = null;
        reject(error instanceof Error ? error : new Error("资料保存失败。"));
      }
    });
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

  moveTaskToTrash(taskId: string): void {
    this.send({ type: "task:trash", taskId });
  }

  restoreTask(taskId: string): void {
    this.send({ type: "task:restore", taskId });
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
      const error = new Error(message.message);
      this.rejectPendingRequests(error);
      this.onStatus({ phase: "error", url: this.currentUrl, message: message.message });
      return;
    }

    if (
      message.type === "account:loginSuccess" ||
      message.type === "account:profileRequired" ||
      message.type === "account:registered"
    ) {
      this.onState(message.state);
      const pending = this.pendingAccountRequest;
      this.pendingAccountRequest = null;
      pending?.resolve({
        profile: message.profile,
        requiresProfileSetup: message.type !== "account:loginSuccess"
      });
      this.onStatus({
        phase: "connected",
        url: this.currentUrl,
        message: message.type === "account:loginSuccess" ? "已登录" : "请设置用户名和头像"
      });
      return;
    }

    if (message.type === "account:profileUpdated") {
      this.onState(message.state);
      const pending = this.pendingProfileRequest;
      this.pendingProfileRequest = null;
      pending?.resolve(message.profile);
      this.onStatus({ phase: "connected", url: this.currentUrl, message: "资料已更新" });
      return;
    }

    this.onState(message.state);
  }

  private sendAccountRequest(message: Extract<ClientToServerMessage, { type: "account:login" | "account:register" }>): Promise<AccountAuthResult> {
    if (this.pendingAccountRequest) {
      throw new Error("已有账号请求正在进行。");
    }

    return new Promise<AccountAuthResult>((resolve, reject) => {
      this.pendingAccountRequest = { resolve, reject };
      try {
        this.send(message);
      } catch (error) {
        this.pendingAccountRequest = null;
        reject(error instanceof Error ? error : new Error("账号请求失败。"));
      }
    });
  }

  private rejectPendingRequests(error: Error): void {
    this.pendingAccountRequest?.reject(error);
    this.pendingProfileRequest?.reject(error);
    this.pendingAccountRequest = null;
    this.pendingProfileRequest = null;
  }

  private send(message: ClientToServerMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("尚未连接主机。");
    }

    this.socket.send(JSON.stringify(message));
  }
}
