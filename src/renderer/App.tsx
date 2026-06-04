import { useEffect, useMemo, useState } from "react";
import type { ClipboardEvent } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  Clipboard,
  Image as ImageIcon,
  Loader2,
  Minus,
  Pin,
  PinOff,
  Plus,
  Save,
  Server,
  Trash2,
  Upload,
  UserRound,
  Wifi,
  X
} from "lucide-react";
import {
  MAX_SCREENSHOT_EDGE,
  MAX_TASK_SCREENSHOTS,
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

function nowIso(): string {
  return new Date().toISOString();
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) {
    return "?";
  }
  return clean.slice(0, 2).toUpperCase();
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
  return (
    <div className={`avatar avatar-${size}`} title={user?.name ?? "未分配"}>
      {user?.avatarDataUrl ? <img src={user.avatarDataUrl} alt={user.name} /> : <span>{initials(user?.name ?? "?")}</span>}
    </div>
  );
}

function WindowControls({ pinned, onTogglePin }: { pinned: boolean; onTogglePin: () => void }) {
  return (
    <div className="window-controls">
      <button className="icon-button" title={pinned ? "取消置顶" : "窗口置顶"} onClick={onTogglePin}>
        {pinned ? <Pin size={14} /> : <PinOff size={14} />}
      </button>
      <button className="icon-button" title="最小化" onClick={() => void window.coWorkApi.minimizeWindow()}>
        <Minus size={15} />
      </button>
      <button className="icon-button danger" title="关闭" onClick={() => void window.coWorkApi.closeWindow()}>
        <X size={15} />
      </button>
    </div>
  );
}

function SetupView({
  initialProfile,
  onSaved
}: {
  initialProfile: UserProfile | null;
  onSaved: (profile: UserProfile) => void;
}) {
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(initialProfile?.avatarDataUrl ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("请输入昵称。");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const saved = await window.coWorkApi.saveLocalProfile({
        id: initialProfile?.id,
        name: cleanName,
        avatarDataUrl: avatarDataUrl || undefined,
        lastSeenAt: nowIso()
      });
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
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
    id: initialProfile?.id ?? "preview",
    name: name || "Player",
    avatarDataUrl: avatarDataUrl || undefined,
    lastSeenAt: nowIso()
  };

  return (
    <main className="app-panel setup-panel">
      <div className="drag-bar">
        <span>协作任务</span>
        <WindowControls pinned={true} onTogglePin={() => undefined} />
      </div>
      <section className="identity-layout">
        <label className="avatar-picker">
          <Avatar user={previewUser} size="lg" />
          <input type="file" accept="image/*" onChange={(event) => handleAvatarFile(event.target.files?.[0])} />
          <span>选择头像</span>
        </label>
        <div className="setup-fields">
          <div>
            <label htmlFor="display-name">昵称</label>
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
          {error ? <p className="error-text">{error}</p> : <p className="muted-text">资料只保存在本机，并在加入局域网主机时同步。</p>}
          <button className="primary-button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="spin" size={16} /> : <UserRound size={16} />}
            保存身份
          </button>
        </div>
      </section>
    </main>
  );
}

function ConnectView({
  profile,
  status,
  hostInfo,
  lanUrls,
  onConnected
}: {
  profile: UserProfile;
  status: ConnectionStatus;
  hostInfo: HostInfo | null;
  lanUrls: string[];
  onConnected: () => void;
}) {
  const [joinAddress, setJoinAddress] = useState("");
  const [busy, setBusy] = useState<"host" | "join" | null>(null);
  const [error, setError] = useState("");

  async function startHost() {
    setBusy("host");
    setError("");
    try {
      await window.coWorkApi.startHost(profile);
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
      await window.coWorkApi.joinHost(joinAddress, profile);
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
        <div className="profile-strip">
          <Avatar user={profile} size="sm" />
          <span>{profile.name}</span>
        </div>
        <WindowControls pinned={true} onTogglePin={() => undefined} />
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

function TaskRow({
  task,
  assignee,
  onToggle,
  onAssignClick,
  onOpenDetail
}: {
  task: Task;
  assignee?: UserProfile;
  onToggle: (task: Task) => void;
  onAssignClick: (task: Task) => void;
  onOpenDetail: (task: Task) => void;
}) {
  return (
    <div className={`task-row ${task.completed ? "task-done" : ""}`}>
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
              title={user.name}
              onClick={() => onAssign(user.id)}
            >
              <Avatar user={user} size="md" />
              <span>{user.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskApp({
  profile,
  state,
  status,
  hostInfo,
  pinned,
  onTogglePin
}: {
  profile: UserProfile;
  state: HostData;
  status: ConnectionStatus;
  hostInfo: HostInfo | null;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [showMineOnly, setShowMineOnly] = useState(false);
  const [activeAssignmentTaskId, setActiveAssignmentTaskId] = useState<string | null>(null);

  const users = useMemo(() => {
    const byId = new Map<string, UserProfile>();
    byId.set(profile.id, profile);
    state.users.forEach((user) => byId.set(user.id, user));
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
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

  const visibleTasks = useMemo(
    () => (showMineOnly ? sortedTasks.filter((task) => task.assigneeId === profile.id) : sortedTasks),
    [profile.id, showMineOnly, sortedTasks]
  );

  const activeAssignmentTask = useMemo(
    () => state.tasks.find((task) => task.id === activeAssignmentTaskId),
    [activeAssignmentTaskId, state.tasks]
  );

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

  return (
    <main className="app-panel task-panel">
      <aside className="side-rail">
        <div className="current-user">
          <Avatar user={profile} size="md" />
          <span>{profile.name}</span>
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
          <div className="status-pill">
            <Wifi size={13} />
            <span>{hostInfo ? "Host" : status.phase === "connected" ? "Client" : "LAN"}</span>
          </div>
          <WindowControls pinned={pinned} onTogglePin={onTogglePin} />
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

  if (!task) {
    return (
      <main className="detail-window">
        <header className="detail-header">
          <div>
            <p>任务详情</p>
            <h1>未找到任务</h1>
          </div>
          <button className="icon-button" title="关闭" onClick={() => void window.coWorkApi.closeWindow()}>
            <X size={16} />
          </button>
        </header>
        <section className="detail-empty">这个任务可能已经被删除，或当前窗口还没有收到主机状态。</section>
      </main>
    );
  }

  return (
    <main className="detail-window" onPaste={(event) => void handlePaste(event)}>
      <header className="detail-header">
        <div>
          <p>任务详情</p>
          <h1>{task.title}</h1>
        </div>
        <button className="icon-button" title="关闭" onClick={() => void window.coWorkApi.closeWindow()}>
          <X size={16} />
        </button>
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
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const cleanupState = window.coWorkApi.onState((nextState) => {
      setState(nextState);
      setConnected(true);
    });
    const cleanupStatus = window.coWorkApi.onConnectionStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus.phase === "disconnected" || nextStatus.phase === "idle") {
        setConnected(false);
      }
    });
    const cleanupHost = window.coWorkApi.onHostInfo(setHostInfo);

    void window.coWorkApi.getLocalProfile().then((savedProfile) => {
      setProfile(savedProfile);
      setLoading(false);
    });
    void window.coWorkApi.getState().then(setState);
    void window.coWorkApi.getLanAddresses().then(setLanUrls);

    return () => {
      cleanupState();
      cleanupStatus();
      cleanupHost();
    };
  }, []);

  async function togglePinned() {
    const next = !pinned;
    await window.coWorkApi.setAlwaysOnTop(next);
    setPinned(next);
  }

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

  if (!profile) {
    return <SetupView initialProfile={profile} onSaved={setProfile} />;
  }

  if (!connected) {
    return (
      <ConnectView
        profile={profile}
        status={status}
        hostInfo={hostInfo}
        lanUrls={lanUrls}
        onConnected={() => setConnected(true)}
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
    />
  );
}
