export const DEFAULT_PORT = 48731;

export interface UserProfile {
  id: string;
  name: string;
  avatarDataUrl?: string;
  lastSeenAt: string;
}

export interface Task {
  id: string;
  title: string;
  assigneeId: string;
  completed: boolean;
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
      type: "client:join";
      profile: UserProfile;
    }
  | {
      type: "task:create";
      title: string;
      assigneeId: string;
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
    };

export type ServerToClientMessage =
  | {
      type: "state:full" | "state:update";
      state: HostData;
    }
  | {
      type: "server:error";
      message: string;
    };
