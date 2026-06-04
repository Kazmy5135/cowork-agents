import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PORT,
  type ConnectionStatus,
  type HostData,
  type HostInfo,
  type TaskScreenshot,
  type UserProfile
} from "../../src/shared/types";
import { HostDataStore, ProfileStore } from "./data-store";
import { LanClient } from "./lan-client";
import { LanServer, listLanUrls } from "./lan-server";

let mainWindow: BrowserWindow | null = null;
let profileStore: ProfileStore;
let hostStore: HostDataStore;
let lanServer: LanServer | null = null;
let lanClient: LanClient | null = null;
let currentHostInfo: HostInfo | null = null;
let latestState: HostData = { users: [], tasks: [] };
const detailWindows = new Map<string, BrowserWindow>();

function emitState(state: HostData): void {
  latestState = state;
  mainWindow?.webContents.send("state:update", state);
  detailWindows.forEach((detailWindow) => detailWindow.webContents.send("state:update", state));
}

function emitStatus(status: ConnectionStatus): void {
  mainWindow?.webContents.send("connection:status", status);
}

function emitHostInfo(info: HostInfo | null): void {
  mainWindow?.webContents.send("host:info", info);
}

function getClient(): LanClient {
  if (!lanClient) {
    lanClient = new LanClient(emitState, emitStatus);
  }

  return lanClient;
}

function normalizeProfile(profile: Partial<UserProfile>): UserProfile {
  const now = new Date().toISOString();
  return {
    id: profile.id || randomUUID(),
    name: profile.name?.trim() || "Player",
    avatarDataUrl: profile.avatarDataUrl,
    lastSeenAt: now
  };
}

function loadRenderer(targetWindow: BrowserWindow, query?: Record<string, string>): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
    void targetWindow.loadURL(url.toString());
    return;
  }

  void targetWindow.loadFile(join(app.getAppPath(), "dist-renderer", "index.html"), { query });
}

function openTaskDetailWindow(taskId: string): void {
  const existingWindow = detailWindows.get(taskId);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return;
  }

  const detailWindow = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 620,
    minHeight: 600,
    title: "任务详情",
    backgroundColor: "#171b24",
    webPreferences: {
      preload: join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  detailWindows.set(taskId, detailWindow);
  loadRenderer(detailWindow, { view: "detail", taskId });
  detailWindow.webContents.once("did-finish-load", () => {
    detailWindow.webContents.send("state:update", latestState);
  });
  detailWindow.on("closed", () => {
    detailWindows.delete(taskId);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 272,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    title: "协作任务",
    webPreferences: {
      preload: join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, "floating");

  loadRenderer(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("state:get", () => latestState);

  ipcMain.handle("profile:get", async () => profileStore.load());

  ipcMain.handle("profile:save", async (_event, profile: Partial<UserProfile>) => {
    const nextProfile = normalizeProfile(profile);
    await profileStore.save(nextProfile);
    return nextProfile;
  });

  ipcMain.handle("network:addresses", () => listLanUrls(DEFAULT_PORT));

  ipcMain.handle("host:start", async (_event, profile: UserProfile) => {
    if (!lanServer) {
      lanServer = new LanServer(hostStore);
    }

    currentHostInfo = await lanServer.start(normalizeProfile(profile), DEFAULT_PORT);
    emitHostInfo(currentHostInfo);
    await getClient().connect(`ws://127.0.0.1:${currentHostInfo.port}`, normalizeProfile(profile));
    return currentHostInfo;
  });

  ipcMain.handle("host:stop", async () => {
    getClient().disconnect();
    await lanServer?.stop();
    lanServer = null;
    currentHostInfo = null;
    emitHostInfo(null);
  });

  ipcMain.handle("client:join", async (_event, address: string, profile: UserProfile) => {
    const connectedUrl = await getClient().connect(address, normalizeProfile(profile));
    return connectedUrl;
  });

  ipcMain.handle("client:disconnect", () => {
    getClient().disconnect();
  });

  ipcMain.handle("task:create", (_event, title: string) => {
    getClient().createTask(title);
  });

  ipcMain.handle("task:toggle", (_event, taskId: string, completed: boolean) => {
    getClient().toggleTask(taskId, completed);
  });

  ipcMain.handle("task:assign", (_event, taskId: string, assigneeId: string) => {
    getClient().assignTask(taskId, assigneeId);
  });

  ipcMain.handle("task:update-details", (_event, taskId: string, title: string, description: string, screenshots: TaskScreenshot[]) => {
    getClient().updateTaskDetails(taskId, title, description, screenshots);
  });

  ipcMain.handle("task:open-detail", (_event, taskId: string) => {
    openTaskDetailWindow(taskId);
  });

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("window:set-always-on-top", (_event, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(enabled, "floating");
    return enabled;
  });
}

app.whenReady().then(() => {
  profileStore = new ProfileStore(app.getPath("userData"));
  hostStore = new HostDataStore(app.getPath("userData"));
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  getClient().disconnect(false);
  void lanServer?.stop();
});
