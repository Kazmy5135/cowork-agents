import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { APP_THEME_IDS } from "../../src/shared/types";
import type { AppPreferences, AppTheme, HostData } from "../../src/shared/types";

const EMPTY_HOST_DATA: HostData = {
  users: [],
  versions: [],
  currentVersionId: "",
  tasks: []
};
const EMPTY_APP_PREFERENCES: AppPreferences = {};
const MAX_TASK_VIEW_USERS = 32;
const MAX_VIEWED_TASK_REVISIONS_PER_USER = 2000;

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function sanitizeAppPreferences(preferences: Partial<AppPreferences> | null | undefined): AppPreferences {
  const nextPreferences: AppPreferences = {};
  const lastJoinAddress = preferences?.lastJoinAddress?.trim();
  const lastAccountId = preferences?.lastAccountId?.trim();
  const theme = preferences?.theme;
  const taskViewStateByUser = sanitizeTaskViewStateByUser(preferences?.taskViewStateByUser);

  if (lastJoinAddress) {
    nextPreferences.lastJoinAddress = lastJoinAddress.slice(0, 128);
  }

  if (lastAccountId) {
    nextPreferences.lastAccountId = lastAccountId.slice(0, 32);
  }

  if (isAppTheme(theme)) {
    nextPreferences.theme = theme;
  }

  if (taskViewStateByUser) {
    nextPreferences.taskViewStateByUser = taskViewStateByUser;
  }

  return nextPreferences;
}

function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && APP_THEME_IDS.includes(value as AppTheme);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeTaskViewStateByUser(value: unknown): AppPreferences["taskViewStateByUser"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nextStates: NonNullable<AppPreferences["taskViewStateByUser"]> = {};
  const userEntries = Object.entries(value).slice(-MAX_TASK_VIEW_USERS);

  for (const [userId, rawState] of userEntries) {
    const cleanUserId = userId.trim().slice(0, 32);
    if (!cleanUserId || !isRecord(rawState)) {
      continue;
    }

    const viewedTaskRevisions: Record<string, string> = {};
    if (isRecord(rawState.viewedTaskRevisions)) {
      const revisionEntries = Object.entries(rawState.viewedTaskRevisions).slice(-MAX_VIEWED_TASK_REVISIONS_PER_USER);
      for (const [taskId, revision] of revisionEntries) {
        const cleanTaskId = taskId.trim().slice(0, 128);
        const cleanRevision = typeof revision === "string" ? revision.trim().slice(0, 64) : "";
        if (cleanTaskId && cleanRevision) {
          viewedTaskRevisions[cleanTaskId] = cleanRevision;
        }
      }
    }

    nextStates[cleanUserId] = {
      initialized: Boolean(rawState.initialized),
      viewedTaskRevisions
    };
  }

  return Object.keys(nextStates).length > 0 ? nextStates : undefined;
}

export class HostDataStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "host-data.json");
  }

  async load(): Promise<HostData> {
    const data = await readJsonFile<HostData>(this.filePath);
    return data ?? { ...EMPTY_HOST_DATA };
  }

  async save(data: HostData): Promise<void> {
    await writeJsonFile(this.filePath, data);
  }
}

export class AppPreferencesStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "app-preferences.json");
  }

  async load(): Promise<AppPreferences> {
    const data = await readJsonFile<Partial<AppPreferences>>(this.filePath);
    return sanitizeAppPreferences(data ?? EMPTY_APP_PREFERENCES);
  }

  async patch(preferences: Partial<AppPreferences>): Promise<AppPreferences> {
    const nextPreferences = sanitizeAppPreferences({
      ...(await this.load()),
      ...preferences
    });
    await writeJsonFile(this.filePath, nextPreferences);
    return nextPreferences;
  }
}
