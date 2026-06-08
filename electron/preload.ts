import { contextBridge, ipcRenderer } from "electron";
import type {
  AccountAuthResult,
  AppUpdateState,
  AppPreferences,
  ConnectionStatus,
  HostData,
  HostInfo,
  ProfileUpdateRequest,
  TaskScreenshot,
  UserProfile
} from "../src/shared/types";

contextBridge.exposeInMainWorld("coWorkApi", {
  getState: () => ipcRenderer.invoke("state:get") as Promise<HostData>,
  getPreferences: () => ipcRenderer.invoke("preferences:get") as Promise<AppPreferences>,
  patchPreferences: (preferences: Partial<AppPreferences>) =>
    ipcRenderer.invoke("preferences:patch", preferences) as Promise<AppPreferences>,
  getLanAddresses: () => ipcRenderer.invoke("network:addresses") as Promise<string[]>,
  getUpdateState: () => ipcRenderer.invoke("update:get-state") as Promise<AppUpdateState>,
  checkForUpdates: () => ipcRenderer.invoke("update:check") as Promise<AppUpdateState>,
  installUpdate: () => ipcRenderer.invoke("update:install") as Promise<void>,
  startHost: () => ipcRenderer.invoke("host:start") as Promise<HostInfo>,
  stopHost: () => ipcRenderer.invoke("host:stop") as Promise<void>,
  joinHost: (address: string) => ipcRenderer.invoke("client:join", address) as Promise<string>,
  loginAccount: (accountId: string) => ipcRenderer.invoke("account:login", accountId) as Promise<AccountAuthResult>,
  registerAccount: (accountId: string) => ipcRenderer.invoke("account:register", accountId) as Promise<AccountAuthResult>,
  updateAccountProfile: (profile: ProfileUpdateRequest) =>
    ipcRenderer.invoke("account:update-profile", profile) as Promise<UserProfile>,
  disconnect: () => ipcRenderer.invoke("client:disconnect") as Promise<void>,
  createTask: (title: string) => ipcRenderer.invoke("task:create", title) as Promise<void>,
  createVersion: (name: string) => ipcRenderer.invoke("version:create", name) as Promise<void>,
  renameVersion: (versionId: string, name: string) =>
    ipcRenderer.invoke("version:rename", versionId, name) as Promise<void>,
  deleteVersion: (versionId: string) => ipcRenderer.invoke("version:delete", versionId) as Promise<void>,
  reorderVersions: (versionIds: string[]) => ipcRenderer.invoke("version:reorder", versionIds) as Promise<void>,
  switchVersion: (versionId: string) => ipcRenderer.invoke("version:switch", versionId) as Promise<void>,
  toggleTask: (taskId: string, completed: boolean) =>
    ipcRenderer.invoke("task:toggle", taskId, completed) as Promise<void>,
  assignTask: (taskId: string, assigneeId: string) =>
    ipcRenderer.invoke("task:assign", taskId, assigneeId) as Promise<void>,
  moveTaskToVersion: (taskId: string, versionId: string) =>
    ipcRenderer.invoke("task:move-version", taskId, versionId) as Promise<void>,
  moveTaskToTrash: (taskId: string) => ipcRenderer.invoke("task:trash", taskId) as Promise<void>,
  restoreTask: (taskId: string) => ipcRenderer.invoke("task:restore", taskId) as Promise<void>,
  updateTaskDetails: (taskId: string, title: string, description: string, screenshots: TaskScreenshot[]) =>
    ipcRenderer.invoke("task:update-details", taskId, title, description, screenshots) as Promise<void>,
  openTaskDetail: (taskId: string) => ipcRenderer.invoke("task:open-detail", taskId) as Promise<void>,
  minimizeWindow: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
  restoreWindow: () => ipcRenderer.invoke("window:restore") as Promise<void>,
  moveCompactWindowBy: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke("window:move-compact-by", deltaX, deltaY) as Promise<void>,
  resizeMainWindowY: (edge: "top" | "bottom", deltaY: number) =>
    ipcRenderer.invoke("window:resize-main-y", edge, deltaY) as Promise<void>,
  resetMainWindowSize: () => ipcRenderer.invoke("window:reset-main-size") as Promise<void>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
  setAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke("window:set-always-on-top", enabled) as Promise<boolean>,
  copyText: (text: string) => ipcRenderer.invoke("clipboard:write-text", text) as Promise<void>,
  onState: (callback: (state: HostData) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: HostData) => callback(state);
    ipcRenderer.on("state:update", handler);
    return () => ipcRenderer.removeListener("state:update", handler);
  },
  onConnectionStatus: (callback: (status: ConnectionStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ConnectionStatus) => callback(status);
    ipcRenderer.on("connection:status", handler);
    return () => ipcRenderer.removeListener("connection:status", handler);
  },
  onHostInfo: (callback: (info: HostInfo | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: HostInfo | null) => callback(info);
    ipcRenderer.on("host:info", handler);
    return () => ipcRenderer.removeListener("host:info", handler);
  },
  onUpdateState: (callback: (state: AppUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => callback(state);
    ipcRenderer.on("update:state", handler);
    return () => ipcRenderer.removeListener("update:state", handler);
  },
  onCompactMode: (callback: (compact: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, compact: boolean) => callback(compact);
    ipcRenderer.on("window:compact-mode", handler);
    return () => ipcRenderer.removeListener("window:compact-mode", handler);
  }
});
