import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Circle,
  Loader2,
  Minus,
  Pin,
  PinOff,
  Plus,
  Server,
  UserRound,
  Wifi,
  X
} from "lucide-react";
import type { ConnectionStatus, HostData, HostInfo, Task, UserProfile } from "../shared/types";

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
  onAssignClick
}: {
  task: Task;
  assignee?: UserProfile;
  onToggle: (task: Task) => void;
  onAssignClick: (task: Task) => void;
}) {
  return (
    <div className={`task-row ${task.completed ? "task-done" : ""}`}>
      <button className="task-check" title={task.completed ? "标记为未完成" : "标记为完成"} onClick={() => onToggle(task)}>
        {task.completed ? <Check size={18} /> : <Circle size={18} />}
      </button>
      <span className="task-title">{task.title}</span>
      <button className="assignment-avatar-button" title="更换负责人" onClick={() => onAssignClick(task)}>
        <Avatar user={assignee} size="sm" />
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
  currentAssigneeId: string;
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
  const [assigneeId, setAssigneeId] = useState(profile.id);
  const [error, setError] = useState("");
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
    await window.coWorkApi.createTask(cleanTitle, assigneeId);
    setTitle("");
    setAssigneeId(profile.id);
    setAdding(false);
  }

  async function toggleTask(task: Task) {
    await window.coWorkApi.toggleTask(task.id, !task.completed);
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
        <button className="scope-button" title="显示全部任务">
          All
          <span>Tasks</span>
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
          {sortedTasks.length === 0 ? (
            <div className="empty-state">还没有任务</div>
          ) : (
            sortedTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                assignee={usersById.get(task.assigneeId)}
                onToggle={(item) => void toggleTask(item)}
                onAssignClick={(item) => setActiveAssignmentTaskId(item.id)}
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
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
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

export function App() {
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
