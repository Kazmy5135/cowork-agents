import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  Clipboard,
  Image as ImageIcon,
  LogIn,
  Loader2,
  Pin,
  PinOff,
  Plus,
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
  MAX_SCREENSHOT_EDGE,
  MAX_TASK_SCREENSHOTS,
  TRASH_RETENTION_DAYS,
  type AccountAuthResult,
  type ConnectionStatus,
  type HostData,
  type HostInfo,
  type Task,
  type TaskScreenshot,
  type UserProfile
} from "../shared/types";

const EMPTY_STATE: HostData = {
  users: [],
  tasks: []
};
const ACCOUNT_ID_REGEX = new RegExp(`^\\d{${ACCOUNT_ID_LENGTH}}$`);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * MS_PER_DAY;
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

function normalizeAccountInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, ACCOUNT_ID_LENGTH);
}

function getAccountError(accountId: string): string {
  return ACCOUNT_ID_REGEX.test(accountId) ? "" : `请输入 ${ACCOUNT_ID_LENGTH} 位数字账号。`;
}

function getUserDisplayName(user?: UserProfile): string {
  return user?.name.trim() || user?.id || "未分配";
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
  onConnected,
  onMinimize
}: {
  status: ConnectionStatus;
  hostInfo: HostInfo | null;
  lanUrls: string[];
  onConnected: () => void;
  onMinimize: () => void;
}) {
  const [joinAddress, setJoinAddress] = useState("");
  const [busy, setBusy] = useState<"host" | "join" | null>(null);
  const [error, setError] = useState("");

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
      await window.coWorkApi.joinHost(joinAddress);
      onConnected();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "连接失败。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-panel connect-panel">
      <div className="drag-bar">
        <span>协作任务</span>
        <WindowControls pinned={true} onTogglePin={() => undefined} onMinimize={onMinimize} />
      </div>
      <section className="connect-grid">
        <button className="connect-action" disabled={busy !== null} onClick={() => void startHost()}>
          {busy === "host" ? <Loader2 className="spin" size={18} /> : <Server size={18} />}
          作为主机启动
        </button>
        <div className="join-box">
          <div className="join-input-row">
            <input
              value={joinAddress}
              placeholder="192.168.1.20:48731"
              onChange={(event) => setJoinAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void joinHost();
                }
              }}
            />
            <button className="icon-button solid" disabled={busy !== null} title="加入主机" onClick={() => void joinHost()}>
              {busy === "join" ? <Loader2 className="spin" size={15} /> : <Wifi size={15} />}
            </button>
          </div>
          <p className="muted-text">{hostInfo?.url ?? lanUrls[0] ?? "等待局域网地址"}</p>
        </div>
      </section>
      <div className="status-line">
        {error || status.phase === "error" ? <AlertCircle size={14} /> : <Wifi size={14} />}
        <span>{error || status.message || "未连接"}</span>
      </div>
    </main>
  );
}

function AccountView({
  status,
  onAuthenticated,
  onMinimize
}: {
  status: ConnectionStatus;
  onAuthenticated: (result: AccountAuthResult) => void;
  onMinimize: () => void;
}) {
  const [accountId, setAccountId] = useState("");
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
  x,
  y,
  onMoveToTrash
}: {
  task: Task;
  x: number;
  y: number;
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
        <button className="task-menu-item danger" role="menuitem" onClick={() => void onMoveToTrash(task)}>
          <Trash2 size={14} />
          移动到垃圾桶
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

function SettingsPanel({
  trashedTasks,
  onClose,
  onOpenTask,
  onRestoreTask
}: {
  trashedTasks: Task[];
  onClose: () => void;
  onOpenTask: (task: Task) => Promise<void>;
  onRestoreTask: (task: Task) => Promise<void>;
}) {
  const sortedTrashedTasks = useMemo(
    () =>
      [...trashedTasks].sort((left, right) => {
        return Date.parse(right.trashedAt ?? right.updatedAt) - Date.parse(left.trashedAt ?? left.updatedAt);
      }),
    [trashedTasks]
  );

  return (
    <div className="settings-panel" role="dialog" aria-label="基础设置">
      <aside className="settings-sidebar">
        <div className="settings-title">基础设置</div>
        <button className="settings-nav-item selected" type="button" aria-pressed="true">
          <Trash2 size={15} />
          <span>垃圾桶</span>
          <strong>{sortedTrashedTasks.length}</strong>
        </button>
      </aside>

      <section className="settings-content">
        <header className="settings-content-header">
          <div>
            <p>垃圾桶</p>
            <span>{TRASH_RETENTION_DAYS} 天后永久清除</span>
          </div>
          <button className="icon-button" title="关闭设置" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        {sortedTrashedTasks.length === 0 ? (
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
  pinned,
  onTogglePin,
  onEditProfile,
  onMinimize
}: {
  profile: UserProfile;
  state: HostData;
  status: ConnectionStatus;
  hostInfo: HostInfo | null;
  pinned: boolean;
  onTogglePin: () => void;
  onEditProfile: () => void;
  onMinimize: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [showMineOnly, setShowMineOnly] = useState(false);
  const [activeAssignmentTaskId, setActiveAssignmentTaskId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [taskMenu, setTaskMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);
  const hostShareAddress = hostInfo?.url ?? hostInfo?.addresses[0] ?? "";
  const statusLabel = addressCopied ? "已复制" : hostInfo ? "Host" : status.phase === "connected" ? "Client" : "LAN";

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
      [...state.tasks].sort((left, right) => {
        if (left.completed !== right.completed) {
          return Number(left.completed) - Number(right.completed);
        }
        return Date.parse(left.createdAt) - Date.parse(right.createdAt);
      }),
    [state.tasks]
  );

  const activeTasks = useMemo(() => sortedTasks.filter((task) => !isTaskInTrash(task)), [sortedTasks]);

  const trashedTasks = useMemo(
    () => sortedTasks.filter((task) => isTaskInTrash(task) && !isExpiredTrashedTask(task)),
    [sortedTasks]
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

    const menuWidth = 164;
    const menuHeight = 40;
    setTaskMenu({
      taskId: task.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    });
  }

  async function moveTaskToTrash(task: Task) {
    setTaskMenu(null);
    setActiveAssignmentTaskId(null);
    setError("");

    try {
      await window.coWorkApi.moveTaskToTrash(task.id);
    } catch (trashError) {
      setError(trashError instanceof Error ? trashError.message : "移动到垃圾桶失败。");
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
          <WindowControls
            pinned={pinned}
            onTogglePin={onTogglePin}
            onOpenSettings={() => {
              setTaskMenu(null);
              setActiveAssignmentTaskId(null);
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

        {settingsOpen ? (
          <SettingsPanel
            trashedTasks={trashedTasks}
            onClose={() => setSettingsOpen(false)}
            onOpenTask={openTaskDetail}
            onRestoreTask={restoreTask}
          />
        ) : null}

        {contextMenuTask && taskMenu ? (
          <TaskContextMenu
            task={contextMenuTask}
            x={taskMenu.x}
            y={taskMenu.y}
            onMoveToTrash={moveTaskToTrash}
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
    </main>
  );
}

function TaskDetailView({ taskId, state }: { taskId: string | null; state: HostData }) {
  const task = useMemo(() => state.tasks.find((item) => item.id === taskId), [state.tasks, taskId]);
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

  return (
    <main className="detail-window" onPaste={(event) => void handlePaste(event)}>
      <header className="detail-header">
        <div>
          <p>任务详情</p>
          <h1>{task.title}</h1>
        </div>
        <DetailWindowControls />
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
        <button className="secondary-button plain" onClick={() => void window.coWorkApi.closeWindow()}>
          关闭
        </button>
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
  const [status, setStatus] = useState<ConnectionStatus>({ phase: "idle", message: "未连接" });
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [compactTaskSnapshot, setCompactTaskSnapshot] = useState<Map<string, CompactTaskSnapshot> | null>(null);

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

    void Promise.all([window.coWorkApi.getState().then(setState), window.coWorkApi.getLanAddresses().then(setLanUrls)]).finally(() =>
      setLoading(false)
    );

    return () => {
      cleanupState();
      cleanupStatus();
      cleanupHost();
      cleanupCompactMode();
    };
  }, []);

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

  async function togglePinned() {
    const next = !pinned;
    await window.coWorkApi.setAlwaysOnTop(next);
    setPinned(next);
  }

  function enterCompactMode() {
    setCompactTaskSnapshot(createCompactTaskSnapshot(state.tasks));
    setCompactMode(true);
    void window.coWorkApi.minimizeWindow();
  }

  async function restoreFromCompactMode() {
    setCompactMode(false);
    setCompactTaskSnapshot(null);
    await window.coWorkApi.restoreWindow();
  }

  function handleAuthResult(result: AccountAuthResult) {
    setProfile(result.profile);
    setEditingProfile(result.requiresProfileSetup);
  }

  const compactMetrics = useMemo(() => {
    if (!profile) {
      return {
        taskCount: 0,
        changeCount: 0
      };
    }

    return {
      taskCount: countMyActiveTasks(state.tasks, profile.id),
      changeCount: countCompactTaskChanges(state.tasks, compactTaskSnapshot, profile.id)
    };
  }, [compactTaskSnapshot, profile, state.tasks]);

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
        onConnected={() => setConnected(true)}
        onMinimize={enterCompactMode}
      />
    );
  }

  if (!profile) {
    return (
      <AccountView
        status={status}
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
      pinned={pinned}
      onTogglePin={() => void togglePinned()}
      onEditProfile={() => setEditingProfile(true)}
      onMinimize={enterCompactMode}
    />
  );
}
