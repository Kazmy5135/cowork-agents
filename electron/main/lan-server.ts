import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_PORT,
  MAX_TASK_SCREENSHOTS,
  type ClientToServerMessage,
  type HostData,
  type HostInfo,
  type ServerToClientMessage,
  type Task,
  type TaskScreenshot,
  type UserProfile
} from "../../src/shared/types";
import { HostDataStore } from "./data-store";

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

function normalizeProfile(profile: UserProfile): UserProfile {
  return {
    id: profile.id,
    name: profile.name.trim() || "Player",
    avatarDataUrl: profile.avatarDataUrl,
    lastSeenAt: new Date().toISOString()
  };
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
  private readonly store: HostDataStore;

  constructor(store: HostDataStore) {
    this.store = store;
  }

  async start(hostProfile: UserProfile, port = DEFAULT_PORT): Promise<HostInfo> {
    if (this.httpServer) {
      return this.getHostInfo(port);
    }

    this.data = await this.store.load();
    this.data = {
      users: this.data.users,
      tasks: this.data.tasks.map(normalizeTask)
    };
    await this.upsertUser(hostProfile);

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

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (raw) => {
      void this.handleMessage(socket, raw.toString());
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
      if (message.type === "client:join") {
        await this.upsertUser(message.profile);
        this.send(socket, { type: "state:full", state: cloneState(this.data) });
        this.broadcast({ type: "state:update", state: cloneState(this.data) });
        return;
      }

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

  private async upsertUser(profile: UserProfile): Promise<void> {
    const nextProfile = normalizeProfile(profile);
    const existingIndex = this.data.users.findIndex((user) => user.id === nextProfile.id);

    if (existingIndex >= 0) {
      this.data.users[existingIndex] = {
        ...this.data.users[existingIndex],
        ...nextProfile
      };
    } else {
      this.data.users.push(nextProfile);
    }

    await this.store.save(this.data);
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
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error("任务不存在或已不在列表中。");
    }

    task.completed = completed;
    task.updatedAt = new Date().toISOString();
    await this.store.save(this.data);
  }

  private async assignTask(taskId: string, assigneeId: string): Promise<void> {
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error("任务不存在或已不在列表中。");
    }

    if (!this.data.users.some((user) => user.id === assigneeId)) {
      throw new Error("负责人不存在或尚未连接。");
    }

    task.assigneeId = assigneeId;
    task.updatedAt = new Date().toISOString();
    await this.store.save(this.data);
  }

  private async updateTaskDetails(taskId: string, title: string, description: string, screenshots: TaskScreenshot[]): Promise<void> {
    const task = this.data.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new Error("任务不存在或已不在列表中。");
    }

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
