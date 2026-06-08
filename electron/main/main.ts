import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, Tray, type NativeImage } from "electron";
import log from "electron-log/main";
import { autoUpdater, type AppUpdater, type ProgressInfo, type UpdateInfo, type VerifyUpdateCodeSignature } from "electron-updater";
import { join } from "node:path";
import {
  DEFAULT_PORT,
  type AppUpdateState,
  type AppPreferences,
  type ConnectionStatus,
  type HostData,
  type HostInfo,
  type ProfileUpdateRequest,
  type TaskScreenshot
} from "../../src/shared/types";
import { AppPreferencesStore, HostDataStore } from "./data-store";
import { LanClient } from "./lan-client";
import { LanServer, listLanUrls } from "./lan-server";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let appIcon: NativeImage | null = null;
let lastMainWindowBounds: { x: number; y: number; width: number; height: number } | null = null;
let isMainWindowCompact = false;
let isQuitting = false;
let hostStore: HostDataStore;
let preferencesStore: AppPreferencesStore;
let lanServer: LanServer | null = null;
let lanClient: LanClient | null = null;
let currentHostInfo: HostInfo | null = null;
let latestState: HostData = { users: [], versions: [], currentVersionId: "", tasks: [] };
let updateState: AppUpdateState = { phase: "idle", currentVersion: app.getVersion() };
let autoUpdaterConfigured = false;
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
type MainWindowResizeEdge = "top" | "bottom";

function emitState(state: HostData): void {
  latestState = state;
  mainWindow?.webContents.send("state:update", state);
  detailWindows.forEach((detailWindow) => detailWindow.webContents.send("state:update", state));
}

function emitStatus(status: ConnectionStatus): void {
  mainWindow?.webContents.send("connection:status", status);
}

function emitUpdateState(state: AppUpdateState): void {
  mainWindow?.webContents.send("update:state", state);
  detailWindows.forEach((detailWindow) => detailWindow.webContents.send("update:state", state));
}

function clearUpdateProgress(phase: AppUpdateState["phase"]): boolean {
  return phase !== "downloading";
}

function setUpdateState(nextState: Omit<AppUpdateState, "currentVersion"> & { currentVersion?: string }): AppUpdateState {
  updateState = {
    currentVersion: app.getVersion(),
    ...nextState,
    percent: clearUpdateProgress(nextState.phase) ? undefined : nextState.percent
  };
  emitUpdateState(updateState);
  return updateState;
}

function getUpdateVersion(info?: UpdateInfo | null): string | undefined {
  return info?.version || undefined;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return fallback;
}

function configureAutoUpdater(): void {
  if (autoUpdaterConfigured) {
    return;
  }

  autoUpdaterConfigured = true;
  log.initialize();
  log.transports.file.level = "info";
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  if (process.platform === "win32") {
    const unsignedUpdater = autoUpdater as AppUpdater & {
      verifyUpdateCodeSignature?: VerifyUpdateCodeSignature;
    };
    unsignedUpdater.verifyUpdateCodeSignature = async () => null;
  }

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      phase: "checking",
      message: "正在检查更新..."
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      phase: "available",
      latestVersion: getUpdateVersion(info),
      message: "发现新版本，正在下载..."
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdateState({
      phase: "not-available",
      latestVersion: getUpdateVersion(info),
      message: "已是最新版本。"
    });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    setUpdateState({
      phase: "downloading",
      latestVersion: updateState.latestVersion,
      percent: Math.max(0, Math.min(100, progress.percent)),
      message: "正在下载更新..."
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      phase: "downloaded",
      latestVersion: getUpdateVersion(info) ?? updateState.latestVersion,
      message: "更新已下载完成，重启应用后安装。"
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({
      phase: "error",
      latestVersion: updateState.latestVersion,
      message: getErrorMessage(error, "检查更新失败。")
    });
  });
}

async function checkForAppUpdates(): Promise<AppUpdateState> {
  configureAutoUpdater();

  if (!app.isPackaged) {
    return setUpdateState({
      phase: "error",
      message: "仅 release 版支持检查更新。"
    });
  }

  if (updateState.phase === "checking" || updateState.phase === "downloading" || updateState.phase === "downloaded") {
    return updateState;
  }

  try {
    setUpdateState({
      phase: "checking",
      message: "正在检查更新..."
    });
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    return setUpdateState({
      phase: "error",
      latestVersion: updateState.latestVersion,
      message: getErrorMessage(error, "检查更新失败。")
    });
  }
}

function installDownloadedUpdate(): void {
  configureAutoUpdater();

  if (updateState.phase !== "downloaded") {
    setUpdateState({
      phase: "error",
      latestVersion: updateState.latestVersion,
      message: "更新还没有下载完成。"
    });
    return;
  }

  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
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

function formatJoinAddressForInput(address: string): string {
  const trimmed = address.trim();

  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed;
  }
}

async function rememberPreferences(preferences: Partial<AppPreferences>): Promise<void> {
  try {
    await preferencesStore.patch(preferences);
  } catch {
    // Remembering convenience inputs should never block connection or login.
  }
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

function clampWindowAxis(value: number, min: number, max: number): number {
  return max <= min ? min : clamp(value, min, max);
}

function rememberMainWindowBoundsFrom(bounds: { x: number; y: number; width: number; height: number }): void {
  if (!isMainWindowCompact) {
    lastMainWindowBounds = bounds;
  }
}

function resetMainWindowSize(): void {
  if (!mainWindow || mainWindow.isDestroyed() || isMainWindowCompact) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const width = MAIN_WINDOW_SIZE.width;
  const height = Math.min(MAIN_WINDOW_SIZE.height, workArea.height);
  const nextBounds = {
    width,
    height,
    x: clampWindowAxis(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clampWindowAxis(bounds.y, workArea.y, workArea.y + workArea.height - height)
  };

  mainWindow.setBounds(nextBounds, false);
  rememberMainWindowBoundsFrom(nextBounds);
}

function resizeMainWindowY(edge: MainWindowResizeEdge, deltaY: number): void {
  if (!mainWindow || mainWindow.isDestroyed() || isMainWindowCompact) {
    return;
  }

  const roundedDeltaY = Math.round(deltaY);
  if (roundedDeltaY === 0) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const width = MAIN_WINDOW_SIZE.width;
  const minHeight = Math.min(MAIN_WINDOW_SIZE.height, workArea.height);
  let nextY = bounds.y;
  let nextHeight = bounds.height;

  if (edge === "top") {
    const currentBottom = clampWindowAxis(bounds.y + bounds.height, workArea.y + minHeight, workArea.y + workArea.height);
    nextY = clampWindowAxis(bounds.y + roundedDeltaY, workArea.y, currentBottom - minHeight);
    nextHeight = currentBottom - nextY;
  } else {
    nextY = clampWindowAxis(bounds.y, workArea.y, workArea.y + workArea.height - minHeight);
    nextHeight = clampWindowAxis(bounds.height + roundedDeltaY, minHeight, workArea.y + workArea.height - nextY);
  }

  const nextBounds = {
    width,
    height: nextHeight,
    x: clampWindowAxis(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: nextY
  };

  mainWindow.setBounds(nextBounds, false);
  rememberMainWindowBoundsFrom(nextBounds);
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
    mainWindow.setSkipTaskbar(compact);
    mainWindow.webContents.send("window:compact-mode", compact);
    return;
  }

  if (compact) {
    rememberMainWindowBounds();
    const normalBounds = lastMainWindowBounds ?? mainWindow.getBounds();
    isMainWindowCompact = true;
    mainWindow.setSkipTaskbar(true);
    mainWindow.setBounds(getCompactBounds(normalBounds), false);
  } else {
    isMainWindowCompact = false;
    mainWindow.setSkipTaskbar(false);
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
    mainWindow?.setSkipTaskbar(false);
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
  mainWindow.setSkipTaskbar(true);
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
    setMainWindowCompact(true);
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

  ipcMain.handle("preferences:get", () => preferencesStore.load());

  ipcMain.handle("preferences:patch", (_event, preferences: Partial<AppPreferences>) => preferencesStore.patch(preferences));

  ipcMain.handle("network:addresses", () => listLanUrls(DEFAULT_PORT));

  ipcMain.handle("update:get-state", () => updateState);

  ipcMain.handle("update:check", () => checkForAppUpdates());

  ipcMain.handle("update:install", () => {
    installDownloadedUpdate();
  });

  ipcMain.handle("clipboard:write-text", (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle("host:start", async () => {
    if (!lanServer) {
      lanServer = new LanServer(hostStore);
    }

    currentHostInfo = await lanServer.start(DEFAULT_PORT);
    emitHostInfo(currentHostInfo);
    await getClient().connect(`ws://127.0.0.1:${currentHostInfo.port}`);
    return currentHostInfo;
  });

  ipcMain.handle("host:stop", async () => {
    getClient().disconnect();
    await lanServer?.stop();
    lanServer = null;
    currentHostInfo = null;
    emitHostInfo(null);
  });

  ipcMain.handle("client:join", async (_event, address: string) => {
    const connectedUrl = await getClient().connect(address);
    await rememberPreferences({ lastJoinAddress: formatJoinAddressForInput(connectedUrl) });
    return connectedUrl;
  });

  ipcMain.handle("account:login", async (_event, accountId: string) => {
    const result = await getClient().loginAccount(accountId);
    await rememberPreferences({ lastAccountId: result.profile.id });
    return result;
  });

  ipcMain.handle("account:register", async (_event, accountId: string) => {
    const result = await getClient().registerAccount(accountId);
    await rememberPreferences({ lastAccountId: result.profile.id });
    return result;
  });

  ipcMain.handle("account:update-profile", (_event, profile: ProfileUpdateRequest) => {
    return getClient().updateAccountProfile(profile);
  });

  ipcMain.handle("client:disconnect", () => {
    getClient().disconnect();
  });

  ipcMain.handle("task:create", (_event, title: string) => {
    getClient().createTask(title);
  });

  ipcMain.handle("version:create", (_event, name: string) => {
    getClient().createVersion(name);
  });

  ipcMain.handle("version:rename", (_event, versionId: string, name: string) => {
    getClient().renameVersion(versionId, name);
  });

  ipcMain.handle("version:delete", (_event, versionId: string) => {
    getClient().deleteVersion(versionId);
  });

  ipcMain.handle("version:reorder", (_event, versionIds: string[]) => {
    getClient().reorderVersions(versionIds);
  });

  ipcMain.handle("version:switch", (_event, versionId: string) => {
    getClient().switchVersion(versionId);
  });

  ipcMain.handle("task:toggle", (_event, taskId: string, completed: boolean) => {
    getClient().toggleTask(taskId, completed);
  });

  ipcMain.handle("task:assign", (_event, taskId: string, assigneeId: string) => {
    getClient().assignTask(taskId, assigneeId);
  });

  ipcMain.handle("task:move-version", (_event, taskId: string, versionId: string) => {
    getClient().moveTaskToVersion(taskId, versionId);
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
  ipcMain.handle("window:resize-main-y", (event, edge: MainWindowResizeEdge, deltaY: number) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) {
      return;
    }

    if (edge !== "top" && edge !== "bottom") {
      return;
    }

    resizeMainWindowY(edge, deltaY);
  });
  ipcMain.handle("window:reset-main-size", (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== mainWindow) {
      return;
    }

    resetMainWindowSize();
  });
  ipcMain.handle("window:close", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (targetWindow === mainWindow) {
      setMainWindowCompact(true);
      return;
    }

    targetWindow?.close();
  });
  ipcMain.handle("window:set-always-on-top", (_event, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(enabled, "floating");
    return enabled;
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.projectmoga.coworkagentslan");
  await loadAppIcon();
  hostStore = new HostDataStore(app.getPath("userData"));
  preferencesStore = new AppPreferencesStore(app.getPath("userData"));
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
