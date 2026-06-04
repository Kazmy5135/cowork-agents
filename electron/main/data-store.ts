import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { HostData, UserProfile } from "../../src/shared/types";

const EMPTY_HOST_DATA: HostData = {
  users: [],
  tasks: []
};

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

export class ProfileStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "profile.json");
  }

  async load(): Promise<UserProfile | null> {
    return readJsonFile<UserProfile>(this.filePath);
  }

  async save(profile: UserProfile): Promise<void> {
    await writeJsonFile(this.filePath, profile);
  }
}
