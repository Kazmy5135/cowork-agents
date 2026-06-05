import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray, type NativeImage } from "electron";
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
let tray: Tray | null = null;
let appIcon: NativeImage | null = null;
let lastMainWindowBounds: { x: number; y: number; width: number; height: number } | null = null;
let isMainWindowCompact = false;
let isQuitting = false;
let profileStore: ProfileStore;
let hostStore: HostDataStore;
let lanServer: LanServer | null = null;
let lanClient: LanClient | null = null;
let currentHostInfo: HostInfo | null = null;
let latestState: HostData = { users: [], tasks: [] };
const detailWindows = new Map<string, BrowserWindow>();
const trayIconBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACwElEQVR4nL3XYUsUURQG4PcH7Mf34/yk+SvztSgaKlpUFAcVxURRVDRNTbM1s8zcTFPTdFUURcVBRVFUNiqKohM37uC0zaxjO7v367L77Mw995z3gjcEvPkLvPUTvP0DvPMdtL+Bd7+C976A9z+DDz6BySxYdgGWnxusODNZeWqx6sRm9bFN58hizaHJ2gODdftgvQs27IGNu+DDHbBpG2zeAls2wdYNsG0dbF8DO1YRFTdYdmGz/DzDijNh5amw6kRYfSx0joQ1h8LaA2HdvrDezbBhz2bjrnEVzs4VXIUnmMw6LLsQlp9LBFzYsCds3BU+3BE2bTts3kqE4exaRj7cZDLrFoALm7eELZsuWzfMIJzdSwjDLSazEgMubN0Qtq0L29esXJw9iygVLuxYFXauWH6cvQsIeu3FwoVdy8LuJdPD2TeP3IKLY8/z4cKeRZe9CwmFs38O/qNWSLVHxYW9C8K+eUfhHJiF/5yXChf2zwkHZg0OzsDrcHaJceHgjM2haXjtNUqHixMXDk1nODwFr7cXDc9dGhcOTwmfvTWgB0tJ8D9/4BIXptIm9FSLFc+3fLjw+RsLeqQG4v98uQA858kVLhydsKHneeCTh/5YPLhwbNyGDhOBr/2q5eGhn/9dcLm48OUrCzrJ5N3z/1kRcOH4mAkdoyIVXMy48PULAzrDZa5T7aHwZZOJgmc4MQovQNqFHrVr4sKJUZuTI/DSqxFTe42KCydHDKZT8Ednp4S4o3BODcOf2xM6QBYbd5lOJRTOd0+Rm9vNIuPCdMr0cE4PIejSYBURt/w43z9B2I3FKgXO2QGE3lh0enVj2nMzCOd8H8JwL7cndIAspNoTYTg/PEY+HF501gHS1jEqSoezvXOeD+diD6LgUOlVBUiV4VSMUklGhQk1z9VIVVNNDRbV21V7VR0uCs6Pj/AbBPOQwE6+/N8AAAAASUVORK5CYII=";
const MAIN_WINDOW_SIZE = {
  width: 500,
  height: 272
};
const COMPACT_WINDOW_SIZE = {
  width: 72,
  height: 87
};

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

function glassWindowMaterial() {
  return {};
}

function createFallbackIconImage(): NativeImage {
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${trayIconBase64}`);

  return image;
}

async function loadAppIcon(): Promise<void> {
  try {
    const executableIcon = await app.getFileIcon(process.execPath, { size: "normal" });
    if (!executableIcon.isEmpty()) {
      appIcon = executableIcon;
      return;
    }
  } catch {
    // Fall back to the bundled image when Windows cannot resolve the executable icon.
  }

  appIcon = createFallbackIconImage();
}

function getAppIcon(): NativeImage {
  if (!appIcon || appIcon.isEmpty()) {
    appIcon = createFallbackIconImage();
  }

  return appIcon;
}

function createTrayImage(): NativeImage {
  const image = getAppIcon();

  return process.platform === "win32" ? image.resize({ width: 16, height: 16 }) : image;
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }

  const isMainWindowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isMainWindowVisible ? "隐藏到托盘" : "显示主窗口",
        click: () => {
          if (isMainWindowVisible) {
            hideMainWindowToTray();
          } else {
            showMainWindow();
          }
        }
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitApplication();
        }
      }
    ])
  );
}

function positionMainWindowNearTray(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const bounds = mainWindow.getBounds();
  mainWindow.setPosition(workArea.x + workArea.width - bounds.width - 16, workArea.y + workArea.height - bounds.height - 16, false);
}

function rememberMainWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (isMainWindowCompact) {
    return;
  }

  lastMainWindowBounds = mainWindow.isMinimized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
}

function restoreMainWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !lastMainWindowBounds) {
    return;
  }

  mainWindow.setBounds(lastMainWindowBounds, false);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function getCompactBounds(normalBounds: { x: number; y: number; width: number; height: number }) {
  const display = screen.getDisplayMatching(normalBounds);
  const workArea = display.workArea;
  const width = COMPACT_WINDOW_SIZE.width;
  const height = COMPACT_WINDOW_SIZE.height;

  return {
    width,
    height,
    x: clamp(normalBounds.x + normalBounds.width - width, workArea.x, workArea.x + workArea.width - width),
    y: clamp(normalBounds.y + normalBounds.height - height, workArea.y, workArea.y + workArea.height - height)
  };
}

function setMainWindowCompact(compact: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (compact === isMainWindowCompact) {
    mainWindow.webContents.send("window:compact-mode", compact);
    return;
  }

  if (compact) {
    rememberMainWindowBounds();
    const normalBounds = lastMainWindowBounds ?? mainWindow.getBounds();
    isMainWindowCompact = true;
    mainWindow.setBounds(getCompactBounds(normalBounds), false);
  } else {
    isMainWindowCompact = false;
    restoreMainWindowBounds();
    mainWindow.show();
    mainWindow.focus();
  }

  mainWindow.webContents.send("window:compact-mode", compact);
  updateTrayMenu();
}

function moveMainCompactWindowBy(deltaX: number, deltaY: number): void {
  if (!mainWindow || mainWindow.isDestroyed() || !isMainWindowCompact) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const workArea = display.workArea;
  mainWindow.setPosition(
    clamp(bounds.x + Math.round(deltaX), workArea.x, workArea.x + workArea.width - bounds.width),
    clamp(bounds.y + Math.round(deltaY), workArea.y, workArea.y + workArea.height - bounds.height),
    false
  );
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  const wasCompact = isMainWindowCompact;
  mainWindow?.restore();
  if (wasCompact) {
    setMainWindowCompact(false);
  } else {
    restoreMainWindowBounds();
  }
  mainWindow?.show();
  mainWindow?.focus();
  updateTrayMenu();
}

function hideMainWindowToTray(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  rememberMainWindowBounds();
  mainWindow.hide();
  updateTrayMenu();
}

function quitApplication(): void {
  isQuitting = true;
  app.quit();
}

function createTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayImage());
  tray.setToolTip("Cowork Agents LAN");
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  updateTrayMenu();
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
    icon: getAppIcon(),
    frame: false,
    transparent: true,
    hasShadow: false,
    title: "任务详情",
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    ...glassWindowMaterial(),
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
  isMainWindowCompact = false;
  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_SIZE.width,
    height: MAIN_WINDOW_SIZE.height,
    resizable: false,
    icon: getAppIcon(),
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    ...glassWindowMaterial(),
    title: "协作任务",
    webPreferences: {
      preload: join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  positionMainWindowNearTray();

  loadRenderer(mainWindow);

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    hideMainWindowToTray();
  });
  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);
  mainWindow.on("closed", () => {
    mainWindow = null;
    updateTrayMenu();
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

  ipcMain.handle("task:trash", (_event, taskId: string) => {
    getClient().moveTaskToTrash(taskId);
  });

  ipcMain.handle("task:restore", (_event, taskId: string) => {
    getClient().restoreTask(taskId);
  });

  ipcMain.handle("task:update-details", (_event, taskId: string, title: string, description: string, screenshots: TaskScreenshot[]) => {
    getClient().updateTaskDetails(taskId, title, description, screenshots);
  });

  ipcMain.handle("task:open-detail", (_event, taskId: string) => {
    openTaskDetailWindow(taskId);
  });

  ipcMain.handle("window:minimize", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (targetWindow === mainWindow) {
      setMainWindowCompact(true);
      return;
    }

    targetWindow?.minimize();
  });
  ipcMain.handle("window:restore", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (targetWindow === mainWindow) {
      setMainWindowCompact(false);
      return;
    }

    targetWindow?.restore();
  });
  ipcMain.handle("window:move-compact-by", (_event, deltaX: number, deltaY: number) => {
    moveMainCompactWindowBy(deltaX, deltaY);
  });
  ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("window:set-always-on-top", (_event, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(enabled, "floating");
    return enabled;
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.projectmoga.coworkagentslan");
  await loadAppIcon();
  profileStore = new ProfileStore(app.getPath("userData"));
  hostStore = new HostDataStore(app.getPath("userData"));
  registerIpc();
  createTray();
  createWindow();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && (!tray || isQuitting)) {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  getClient().disconnect(false);
  void lanServer?.stop();
});
