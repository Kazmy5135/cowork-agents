import type { ConnectionStatus, HostData, HostInfo, TaskScreenshot, UserProfile } from "../shared/types";

declare global {
  interface Window {
    coWorkApi: {
      getState: () => Promise<HostData>;
      getLocalProfile: () => Promise<UserProfile | null>;
      saveLocalProfile: (profile: Partial<UserProfile>) => Promise<UserProfile>;
      getLanAddresses: () => Promise<string[]>;
      startHost: (profile: UserProfile) => Promise<HostInfo>;
      stopHost: () => Promise<void>;
      joinHost: (address: string, profile: UserProfile) => Promise<string>;
      disconnect: () => Promise<void>;
      createTask: (title: string) => Promise<void>;
      toggleTask: (taskId: string, completed: boolean) => Promise<void>;
      assignTask: (taskId: string, assigneeId: string) => Promise<void>;
      updateTaskDetails: (taskId: string, title: string, description: string, screenshots: TaskScreenshot[]) => Promise<void>;
      openTaskDetail: (taskId: string) => Promise<void>;
      minimizeWindow: () => Promise<void>;
      closeWindow: () => Promise<void>;
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      onState: (callback: (state: HostData) => void) => () => void;
      onConnectionStatus: (callback: (status: ConnectionStatus) => void) => () => void;
      onHostInfo: (callback: (info: HostInfo | null) => void) => () => void;
    };
  }
}

export {};
