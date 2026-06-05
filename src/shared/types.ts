export const DEFAULT_PORT = 48731;
export const MAX_TASK_SCREENSHOTS = 5;
export const MAX_SCREENSHOT_EDGE = 1280;
export const TRASH_RETENTION_DAYS = 14;
export const ACCOUNT_ID_LENGTH = 11;

export interface TaskScreenshot {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  avatarDataUrl?: string;
  lastSeenAt: string;
  profileComplete?: boolean;
}

export interface ProfileUpdateRequest {
  name: string;
  avatarDataUrl?: string;
}

export interface AccountAuthResult {
  profile: UserProfile;
  requiresProfileSetup: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  screenshots?: TaskScreenshot[];
  assigneeId?: string;
  completed: boolean;
  trashedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostData {
  users: UserProfile[];
  tasks: Task[];
}

export interface HostInfo {
  port: number;
  url: string;
  addresses: string[];
}

export interface ConnectionStatus {
  phase: "idle" | "connecting" | "connected" | "disconnected" | "error";
  message?: string;
  url?: string;
}

export type ClientToServerMessage =
  | {
      type: "account:login";
      accountId: string;
    }
  | {
      type: "account:register";
      accountId: string;
    }
  | {
      type: "account:updateProfile";
      profile: ProfileUpdateRequest;
    }
  | {
      type: "task:create";
      title: string;
    }
  | {
      type: "task:toggle";
      taskId: string;
      completed: boolean;
    }
  | {
      type: "task:assign";
      taskId: string;
      assigneeId: string;
    }
  | {
      type: "task:trash";
      taskId: string;
    }
  | {
      type: "task:restore";
      taskId: string;
    }
  | {
      type: "task:updateDetails";
      taskId: string;
      title: string;
      description: string;
      screenshots: TaskScreenshot[];
    };

export type ServerToClientMessage =
  | {
      type: "state:full" | "state:update";
      state: HostData;
    }
  | {
      type: "account:loginSuccess" | "account:profileRequired" | "account:registered" | "account:profileUpdated";
      profile: UserProfile;
      state: HostData;
    }
  | {
      type: "server:error";
      message: string;
    };
