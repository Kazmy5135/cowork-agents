import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionStatus, HostData, HostInfo, UserProfile } from "../src/shared/types";

contextBridge.exposeInMainWorld("coWorkApi", {
  getLocalProfile: () => ipcRenderer.invoke("profile:get") as Promise<UserProfile | null>,
  saveLocalProfile: (profile: Partial<UserProfile>) =>
    ipcRenderer.invoke("profile:save", profile) as Promise<UserProfile>,
  getLanAddresses: () => ipcRenderer.invoke("network:addresses") as Promise<string[]>,
  startHost: (profile: UserProfile) => ipcRenderer.invoke("host:start", profile) as Promise<HostInfo>,
  stopHost: () => ipcRenderer.invoke("host:stop") as Promise<void>,
  joinHost: (address: string, profile: UserProfile) =>
    ipcRenderer.invoke("client:join", address, profile) as Promise<string>,
  disconnect: () => ipcRenderer.invoke("client:disconnect") as Promise<void>,
  createTask: (title: string, assigneeId: string) =>
    ipcRenderer.invoke("task:create", title, assigneeId) as Promise<void>,
  toggleTask: (taskId: string, completed: boolean) =>
    ipcRenderer.invoke("task:toggle", taskId, completed) as Promise<void>,
  assignTask: (taskId: string, assigneeId: string) =>
    ipcRenderer.invoke("task:assign", taskId, assigneeId) as Promise<void>,
  minimizeWindow: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
  setAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke("window:set-always-on-top", enabled) as Promise<boolean>,
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
  }
});
