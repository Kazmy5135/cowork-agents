import type { AccountAuthResult, ConnectionStatus, HostData, HostInfo, ProfileUpdateRequest, TaskScreenshot, UserProfile } from "../shared/types";

declare global {
  interface Window {
    coWorkApi: {
      getState: () => Promise<HostData>;
      getLanAddresses: () => Promise<string[]>;
      startHost: () => Promise<HostInfo>;
      stopHost: () => Promise<void>;
      joinHost: (address: string) => Promise<string>;
      loginAccount: (accountId: string) => Promise<AccountAuthResult>;
      registerAccount: (accountId: string) => Promise<AccountAuthResult>;
      updateAccountProfile: (profile: ProfileUpdateRequest) => Promise<UserProfile>;
      disconnect: () => Promise<void>;
      createTask: (title: string) => Promise<void>;
      toggleTask: (taskId: string, completed: boolean) => Promise<void>;
      assignTask: (taskId: string, assigneeId: string) => Promise<void>;
      moveTaskToTrash: (taskId: string) => Promise<void>;
      restoreTask: (taskId: string) => Promise<void>;
      updateTaskDetails: (taskId: string, title: string, description: string, screenshots: TaskScreenshot[]) => Promise<void>;
      openTaskDetail: (taskId: string) => Promise<void>;
      minimizeWindow: () => Promise<void>;
      restoreWindow: () => Promise<void>;
      moveCompactWindowBy: (deltaX: number, deltaY: number) => Promise<void>;
      closeWindow: () => Promise<void>;
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      copyText: (text: string) => Promise<void>;
      onState: (callback: (state: HostData) => void) => () => void;
      onConnectionStatus: (callback: (status: ConnectionStatus) => void) => () => void;
      onHostInfo: (callback: (info: HostInfo | null) => void) => () => void;
      onCompactMode: (callback: (compact: boolean) => void) => () => void;
    };
  }
}

export {};
