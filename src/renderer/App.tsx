import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  Clipboard,
  Download,
  GripVertical,
  Image as ImageIcon,
  Layers,
  LogIn,
  Loader2,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  Wifi,
  X
} from "lucide-react";
import {
  ACCOUNT_ID_LENGTH,
  APP_THEME_IDS,
  DEFAULT_APP_THEME,
  MAX_VERSION_NAME_LENGTH,
  MAX_SCREENSHOT_EDGE,
  MAX_TASK_SCREENSHOTS,
  TRASH_RETENTION_DAYS,
  type AccountAuthResult,
  type AppUpdateState,
  type AppPreferences,
  type AppTheme,
  type ConnectionStatus,
  type HostData,
  type HostInfo,
  type Task,
  type TaskScreenshot,
  type TaskVersion,
  type UserProfile
} from "../shared/types";

const EMPTY_STATE: HostData = {
  users: [],
  versions: [],
  currentVersionId: "",
  tasks: []
};
const THEME_OPTIONS: Array<{
  id: AppTheme;
  label: string;
  previewClassName: string;
}> = [
  {
    id: "default",
    label: "默认",
    previewClassName: "theme-preview-default"
  },
  {
    id: "field-terminal",
    label: "野外终端",
    previewClassName: "theme-preview-field-terminal"
  }
];
const EMPTY_UPDATE_STATE: AppUpdateState = {
  phase: "idle",
  currentVersion: ""
};
const ACCOUNT_ID_REGEX = new RegExp(`^\\d{${ACCOUNT_ID_LENGTH}}$`);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * MS_PER_DAY;
const VERSION_REORDER_BUSY_ID = "__version-reorder__";
const VERSION_REORDER_FORWARD_THRESHOLD = 0.3;
const VERSION_REORDER_BACKWARD_THRESHOLD = 0.7;
const trashDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

interface CompactTaskSnapshot {
  id: string;
  title: string;
  description: string;
  assigneeId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getValidTheme(theme: AppPreferences["theme"]): AppTheme {
  return APP_THEME_IDS.includes(theme as AppTheme) ? (theme as AppTheme) : DEFAULT_APP_THEME;
}

function normalizeAccountInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, ACCOUNT_ID_LENGTH);
}

function formatJoinAddressForInput(address: string): string {
  const trimmed = address.trim();

  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed;
  }
}

function getAccountError(accountId: string): string {
  return ACCOUNT_ID_REGEX.test(accountId) ? "" : `请输入 ${ACCOUNT_ID_LENGTH} 位数字账号。`;
}

function getUserDisplayName(user?: UserProfile): string {
  return user?.name.trim() || user?.id || "未分配";
}

function getTaskPersonDisplayName(user: UserProfile | undefined, userId: string | undefined, emptyLabel: string): string {
  return user ? getUserDisplayName(user) : userId || emptyLabel;
}

function isUserProfileComplete(user: UserProfile): boolean {
  return user.profileComplete ?? user.name.trim().length > 0;
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) {
    return "?";
  }
  return clean.slice(0, 2).toUpperCase();
}

function isTaskInTrash(task: Task): boolean {
  return Boolean(task.trashedAt);
}

function isExpiredTrashedTask(task: Task, nowMs = Date.now()): boolean {
  if (!task.trashedAt) {
    return false;
  }

  const trashedAtMs = Date.parse(task.trashedAt);
  return Number.isFinite(trashedAtMs) && nowMs - trashedAtMs >= TRASH_RETENTION_MS;
}

function getTrashDaysLeft(task: Task): number {
  const trashedAtMs = Date.parse(task.trashedAt ?? "");
  if (!Number.isFinite(trashedAtMs)) {
    return TRASH_RETENTION_DAYS;
  }

  return Math.max(0, Math.ceil((trashedAtMs + TRASH_RETENTION_MS - Date.now()) / MS_PER_DAY));
}

function formatTrashDate(isoDate: string | undefined): string {
  if (!isoDate) {
    return "未知时间";
  }

  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) {
    return "未知时间";
  }

  return trashDateFormatter.format(date);
}

function createCompactTaskSnapshot(tasks: Task[]): Map<string, CompactTaskSnapshot> {
  return new Map(
    tasks.map((task) => [
      task.id,
      {
        id: task.id,
        title: task.title,
        description: task.description ?? "",
        assigneeId: task.assigneeId
      }
    ])
  );
}

function countMyActiveTasks(tasks: Task[], userId: string): number {
  return tasks.filter((task) => !isTaskInTrash(task) && task.assigneeId === userId).length;
}

function countCompactTaskChanges(tasks: Task[], snapshot: Map<string, CompactTaskSnapshot> | null, userId: string): number {
  if (!snapshot) {
    return 0;
  }

  return tasks.reduce((count, task) => {
    if (isTaskInTrash(task) || task.assigneeId !== userId) {
      return count;
    }

    const previous = snapshot.get(task.id);
    if (!previous) {
      return count + 1;
    }

    if (previous.assigneeId !== userId) {
      return count + 1;
    }

    let nextCount = count;
    if (previous.title !== task.title) {
      nextCount += 1;
    }
    if (previous.description !== (task.description ?? "")) {
      nextCount += 1;
    }

    return nextCount;
  }, 0);
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function getReadableError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  return fallback;
}

function formatUpdatePercent(percent: number | undefined): string {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return "0%";
  }

  return `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
}

function getUpdateMessage(state: AppUpdateState): string {
  if (state.message) {
    return state.message;
  }

  switch (state.phase) {
    case "checking":
      return "正在检查更新...";
    case "available":
      return "发现新版本，正在下载...";
    case "not-available":
      return "已是最新版本。";
    case "downloading":
      return "正在下载更新...";
    case "downloaded":
      return "更新已下载完成，重启应用后安装。";
    case "error":
      return "检查更新失败。";
    default:
      return "点击检查更新，获取最新 release 版本。";
  }
}

function getUpdateActionLabel(state: AppUpdateState): string {
  switch (state.phase) {
    case "checking":
      return "正在检查";
    case "downloading":
      return `下载中 ${formatUpdatePercent(state.percent)}`;
    case "downloaded":
      return "重启安装";
    default:
      return "检查更新";
  }
}

function isUpdateActionDisabled(state: AppUpdateState): boolean {
  return state.phase === "checking" || state.phase === "downloading" || state.phase === "available";
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function getCurrentVersion(state: HostData): TaskVersion | undefined {
  return state.versions.find((version) => version.id === state.currentVersionId) ?? state.versions[0];
}

function getCurrentVersionTasks(state: HostData): Task[] {
  const currentVersion = getCurrentVersion(state);
  return currentVersion ? state.tasks.filter((task) => task.versionId === currentVersion.id) : state.tasks;
}

function getDetailRoute(): { isDetail: boolean; taskId: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    isDetail: params.get("view") === "detail",
    taskId: params.get("taskId")
  };
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function compressImageFile(file: File): Promise<TaskScreenshot> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("截图只支持 PNG、JPG 或 WebP。");
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const nextImage = new Image();
    nextImage.onload = () => {
      URL.revokeObjectURL(url);
      resolve(nextImage);
    };
    nextImage.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("截图读取失败。"));
    };
    nextImage.src = url;
  });

  const scale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法压缩截图。");
  }

  context.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/webp", 0.82);

  return {
    id: createId(),
    name: file.name || "screenshot.webp",
    mimeType: "image/webp",
    dataUrl,
    width,
    height,
    createdAt: nowIso()
  };
}

function Avatar({ user, size = "md" }: { user?: UserProfile; size?: "sm" | "md" | "lg" }) {
  const displayName = getUserDisplayName(user);

  return (
    <div className={`avatar avatar-${size}`} title={displayName}>
      {user?.avatarDataUrl ? <img src={user.avatarDataUrl} alt={displayName} /> : <span>{initials(displayName)}</span>}
    </div>
  );
}

function CompactIcon({
  user,
  taskCount,
  changeCount,
  onRestore
}: {
  user?: UserProfile;
  taskCount: number;
  changeCount: number;
  onRestore: () => void;
}) {
  const displayName = getUserDisplayName(user);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      moved: false
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const currentDrag = dragState.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - currentDrag.lastX;
    const deltaY = event.screenY - currentDrag.lastY;
    currentDrag.lastX = event.screenX;
    currentDrag.lastY = event.screenY;

    if (Math.abs(event.screenX - currentDrag.startX) > 3 || Math.abs(event.screenY - currentDrag.startY) > 3) {
      currentDrag.moved = true;
    }

    if (deltaX !== 0 || deltaY !== 0) {
      void window.coWorkApi.moveCompactWindowBy(deltaX, deltaY);
    }
  }

  function finishPointerGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const currentDrag = dragState.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }

    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!currentDrag.moved) {
      onRestore();
    }
  }

  return (
    <main className="compact-panel">
      <button
        className="compact-icon"
        type="button"
        title="展开协作工具"
        aria-label="展开协作工具"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={finishPointerGesture}
      >
        <span className="compact-icon-art" aria-hidden="true">
          <span className="compact-avatar-face">
            {user?.avatarDataUrl ? <img src={user.avatarDataUrl} alt="" draggable={false} /> : <span>{initials(displayName)}</span>}
          </span>
          <span className="compact-name">{displayName}</span>
          {changeCount > 0 ? <span className="compact-badge compact-badge-danger">{formatBadgeCount(changeCount)}</span> : null}
          <span className="compact-badge compact-badge-success">{formatBadgeCount(taskCount)}</span>
        </span>
      </button>
    </main>
  );
}

function MainWindowResizeHandle({ edge }: { edge: "top" | "bottom" }) {
  const dragState = useRef<{
    pointerId: number;
    lastY: number;
  } | null>(null);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      lastY: event.screenY
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const currentDrag = dragState.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }

    const deltaY = event.screenY - currentDrag.lastY;
    currentDrag.lastY = event.screenY;

    if (deltaY !== 0) {
      void window.coWorkApi.resizeMainWindowY(edge, deltaY);
    }
  }

  function finishPointerGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const currentDrag = dragState.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }

    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className={`main-resize-handle main-resize-handle-${edge}`}
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerGesture}
      onPointerCancel={finishPointerGesture}
    />
  );
}

function WindowControls({
  pinned,
  onTogglePin,
  onOpenSettings,
  onMinimize
}: {
  pinned: boolean;
  onTogglePin: () => void;
  onOpenSettings?: () => void;
  onMinimize?: () => void;
}) {
  return (
    <div className="window-controls">
      <button className="icon-button" title={pinned ? "取消置顶" : "窗口置顶"} onClick={onTogglePin}>
        {pinned ? <Pin size={14} /> : <PinOff size={14} />}
      </button>
      {onOpenSettings ? (
        <button className="icon-button" title="设置" onClick={onOpenSettings}>
          <Settings size={14} />
        </button>
      ) : null}
      <button className="icon-button danger" title="收起到小托盘" onClick={onMinimize ?? (() => void window.coWorkApi.closeWindow())}>
        <X size={15} />
      </button>
    </div>
  );
}

function DetailWindowControls() {
  return (
    <div className="window-controls detail-window-controls">
      <button className="icon-button danger" title="关闭" onClick={() => void window.coWorkApi.closeWindow()}>
        <X size={15} />
      </button>
    </div>
  );
}

function ProfileSetupView({
  profile,
  mode,
  onSaved,
  onMinimize
}: {
  profile: UserProfile;
  mode: "setup" | "edit";
  onSaved: (profile: UserProfile) => void;
  onMinimize: () => void;
}) {
  const [name, setName] = useState(profile.name ?? "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(profile.avatarDataUrl ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("请输入用户名。");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const saved = await window.coWorkApi.updateAccountProfile({
        name: cleanName,
        avatarDataUrl: avatarDataUrl || undefined
      });
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存资料失败。");
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarFile(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setAvatarDataUrl(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }

  const previewUser: UserProfile = {
    id: profile.id,
    name: name || "Player",
    avatarDataUrl: avatarDataUrl || undefined,
    lastSeenAt: profile.lastSeenAt,
    profileComplete: Boolean(name.trim())
  };

  return (
    <main className="app-panel setup-panel">
      <div className="drag-bar">
        <span>协作任务</span>
        <WindowControls pinned={true} onTogglePin={() => undefined} onMinimize={onMinimize} />
      </div>
      <section className="identity-layout">
        <label className="avatar-picker">
          <Avatar user={previewUser} size="lg" />
          <input type="file" accept="image/*" onChange={(event) => handleAvatarFile(event.target.files?.[0])} />
          <span>选择头像</span>
        </label>
        <div className="setup-fields">
          <div>
            <label htmlFor="account-id">账号</label>
            <input id="account-id" value={profile.id} readOnly />
          </div>
          <div>
            <label htmlFor="display-name">用户名</label>
            <input
              id="display-name"
              autoFocus
              value={name}
              maxLength={18}
              placeholder="Kazmy"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSave();
                }
              }}
            />
          </div>
          {error ? (
            <p className="error-text">{error}</p>
          ) : (
            <p className="muted-text">
              {mode === "setup" ? "首次注册后需要设置用户名和头像，资料会保存在主机上。" : "修改会同步写回当前主机账号资料。"}
            </p>
          )}
          <button className="primary-button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="spin" size={16} /> : <UserRound size={16} />}
            保存资料
          </button>
        </div>
      </section>
    </main>
  );
}

function ConnectView({
  status,
  hostInfo,
  lanUrls,
  initialJoinAddress,
  onConnected,
  onJoined,
  onMinimize
}: {
  status: ConnectionStatus;
  hostInfo: HostInfo | null;
  lanUrls: string[];
  initialJoinAddress: string;
  onConnected: () => void;
  onJoined: (address: string) => void;
  onMinimize: () => void;
}) {
  const [joinAddress, setJoinAddress] = useState(initialJoinAddress);
  const [busy, setBusy] = useState<"host" | "join" | null>(null);
  const [error, setError] = useState("");
  const [addressCopied, setAddressCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);
  const localJoinAddress = formatJoinAddressForInput(hostInfo?.url ?? lanUrls[0] ?? "");

  useEffect(() => {
    setJoinAddress(initialJoinAddress);
  }, [initialJoinAddress]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
    };
  }, []);

  async function startHost() {
    setBusy("host");
    setError("");
    try {
      await window.coWorkApi.startHost();
      onConnected();
    } catch (hostError) {
      setError(hostError instanceof Error ? hostError.message : "主机启动失败。");
    } finally {
      setBusy(null);
    }
  }

  async function joinHost() {
    setBusy("join");
    setError("");
    try {
      const connectedAddress = await window.coWorkApi.joinHost(joinAddress);
      onJoined(formatJoinAddressForInput(connectedAddress));
      onConnected();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "连接失败。");
    } finally {
      setBusy(null);
    }
  }

  async function copyLocalAddress() {
    if (!localJoinAddress) {
      return;
    }

    setError("");
    try {
      await window.coWorkApi.copyText(localJoinAddress);
      setAddressCopied(true);

      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current);
      }

      copyFeedbackTimer.current = window.setTimeout(() => {
        setAddressCopied(false);
        copyFeedbackTimer.current = null;
      }, 1400);
    } catch (copyError) {
      setAddressCopied(false);
      setError(copyError instanceof Error ? copyError.message : "复制本机 IP 失败。");
    }
  }

  return (
    <main className="app-panel connect-panel">
      <div className="drag-bar">
        <span>协作任务</span>
        <WindowControls pinned={true} onTogglePin={() => undefined} onMinimize={onMinimize} />
      </div>
      <section className="connect-layout">
        <div className="host-start-section">
          <button className="connect-action host-start-button" disabled={busy !== null} onClick={() => void startHost()}>
            {busy === "host" ? <Loader2 className="spin" size={18} /> : <Server size={18} />}
            作为主机启动
          </button>
        </div>
        <div className="client-connect-section">
          <div className="client-connect-header">
            <span>连接服务器（作为客户端）</span>
            <small>{localJoinAddress ? `本机：${localJoinAddress}` : "未找到本机 IP"}</small>
          </div>
          <div className="join-input-row client-join-row">
            <input
              aria-label="服务器地址"
              value={joinAddress}
              placeholder="192.168.1.20:48731"
              onChange={(event) => {
                setJoinAddress(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void joinHost();
                }
              }}
            />
            <button className="primary-button join-button" disabled={busy !== null} onClick={() => void joinHost()}>
              {busy === "join" ? <Loader2 className="spin" size={15} /> : <Wifi size={15} />}
              连接
            </button>
            <button
              className="secondary-button copy-local-ip-button"
              disabled={!localJoinAddress}
              title={localJoinAddress ? `复制本机 IP：${localJoinAddress}` : "未找到本机 IP"}
              onClick={() => void copyLocalAddress()}
            >
              {addressCopied ? <Check size={15} /> : <Clipboard size={15} />}
              {addressCopied ? "已复制" : "复制本机 IP"}
            </button>
          </div>
        </div>
      </section>
      <div className="status-line connect-status-line">
        {error || status.phase === "error" ? <AlertCircle size={14} /> : <Wifi size={14} />}
        <span>{error || status.message || "未连接"}</span>
      </div>
    </main>
  );
}

function AccountView({
  status,
  initialAccountId,
  onAuthenticated,
  onMinimize
}: {
  status: ConnectionStatus;
  initialAccountId: string;
  onAuthenticated: (result: AccountAuthResult) => void;
  onMinimize: () => void;
}) {
  const [accountId, setAccountId] = useState(normalizeAccountInput(initialAccountId));
  const [busy, setBusy] = useState<"login" | "register" | null>(null);
  const [error, setError] = useState("");

  async function authenticate(action: "login" | "register") {
    const accountError = getAccountError(accountId);
    if (accountError) {
      setError(accountError);
      return;
    }

    setBusy(action);
    setError("");

    try {
      const result =
        action === "login" ? await window.coWorkApi.loginAccount(accountId) : await window.coWorkApi.registerAccount(accountId);
      onAuthenticated(result);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : action === "login" ? "登录失败。" : "注册失败。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-panel account-panel">
      <div className="drag-bar">
        <span>账号登录</span>
        <WindowControls pinned={true} onTogglePin={() => undefined} onMinimize={onMinimize} />
      </div>
      <section className="account-layout">
        <div className="account-field">
          <label htmlFor="account-id-input">账号</label>
          <input
            id="account-id-input"
            autoFocus
            inputMode="numeric"
            value={accountId}
            maxLength={ACCOUNT_ID_LENGTH}
            placeholder="12345678901"
            onChange={(event) => {
              setAccountId(normalizeAccountInput(event.target.value));
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void authenticate("login");
              }
            }}
          />
        </div>
        <div className="account-actions">
          <button className="primary-button" disabled={busy !== null} onClick={() => void authenticate("login")}>
            {busy === "login" ? <Loader2 className="spin" size={16} /> : <LogIn size={16} />}
            登录
          </button>
          <button className="secondary-button" disabled={busy !== null} onClick={() => void authenticate("register")}>
            {busy === "register" ? <Loader2 className="spin" size={16} /> : <UserPlus size={16} />}
            注册
          </button>
        </div>
        <div className="status-line account-status-line">
          {error || status.phase === "error" ? <AlertCircle size={14} /> : <Wifi size={14} />}
          <span>{error || status.message || "已连接主机"}</span>
        </div>
      </section>
    </main>
  );
}

function TaskRow({
  task,
  assignee,
  onToggle,
  onAssignClick,
  onOpenDetail,
  onOpenMenu
}: {
  task: Task;
  assignee?: UserProfile;
  onToggle: (task: Task) => void;
  onAssignClick: (task: Task) => void;
  onOpenDetail: (task: Task) => void;
  onOpenMenu: (task: Task, event: MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className={`task-row ${task.completed ? "task-done" : ""}`} onContextMenu={(event) => onOpenMenu(task, event)}>
      <button className="task-check" title={task.completed ? "标记为未完成" : "标记为完成"} onClick={() => onToggle(task)}>
        {task.completed ? <Check size={18} /> : <Circle size={18} />}
      </button>
      <button className="task-title-button" title="打开任务详情" onClick={() => onOpenDetail(task)}>
        {task.title}
      </button>
      <button
        className={`assignment-avatar-button ${assignee ? "" : "unassigned"}`}
        title={assignee ? "更换负责人" : "选择负责人"}
        onClick={() => onAssignClick(task)}
      >
        {assignee ? <Avatar user={assignee} size="sm" /> : <Plus size={18} />}
      </button>
    </div>
  );
}

function TaskContextMenu({
  task,
  versions,
  x,
  y,
  submenuX,
  submenuY,
  onMoveToVersion,
  onMoveToTrash
}: {
  task: Task;
  versions: TaskVersion[];
  x: number;
  y: number;
  submenuX: "left" | "right";
  submenuY: "down" | "up";
  onMoveToVersion: (task: Task, versionId: string) => Promise<void>;
  onMoveToTrash: (task: Task) => Promise<void>;
}) {
  return (
    <div className="task-menu-layer">
      <div
        className="task-context-menu"
        style={{ left: x, top: y }}
        role="menu"
        aria-label={`${task.title} 的任务菜单`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="task-menu-group">
          <button className="task-menu-item" role="menuitem" aria-haspopup="menu" type="button">
            <Layers size={14} />
            <span>移动</span>
            <ChevronRight className="task-menu-caret" size={14} />
          </button>
          <div className={`task-version-submenu ${submenuX} ${submenuY}`} role="menu" aria-label="移动到版本">
            {versions.map((version) => {
              const isCurrentTaskVersion = version.id === task.versionId;

              return (
                <button
                  key={version.id}
                  className={`task-menu-item task-version-item ${isCurrentTaskVersion ? "current" : ""}`}
                  role="menuitem"
                  type="button"
                  disabled={isCurrentTaskVersion}
                  title={version.name}
                  onClick={() => void onMoveToVersion(task, version.id)}
                >
                  <Layers size={13} />
                  <span>{version.name}</span>
                  {isCurrentTaskVersion ? <span className="task-version-current">当前</span> : null}
                </button>
              );
            })}
          </div>
        </div>
        <button className="task-menu-item danger" role="menuitem" type="button" onClick={() => void onMoveToTrash(task)}>
          <Trash2 size={14} />
          删除
        </button>
      </div>
    </div>
  );
}

function AssignmentPopover({
  users,
  currentAssigneeId,
  onAssign,
  onClose
}: {
  users: UserProfile[];
  currentAssigneeId?: string;
  onAssign: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="assignment-layer">
      <button className="assignment-backdrop" title="关闭" onClick={onClose} />
      <div className="assignment-popover" role="dialog" aria-label="选择负责人">
        <div className="assignment-user-strip">
          {users.map((user) => (
            <button
              key={user.id}
              className={`assignment-user-option ${user.id === currentAssigneeId ? "selected" : ""}`}
              title={getUserDisplayName(user)}
              onClick={() => onAssign(user.id)}
            >
              <Avatar user={user} size="md" />
              <span>{getUserDisplayName(user)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function VersionPopover({
  versions,
  currentVersionId,
  taskCountsByVersion,
  onClose,
  onCreateVersion,
  onRenameVersion,
  onDeleteVersion,
  onReorderVersions,
  onSwitchVersion
}: {
  versions: TaskVersion[];
  currentVersionId: string;
  taskCountsByVersion: Map<string, number>;
  onClose: () => void;
  onCreateVersion: (name: string) => Promise<void>;
  onRenameVersion: (versionId: string, name: string) => Promise<void>;
  onDeleteVersion: (versionId: string) => Promise<void>;
  onReorderVersions: (versionIds: string[]) => Promise<void>;
  onSwitchVersion: (versionId: string) => Promise<void>;
}) {
  const [newVersionName, setNewVersionName] = useState("");
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmingDeleteVersionId, setConfirmingDeleteVersionId] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [orderedVersionIds, setOrderedVersionIds] = useState<string[]>(() => versions.map((version) => version.id));
  const [dragPreview, setDragPreview] = useState<{
    versionId: string;
    width: number;
    height: number;
  } | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const dragPreviewPositionRef = useRef({ left: 0, top: 0 });
  const dragPreviewFrameRef = useRef<number | null>(null);
  const dragListenerCleanupRef = useRef<(() => void) | null>(null);
  const versionItemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const versionIdsRef = useRef<string[]>(versions.map((version) => version.id));
  const orderedVersionIdsRef = useRef<string[]>(orderedVersionIds);
  const suppressNextSwitchRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    versionId: string;
    sourceElement: HTMLButtonElement;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    lastCenterY: number;
    initialOrder: string[];
  } | null>(null);
  const orderBusy = busyVersionId === VERSION_REORDER_BUSY_ID;
  const draggingVersionId = dragPreview?.versionId ?? null;
  const orderedVersions = useMemo(() => {
    const versionsById = new Map(versions.map((version) => [version.id, version]));
    const nextVersions: TaskVersion[] = [];
    orderedVersionIds.forEach((versionId) => {
      const version = versionsById.get(versionId);
      if (version) {
        nextVersions.push(version);
      }
    });

    const orderedIds = new Set(nextVersions.map((version) => version.id));
    versions.forEach((version) => {
      if (!orderedIds.has(version.id)) {
        nextVersions.push(version);
      }
    });

    return nextVersions;
  }, [orderedVersionIds, versions]);

  useEffect(() => {
    orderedVersionIdsRef.current = orderedVersionIds;
  }, [orderedVersionIds]);

  useEffect(() => {
    const nextVersionIds = versions.map((version) => version.id);
    setConfirmingDeleteVersionId((current) => (current && !nextVersionIds.includes(current) ? null : current));

    if (areStringArraysEqual(nextVersionIds, versionIdsRef.current)) {
      return;
    }

    if (dragStateRef.current) {
      clearActiveVersionDrag(false);
    }

    versionIdsRef.current = nextVersionIds;
    orderedVersionIdsRef.current = nextVersionIds;
    setOrderedVersionIds(nextVersionIds);
  }, [versions]);

  useEffect(() => {
    return () => {
      dragListenerCleanupRef.current?.();
      dragListenerCleanupRef.current = null;

      if (dragPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(dragPreviewFrameRef.current);
        dragPreviewFrameRef.current = null;
      }

      const currentDrag = dragStateRef.current;
      if (currentDrag) {
        releaseVersionDragPointer(currentDrag);
      }

      dragStateRef.current = null;
    };
  }, []);

  function cleanVersionName(rawName: string): string | null {
    const cleanName = rawName.trim();
    if (!cleanName) {
      setVersionError("版本名称不能为空。");
      return null;
    }

    if (cleanName.length > MAX_VERSION_NAME_LENGTH) {
      setVersionError(`版本名称最多 ${MAX_VERSION_NAME_LENGTH} 个字。`);
      return null;
    }

    return cleanName;
  }

  async function handleCreateVersion() {
    const cleanName = cleanVersionName(newVersionName);
    if (!cleanName) {
      return;
    }

    setCreating(true);
    setVersionError("");
    setConfirmingDeleteVersionId(null);
    try {
      await onCreateVersion(cleanName);
      setNewVersionName("");
    } catch (createError) {
      setVersionError(createError instanceof Error ? createError.message : "创建版本失败。");
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameVersion(versionId: string) {
    const cleanName = cleanVersionName(editingName);
    if (!cleanName) {
      return;
    }

    setBusyVersionId(versionId);
    setVersionError("");
    try {
      await onRenameVersion(versionId, cleanName);
      setEditingVersionId(null);
      setEditingName("");
    } catch (renameError) {
      setVersionError(renameError instanceof Error ? renameError.message : "重命名版本失败。");
    } finally {
      setBusyVersionId(null);
    }
  }

  async function handleDeleteVersion(version: TaskVersion) {
    if (version.isDefault || versions.length <= 1) {
      return;
    }

    if (confirmingDeleteVersionId !== version.id) {
      setConfirmingDeleteVersionId(version.id);
      setVersionError("");
      setEditingVersionId(null);
      setEditingName("");
      return;
    }

    setBusyVersionId(version.id);
    setVersionError("");
    try {
      await onDeleteVersion(version.id);
      setConfirmingDeleteVersionId(null);
      if (editingVersionId === version.id) {
        setEditingVersionId(null);
        setEditingName("");
      }
    } catch (deleteError) {
      setVersionError(deleteError instanceof Error ? deleteError.message : "删除版本失败。");
    } finally {
      setBusyVersionId(null);
    }
  }

  async function handleSwitchVersion(version: TaskVersion) {
    if (editingVersionId || draggingVersionId) {
      return;
    }

    setConfirmingDeleteVersionId(null);
    if (version.id === currentVersionId) {
      onClose();
      return;
    }

    setBusyVersionId(version.id);
    setVersionError("");
    try {
      await onSwitchVersion(version.id);
      onClose();
    } catch (switchError) {
      setVersionError(switchError instanceof Error ? switchError.message : "切换版本失败。");
    } finally {
      setBusyVersionId(null);
    }
  }

  async function commitVersionOrder(versionIds: string[]) {
    if (areStringArraysEqual(versionIds, versionIdsRef.current)) {
      return;
    }

    setBusyVersionId(VERSION_REORDER_BUSY_ID);
    setVersionError("");
    try {
      await onReorderVersions(versionIds);
      versionIdsRef.current = versionIds;
    } catch (reorderError) {
      setOrderedVersionIds(versionIdsRef.current);
      orderedVersionIdsRef.current = versionIdsRef.current;
      setVersionError(reorderError instanceof Error ? reorderError.message : "调整版本顺序失败。");
    } finally {
      setBusyVersionId(null);
    }
  }

  function flushDragPreviewPosition() {
    const previewNode = dragPreviewRef.current;
    if (!previewNode) {
      return;
    }

    const { left, top } = dragPreviewPositionRef.current;
    previewNode.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function scheduleDragPreviewPosition(left: number, top: number) {
    dragPreviewPositionRef.current = { left, top };

    if (dragPreviewFrameRef.current !== null) {
      return;
    }

    dragPreviewFrameRef.current = window.requestAnimationFrame(() => {
      dragPreviewFrameRef.current = null;
      flushDragPreviewPosition();
    });
  }

  function releaseVersionDragPointer(currentDrag: NonNullable<typeof dragStateRef.current>) {
    try {
      if (currentDrag.sourceElement.hasPointerCapture(currentDrag.pointerId)) {
        currentDrag.sourceElement.releasePointerCapture(currentDrag.pointerId);
      }
    } catch {
      // The pointer can already be gone if Electron drops capture during a fast drag.
    }
  }

  function removeVersionDragListeners() {
    dragListenerCleanupRef.current?.();
    dragListenerCleanupRef.current = null;
  }

  function clearDragPreviewFrame() {
    if (dragPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(dragPreviewFrameRef.current);
      dragPreviewFrameRef.current = null;
    }
  }

  function clearActiveVersionDrag(restoreInitialOrder: boolean) {
    const currentDrag = dragStateRef.current;
    if (!currentDrag) {
      return;
    }

    dragStateRef.current = null;
    removeVersionDragListeners();
    releaseVersionDragPointer(currentDrag);
    clearDragPreviewFrame();
    setDragPreview(null);
    suppressNextSwitchRef.current = false;

    if (restoreInitialOrder) {
      orderedVersionIdsRef.current = currentDrag.initialOrder;
      setOrderedVersionIds(currentDrag.initialOrder);
    }
  }

  function moveDraggingVersion(pointerY: number) {
    const currentDrag = dragStateRef.current;
    if (!currentDrag) {
      return;
    }

    const dragCenterY = pointerY - currentDrag.offsetY + currentDrag.height / 2;
    const thresholdRatio =
      dragCenterY >= currentDrag.lastCenterY ? VERSION_REORDER_FORWARD_THRESHOLD : VERSION_REORDER_BACKWARD_THRESHOLD;
    currentDrag.lastCenterY = dragCenterY;

    const currentOrder = orderedVersionIdsRef.current;
    if (!currentOrder.includes(currentDrag.versionId)) {
      return;
    }

    const remainingIds = currentOrder.filter((versionId) => versionId !== currentDrag.versionId);
    let nextIndex = remainingIds.length;
    for (let index = 0; index < remainingIds.length; index += 1) {
      const itemNode = versionItemRefs.current.get(remainingIds[index]);
      if (!itemNode) {
        continue;
      }

      const rect = itemNode.getBoundingClientRect();
      if (dragCenterY < rect.top + rect.height * thresholdRatio) {
        nextIndex = index;
        break;
      }
    }

    const nextOrder = [...remainingIds];
    nextOrder.splice(nextIndex, 0, currentDrag.versionId);

    if (!areStringArraysEqual(nextOrder, currentOrder)) {
      orderedVersionIdsRef.current = nextOrder;
      setOrderedVersionIds(nextOrder);
    }
  }

  function finishVersionDrag(pointerId: number, commitOrder: boolean, event?: PointerEvent) {
    const currentDrag = dragStateRef.current;
    if (!currentDrag || currentDrag.pointerId !== pointerId) {
      return;
    }

    const finalOrder = orderedVersionIdsRef.current;
    event?.preventDefault();
    event?.stopPropagation();
    dragStateRef.current = null;
    removeVersionDragListeners();
    releaseVersionDragPointer(currentDrag);
    clearDragPreviewFrame();
    setDragPreview(null);
    suppressNextSwitchRef.current = true;
    window.setTimeout(() => {
      suppressNextSwitchRef.current = false;
    }, 0);

    if (commitOrder) {
      void commitVersionOrder(finalOrder);
    } else {
      orderedVersionIdsRef.current = currentDrag.initialOrder;
      setOrderedVersionIds(currentDrag.initialOrder);
    }
  }

  function handleWindowVersionDragMove(event: PointerEvent) {
    const currentDrag = dragStateRef.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if ((event.buttons & 1) === 0) {
      finishVersionDrag(event.pointerId, true, event);
      return;
    }

    scheduleDragPreviewPosition(event.clientX - currentDrag.offsetX, event.clientY - currentDrag.offsetY);
    moveDraggingVersion(event.clientY);
  }

  function bindWindowVersionDragListeners() {
    removeVersionDragListeners();

    const handlePointerMove = (event: PointerEvent) => handleWindowVersionDragMove(event);
    const handlePointerUp = (event: PointerEvent) => finishVersionDrag(event.pointerId, true, event);
    const handlePointerCancel = (event: PointerEvent) => finishVersionDrag(event.pointerId, false, event);

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    dragListenerCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }

  function handleVersionDragStart(event: ReactPointerEvent<HTMLButtonElement>, version: TaskVersion) {
    if (event.button !== 0 || editingVersionId || busyVersionId || creating || versions.length <= 1) {
      return;
    }

    const itemNode = event.currentTarget.closest<HTMLElement>(".version-item");
    if (!itemNode) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Global pointer listeners still keep the drag responsive if capture is unavailable.
    }
    const itemRect = itemNode.getBoundingClientRect();
    const previewLeft = itemRect.left;
    const previewTop = itemRect.top;
    dragStateRef.current = {
      pointerId: event.pointerId,
      versionId: version.id,
      sourceElement: event.currentTarget,
      offsetX: event.clientX - itemRect.left,
      offsetY: event.clientY - itemRect.top,
      width: itemRect.width,
      height: itemRect.height,
      lastCenterY: itemRect.top + itemRect.height / 2,
      initialOrder: [...orderedVersionIdsRef.current]
    };

    scheduleDragPreviewPosition(previewLeft, previewTop);
    bindWindowVersionDragListeners();
    suppressNextSwitchRef.current = true;
    setConfirmingDeleteVersionId(null);
    setEditingVersionId(null);
    setEditingName("");
    setVersionError("");
    setDragPreview({
      versionId: version.id,
      width: itemRect.width,
      height: itemRect.height
    });
    moveDraggingVersion(event.clientY);
  }

  const dragPreviewVersion = dragPreview ? versions.find((version) => version.id === dragPreview.versionId) ?? null : null;
  const dragPreviewTaskCount = dragPreviewVersion ? taskCountsByVersion.get(dragPreviewVersion.id) ?? 0 : 0;

  return (
    <div className="version-layer" role="dialog" aria-label="版本管理">
      <button className="version-backdrop" title="关闭版本管理" onClick={onClose} />
      <div className="version-popover" onPointerDown={(event) => event.stopPropagation()}>
        <header className="version-popover-header">
          <div>
            <p>版本</p>
            <span>当前任务列表</span>
          </div>
          <button className="icon-button" title="关闭版本管理" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className={`version-list${draggingVersionId ? " dragging" : ""}`} role="list">
          {orderedVersions.map((version) => {
            const selected = version.id === currentVersionId;
            const canDelete = !version.isDefault && versions.length > 1;
            const taskCount = taskCountsByVersion.get(version.id) ?? 0;
            const busy = busyVersionId === version.id;
            const confirmingDelete = confirmingDeleteVersionId === version.id;
            const itemClassName = [
              "version-item",
              selected ? "selected" : "",
              draggingVersionId === version.id ? "dragging" : "",
              confirmingDelete ? "confirming-delete" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <article
                key={version.id}
                ref={(node) => {
                  if (node) {
                    versionItemRefs.current.set(version.id, node);
                  } else {
                    versionItemRefs.current.delete(version.id);
                  }
                }}
                className={itemClassName}
                role="listitem"
                aria-grabbed={draggingVersionId === version.id}
                onContextMenu={(event) => event.preventDefault()}
              >
                {editingVersionId === version.id ? (
                  <form
                    className="version-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleRenameVersion(version.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={editingName}
                      maxLength={MAX_VERSION_NAME_LENGTH}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setEditingVersionId(null);
                          setEditingName("");
                        }
                      }}
                    />
                    <button className="icon-button solid" type="submit" title="保存版本名" disabled={busy || orderBusy}>
                      {busy ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="取消重命名"
                      disabled={orderBusy}
                      onClick={() => {
                        setEditingVersionId(null);
                        setEditingName("");
                      }}
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className="version-drag-grip"
                      type="button"
                      title={versions.length <= 1 ? "至少需要两个版本才能排序" : "拖拽排序"}
                      aria-label={`拖拽排序：${version.name}`}
                      disabled={versions.length <= 1 || Boolean(busyVersionId) || creating}
                      onPointerDown={(event) => handleVersionDragStart(event, version)}
                    >
                      <GripVertical size={13} />
                    </button>
                    <button
                      className="version-main"
                      type="button"
                      title={version.name}
                      onClick={(event) => {
                        if (suppressNextSwitchRef.current) {
                          event.preventDefault();
                          suppressNextSwitchRef.current = false;
                          return;
                        }

                        void handleSwitchVersion(version);
                      }}
                    >
                      <span>{version.name}</span>
                      <small>{taskCount} 任务</small>
                    </button>
                    {confirmingDelete ? (
                      <div className="version-actions version-actions-confirm">
                        <span className="version-delete-confirm">确认删除？</span>
                        <button
                          className="icon-button danger version-confirm-delete"
                          type="button"
                          title="确认删除版本"
                          disabled={!canDelete || busy || orderBusy}
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            void handleDeleteVersion(version);
                          }}
                        >
                          {busy ? <Loader2 className="spin" size={13} /> : <Check size={13} />}
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          title="取消删除"
                          disabled={busy || orderBusy}
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            setConfirmingDeleteVersionId(null);
                          }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="version-actions">
                        <button
                          className="icon-button"
                          type="button"
                          title="重命名版本"
                          disabled={orderBusy}
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            setVersionError("");
                            setConfirmingDeleteVersionId(null);
                            setEditingVersionId(version.id);
                            setEditingName(version.name);
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="icon-button danger"
                          type="button"
                          title={version.isDefault ? "默认版本不能删除" : versions.length <= 1 ? "至少保留一个版本" : "删除版本"}
                          disabled={!canDelete || busy || orderBusy}
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            void handleDeleteVersion(version);
                          }}
                        >
                          {busy ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>

        <form
          className="version-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateVersion();
          }}
        >
          <input
            value={newVersionName}
            maxLength={MAX_VERSION_NAME_LENGTH}
            placeholder="新版本名称"
            onChange={(event) => {
              setConfirmingDeleteVersionId(null);
              setNewVersionName(event.target.value);
            }}
          />
          <button className="icon-button solid" type="submit" title="创建版本" disabled={creating || orderBusy}>
            {creating ? <Loader2 className="spin" size={14} /> : <Plus size={15} />}
          </button>
        </form>
        {versionError ? <div className="version-error">{versionError}</div> : null}
      </div>
      {dragPreview && dragPreviewVersion
        ? createPortal(
            <div
              ref={(node) => {
                dragPreviewRef.current = node;
                if (node) {
                  flushDragPreviewPosition();
                }
              }}
              className="version-drag-preview"
              style={{
                width: dragPreview.width,
                height: dragPreview.height
              }}
              aria-hidden="true"
            >
              <span className="version-drag-grip preview">
                <GripVertical size={13} />
              </span>
              <div className="version-preview-main">
                <span>{dragPreviewVersion.name}</span>
                <small>{dragPreviewTaskCount} 任务</small>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function SettingsPanel({
  theme,
  trashedTasks,
  updateState,
  onClose,
  onCheckForUpdates,
  onInstallUpdate,
  onThemeChange,
  onOpenTask,
  onRestoreTask
}: {
  theme: AppTheme;
  trashedTasks: Task[];
  updateState: AppUpdateState;
  onClose: () => void;
  onCheckForUpdates: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onThemeChange: (theme: AppTheme) => Promise<void>;
  onOpenTask: (task: Task) => Promise<void>;
  onRestoreTask: (task: Task) => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<"updates" | "trash" | "theme">("updates");
  const [themeSaving, setThemeSaving] = useState<AppTheme | null>(null);
  const [themeError, setThemeError] = useState("");
  const sortedTrashedTasks = useMemo(
    () =>
      [...trashedTasks].sort((left, right) => {
        return Date.parse(right.trashedAt ?? right.updatedAt) - Date.parse(left.trashedAt ?? left.updatedAt);
      }),
    [trashedTasks]
  );
  const updateProgress = Math.max(0, Math.min(100, updateState.percent ?? 0));
  const updateIsBusy = updateState.phase === "checking" || updateState.phase === "downloading";
  const updateMessage = getUpdateMessage(updateState);
  const activeTheme = THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0];
  const activeTitle = activeSection === "updates" ? "应用更新" : activeSection === "theme" ? "主题" : "垃圾桶";
  const activeSubtitle =
    activeSection === "updates"
      ? `当前版本 ${updateState.currentVersion || "未知"}`
      : activeSection === "theme"
        ? `当前：${activeTheme.label}`
        : `${TRASH_RETENTION_DAYS} 天后永久清除`;

  async function handleUpdateAction() {
    if (updateState.phase === "downloaded") {
      await onInstallUpdate();
      return;
    }

    await onCheckForUpdates();
  }

  async function handleThemeChange(nextTheme: AppTheme) {
    if (nextTheme === theme || themeSaving) {
      return;
    }

    setThemeSaving(nextTheme);
    setThemeError("");
    try {
      await onThemeChange(nextTheme);
    } catch (saveError) {
      setThemeError(saveError instanceof Error ? saveError.message : "保存主题失败。");
    } finally {
      setThemeSaving(null);
    }
  }

  return (
    <div className="settings-panel" role="dialog" aria-label="基础设置">
      <aside className="settings-sidebar">
        <div className="settings-title">基础设置</div>
        <button
          className={`settings-nav-item${activeSection === "updates" ? " selected" : ""}`}
          type="button"
          aria-pressed={activeSection === "updates"}
          onClick={() => setActiveSection("updates")}
        >
          <Download size={15} />
          <span>应用更新</span>
        </button>
        <button
          className={`settings-nav-item ${activeSection === "trash" ? "selected" : ""}`}
          type="button"
          aria-pressed={activeSection === "trash"}
          onClick={() => setActiveSection("trash")}
        >
          <Trash2 size={15} />
          <span>垃圾桶</span>
        </button>
        <button
          className={`settings-nav-item ${activeSection === "theme" ? "selected" : ""}`}
          type="button"
          aria-pressed={activeSection === "theme"}
          onClick={() => setActiveSection("theme")}
        >
          <Palette size={15} />
          <span>主题</span>
        </button>
      </aside>

      <section className="settings-content">
        <header className="settings-content-header">
          <div>
            <p>{activeTitle}</p>
            <span>{activeSubtitle}</span>
          </div>
          <button className="icon-button" title="关闭设置" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        {activeSection === "updates" ? (
          <div className="update-panel-content">
            <div className={`update-status update-status-${updateState.phase}`}>
              <div className="update-version-grid">
                <div>
                  <span>当前版本</span>
                  <strong>{updateState.currentVersion || "未知"}</strong>
                </div>
                <div>
                  <span>最新版本</span>
                  <strong>{updateState.latestVersion ?? "等待检查"}</strong>
                </div>
              </div>
              <div className="update-message">
                {updateState.phase === "error" ? (
                  <AlertCircle size={14} />
                ) : updateIsBusy ? (
                  <Loader2 className="spin" size={14} />
                ) : (
                  <Check size={14} />
                )}
                <span>{updateMessage}</span>
              </div>
              {updateState.phase === "downloading" ? (
                <div className="update-progress" aria-label={`下载进度 ${formatUpdatePercent(updateProgress)}`}>
                  <div className="update-progress-bar" style={{ width: `${updateProgress}%` }} />
                </div>
              ) : null}
            </div>
            <button
              className="primary-button update-action-button"
              type="button"
              disabled={isUpdateActionDisabled(updateState)}
              onClick={() => void handleUpdateAction()}
            >
              {updateIsBusy ? (
                <Loader2 className="spin" size={16} />
              ) : updateState.phase === "downloaded" ? (
                <Download size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              {getUpdateActionLabel(updateState)}
            </button>
            <p className="muted-text update-footnote">通过 GitHub Releases 获取安装包。旧 portable 版需要先手动安装一次新版安装包。</p>
          </div>
        ) : activeSection === "theme" ? (
          <div className="theme-settings">
            <div className="theme-option-list" role="radiogroup" aria-label="主题">
              {THEME_OPTIONS.map((option) => {
                const selected = option.id === theme;
                const saving = themeSaving === option.id;

                return (
                  <button
                    key={option.id}
                    className={`theme-option ${selected ? "selected" : ""}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={Boolean(themeSaving)}
                    onClick={() => void handleThemeChange(option.id)}
                  >
                    <span className={`theme-preview ${option.previewClassName}`} aria-hidden="true">
                      <span />
                      <span />
                    </span>
                    <span>{option.label}</span>
                    {saving ? <Loader2 className="spin" size={14} /> : selected ? <Check size={14} /> : null}
                  </button>
                );
              })}
            </div>
            {themeError ? <div className="theme-error">{themeError}</div> : null}
          </div>
        ) : sortedTrashedTasks.length === 0 ? (
          <div className="trash-empty">14 天内没有移入垃圾桶的任务</div>
        ) : (
          <div className="trash-list">
            {sortedTrashedTasks.map((task) => {
              const daysLeft = getTrashDaysLeft(task);
              return (
                <article key={task.id} className="trash-item">
                  <button className="trash-item-main" type="button" title="打开任务详情" onClick={() => void onOpenTask(task)}>
                    <h3>{task.title}</h3>
                    <p>移入时间 {formatTrashDate(task.trashedAt)}</p>
                  </button>
                  <button
                    className="trash-restore-button"
                    type="button"
                    title="恢复任务"
                    aria-label={`恢复任务 ${task.title}`}
                    onClick={() => void onRestoreTask(task)}
                  >
                    <span className="trash-restore-label trash-restore-label-expiry">
                      {daysLeft > 0 ? `${daysLeft} 天后清除` : "即将清除"}
                    </span>
                    <span className="trash-restore-label trash-restore-label-action">恢复</span>
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TaskApp({
  profile,
  state,
  status,
  hostInfo,
  theme,
  pinned,
  onTogglePin,
  onEditProfile,
  onThemeChange,
  onMinimize
}: {
  profile: UserProfile;
  state: HostData;
  status: ConnectionStatus;
  hostInfo: HostInfo | null;
  theme: AppTheme;
  pinned: boolean;
  onTogglePin: () => void;
  onEditProfile: () => void;
  onThemeChange: (theme: AppTheme) => Promise<void>;
  onMinimize: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [updateState, setUpdateState] = useState<AppUpdateState>(EMPTY_UPDATE_STATE);
  const [showMineOnly, setShowMineOnly] = useState(false);
  const [activeAssignmentTaskId, setActiveAssignmentTaskId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [taskMenu, setTaskMenu] = useState<{
    taskId: string;
    x: number;
    y: number;
    submenuX: "left" | "right";
    submenuY: "down" | "up";
  } | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);
  const hostShareAddress = hostInfo?.url ?? hostInfo?.addresses[0] ?? "";
  const statusLabel = addressCopied ? "已复制" : hostInfo ? "Host" : status.phase === "connected" ? "Client" : "LAN";

  const currentVersion = useMemo(() => getCurrentVersion(state), [state]);
  const currentVersionId = currentVersion?.id ?? "";
  const versions = useMemo(() => state.versions, [state.versions]);
  const versionTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    state.tasks.forEach((task) => {
      counts.set(task.versionId, (counts.get(task.versionId) ?? 0) + 1);
    });
    return counts;
  }, [state.tasks]);

  const users = useMemo(() => {
    const byId = new Map<string, UserProfile>();
    if (isUserProfileComplete(profile)) {
      byId.set(profile.id, profile);
    }
    state.users.forEach((user) => {
      if (isUserProfileComplete(user)) {
        byId.set(user.id, user);
      }
    });
    return [...byId.values()].sort((left, right) => getUserDisplayName(left).localeCompare(getUserDisplayName(right), "zh-CN"));
  }, [profile, state.users]);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const sortedTasks = useMemo(
    () =>
      state.tasks
        .filter((task) => !currentVersionId || task.versionId === currentVersionId)
        .sort((left, right) => {
          if (left.completed !== right.completed) {
            return Number(left.completed) - Number(right.completed);
          }
          return Date.parse(left.createdAt) - Date.parse(right.createdAt);
        }),
    [currentVersionId, state.tasks]
  );

  const activeTasks = useMemo(() => sortedTasks.filter((task) => !isTaskInTrash(task)), [sortedTasks]);

  const trashedTasks = useMemo(
    () => state.tasks.filter((task) => isTaskInTrash(task) && !isExpiredTrashedTask(task)),
    [state.tasks]
  );

  const visibleTasks = useMemo(
    () => (showMineOnly ? activeTasks.filter((task) => task.assigneeId === profile.id) : activeTasks),
    [activeTasks, profile.id, showMineOnly]
  );

  const activeAssignmentTask = useMemo(
    () => activeTasks.find((task) => task.id === activeAssignmentTaskId),
    [activeAssignmentTaskId, activeTasks]
  );

  useEffect(() => {
    if (activeAssignmentTaskId && !activeTasks.some((task) => task.id === activeAssignmentTaskId)) {
      setActiveAssignmentTaskId(null);
    }
  }, [activeAssignmentTaskId, activeTasks]);

  useEffect(() => {
    if (taskMenu && !activeTasks.some((task) => task.id === taskMenu.taskId)) {
      setTaskMenu(null);
    }
  }, [activeTasks, taskMenu]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const cleanupUpdateState = window.coWorkApi.onUpdateState(setUpdateState);
    void window.coWorkApi.getUpdateState().then(setUpdateState).catch((updateError) => {
      setUpdateState((current) => ({
        ...current,
        phase: "error",
        message: getReadableError(updateError, "读取更新状态失败。")
      }));
    });

    return cleanupUpdateState;
  }, []);

  useEffect(() => {
    if (!taskMenu) {
      return;
    }

    function closeTaskMenu() {
      setTaskMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTaskMenu(null);
      }
    }

    window.addEventListener("pointerdown", closeTaskMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", closeTaskMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [taskMenu]);

  async function copyHostAddress() {
    if (!hostShareAddress) {
      return;
    }

    setError("");
    try {
      await window.coWorkApi.copyText(hostShareAddress);
      setAddressCopied(true);

      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current);
      }

      copyFeedbackTimer.current = window.setTimeout(() => {
        setAddressCopied(false);
        copyFeedbackTimer.current = null;
      }, 1400);
    } catch (copyError) {
      setAddressCopied(false);
      setError(copyError instanceof Error ? copyError.message : "复制主机地址失败。");
    }
  }

  async function checkForUpdates() {
    setError("");
    try {
      const nextUpdateState = await window.coWorkApi.checkForUpdates();
      setUpdateState(nextUpdateState);
    } catch (updateError) {
      setUpdateState((current) => ({
        ...current,
        phase: "error",
        message: getReadableError(updateError, "检查更新失败。")
      }));
    }
  }

  async function installUpdate() {
    setError("");
    try {
      await window.coWorkApi.installUpdate();
    } catch (updateError) {
      setUpdateState((current) => ({
        ...current,
        phase: "error",
        message: getReadableError(updateError, "安装更新失败。")
      }));
    }
  }

  async function createTask() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("任务标题不能为空。");
      return;
    }

    setError("");
    await window.coWorkApi.createTask(cleanTitle);
    setTitle("");
    setAdding(false);
  }

  async function createVersion(name: string) {
    setError("");
    await window.coWorkApi.createVersion(name);
  }

  async function renameVersion(versionId: string, name: string) {
    setError("");
    await window.coWorkApi.renameVersion(versionId, name);
  }

  async function deleteVersion(versionId: string) {
    setTaskMenu(null);
    setActiveAssignmentTaskId(null);
    setAdding(false);
    setError("");
    await window.coWorkApi.deleteVersion(versionId);
  }

  async function reorderVersions(versionIds: string[]) {
    setError("");
    await window.coWorkApi.reorderVersions(versionIds);
  }

  async function switchVersion(versionId: string) {
    setTaskMenu(null);
    setActiveAssignmentTaskId(null);
    setAdding(false);
    setSettingsOpen(false);
    setError("");
    await window.coWorkApi.switchVersion(versionId);
  }

  async function toggleTask(task: Task) {
    await window.coWorkApi.toggleTask(task.id, !task.completed);
  }

  async function openTaskDetail(task: Task) {
    await window.coWorkApi.openTaskDetail(task.id);
  }

  function openTaskMenu(task: Task, event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setSettingsOpen(false);
    setVersionPanelOpen(false);

    const menuWidth = 176;
    const menuHeight = 70;
    const submenuWidth = 178;
    const submenuHeight = Math.min(window.innerHeight - 16, versions.length * 30 + 10);
    const menuInset = 8;
    const panelRect = event.currentTarget.closest(".task-panel")?.getBoundingClientRect();
    const panelLeft = panelRect?.left ?? 0;
    const panelTop = panelRect?.top ?? 0;
    const panelWidth = panelRect?.width ?? window.innerWidth;
    const panelHeight = panelRect?.height ?? window.innerHeight;
    const rawMenuX = event.clientX - panelLeft;
    const rawMenuY = event.clientY - panelTop;
    const rightCascadeMaxX = panelWidth - menuWidth - submenuWidth - menuInset;
    const canFitRightCascade = rightCascadeMaxX >= menuInset;
    const menuX = canFitRightCascade
      ? Math.max(menuInset, Math.min(rawMenuX, rightCascadeMaxX))
      : Math.max(menuInset, Math.min(rawMenuX, panelWidth - menuWidth - menuInset));
    const menuY = Math.max(menuInset, Math.min(rawMenuY, panelHeight - menuHeight - menuInset));

    setTaskMenu({
      taskId: task.id,
      x: menuX,
      y: menuY,
      submenuX: canFitRightCascade ? "right" : "left",
      submenuY: menuY + submenuHeight + 8 > panelHeight ? "up" : "down"
    });
  }

  async function moveTaskToVersion(task: Task, versionId: string) {
    setTaskMenu(null);
    setActiveAssignmentTaskId(null);
    setError("");

    try {
      await window.coWorkApi.moveTaskToVersion(task.id, versionId);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "移动任务失败。");
    }
  }

  async function moveTaskToTrash(task: Task) {
    setTaskMenu(null);
    setActiveAssignmentTaskId(null);
    setError("");

    try {
      await window.coWorkApi.moveTaskToTrash(task.id);
    } catch (trashError) {
      setError(trashError instanceof Error ? trashError.message : "删除失败。");
    }
  }

  async function restoreTask(task: Task) {
    setTaskMenu(null);
    setActiveAssignmentTaskId(null);
    setError("");

    try {
      await window.coWorkApi.restoreTask(task.id);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复任务失败。");
    }
  }

  async function assignTask(userId: string) {
    if (!activeAssignmentTaskId) {
      return;
    }

    setError("");
    try {
      await window.coWorkApi.assignTask(activeAssignmentTaskId, userId);
      setActiveAssignmentTaskId(null);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "分配任务失败。");
    }
  }

  const contextMenuTask = taskMenu ? activeTasks.find((task) => task.id === taskMenu.taskId) : null;

  return (
    <main className="app-panel task-panel">
      <MainWindowResizeHandle edge="top" />
      <aside className="side-rail">
        <div className="current-user">
          <button className="current-user-avatar" type="button" title="修改账号资料" aria-label="修改账号资料" onClick={onEditProfile}>
            <Avatar user={profile} size="md" />
          </button>
          <span>{getUserDisplayName(profile)}</span>
        </div>
        <button
          className="scope-button"
          title={showMineOnly ? "显示全部任务" : "只显示我的任务"}
          aria-pressed={showMineOnly}
          onClick={() => setShowMineOnly((current) => !current)}
        >
          {showMineOnly ? "All" : "My"}
          <span>Task</span>
        </button>
      </aside>

      <section className="task-surface">
        <div className="drag-bar task-drag">
          <button
            className={`status-pill${addressCopied ? " status-pill-copied" : ""}`}
            type="button"
            title={hostShareAddress ? `复制主机地址：${hostShareAddress}` : "等待主机地址"}
            aria-disabled={!hostShareAddress}
            onClick={() => void copyHostAddress()}
          >
            <Wifi size={13} />
            <span>{statusLabel}</span>
          </button>
          <button
            className={`version-button${versionPanelOpen ? " active" : ""}`}
            type="button"
            title={currentVersion ? `当前版本：${currentVersion.name}` : "当前版本"}
            onClick={() => {
              setTaskMenu(null);
              setActiveAssignmentTaskId(null);
              setSettingsOpen(false);
              setVersionPanelOpen((current) => !current);
            }}
          >
            <Layers size={13} />
            <span>当前版本：{currentVersion?.name ?? "默认版本"}</span>
          </button>
          <WindowControls
            pinned={pinned}
            onTogglePin={onTogglePin}
            onOpenSettings={() => {
              setTaskMenu(null);
              setActiveAssignmentTaskId(null);
              setVersionPanelOpen(false);
              setSettingsOpen((current) => !current);
            }}
            onMinimize={onMinimize}
          />
        </div>

        <div className="task-list">
          {visibleTasks.length === 0 ? (
            <div className="empty-state">{showMineOnly ? "还没有分配给你的任务" : "还没有任务"}</div>
          ) : (
            visibleTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                assignee={task.assigneeId ? usersById.get(task.assigneeId) : undefined}
                onToggle={(item) => void toggleTask(item)}
                onAssignClick={(item) => setActiveAssignmentTaskId(item.id)}
                onOpenDetail={(item) => void openTaskDetail(item)}
                onOpenMenu={(item, event) => openTaskMenu(item, event)}
              />
            ))
          )}
        </div>

        {activeAssignmentTask ? (
          <AssignmentPopover
            users={users}
            currentAssigneeId={activeAssignmentTask.assigneeId}
            onAssign={(userId) => void assignTask(userId)}
            onClose={() => setActiveAssignmentTaskId(null)}
          />
        ) : null}

        {versionPanelOpen ? (
          <VersionPopover
            versions={versions}
            currentVersionId={currentVersionId}
            taskCountsByVersion={versionTaskCounts}
            onClose={() => setVersionPanelOpen(false)}
            onCreateVersion={createVersion}
            onRenameVersion={renameVersion}
            onDeleteVersion={deleteVersion}
            onReorderVersions={reorderVersions}
            onSwitchVersion={switchVersion}
          />
        ) : null}

        {settingsOpen ? (
          <SettingsPanel
            theme={theme}
            trashedTasks={trashedTasks}
            updateState={updateState}
            onClose={() => setSettingsOpen(false)}
            onCheckForUpdates={checkForUpdates}
            onInstallUpdate={installUpdate}
            onThemeChange={onThemeChange}
            onOpenTask={openTaskDetail}
            onRestoreTask={restoreTask}
          />
        ) : null}

        {adding ? (
          <form
            className="add-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createTask();
            }}
          >
            <input
              autoFocus
              value={title}
              maxLength={40}
              placeholder="新增任务"
              onChange={(event) => setTitle(event.target.value)}
            />
            <button className="icon-button solid" type="submit" title="添加">
              <Check size={15} />
            </button>
            <button className="icon-button" type="button" title="取消" onClick={() => setAdding(false)}>
              <X size={15} />
            </button>
          </form>
        ) : (
          <button className="add-task-button" onClick={() => setAdding(true)}>
            <Plus size={22} />
          </button>
        )}

        {error ? <div className="floating-error">{error}</div> : null}
      </section>

      {contextMenuTask && taskMenu ? (
        <TaskContextMenu
          task={contextMenuTask}
          versions={versions}
          x={taskMenu.x}
          y={taskMenu.y}
          submenuX={taskMenu.submenuX}
          submenuY={taskMenu.submenuY}
          onMoveToVersion={moveTaskToVersion}
          onMoveToTrash={moveTaskToTrash}
        />
      ) : null}

      <MainWindowResizeHandle edge="bottom" />
    </main>
  );
}

function TaskDetailView({ taskId, state }: { taskId: string | null; state: HostData }) {
  const task = useMemo(() => state.tasks.find((item) => item.id === taskId), [state.tasks, taskId]);
  const usersById = useMemo(() => new Map(state.users.map((user) => [user.id, user])), [state.users]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshots, setScreenshots] = useState<TaskScreenshot[]>([]);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [preview, setPreview] = useState<TaskScreenshot | null>(null);

  useEffect(() => {
    if (!task) {
      return;
    }

    setTitle(task.title);
    setDescription(task.description ?? "");
    setScreenshots(task.screenshots ?? []);
    setError("");
    setSavedMessage("");
  }, [task?.id, task?.updatedAt]);

  async function addScreenshotFiles(files: File[]) {
    const imageFiles = files.filter((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
    if (imageFiles.length === 0) {
      setError("请选择或粘贴 PNG、JPG、WebP 图片。");
      return;
    }

    if (screenshots.length + imageFiles.length > MAX_TASK_SCREENSHOTS) {
      setError(`每个任务最多只能附加 ${MAX_TASK_SCREENSHOTS} 张截图。`);
      return;
    }

    setError("");
    const compressed = await Promise.all(imageFiles.map(compressImageFile));
    setScreenshots((current) => [...current, ...compressed].slice(0, MAX_TASK_SCREENSHOTS));
    setSavedMessage("");
  }

  async function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const files = [...event.clipboardData.files];
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    try {
      await addScreenshotFiles(files);
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : "粘贴截图失败。");
    }
  }

  async function saveDetails() {
    if (!task) {
      return;
    }

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("任务标题不能为空。");
      return;
    }

    setSaving(true);
    setError("");
    setSavedMessage("");

    try {
      await window.coWorkApi.updateTaskDetails(task.id, cleanTitle, description, screenshots);
      setSavedMessage("已保存");
      await window.coWorkApi.closeWindow();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存任务详情失败。");
    } finally {
      setSaving(false);
    }
  }

  async function restoreTaskFromDetail() {
    if (!task) {
      return;
    }

    setRestoring(true);
    setError("");
    setSavedMessage("");

    try {
      await window.coWorkApi.restoreTask(task.id);
      setSavedMessage("已恢复");
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复任务失败。");
    } finally {
      setRestoring(false);
    }
  }

  if (!task) {
    return (
      <main className="detail-window">
        <header className="detail-header">
          <div>
            <p>任务详情</p>
            <h1>未找到任务</h1>
          </div>
          <DetailWindowControls />
        </header>
        <section className="detail-empty">这个任务可能已经被删除，或当前窗口还没有收到主机状态。</section>
      </main>
    );
  }

  const taskIsTrashed = isTaskInTrash(task);
  const creator = task.creatorId ? usersById.get(task.creatorId) : undefined;
  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const creatorName = getTaskPersonDisplayName(creator, task.creatorId, "未记录");
  const assigneeName = getTaskPersonDisplayName(assignee, task.assigneeId, "未分配");

  return (
    <main className="detail-window" onPaste={(event) => void handlePaste(event)}>
      <header className="detail-header">
        <div className="detail-header-main">
          <p>任务详情</p>
          <h1>{task.title}</h1>
        </div>
        <div className="detail-header-right">
          <div className="detail-user-meta" aria-label="任务人员信息">
            <div className="detail-user-card" title={`任务创建人：${creatorName}`}>
              <span>任务创建人</span>
              <div>
                <Avatar user={creator} size="sm" />
                <strong>{creatorName}</strong>
              </div>
            </div>
            <div className="detail-user-card" title={`任务当前所属人：${assigneeName}`}>
              <span>当前所属人</span>
              <div>
                <Avatar user={assignee} size="sm" />
                <strong>{assigneeName}</strong>
              </div>
            </div>
          </div>
          <DetailWindowControls />
        </div>
      </header>

      <section className="detail-content">
        <label className="detail-field">
          <span>任务名字</span>
          <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label className="detail-field detail-description">
          <span>任务描述</span>
          <textarea
            value={description}
            maxLength={3000}
            placeholder="写下需求、复现步骤、验收标准或注意事项。"
            onChange={(event) => {
              setDescription(event.target.value);
              setSavedMessage("");
            }}
          />
        </label>

        <div className="detail-screenshot-block">
          <div className="detail-section-title">
            <span>附加截图</span>
            <small>
              {screenshots.length}/{MAX_TASK_SCREENSHOTS}
            </small>
          </div>

          <div className="screenshot-actions">
            <label className="secondary-button">
              <Upload size={15} />
              选择图片
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = "";
                  void addScreenshotFiles(files).catch((fileError) =>
                    setError(fileError instanceof Error ? fileError.message : "添加截图失败。")
                  );
                }}
              />
            </label>
            <div className="paste-hint">
              <Clipboard size={14} />
              Ctrl+V 粘贴截图
            </div>
          </div>

          {screenshots.length === 0 ? (
            <div className="screenshot-empty">
              <ImageIcon size={22} />
              <span>还没有截图</span>
            </div>
          ) : (
            <div className="screenshot-grid">
              {screenshots.map((screenshot) => (
                <figure key={screenshot.id} className="screenshot-card">
                  <button className="screenshot-preview-button" title="查看截图" onClick={() => setPreview(screenshot)}>
                    <img src={screenshot.dataUrl} alt={screenshot.name} />
                  </button>
                  <figcaption>
                    <span>{screenshot.name}</span>
                    <button
                      className="icon-button danger"
                      title="删除截图"
                      onClick={() => {
                        setScreenshots((current) => current.filter((item) => item.id !== screenshot.id));
                        setSavedMessage("");
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className="detail-footer">
        <div className="detail-message">
          {error ? <span className="error-text">{error}</span> : savedMessage ? <span className="success-text">{savedMessage}</span> : null}
        </div>
        <button className="primary-button save-button" disabled={saving} onClick={() => void saveDetails()}>
          {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
          保存
        </button>
        {taskIsTrashed ? (
          <button className="primary-button restore-button" disabled={restoring} onClick={() => void restoreTaskFromDetail()}>
            {restoring ? <Loader2 className="spin" size={16} /> : <RotateCcw size={16} />}
            恢复
          </button>
        ) : null}
      </footer>

      {preview ? (
        <div className="image-preview-layer">
          <button className="image-preview-backdrop" title="关闭预览" onClick={() => setPreview(null)} />
          <div className="image-preview-panel">
            <img src={preview.dataUrl} alt={preview.name} />
            <button className="icon-button" title="关闭预览" onClick={() => setPreview(null)}>
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export function App() {
  const detailRoute = useMemo(getDetailRoute, []);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [state, setState] = useState<HostData>(EMPTY_STATE);
  const [preferences, setPreferences] = useState<AppPreferences>({});
  const [status, setStatus] = useState<ConnectionStatus>({ phase: "idle", message: "未连接" });
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [compactTaskSnapshot, setCompactTaskSnapshot] = useState<Map<string, CompactTaskSnapshot> | null>(null);
  const currentTheme = getValidTheme(preferences.theme);
  const isTaskMainView = !detailRoute.isDetail && !loading && !compactMode && connected && profile !== null && !editingProfile;

  useEffect(() => {
    const cleanupState = window.coWorkApi.onState((nextState) => {
      setState(nextState);
    });
    const cleanupStatus = window.coWorkApi.onConnectionStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus.phase === "connected") {
        setConnected(true);
      }
      if (nextStatus.phase === "disconnected" || nextStatus.phase === "idle") {
        setConnected(false);
        setProfile(null);
        setEditingProfile(false);
        setState(EMPTY_STATE);
      }
    });
    const cleanupHost = window.coWorkApi.onHostInfo(setHostInfo);
    const cleanupCompactMode = window.coWorkApi.onCompactMode(setCompactMode);

    void Promise.all([
      window.coWorkApi.getState().then(setState),
      window.coWorkApi.getPreferences().then(setPreferences),
      window.coWorkApi.getLanAddresses().then(setLanUrls)
    ]).finally(() => setLoading(false));

    return () => {
      cleanupState();
      cleanupStatus();
      cleanupHost();
      cleanupCompactMode();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = currentTheme;

    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [currentTheme]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    const nextProfile = state.users.find((user) => user.id === profile.id);
    if (!nextProfile) {
      return;
    }

    if (
      nextProfile.name !== profile.name ||
      nextProfile.avatarDataUrl !== profile.avatarDataUrl ||
      nextProfile.lastSeenAt !== profile.lastSeenAt ||
      nextProfile.profileComplete !== profile.profileComplete
    ) {
      setProfile(nextProfile);
    }
  }, [profile, state.users]);

  useEffect(() => {
    if (loading || detailRoute.isDetail || compactMode || isTaskMainView) {
      return;
    }

    void window.coWorkApi.resetMainWindowSize();
  }, [compactMode, detailRoute.isDetail, isTaskMainView, loading]);

  async function togglePinned() {
    const next = !pinned;
    await window.coWorkApi.setAlwaysOnTop(next);
    setPinned(next);
  }

  function enterCompactMode() {
    setCompactTaskSnapshot(createCompactTaskSnapshot(getCurrentVersionTasks(state)));
    setCompactMode(true);
    void window.coWorkApi.minimizeWindow();
  }

  async function restoreFromCompactMode() {
    setCompactMode(false);
    setCompactTaskSnapshot(null);
    await window.coWorkApi.restoreWindow();
  }

  function handleAuthResult(result: AccountAuthResult) {
    setPreferences((current) => ({ ...current, lastAccountId: result.profile.id }));
    setProfile(result.profile);
    setEditingProfile(result.requiresProfileSetup);
  }

  async function changeTheme(theme: AppTheme) {
    const nextPreferences = await window.coWorkApi.patchPreferences({ theme });
    setPreferences(nextPreferences);
  }

  const compactVersionTasks = useMemo(() => getCurrentVersionTasks(state), [state]);
  const compactMetrics = useMemo(() => {
    if (!profile) {
      return {
        taskCount: 0,
        changeCount: 0
      };
    }

    return {
      taskCount: countMyActiveTasks(compactVersionTasks, profile.id),
      changeCount: countCompactTaskChanges(compactVersionTasks, compactTaskSnapshot, profile.id)
    };
  }, [compactTaskSnapshot, compactVersionTasks, profile]);

  if (loading) {
    return (
      <main className="app-panel loading-panel">
        <Loader2 className="spin" size={22} />
      </main>
    );
  }

  if (detailRoute.isDetail) {
    return <TaskDetailView taskId={detailRoute.taskId} state={state} />;
  }

  if (compactMode) {
    return (
      <CompactIcon
        user={profile ?? undefined}
        taskCount={compactMetrics.taskCount}
        changeCount={compactMetrics.changeCount}
        onRestore={() => void restoreFromCompactMode()}
      />
    );
  }

  if (!connected) {
    return (
      <ConnectView
        status={status}
        hostInfo={hostInfo}
        lanUrls={lanUrls}
        initialJoinAddress={preferences.lastJoinAddress ?? ""}
        onConnected={() => setConnected(true)}
        onJoined={(lastJoinAddress) => setPreferences((current) => ({ ...current, lastJoinAddress }))}
        onMinimize={enterCompactMode}
      />
    );
  }

  if (!profile) {
    return (
      <AccountView
        status={status}
        initialAccountId={preferences.lastAccountId ?? ""}
        onAuthenticated={handleAuthResult}
        onMinimize={enterCompactMode}
      />
    );
  }

  if (editingProfile) {
    return (
      <ProfileSetupView
        profile={profile}
        mode={isUserProfileComplete(profile) ? "edit" : "setup"}
        onSaved={(nextProfile) => {
          setProfile(nextProfile);
          setEditingProfile(false);
        }}
        onMinimize={enterCompactMode}
      />
    );
  }

  return (
    <TaskApp
      profile={profile}
      state={state}
      status={status}
      hostInfo={hostInfo}
      theme={currentTheme}
      pinned={pinned}
      onTogglePin={() => void togglePinned()}
      onEditProfile={() => setEditingProfile(true)}
      onThemeChange={changeTheme}
      onMinimize={enterCompactMode}
    />
  );
}
