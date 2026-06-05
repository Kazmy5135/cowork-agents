import { clipboard, contextBridge, ipcRenderer } from "electron";
import type { AccountAuthResult, ConnectionStatus, HostData, HostInfo, ProfileUpdateRequest, TaskScreenshot, UserProfile } from "../src/shared/types";

contextBridge.exposeInMainWorld("coWorkApi", {
  getState: () => ipcRenderer.invoke("state:get") as Promise<HostData>,
  getLanAddresses: () => ipcRenderer.invoke("network:addresses") as Promise<string[]>,
  startHost: () => ipcRenderer.invoke("host:start") as Promise<HostInfo>,
  stopHost: () => ipcRenderer.invoke("host:stop") as Promise<void>,
  joinHost: (address: string) => ipcRenderer.invoke("client:join", address) as Promise<string>,
  loginAccount: (accountId: string) => ipcRenderer.invoke("account:login", accountId) as Promise<AccountAuthResult>,
  registerAccount: (accountId: string) => ipcRenderer.invoke("account:register", accountId) as Promise<AccountAuthResult>,
  updateAccountProfile: (profile: ProfileUpdateRequest) =>
    ipcRenderer.invoke("account:update-profile", profile) as Promise<UserProfile>,
  disconnect: () => ipcRenderer.invoke("client:disconnect") as Promise<void>,
  createTask: (title: string) => ipcRenderer.invoke("task:create", title) as Promise<void>,
  toggleTask: (taskId: string, completed: boolean) =>
    ipcRenderer.invoke("task:toggle", taskId, completed) as Promise<void>,
  assignTask: (taskId: string, assigneeId: string) =>
    ipcRenderer.invoke("task:assign", taskId, assigneeId) as Promise<void>,
  moveTaskToTrash: (taskId: string) => ipcRenderer.invoke("task:trash", taskId) as Promise<void>,
  restoreTask: (taskId: string) => ipcRenderer.invoke("task:restore", taskId) as Promise<void>,
  updateTaskDetails: (taskId: string, title: string, description: string, screenshots: TaskScreenshot[]) =>
    ipcRenderer.invoke("task:update-details", taskId, title, description, screenshots) as Promise<void>,
  openTaskDetail: (taskId: string) => ipcRenderer.invoke("task:open-detail", taskId) as Promise<void>,
  minimizeWindow: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
  restoreWindow: () => ipcRenderer.invoke("window:restore") as Promise<void>,
  moveCompactWindowBy: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke("window:move-compact-by", deltaX, deltaY) as Promise<void>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
  setAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke("window:set-always-on-top", enabled) as Promise<boolean>,
  copyText: (text: string) => {
    clipboard.writeText(text);
    return Promise.resolve();
  },
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
  onCompactMode: (callback: (compact: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, compact: boolean) => callback(compact);
    ipcRenderer.on("window:compact-mode", handler);
    return () => ipcRenderer.removeListener("window:compact-mode", handler);
  }
});
