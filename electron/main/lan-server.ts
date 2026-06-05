import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import {
  ACCOUNT_ID_LENGTH,
  DEFAULT_PORT,
  MAX_TASK_SCREENSHOTS,
  TRASH_RETENTION_DAYS,
  type ClientToServerMessage,
  type HostData,
  type HostInfo,
  type ServerToClientMessage,
  type Task,
  type TaskScreenshot,
  type UserProfile
} from "../../src/shared/types";
import { HostDataStore } from "./data-store";

const ACCOUNT_ID_REGEX = new RegExp(`^\\d{${ACCOUNT_ID_LENGTH}}$`);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * MS_PER_DAY;
const TRASH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function getLanAddresses(port: number): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];

  for (const values of Object.values(interfaces)) {
    for (const value of values ?? []) {
      if (value.family === "IPv4" && !value.internal) {
        addresses.push(`http://${value.address}:${port}`);
      }
    }
  }

  return addresses;
}

function isProfileComplete(profile: UserProfile): boolean {
  return profile.profileComplete ?? profile.name.trim().length > 0;
}

function normalizeStoredUser(profile: UserProfile): UserProfile {
  const name = profile.name?.trim() ?? "";

  return {
    id: String(profile.id),
    name,
    avatarDataUrl: profile.avatarDataUrl,
    lastSeenAt: profile.lastSeenAt || new Date().toISOString(),
    profileComplete: profile.profileComplete ?? name.length > 0
  };
}

function createRegisteredProfile(accountId: string): UserProfile {
  return {
    id: accountId,
    name: "",
    lastSeenAt: new Date().toISOString(),
    profileComplete: false
  };
}

function validateAccountId(accountId: string): string {
  const cleanAccountId = accountId.trim();
  if (!ACCOUNT_ID_REGEX.test(cleanAccountId)) {
    throw new Error(`账号必须是 ${ACCOUNT_ID_LENGTH} 位数字。`);
  }

  return cleanAccountId;
}

function cloneState(data: HostData): HostData {
  return {
    users: data.users.map((user) => ({ ...user })),
    tasks: data.tasks.map((task) => ({
      ...task,
      screenshots: task.screenshots?.map((screenshot) => ({ ...screenshot }))
    }))
  };
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    description: task.description ?? "",
    screenshots: task.screenshots ?? []
  };
}

function isExpiredTrashedTask(task: Task, nowMs = Date.now()): boolean {
  if (!task.trashedAt) {
    return false;
  }

  const trashedAtMs = Date.parse(task.trashedAt);
  return Number.isFinite(trashedAtMs) && nowMs - trashedAtMs >= TRASH_RETENTION_MS;
}

function validateScreenshots(screenshots: TaskScreenshot[]): TaskScreenshot[] {
  if (screenshots.length > MAX_TASK_SCREENSHOTS) {
    throw new Error(`每个任务最多只能附加 ${MAX_TASK_SCREENSHOTS} 张截图。`);
  }

  return screenshots.map((screenshot) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(screenshot.mimeType)) {
      throw new Error("截图只支持 PNG、JPG 或 WebP。");
    }

    if (!screenshot.dataUrl.startsWith(`data:${screenshot.mimeType};base64,`)) {
      throw new Error("截图数据格式不正确。");
    }

    if (!Number.isFinite(screenshot.width) || !Number.isFinite(screenshot.height) || screenshot.width <= 0 || screenshot.height <= 0) {
      throw new Error("截图尺寸不正确。");
    }

    return {
      ...screenshot,
      name: screenshot.name.trim() || "screenshot",
      width: Math.round(screenshot.width),
      height: Math.round(screenshot.height)
    };
  });
}

export class LanServer {
  private data: HostData = { users: [], tasks: [] };
  private httpServer: Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly sessions = new Map<WebSocket, string>();
  private readonly store: HostDataStore;

  constructor(store: HostDataStore) {
    this.store = store;
  }

  async start(port = DEFAULT_PORT): Promise<HostInfo> {
    if (this.httpServer) {
      return this.getHostInfo(port);
    }

    this.data = await this.store.load();
    this.data = {
      users: this.data.users.map(normalizeStoredUser),
      tasks: this.data.tasks.map(normalizeTask)
    };
    await this.deleteExpiredTrashedTasks();

    this.httpServer = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          name: "cowork-agents-lan",
          status: "ok",
          websocket: `ws://${request.headers.host ?? `127.0.0.1:${port}`}`
        })
      );
    });

    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.wsServer.on("connection", (socket) => this.handleConnection(socket));
    this.startCleanupTimer();

    await new Promise<void>((resolve, reject) => {
      const server = this.httpServer;
      if (!server) {
        reject(new Error("Host server was not created."));
        return;
      }

      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE") {
          reject(new Error(`端口 ${port} 已被占用，请先关闭另一个主机实例。`));
          return;
        }
        reject(error);
      };

      const onListening = () => {
        server.off("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    });

    return this.getHostInfo(port);
  }

  async stop(): Promise<void> {
    const wsServer = this.wsServer;
    const httpServer = this.httpServer;
    this.wsServer = null;
    this.httpServer = null;
    this.sessions.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    wsServer?.clients.forEach((client) => client.close(1001, "Host stopped"));
    await new Promise<void>((resolve) => {
      wsServer?.close(() => resolve());
      if (!wsServer) {
        resolve();
      }
    });

    await new Promise<void>((resolve) => {
      httpServer?.close(() => resolve());
      if (!httpServer) {
        resolve();
      }
    });
  }

  private getHostInfo(port: number): HostInfo {
    const addresses = getLanAddresses(port);
    return {
      port,
      url: addresses[0] ?? `http://127.0.0.1:${port}`,
      addresses
    };
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      void this.deleteExpiredTrashedTasks()
        .then((deleted) => {
          if (deleted) {
            this.broadcast({ type: "state:update", state: cloneState(this.data) });
          }
        })
        .catch(() => undefined);
    }, TRASH_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (raw) => {
      void this.handleMessage(socket, raw.toString());
    });
    socket.on("close", () => {
      this.sessions.delete(socket);
    });
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let message: ClientToServerMessage;

    try {
      message = JSON.parse(raw) as ClientToServerMessage;
    } catch {
      this.send(socket, { type: "server:error", message: "收到无法解析的消息。" });
      return;
    }

    try {
      await this.deleteExpiredTrashedTasks();

      if (message.type === "account:login") {
        await this.loginAccount(socket, message.accountId);
        return;
      }

      if (message.type === "account:register") {
        await this.registerAccount(socket, message.accountId);
        return;
      }

      if (message.type === "account:updateProfile") {
        await this.updateCurrentProfile(socket, message.profile);
        return;
      }

      this.requireReadySession(socket);

      if (message.type === "task:create") {
        await this.createTask(message.title);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:toggle") {
        await this.toggleTask(message.taskId, message.completed);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:assign") {
        await this.assignTask(message.taskId, message.assigneeId);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:trash") {
        await this.moveTaskToTrash(message.taskId);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:restore") {
        await this.restoreTask(message.taskId);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:updateDetails") {
        await this.updateTaskDetails(message.taskId, message.title, message.description, message.screenshots);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
      }
    } catch (error) {
      this.send(socket, {
        type: "server:error",
        message: error instanceof Error ? error.message : "操作失败。"
      });
    }
  }

  private async loginAccount(socket: WebSocket, accountId: string): Promise<void> {
    const cleanAccountId = validateAccountId(accountId);
    const user = this.data.users.find((item) => item.id === cleanAccountId);

    if (!user) {
      throw new Error("账号不存在，请先注册。");
    }

    user.lastSeenAt = new Date().toISOString();
    await this.store.save(this.data);
    this.sessions.set(socket, cleanAccountId);

    const state = cloneState(this.data);
    this.send(socket, {
      type: isProfileComplete(user) ? "account:loginSuccess" : "account:profileRequired",
      profile: { ...user },
      state
    });
    this.broadcast({ type: "state:update", state });
  }

  private async registerAccount(socket: WebSocket, accountId: string): Promise<void> {
    const cleanAccountId = validateAccountId(accountId);
    const existingUser = this.data.users.find((item) => item.id === cleanAccountId);

    if (existingUser) {
      throw new Error("账号已存在，请直接登录。");
    }

    const profile = createRegisteredProfile(cleanAccountId);
    this.data.users.push(profile);
    await this.store.save(this.data);
    this.sessions.set(socket, cleanAccountId);

    const state = cloneState(this.data);
    this.send(socket, { type: "account:registered", profile: { ...profile }, state });
    this.broadcast({ type: "state:update", state });
  }

  private requireSession(socket: WebSocket): UserProfile {
    const accountId = this.sessions.get(socket);
    if (!accountId) {
      throw new Error("请先登录账号。");
    }

    const user = this.data.users.find((item) => item.id === accountId);
    if (!user) {
      this.sessions.delete(socket);
      throw new Error("账号信息不存在，请重新登录。");
    }

    return user;
  }

  private requireReadySession(socket: WebSocket): UserProfile {
    const user = this.requireSession(socket);
    if (!isProfileComplete(user)) {
      throw new Error("请先设置用户名和头像。");
    }

    return user;
  }

  private async updateCurrentProfile(socket: WebSocket, profile: { name: string; avatarDataUrl?: string }): Promise<void> {
    const user = this.requireSession(socket);
    const cleanName = profile.name.trim();

    if (!cleanName) {
      throw new Error("请输入用户名。");
    }

    user.name = cleanName;
    user.avatarDataUrl = profile.avatarDataUrl || undefined;
    user.profileComplete = true;
    user.lastSeenAt = new Date().toISOString();
    await this.store.save(this.data);

    const state = cloneState(this.data);
    this.send(socket, { type: "account:profileUpdated", profile: { ...user }, state });
    this.broadcast({ type: "state:update", state });
  }

  private findActiveTask(taskId: string): Task {
    const task = this.data.tasks.find((item) => item.id === taskId && !item.trashedAt);
    if (!task) {
      throw new Error("任务不存在或已不在列表中。");
    }

    return task;
  }

  private findRetainedTask(taskId: string): Task {
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error("任务不存在或已不在列表中。");
    }

    return task;
  }

  private async deleteExpiredTrashedTasks(): Promise<boolean> {
    const previousLength = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((task) => !isExpiredTrashedTask(task));

    if (this.data.tasks.length !== previousLength) {
      await this.store.save(this.data);
      return true;
    }

    return false;
  }

  private async createTask(title: string): Promise<void> {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new Error("任务标题不能为空。");
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title: cleanTitle,
      description: "",
      screenshots: [],
      completed: false,
      createdAt: now,
      updatedAt: now
    };

    this.data.tasks.push(task);
    await this.store.save(this.data);
  }

  private async toggleTask(taskId: string, completed: boolean): Promise<void> {
    const task = this.findActiveTask(taskId);

    task.completed = completed;
    task.updatedAt = new Date().toISOString();
    await this.store.save(this.data);
  }

  private async assignTask(taskId: string, assigneeId: string): Promise<void> {
    const task = this.findActiveTask(taskId);

    if (!this.data.users.some((user) => user.id === assigneeId && isProfileComplete(user))) {
      throw new Error("负责人不存在或尚未连接。");
    }

    task.assigneeId = assigneeId;
    task.updatedAt = new Date().toISOString();
    await this.store.save(this.data);
  }

  private async moveTaskToTrash(taskId: string): Promise<void> {
    const task = this.findActiveTask(taskId);
    const now = new Date().toISOString();

    task.trashedAt = now;
    task.updatedAt = now;
    await this.store.save(this.data);
  }

  private async restoreTask(taskId: string): Promise<void> {
    const task = this.findRetainedTask(taskId);
    const now = new Date().toISOString();

    if (!task.trashedAt) {
      return;
    }

    delete task.trashedAt;
    task.updatedAt = now;
    await this.store.save(this.data);
  }

  private async updateTaskDetails(taskId: string, title: string, description: string, screenshots: TaskScreenshot[]): Promise<void> {
    const task = this.findRetainedTask(taskId);

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new Error("任务标题不能为空。");
    }

    task.title = cleanTitle;
    task.description = description;
    task.screenshots = validateScreenshots(screenshots);
    task.updatedAt = new Date().toISOString();
    await this.store.save(this.data);
  }

  private broadcast(message: ServerToClientMessage): void {
    const payload = JSON.stringify(message);
    this.wsServer?.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    });
  }

  private send(socket: WebSocket, message: ServerToClientMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}

export function listLanUrls(port = DEFAULT_PORT): string[] {
  return getLanAddresses(port);
}
