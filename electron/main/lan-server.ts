import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import {
  ACCOUNT_ID_LENGTH,
  DEFAULT_PORT,
  DEFAULT_VERSION_NAME,
  MAX_TASK_SCREENSHOTS,
  MAX_VERSION_NAME_LENGTH,
  TRASH_RETENTION_DAYS,
  type ClientToServerMessage,
  type HostData,
  type HostInfo,
  type ServerToClientMessage,
  type Task,
  type TaskScreenshot,
  type TaskVersion,
  type UserProfile
} from "../../src/shared/types";
import { HostDataStore } from "./data-store";

const ACCOUNT_ID_REGEX = new RegExp(`^\\d{${ACCOUNT_ID_LENGTH}}$`);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * MS_PER_DAY;
const TRASH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_VERSION_ID = "default-version";

function normalizeTaskPriority(priority: unknown, fallback = 0): number {
  return typeof priority === "number" && Number.isSafeInteger(priority) && priority >= 0 ? priority : fallback;
}

function validateTaskPriority(priority: number): number {
  if (!Number.isSafeInteger(priority) || priority < 0) {
    throw new Error("任务优先级必须是非负整数。");
  }

  return priority;
}

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

function createDefaultVersion(now = new Date().toISOString()): TaskVersion {
  return {
    id: DEFAULT_VERSION_ID,
    name: DEFAULT_VERSION_NAME,
    createdAt: now,
    updatedAt: now,
    isDefault: true
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
    versions: data.versions.map((version) => ({ ...version })),
    currentVersionId: data.currentVersionId,
    tasks: data.tasks.map((task) => ({
      ...task,
      screenshots: task.screenshots?.map((screenshot) => ({ ...screenshot }))
    }))
  };
}

function normalizeVersion(version: TaskVersion, now: string, fallbackName: string): TaskVersion {
  const id = typeof version.id === "string" && version.id.trim() ? version.id : randomUUID();
  const name = typeof version.name === "string" && version.name.trim() ? version.name.trim().slice(0, MAX_VERSION_NAME_LENGTH) : fallbackName;
  const createdAt = typeof version.createdAt === "string" && version.createdAt ? version.createdAt : now;

  return {
    id,
    name,
    createdAt,
    updatedAt: typeof version.updatedAt === "string" && version.updatedAt ? version.updatedAt : createdAt,
    isDefault: version.isDefault || undefined
  };
}

function normalizeTask(task: Task, fallbackVersionId: string, validVersionIds: Set<string>): Task {
  const versionId = validVersionIds.has(task.versionId) ? task.versionId : fallbackVersionId;
  const lastUpdatedById = typeof task.lastUpdatedById === "string" && task.lastUpdatedById.trim() ? task.lastUpdatedById.trim() : undefined;

  return {
    ...task,
    versionId,
    description: task.description ?? "",
    screenshots: task.screenshots ?? [],
    priority: normalizeTaskPriority(task.priority),
    lastUpdatedById
  };
}

function normalizeHostData(data: HostData): HostData {
  const now = new Date().toISOString();
  const seenVersionIds = new Set<string>();
  const versions = (Array.isArray(data.versions) ? data.versions : [])
    .map((version, index) => normalizeVersion(version, now, index === 0 ? DEFAULT_VERSION_NAME : `版本 ${index + 1}`))
    .map((version) => {
      if (!seenVersionIds.has(version.id)) {
        seenVersionIds.add(version.id);
        return version;
      }

      const id = randomUUID();
      seenVersionIds.add(id);
      return { ...version, id };
    });

  if (versions.length === 0) {
    versions.push(createDefaultVersion(now));
  }

  const defaultVersion = versions.find((version) => version.isDefault) ?? versions[0];
  versions.forEach((version) => {
    version.isDefault = version.id === defaultVersion.id || undefined;
  });

  const validVersionIds = new Set(versions.map((version) => version.id));
  const fallbackVersionId = defaultVersion.id;
  const currentVersionId = validVersionIds.has(data.currentVersionId) ? data.currentVersionId : fallbackVersionId;
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).map((task) => normalizeTask(task, fallbackVersionId, validVersionIds));

  return {
    users: (Array.isArray(data.users) ? data.users : []).map(normalizeStoredUser),
    versions,
    currentVersionId,
    tasks
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

function validateVersionName(name: string): string {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("版本名称不能为空。");
  }

  if (cleanName.length > MAX_VERSION_NAME_LENGTH) {
    throw new Error(`版本名称最多 ${MAX_VERSION_NAME_LENGTH} 个字。`);
  }

  return cleanName;
}

export class LanServer {
  private data: HostData = { users: [], versions: [], currentVersionId: "", tasks: [] };
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

    this.data = normalizeHostData(await this.store.load());
    await this.store.save(this.data);
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

      const currentUser = this.requireReadySession(socket);

      if (message.type === "version:create") {
        await this.createVersion(message.name);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "version:rename") {
        await this.renameVersion(message.versionId, message.name);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "version:delete") {
        await this.deleteVersion(message.versionId, currentUser.id);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "version:reorder") {
        await this.reorderVersions(message.versionIds);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "version:switch") {
        await this.switchVersion(message.versionId);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:create") {
        await this.createTask(message.title, currentUser.id);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:toggle") {
        await this.toggleTask(message.taskId, message.completed, currentUser.id);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:assign") {
        await this.assignTask(message.taskId, message.assigneeId, currentUser.id);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:moveVersion") {
        await this.moveTaskToVersion(message.taskId, message.versionId, currentUser.id);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:trash") {
        await this.moveTaskToTrash(message.taskId, currentUser.id);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:restore") {
        await this.restoreTask(message.taskId, currentUser.id);
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

      if (message.type === "task:updateDetails") {
        await this.updateTaskDetails(
          message.taskId,
          message.title,
          message.description,
          message.screenshots,
          message.priority,
          currentUser.id
        );
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

  private findVersion(versionId: string): TaskVersion {
    const version = this.data.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new Error("版本不存在。");
    }

    return version;
  }

  private getDefaultVersion(): TaskVersion {
    const defaultVersion = this.data.versions.find((version) => version.isDefault) ?? this.data.versions[0];
    if (!defaultVersion) {
      const now = new Date().toISOString();
      const nextDefaultVersion = createDefaultVersion(now);
      this.data.versions.push(nextDefaultVersion);
      this.data.currentVersionId = nextDefaultVersion.id;
      return nextDefaultVersion;
    }

    defaultVersion.isDefault = true;
    return defaultVersion;
  }

  private getCurrentVersion(): TaskVersion {
    const currentVersion = this.data.versions.find((version) => version.id === this.data.currentVersionId);
    if (currentVersion) {
      return currentVersion;
    }

    const defaultVersion = this.getDefaultVersion();
    this.data.currentVersionId = defaultVersion.id;
    return defaultVersion;
  }

  private async createVersion(name: string): Promise<void> {
    const cleanName = validateVersionName(name);
    const now = new Date().toISOString();

    const version: TaskVersion = {
      id: randomUUID(),
      name: cleanName,
      createdAt: now,
      updatedAt: now
    };

    this.data.versions.push(version);
    this.data.currentVersionId = version.id;
    await this.store.save(this.data);
  }

  private async renameVersion(versionId: string, name: string): Promise<void> {
    const version = this.findVersion(versionId);
    version.name = validateVersionName(name);
    version.updatedAt = new Date().toISOString();
    await this.store.save(this.data);
  }

  private async deleteVersion(versionId: string, updatedById: string): Promise<void> {
    const version = this.findVersion(versionId);
    if (this.data.versions.length <= 1) {
      throw new Error("至少需要保留一个版本。");
    }

    if (version.isDefault) {
      throw new Error("默认版本不能删除。");
    }

    const defaultVersion = this.getDefaultVersion();
    const now = new Date().toISOString();
    this.data.tasks.forEach((task) => {
      if (task.versionId === version.id) {
        task.versionId = defaultVersion.id;
        task.updatedAt = now;
        task.lastUpdatedById = updatedById;
      }
    });
    this.data.versions = this.data.versions.filter((item) => item.id !== version.id);

    if (this.data.currentVersionId === version.id) {
      this.data.currentVersionId = defaultVersion.id;
    }

    await this.store.save(this.data);
  }

  private async reorderVersions(versionIds: string[]): Promise<void> {
    if (!Array.isArray(versionIds) || versionIds.length !== this.data.versions.length) {
      throw new Error("版本排序数据无效。");
    }

    const versionsById = new Map(this.data.versions.map((version) => [version.id, version]));
    const seenVersionIds = new Set<string>();
    const nextVersions = versionIds.map((versionId) => {
      if (seenVersionIds.has(versionId)) {
        throw new Error("版本排序数据重复。");
      }

      const version = versionsById.get(versionId);
      if (!version) {
        throw new Error("版本排序数据无效。");
      }

      seenVersionIds.add(versionId);
      return version;
    });

    this.data.versions = nextVersions;
    await this.store.save(this.data);
  }

  private async switchVersion(versionId: string): Promise<void> {
    const version = this.findVersion(versionId);
    this.data.currentVersionId = version.id;
    await this.store.save(this.data);
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

  private async createTask(title: string, creatorId: string): Promise<void> {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new Error("任务标题不能为空。");
    }

    const now = new Date().toISOString();
    const currentVersion = this.getCurrentVersion();
    const task: Task = {
      id: randomUUID(),
      versionId: currentVersion.id,
      title: cleanTitle,
      description: "",
      screenshots: [],
      creatorId,
      assigneeId: creatorId,
      completed: false,
      priority: 0,
      lastUpdatedById: creatorId,
      createdAt: now,
      updatedAt: now
    };

    this.data.tasks.push(task);
    await this.store.save(this.data);
  }

  private async toggleTask(taskId: string, completed: boolean, updatedById: string): Promise<void> {
    const task = this.findActiveTask(taskId);
    const now = new Date().toISOString();

    task.completed = completed;
    if (completed) {
      task.completedAt = now;
    } else {
      delete task.completedAt;
    }
    task.updatedAt = now;
    task.lastUpdatedById = updatedById;
    await this.store.save(this.data);
  }

  private async assignTask(taskId: string, assigneeId: string, updatedById: string): Promise<void> {
    const task = this.findActiveTask(taskId);

    if (!this.data.users.some((user) => user.id === assigneeId && isProfileComplete(user))) {
      throw new Error("负责人不存在或尚未连接。");
    }

    task.assigneeId = assigneeId;
    task.updatedAt = new Date().toISOString();
    task.lastUpdatedById = updatedById;
    await this.store.save(this.data);
  }

  private async moveTaskToVersion(taskId: string, versionId: string, updatedById: string): Promise<void> {
    const task = this.findActiveTask(taskId);
    const version = this.findVersion(versionId);

    if (task.versionId === version.id) {
      return;
    }

    task.versionId = version.id;
    task.updatedAt = new Date().toISOString();
    task.lastUpdatedById = updatedById;
    await this.store.save(this.data);
  }

  private async moveTaskToTrash(taskId: string, updatedById: string): Promise<void> {
    const task = this.findActiveTask(taskId);
    const now = new Date().toISOString();

    task.trashedAt = now;
    task.updatedAt = now;
    task.lastUpdatedById = updatedById;
    await this.store.save(this.data);
  }

  private async restoreTask(taskId: string, updatedById: string): Promise<void> {
    const task = this.findRetainedTask(taskId);
    const now = new Date().toISOString();

    if (!task.trashedAt) {
      return;
    }

    delete task.trashedAt;
    task.updatedAt = now;
    task.lastUpdatedById = updatedById;
    await this.store.save(this.data);
  }

  private async updateTaskDetails(
    taskId: string,
    title: string,
    description: string,
    screenshots: TaskScreenshot[],
    priority: number | undefined,
    updatedById: string
  ): Promise<void> {
    const task = this.findRetainedTask(taskId);

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new Error("任务标题不能为空。");
    }

    task.title = cleanTitle;
    task.description = description;
    task.screenshots = validateScreenshots(screenshots);
    task.priority = priority === undefined ? normalizeTaskPriority(task.priority) : validateTaskPriority(priority);
    task.updatedAt = new Date().toISOString();
    task.lastUpdatedById = updatedById;
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
