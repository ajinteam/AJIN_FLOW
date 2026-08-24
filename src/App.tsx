import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Project,
  Process,
  Task,
  PROCESS_LIST,
  ProcessName,
  TaskStatus,
  UserConfig,
  ProcessPart,
  InfoProject,
  InfoFile,
} from './types';
import { format, parseISO } from 'date-fns';
import {
  Plus,
  Settings as SettingsIcon,
  LogOut,
  ChevronRight,
  Edit2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Trash2,
  Save,
  X,
  Users,
  Layers,
  FileText,
  ShieldAlert,
  ArrowRightLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { InfoView } from './components/InfoView';
import { UserManagementModal } from './components/UserManagementModal';
import { fetchInfoData, saveInfoData } from './lib/api';
import * as Processes from './processes';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PROCESS_COLORS: Record<ProcessName, string> = {
  사출: 'bg-sky-50/50',
  인쇄: 'bg-indigo-50/50',
  메탈: 'bg-slate-100/50',
  PAINT: 'bg-rose-50/50',
  PRINT: 'bg-orange-50/50',
  가공: 'bg-emerald-50/50',
  조립: 'bg-amber-50/50',
  포장: 'bg-teal-50/50',
};

const MASTER_PASSWORD = 'AJ5200';

// Simple Auth Component
const Auth = ({
  users,
  onLogin,
}: {
  users: UserConfig[];
  onLogin: (initials: string, password: string, userObj?: UserConfig) => void;
}) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const inputPassword = password.trim().toUpperCase();

      if (inputPassword === MASTER_PASSWORD.toUpperCase()) {
        const masterUser: UserConfig = {
          id: 'master',
          initials: 'MASTER',
          name: '최고관리자',
          password: MASTER_PASSWORD,
          isAuthorized: true,
          canAccessFlow: true,
          canAccessInfo: true,
          canManageInfo: true,
        };
        onLogin('MASTER', MASTER_PASSWORD, masterUser);
        localStorage.setItem('isAuthorized', 'true');
        localStorage.setItem('currentUserPassword', MASTER_PASSWORD);
        return;
      }

      if (inputPassword === '5200') {
        const user5200: UserConfig = {
          id: '5200',
          initials: '5200',
          name: '관리자 5200',
          password: '5200',
          isAuthorized: true,
          canAccessFlow: true,
          canAccessInfo: true,
          canManageInfo: true,
        };
        onLogin('5200', '5200', user5200);
        localStorage.setItem('isAuthorized', 'true');
        localStorage.setItem('currentUserPassword', '5200');
        return;
      }

      const user = users.find((u) => u.password.toUpperCase() === inputPassword);

      if (user) {
        onLogin(user.initials, user.password, user);
        localStorage.setItem('isAuthorized', user.isAuthorized ? 'true' : 'false');
        localStorage.setItem('currentUserPassword', user.password);
      } else {
        setError('비밀번호가 올바르지 않습니다.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-100">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-900 p-8 sm:p-10 rounded-3xl shadow-2xl w-full max-w-md border border-slate-800"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-sky-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-sky-600/30">
            <span className="text-xl font-black text-white">AJ</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 text-center">
            아진정밀 통합 정보 시스템
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            도면·사양서 열람(INFO) & 공정관리(FLOW)
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 text-center">
              접속 비밀번호 입력
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none text-center text-xl tracking-widest font-bold text-slate-100 placeholder-slate-600"
              placeholder="••••••"
              required
              autoFocus
            />
          </div>
          {error && <p className="text-rose-400 text-xs text-center font-medium">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-500 text-white py-3 rounded-xl font-semibold transition-all shadow-lg shadow-sky-600/20 disabled:opacity-50 active:scale-98"
          >
            {loading ? '확인 중...' : '시스템 접속하기'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-800 text-center text-[11px] text-slate-500">
          관리자 번호 또는 부여받은 비밀번호를 입력해 주세요.
        </div>
      </motion.div>
    </div>
  );
};

// Main App Component
export default function App() {
  const [userInitials, setUserInitials] = useState<string | null>(
    localStorage.getItem('userInitials')
  );
  const [currentUserPassword, setCurrentUserPassword] = useState<string>(
    localStorage.getItem('currentUserPassword') || ''
  );

  // App starts directly in 'info' mode! (Requirement #3)
  const [currentView, setCurrentView] = useState<'info' | 'flow'>('info');

  // Info Data State (Upstash key: ajin-info-files26)
  const [infoProjects, setInfoProjects] = useState<InfoProject[]>([]);
  const [infoFiles, setInfoFiles] = useState<InfoFile[]>([]);

  // Flow Data State (Upstash key: ajin_flow26_Backup)
  const [flowData, setFlowData] = useState({
    users: [] as UserConfig[],
    projects: [] as Project[],
    processes: [] as Process[],
    tasks: [] as Task[],
    processParts: [] as ProcessPart[],
  });

  const [loading, setLoading] = useState(true);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);

  // Flow Modals State
  const [isFlowProjectModalOpen, setIsFlowProjectModalOpen] = useState(false);
  const [showFlowCompleted, setShowFlowCompleted] = useState(false);
  const [selectedFlowProject, setSelectedFlowProject] = useState<Project | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<{
    projectId: string;
    name: ProcessName;
  } | null>(null);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'info' | 'error' | 'success';
  }>({ isOpen: false, title: '', message: '', type: 'info' });
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [passwordModal, setPasswordModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: (password: string) => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const showAlert = (title: string, message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setAlertModal({ isOpen: true, title, message, type });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

  const showPasswordPrompt = (title: string, message: string, onConfirm: (password: string) => void) => {
    setPasswordModal({ isOpen: true, title, message, onConfirm });
  };

  // Load Info Data (ajin-info-files26)
  const loadInfoData = useCallback(async () => {
    try {
      const res = await fetchInfoData();
      setInfoProjects(res.projects || []);
      setInfoFiles(res.files || []);
    } catch (e) {
      console.error('Failed to load info data:', e);
    }
  }, []);

  // Load Flow Data (ajin_flow26_Backup)
  const loadFlowData = useCallback(async () => {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const json = await res.json();
        setFlowData({
          users: Array.isArray(json.users) ? json.users : [],
          projects: Array.isArray(json.projects) ? json.projects : [],
          processes: Array.isArray(json.processes) ? json.processes : [],
          tasks: Array.isArray(json.tasks) ? json.tasks : [],
          processParts: Array.isArray(json.processParts) ? json.processParts : [],
        });
      }
    } catch (e) {
      console.error('Failed to load flow data:', e);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([loadInfoData(), loadFlowData()]);
      setLoading(false);
    }
    init();
  }, [loadInfoData, loadFlowData]);

  // Mobile Back Button Management (Requirement #4)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      // Priority 1: Close innermost Flow / App modals if open
      if (passwordModal.isOpen) {
        setPasswordModal((prev) => ({ ...prev, isOpen: false }));
        return;
      }
      if (confirmModal.isOpen) {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        return;
      }
      if (alertModal.isOpen) {
        setAlertModal((prev) => ({ ...prev, isOpen: false }));
        return;
      }
      if (isUserManagementOpen) {
        setIsUserManagementOpen(false);
        return;
      }
      if (selectedProcess) {
        setSelectedProcess(null);
        return;
      }
      if (selectedFlowProject) {
        setSelectedFlowProject(null);
        return;
      }
      if (isFlowProjectModalOpen) {
        setIsFlowProjectModalOpen(false);
        return;
      }
      if (showFlowCompleted) {
        setShowFlowCompleted(false);
        return;
      }
      // Priority 2: If on Flow view, return to Home (Info view)
      if (currentView === 'flow') {
        setCurrentView('info');
        return;
      }
      // If at home (Info view) with no modals, allow standard back action (exit app)
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    passwordModal.isOpen,
    confirmModal.isOpen,
    alertModal.isOpen,
    isUserManagementOpen,
    selectedProcess,
    selectedFlowProject,
    isFlowProjectModalOpen,
    showFlowCompleted,
    currentView,
  ]);

  // Persist Flow Data
  const persistFlowData = async (updates: any) => {
    const updated = {
      users: updates.users !== undefined ? updates.users : flowData.users,
      projects: updates.projects !== undefined ? updates.projects : flowData.projects,
      processes: updates.processes !== undefined ? updates.processes : flowData.processes,
      tasks: updates.tasks !== undefined ? updates.tasks : flowData.tasks,
      processParts: updates.processParts !== undefined ? updates.processParts : flowData.processParts,
    };
    setFlowData(updated);
    try {
      await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch (err) {
      console.error('Failed to save flow data:', err);
    }
  };

  // Handle Info Data updates (with atomic full update to prevent race conditions during deletion)
  const handleUpdateInfoData = (newProjects: InfoProject[], newFiles: InfoFile[]) => {
    setInfoProjects(newProjects);
    setInfoFiles(newFiles);
    saveInfoData({ projects: newProjects, files: newFiles });
  };

  const handleUpdateInfoProjects = (newProjects: InfoProject[]) => {
    setInfoProjects(newProjects);
    saveInfoData({ projects: newProjects, files: infoFiles });
  };

  const handleUpdateInfoFiles = (newFiles: InfoFile[]) => {
    setInfoFiles(newFiles);
    saveInfoData({ projects: infoProjects, files: newFiles });
  };

  // User details & permission calculation
  const currentUser = useMemo(() => {
    if (!userInitials) return null;
    return flowData.users.find(
      (u) => u.initials.toUpperCase() === userInitials.toUpperCase()
    );
  }, [userInitials, flowData.users]);

  const isMaster =
    userInitials === 'MASTER' ||
    userInitials === '5200' ||
    currentUserPassword.toUpperCase() === MASTER_PASSWORD ||
    currentUserPassword === '5200' ||
    Boolean(currentUser?.isAuthorized);

  const canAccessFlow = isMaster || currentUser?.canAccessFlow !== false;
  const canAccessInfo = isMaster || currentUser?.canAccessInfo !== false;
  const canManageInfo =
    isMaster ||
    userInitials === '5200' ||
    Boolean(currentUser?.canManageInfo);

  // If user only has permission for flow, auto-switch
  useEffect(() => {
    if (userInitials) {
      if (!canAccessInfo && canAccessFlow) {
        setCurrentView('flow');
      } else if (canAccessInfo && !canAccessFlow) {
        setCurrentView('info');
      }
    }
  }, [userInitials, canAccessInfo, canAccessFlow]);

  const handleLogin = (initials: string, pass: string, userObj?: UserConfig) => {
    setUserInitials(initials);
    setCurrentUserPassword(pass);
    localStorage.setItem('userInitials', initials);
    localStorage.setItem('currentUserPassword', pass);

    // If user has info permission, start in info view directly
    if (userObj?.canAccessInfo !== false || initials === 'MASTER' || initials === '5200') {
      setCurrentView('info');
    } else {
      setCurrentView('flow');
    }
  };

  const handleLogout = () => {
    setUserInitials(null);
    setCurrentUserPassword('');
    localStorage.removeItem('userInitials');
    localStorage.removeItem('currentUserPassword');
    localStorage.removeItem('isAuthorized');
  };

  const handleSaveUsersList = async (updatedUsers: UserConfig[]) => {
    await persistFlowData({ users: updatedUsers });
  };

  // Flow handlers
  const handleCreateFlowProject = async (data: Omit<Project, 'id' | 'createdAt' | 'sortOrder'>) => {
    const maxSortOrder =
      flowData.projects.length > 0 ? Math.max(...flowData.projects.map((p) => p.sortOrder || 0)) : 0;
    const newProjectId = Date.now().toString();
    const newProject: Project = {
      ...data,
      id: newProjectId,
      createdAt: new Date().toISOString(),
      sortOrder: maxSortOrder + 1,
      status: 'active',
    };

    const newProjects = [...flowData.projects, newProject];
    const newProcesses = [...flowData.processes];
    PROCESS_LIST.forEach((name) => {
      newProcesses.push({
        id: (Date.now() + Math.random()).toString(),
        projectId: newProjectId,
        name,
        targetDate: '',
        progress: 0,
      });
    });

    await persistFlowData({ projects: newProjects, processes: newProcesses });
    setIsFlowProjectModalOpen(false);
  };

  const handleUpdateFlowProject = async (id: string, data: Partial<Project>) => {
    const project = flowData.projects.find((p) => p.id === id);
    if (project?.status === 'completed') {
      showAlert('수정 불가', '생산 완료된 프로젝트는 수정할 수 없습니다.', 'error');
      return;
    }

    const updatedProjects = flowData.projects.map((p) => {
      if (p.id === id) {
        const updates: any = { ...data };
        if (data.foDate && p.foDate.split('T')[0] !== data.foDate.split('T')[0]) {
          const history = p.foDateHistory || [];
          updates.foDateHistory = [...history, p.foDate];
        }
        return { ...p, ...updates };
      }
      return p;
    });

    await persistFlowData({ projects: updatedProjects });
    setSelectedFlowProject(null);
  };

  const handleDeleteFlowProject = async (id: string) => {
    if (!isMaster) {
      showAlert('권한 없음', '프로젝트 삭제 권한이 없습니다.', 'error');
      return;
    }

    showConfirm('프로젝트 삭제', '프로젝트와 관련된 공정 데이터를 삭제하시겠습니까?', async () => {
      const updatedProjects = flowData.projects.filter((p) => p.id !== id);
      const updatedProcesses = flowData.processes.filter((p) => p.projectId !== id);
      const updatedTasks = flowData.tasks.filter((t) => t.projectId !== id);
      const updatedParts = flowData.processParts.filter((p) => p.projectId !== id);

      await persistFlowData({
        projects: updatedProjects,
        processes: updatedProcesses,
        tasks: updatedTasks,
        processParts: updatedParts,
      });
      showAlert('삭제 완료', '프로젝트가 삭제되었습니다.', 'success');
    });
  };

  const handleCompleteFlowProject = async (projectId: string) => {
    if (!isMaster && userInitials !== '5200') {
      showAlert('권한 없음', '완료 권한이 없습니다.', 'error');
      return;
    }

    showConfirm('생산 완료', '이 프로젝트를 생산 완료 처리하시겠습니까?', async () => {
      const updatedProjects = flowData.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              status: 'completed' as const,
              completedAt: new Date().toISOString(),
            }
          : p
      );
      await persistFlowData({ projects: updatedProjects });
      showAlert('완료 처리', '프로젝트가 생산 완료 목록으로 이동되었습니다.', 'success');
    });
  };

  const handleUpdateProcessDate = async (processId: string, date: string) => {
    const updatedProcesses = flowData.processes.map((proc) => {
      if (proc.id === processId) {
        const history = proc.targetDateHistory || [];
        if (proc.targetDate.split('T')[0] !== date.split('T')[0]) {
          const newHistory = [...history, proc.targetDate];
          return { ...proc, targetDate: date, targetDateHistory: newHistory };
        }
      }
      return proc;
    });
    await persistFlowData({ processes: updatedProcesses });
  };

  const getUpdatedProcessesProgress = (
    projectId: string,
    processName: string,
    currentParts: ProcessPart[],
    currentTasks: Task[],
    currentProcesses: Process[]
  ) => {
    const parts = currentParts.filter(
      (p) => p.projectId === projectId && p.processName === processName
    );
    const tasks = currentTasks.filter(
      (t) => t.projectId === projectId && t.processName === processName
    );

    const totalItems = parts.length + tasks.length;
    if (totalItems === 0) {
      return currentProcesses.map((proc) => {
        if (proc.projectId === projectId && proc.name === processName) {
          return { ...proc, progress: 0 };
        }
        return proc;
      });
    }

    const completedParts = parts.filter((p) => p.completedAt).length;
    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const progress = Math.round(((completedParts + completedTasks) / totalItems) * 100);

    return currentProcesses.map((proc) => {
      if (proc.projectId === projectId && proc.name === processName) {
        return { ...proc, progress };
      }
      return proc;
    });
  };

  const handleAddTask = async (projectId: string, processName: string, type: string, description: string) => {
    const newTask: Task = {
      id: Date.now().toString(),
      projectId,
      processName,
      type,
      description,
      status: 'pending',
    };
    const updatedTasks = [...flowData.tasks, newTask];
    const updatedProcesses = getUpdatedProcessesProgress(
      projectId,
      processName,
      flowData.processParts,
      updatedTasks,
      flowData.processes
    );
    await persistFlowData({ tasks: updatedTasks, processes: updatedProcesses });
  };

  const handleUpdateTaskStatus = async (
    taskId: string,
    status: TaskStatus,
    projectId: string,
    processName: string
  ) => {
    const updatedTasks = flowData.tasks.map((t) => {
      if (t.id === taskId) {
        const updateData: any = { status };
        if (status === 'completed') {
          updateData.completedAt = new Date().toISOString();
          updateData.initials = userInitials || null;
        } else {
          updateData.completedAt = null;
          updateData.initials = null;
        }
        return { ...t, ...updateData };
      }
      return t;
    });
    const updatedProcesses = getUpdatedProcessesProgress(
      projectId,
      processName,
      flowData.processParts,
      updatedTasks,
      flowData.processes
    );
    await persistFlowData({ tasks: updatedTasks, processes: updatedProcesses });
  };

  const handleUpdateTask = async (
    taskId: string,
    data: Partial<Task>,
    projectId: string,
    processName: string
  ) => {
    const updatedTasks = flowData.tasks.map((t) => (t.id === taskId ? { ...t, ...data } : t));
    const updatedProcesses = getUpdatedProcessesProgress(
      projectId,
      processName,
      flowData.processParts,
      updatedTasks,
      flowData.processes
    );
    await persistFlowData({ tasks: updatedTasks, processes: updatedProcesses });
  };

  const handleAddPart = async (projectId: string, processName: string, data: Partial<ProcessPart>) => {
    const partsInProcess = flowData.processParts.filter(
      (p) => p.projectId === projectId && p.processName === processName
    );
    const maxOrder =
      partsInProcess.length > 0 ? Math.max(...partsInProcess.map((p) => p.order || 0)) : 0;
    const newPart: ProcessPart = {
      id: Date.now().toString(),
      projectId,
      processName,
      moldNo: data.moldNo || '',
      drwNo: data.drwNo || '',
      s: data.s || '',
      partsName: data.partsName || '',
      productionLocation: data.productionLocation || '',
      plannedAt: data.plannedAt || null,
      completedAt: data.completedAt || null,
      initials: data.initials || undefined,
      delayReason: data.delayReason || '',
      delayType: data.delayType || '',
      order: maxOrder + 1,
    };
    const updatedParts = [...flowData.processParts, newPart];
    const updatedProcesses = getUpdatedProcessesProgress(
      projectId,
      processName,
      updatedParts,
      flowData.tasks,
      flowData.processes
    );
    await persistFlowData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleDeletePart = async (partId: string, projectId: string, processName: string) => {
    const updatedParts = flowData.processParts.filter((p) => p.id !== partId);
    const updatedProcesses = getUpdatedProcessesProgress(
      projectId,
      processName,
      updatedParts,
      flowData.tasks,
      flowData.processes
    );
    await persistFlowData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleUpdatePart = async (
    partId: string,
    data: Partial<ProcessPart>,
    projectId: string,
    processName: string
  ) => {
    const updatedParts = flowData.processParts.map((p) => (p.id === partId ? { ...p, ...data } : p));
    const updatedProcesses = getUpdatedProcessesProgress(
      projectId,
      processName,
      updatedParts,
      flowData.tasks,
      flowData.processes
    );
    await persistFlowData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleBatchUpdateParts = async (
    updates: { id: string; data: Partial<ProcessPart> }[],
    projectId: string,
    processName: string
  ) => {
    const updateMap = new Map(updates.map((u) => [u.id, u.data]));
    const updatedParts = flowData.processParts.map((p) => {
      const update = updateMap.get(p.id);
      return update ? { ...p, ...update } : p;
    });
    const updatedProcesses = getUpdatedProcessesProgress(
      projectId,
      processName,
      updatedParts,
      flowData.tasks,
      flowData.processes
    );
    await persistFlowData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleDeleteParts = async (projectId: string, processName: string) => {
    const updatedParts = flowData.processParts.filter(
      (p) => !(p.projectId === projectId && p.processName === processName)
    );
    const updatedTasks = flowData.tasks.filter(
      (t) => !(t.projectId === projectId && t.processName === processName)
    );
    const updatedProcesses = flowData.processes.map((proc) => {
      if (proc.projectId === projectId && proc.name === processName) {
        return {
          ...proc,
          progress: 0,
          headers: [],
          excelTitle: null,
          targetDate: '',
          targetDateHistory: [],
        };
      }
      return proc;
    });
    await persistFlowData({
      processParts: updatedParts,
      tasks: updatedTasks,
      processes: updatedProcesses,
    });
  };

  const handleUploadExcel = async (projectId: string, processName: string, file: File) => {
    const project = flowData.projects.find((p) => p.id === projectId);
    if (project?.status === 'completed') {
      showAlert('업로드 불가', '생산 완료된 프로젝트는 데이터를 수정할 수 없습니다.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          range: 0,
        }) as any[][];

        if (jsonData.length === 0) {
          showAlert('오류', '엑셀 파일에 데이터가 없습니다.', 'error');
          return;
        }

        // Header detection
        let headerRowIndex = -1;
        let detectedHeaders: string[] = [];

        for (let i = 0; i < Math.min(10, jsonData.length); i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;
          const strRow = row.map((cell) => String(cell || '').trim());
          if (strRow.some((c) => c.includes('품명') || c.includes('도번') || c.includes('DRW') || c.includes('MOLD'))) {
            headerRowIndex = i;
            detectedHeaders = strRow;
            break;
          }
        }

        if (headerRowIndex === -1) {
          headerRowIndex = 0;
          detectedHeaders = jsonData[0].map((cell, idx) => String(cell || `열 ${idx + 1}`).trim());
        }

        const dataRows = jsonData.slice(headerRowIndex + 1);
        const newParts: ProcessPart[] = dataRows
          .filter((r) => r.some((c) => c !== ''))
          .map((row, idx) => ({
            id: `${Date.now()}_${idx}`,
            projectId,
            processName,
            moldNo: String(row[0] || ''),
            drwNo: String(row[1] || ''),
            s: String(row[2] || ''),
            partsName: String(row[3] || ''),
            productionLocation: String(row[4] || ''),
            plannedAt: null,
            completedAt: null,
            delayReason: '',
            delayType: '',
            order: idx + 1,
            rawData: row,
          }));

        const existingParts = flowData.processParts.filter(
          (p) => !(p.projectId === projectId && p.processName === processName)
        );
        const updatedParts = [...existingParts, ...newParts];
        const updatedProcesses = getUpdatedProcessesProgress(
          projectId,
          processName,
          updatedParts,
          flowData.tasks,
          flowData.processes
        ).map((proc) => {
          if (proc.projectId === projectId && proc.name === processName) {
            return {
              ...proc,
              headers: detectedHeaders,
              excelTitle: file.name.replace(/\.[^/.]+$/, ''),
            };
          }
          return proc;
        });

        await persistFlowData({ processParts: updatedParts, processes: updatedProcesses });
        showAlert('업로드 완료', `${newParts.length}건의 부품 데이터가 등록되었습니다.`, 'success');
      } catch (err: any) {
        console.error('Excel parse error:', err);
        showAlert('오류', '엑셀 파일을 처리하는 중 오류가 발생했습니다.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleMoveProject = async (projectId: string, direction: 'up' | 'down') => {
    const currentList = flowData.projects
      .filter((p) => (showFlowCompleted ? p.status === 'completed' : p.status !== 'completed'))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    const index = currentList.findIndex((p) => p.id === projectId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentList.length) return;

    const currentProj = currentList[index];
    const targetProj = currentList[targetIndex];

    const currentOrder = currentProj.sortOrder || 0;
    const targetOrder = targetProj.sortOrder || 0;

    const updatedProjects = flowData.projects.map((p) => {
      if (p.id === currentProj.id) return { ...p, sortOrder: targetOrder === currentOrder ? targetOrder + (direction === 'up' ? -1 : 1) : targetOrder };
      if (p.id === targetProj.id) return { ...p, sortOrder: currentOrder };
      return p;
    });

    await persistFlowData({ projects: updatedProjects });
  };

  const getProcessDDay = (targetDate?: string) => {
    if (!targetDate) return { label: 'D-0', isRed: false };
    try {
      const target = new Date(targetDate.split('T')[0]);
      if (isNaN(target.getTime())) return { label: 'D-0', isRed: false };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      target.setHours(0, 0, 0, 0);
      const diffTime = target.getTime() - today.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return { label: 'D-0', isRed: false };
      if (diffDays > 0) return { label: `D-${diffDays}`, isRed: false };
      return { label: `+${Math.abs(diffDays)}`, isRed: true };
    } catch {
      return { label: 'D-0', isRed: false };
    }
  };

  const getFoDDay = (foDate?: string) => {
    if (!foDate) return 'D-0';
    try {
      const target = new Date(foDate.split('T')[0]);
      if (isNaN(target.getTime())) return 'D-0';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      target.setHours(0, 0, 0, 0);
      const diffTime = target.getTime() - today.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'D-DAY';
      if (diffDays > 0) return `D-${diffDays}`;
      return `D+${Math.abs(diffDays)}`;
    } catch {
      return 'D-0';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-slate-100 gap-3">
        <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-slate-400 font-mono">AJIN System Loading...</p>
      </div>
    );
  }

  if (!userInitials) {
    return <Auth users={flowData.users} onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-slate-800 flex flex-col font-sans selection:bg-blue-500 selection:text-white w-full max-w-full overflow-x-hidden">
      {/* Top Bar matching screenshot */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-2.5 sm:px-6 lg:px-8 py-2 sm:py-2.5 shadow-sm w-full max-w-full">
        <div className="w-full flex items-center justify-between gap-1.5 sm:gap-4">
          {/* Left Zone: Logo + Tabs + User Badge */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-xs sm:text-sm shadow-sm select-none shrink-0">
              AJ
            </div>

            {/* Info Tab */}
            <button
              onClick={() => {
                if (canAccessInfo) setCurrentView('info');
                else alert('INFO 열람 권한이 없습니다. 관리자에게 문의하세요.');
              }}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap border ${
                currentView === 'info'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Info</span>
            </button>

            {/* Flow Tab */}
            <button
              onClick={() => {
                if (canAccessFlow) {
                  window.history.pushState({ view: 'flow' }, '');
                  setCurrentView('flow');
                } else {
                  alert('FLOW 공정 접근 권한이 없습니다. 관리자에게 문의하세요.');
                }
              }}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap border ${
                currentView === 'flow'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Flow</span>
            </button>

            {/* User Badge */}
            <div className="hidden xs:flex items-center gap-1 px-2 sm:px-3 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] sm:text-xs font-bold truncate max-w-[110px] sm:max-w-none">
              <span className="truncate">{currentUser?.name || userInitials}</span>
              {isMaster && (
                <span className="text-amber-500 font-black shrink-0">★관리자</span>
              )}
            </div>
          </div>

          {/* Right Zone: Completed list + Add Proj + Settings + Refresh + Logout */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {currentView === 'flow' && (
              <>
                <button
                  onClick={() => setShowFlowCompleted(!showFlowCompleted)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                    showFlowCompleted
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-sm'
                  }`}
                >
                  {showFlowCompleted ? '진행 목록' : '완료 목록'}
                </button>

                {isMaster && (
                  <button
                    onClick={() => setIsFlowProjectModalOpen(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition-all"
                  >
                    <span>+ + PROJ</span>
                  </button>
                )}
              </>
            )}

            {isMaster && (
              <button
                onClick={() => setIsUserManagementOpen(true)}
                className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
                title="사용자 관리"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => {
                setLoading(true);
                Promise.all([loadInfoData(), loadFlowData()]).finally(() => setLoading(false));
              }}
              className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
              title="새로고침"
            >
              <ArrowRightLeft className="w-4 h-4" />
            </button>

            <button
              onClick={handleLogout}
              className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition-colors"
              title="로그아웃"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area: Full Width Screen */}
      <main className="flex-1 w-full p-3 sm:p-5 lg:p-6">
        {/* 1. INFO VIEW */}
        {currentView === 'info' && (
          <InfoView
            projects={infoProjects}
            files={infoFiles}
            currentUserInitials={userInitials}
            isMaster={isMaster}
            canManage={canManageInfo}
            onUpdateProjects={handleUpdateInfoProjects}
            onUpdateFiles={handleUpdateInfoFiles}
            onUpdateInfoData={handleUpdateInfoData}
          />
        )}

        {/* 2. FLOW VIEW (Exact Layout as Screenshot) */}
        {currentView === 'flow' && (
          <div className="space-y-6">
            {flowData.projects
              .filter((p) => (showFlowCompleted ? p.status === 'completed' : p.status !== 'completed'))
              .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
              .map((project, projIdx, arr) => {
                const projectProcesses = flowData.processes.filter(
                  (p) => p.projectId === project.id
                );
                const totalParts = flowData.processParts.filter((p) => p.projectId === project.id);
                const completedParts = totalParts.filter((p) => p.completedAt).length;
                const overallProgress =
                  totalParts.length > 0
                    ? Math.round((completedParts / totalParts.length) * 100)
                    : 0;

                const foDDay = getFoDDay(project.foDate);

                return (
                  <div
                    key={project.id}
                    className="bg-white rounded-2xl overflow-hidden shadow-md border border-slate-200/80"
                  >
                    {/* Project Dark Header matching Screenshot */}
                    <div className="bg-[#071126] text-white p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Left: Controls & Title & Stats */}
                      <div className="flex items-start gap-3 sm:gap-4">
                        {/* Control buttons (^, v, edit, complete, delete) */}
                        <div className="flex items-center gap-1 bg-[#0f1d3d] p-1 rounded-xl border border-slate-700/60 shrink-0">
                          {isMaster && (
                            <>
                              <button
                                onClick={() => handleMoveProject(project.id, 'up')}
                                disabled={projIdx === 0}
                                className="p-1 rounded hover:bg-slate-700 text-slate-300 disabled:opacity-30"
                                title="위로 이동"
                              >
                                <span className="font-bold text-xs">▲</span>
                              </button>
                              <button
                                onClick={() => handleMoveProject(project.id, 'down')}
                                disabled={projIdx === arr.length - 1}
                                className="p-1 rounded hover:bg-slate-700 text-slate-300 disabled:opacity-30"
                                title="아래로 이동"
                              >
                                <span className="font-bold text-xs">▼</span>
                              </button>
                            </>
                          )}

                          <button
                            onClick={() => setSelectedFlowProject(project)}
                            className="p-1 rounded hover:bg-slate-700 text-emerald-400"
                            title="수정"
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>

                          {(isMaster || userInitials === '5200') && (
                            <button
                              onClick={() => handleCompleteFlowProject(project.id)}
                              className="p-1 rounded hover:bg-slate-700 text-sky-400"
                              title="생산 완료"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {isMaster && (
                            <button
                              onClick={() => handleDeleteFlowProject(project.id)}
                              className="p-1 rounded hover:bg-rose-500/30 text-rose-400"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Title, Model, Progress, Quantity */}
                        <div>
                          <div className="flex items-baseline gap-2">
                            <h2 className="text-xl sm:text-2xl font-black text-white tracking-wide">
                              {project.name}
                            </h2>
                          </div>
                          <p className="text-xs text-sky-400 font-semibold mt-0.5">
                            {project.model}
                          </p>

                          <div className="flex items-center gap-6 mt-2">
                            <div>
                              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                PROGRESS
                              </div>
                              <div className="text-lg sm:text-xl font-black text-sky-400">
                                {overallProgress}%
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                QTY
                              </div>
                              <div className="text-lg sm:text-xl font-black text-white">
                                {project.targetQuantity?.toLocaleString() || 0}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: D-Day & FO Date History */}
                      <div className="flex flex-col md:items-end justify-between">
                        <div className="text-2xl sm:text-3xl font-black text-sky-400 tracking-tight">
                          {foDDay}
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-xs font-mono">
                          {project.foDateHistory &&
                            project.foDateHistory.map((d, i) => (
                              <span key={i} className="text-slate-400">
                                {d ? format(parseISO(d), 'yyyy-MM-dd') : ''}
                              </span>
                            ))}
                          <span className="text-rose-500 font-bold">
                            {project.foDate ? format(parseISO(project.foDate), 'yyyy-MM-dd') : '연도 - 월 - 일'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 8 Process Grid Cells (2 rows x 4 cols) matching Screenshot */}
                    <div className="grid grid-cols-2 md:grid-cols-4 border-t border-slate-100 divide-x divide-y divide-slate-100 bg-[#fffdfa]/40">
                      {PROCESS_LIST.map((procName) => {
                        const proc = projectProcesses.find((p) => p.name === procName);
                        const procParts = flowData.processParts.filter(
                          (p) => p.projectId === project.id && p.processName === procName
                        );
                        const procTasks = flowData.tasks.filter(
                          (t) => t.projectId === project.id && t.processName === procName
                        );
                        const total = procParts.length + procTasks.length;
                        const done =
                          procParts.filter((p) => p.completedAt).length +
                          procTasks.filter((t) => t.status === 'completed').length;
                        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                        const dDay = getProcessDDay(proc?.targetDate);

                        return (
                          <div
                            key={procName}
                            onClick={() => {
                              window.history.pushState({ modal: 'process', procName }, '');
                              setSelectedProcess({ projectId: project.id, name: procName });
                            }}
                            className="p-4 flex flex-col items-center justify-between text-center hover:bg-slate-50/80 transition-colors cursor-pointer min-h-[140px]"
                          >
                            <div className="text-xs font-bold text-slate-600 mb-1">
                              {procName}
                            </div>

                            <div className="flex items-baseline justify-center my-1">
                              <span className="text-3xl sm:text-4xl font-black text-slate-900 leading-none">
                                {pct}
                              </span>
                              <span className="text-xs font-bold text-slate-400 ml-0.5">%</span>
                            </div>

                            <div className="w-full space-y-1 mt-1">
                              {/* Date Input / History */}
                              <div
                                className="flex items-center justify-center gap-1.5 text-xs text-slate-600 font-mono"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {proc?.targetDateHistory && proc.targetDateHistory.length > 0 && (
                                  <span className="text-[10px] text-slate-400 line-through">
                                    {format(parseISO(proc.targetDateHistory[proc.targetDateHistory.length - 1]), 'yyyy-MM-dd')}
                                  </span>
                                )}
                                <input
                                  type="date"
                                  value={proc?.targetDate ? proc.targetDate.split('T')[0] : ''}
                                  onChange={(e) => {
                                    if (proc) {
                                      handleUpdateProcessDate(
                                        proc.id,
                                        e.target.value ? new Date(e.target.value).toISOString() : ''
                                      );
                                    }
                                  }}
                                  disabled={project.status === 'completed'}
                                  className={`text-[11px] font-bold border-none bg-transparent outline-none cursor-pointer text-center ${
                                    proc?.targetDate ? (dDay.isRed ? 'text-rose-600' : 'text-slate-800') : 'text-slate-400'
                                  }`}
                                />
                              </div>

                              {/* D-Day badge at bottom */}
                              <div
                                className={`text-xs font-black ${
                                  dDay.isRed ? 'text-rose-600' : 'text-sky-600'
                                }`}
                              >
                                {dDay.label}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </main>

      {/* User Management Modal (Master) */}
      <UserManagementModal
        isOpen={isUserManagementOpen}
        users={flowData.users}
        onClose={() => setIsUserManagementOpen(false)}
        onSaveUsers={handleSaveUsersList}
      />

      {/* Flow Project Creation Modal */}
      {isFlowProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-slate-100"
          >
            <div className="px-6 py-4 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-100">새 공정 프로젝트 생성</h3>
              <button
                onClick={() => setIsFlowProjectModalOpen(false)}
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.target as any;
                handleCreateFlowProject({
                  name: form.name.value,
                  model: form.model.value,
                  targetQuantity: Number(form.targetQuantity.value || 0),
                  foDate: form.foDate.value ? new Date(form.foDate.value).toISOString() : '',
                });
              }}
              className="p-6 space-y-4 text-xs"
            >
              <div>
                <label className="block text-slate-300 font-semibold mb-1">프로젝트명</label>
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="예: CPH-329R3"
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">모델명</label>
                <input
                  name="model"
                  type="text"
                  required
                  placeholder="예: EF-510"
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">생산수량</label>
                <input
                  name="targetQuantity"
                  type="number"
                  defaultValue={5000}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">FO 선적 날짜</label>
                <input
                  name="foDate"
                  type="date"
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 [color-scheme:dark]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsFlowProjectModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                >
                  생성하기
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Flow Project Edit Modal */}
      {selectedFlowProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-slate-100"
          >
            <div className="px-6 py-4 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-100">프로젝트 정보 수정</h3>
              <button
                onClick={() => setSelectedFlowProject(null)}
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.target as any;
                handleUpdateFlowProject(selectedFlowProject.id, {
                  name: form.name.value,
                  model: form.model.value,
                  targetQuantity: Number(form.targetQuantity.value || 0),
                  foDate: form.foDate.value ? new Date(form.foDate.value).toISOString() : '',
                });
              }}
              className="p-6 space-y-4 text-xs"
            >
              <div>
                <label className="block text-slate-300 font-semibold mb-1">프로젝트명</label>
                <input
                  name="name"
                  type="text"
                  required
                  defaultValue={selectedFlowProject.name}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">모델명</label>
                <input
                  name="model"
                  type="text"
                  required
                  defaultValue={selectedFlowProject.model}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">생산수량</label>
                <input
                  name="targetQuantity"
                  type="number"
                  defaultValue={selectedFlowProject.targetQuantity}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">FO 선적 날짜</label>
                <input
                  name="foDate"
                  type="date"
                  defaultValue={selectedFlowProject.foDate ? selectedFlowProject.foDate.split('T')[0] : ''}
                  className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 [color-scheme:dark]"
                />
              </div>
              {selectedFlowProject.foDateHistory && selectedFlowProject.foDateHistory.length > 0 && (
                <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                  <div className="text-[11px] font-semibold text-amber-400 mb-1">이전 선적일 변경 이력:</div>
                  <div className="space-y-0.5 text-[11px] text-slate-300 font-mono">
                    {selectedFlowProject.foDateHistory.map((h, i) => (
                      <div key={i}>
                        {i + 1}. {h ? format(parseISO(h), 'yyyy-MM-dd') : '미정'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedFlowProject(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                >
                  저장하기
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Flow Process Detail Modal */}
      {selectedProcess && (
        <ProcessDetailModal
          projectId={selectedProcess.projectId}
          processName={selectedProcess.name}
          tasks={flowData.tasks}
          processParts={flowData.processParts}
          processes={flowData.processes}
          onClose={() => setSelectedProcess(null)}
          onAddTask={handleAddTask}
          onUpdateTaskStatus={handleUpdateTaskStatus}
          onUpdateTask={handleUpdateTask}
          onAddPart={handleAddPart}
          onDeletePart={handleDeletePart}
          onUpdatePart={handleUpdatePart}
          onBatchUpdateParts={handleBatchUpdateParts}
          onDeleteParts={handleDeleteParts}
          onUploadExcel={handleUploadExcel}
          userInitials={userInitials}
          showAlert={showAlert}
          showConfirm={showConfirm}
          showPasswordPrompt={showPasswordPrompt}
        />
      )}

      {/* Alert & Confirm Modals */}
      <AnimatePresence>
        {alertModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center"
            >
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 ${
                  alertModal.type === 'success'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : alertModal.type === 'error'
                    ? 'bg-rose-500/20 text-rose-400'
                    : 'bg-sky-500/20 text-sky-400'
                }`}
              >
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-100 mb-1">{alertModal.title}</h3>
              <p className="text-xs text-slate-400 mb-5">{alertModal.message}</p>
              <button
                onClick={() => setAlertModal((prev) => ({ ...prev, isOpen: false }))}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors"
              >
                확인
              </button>
            </motion.div>
          </div>
        )}

        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-100 mb-1">{confirmModal.title}</h3>
              <p className="text-xs text-slate-400 mb-5">{confirmModal.message}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => {
                    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                    confirmModal.onConfirm();
                  }}
                  className="flex-1 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs transition-colors shadow-sm"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Process Detail Modal wrapper
const ProcessDetailModal = ({
  projectId,
  processName,
  tasks,
  processParts,
  processes,
  isReadOnly,
  onClose,
  onAddTask,
  onUpdateTaskStatus,
  onUpdateTask,
  onAddPart,
  onDeletePart,
  onUpdatePart,
  onBatchUpdateParts,
  onDeleteParts,
  onUploadExcel,
  userInitials,
  showAlert,
  showConfirm,
  showPasswordPrompt,
}: {
  projectId: string;
  processName: string;
  tasks: Task[];
  processParts: ProcessPart[];
  processes: Process[];
  isReadOnly?: boolean;
  onClose: () => void;
  onAddTask: (pid: string, pname: string, type: string, desc: string) => void;
  onUpdateTaskStatus: (tid: string, status: TaskStatus, pid: string, pname: string) => void;
  onUpdateTask: (tid: string, data: Partial<Task>, pid: string, pname: string) => void;
  onAddPart: (projectId: string, processName: string, data: Partial<ProcessPart>) => void;
  onDeletePart: (partId: string, projectId: string, processName: string) => void;
  onUpdatePart: (partId: string, data: Partial<ProcessPart>, projectId: string, processName: string) => void;
  onBatchUpdateParts: (updates: { id: string; data: Partial<ProcessPart> }[], projectId: string, processName: string) => void;
  onDeleteParts: (projectId: string, processName: string) => void;
  onUploadExcel: (projectId: string, processName: string, file: File) => void;
  userInitials: string;
  showAlert: (title: string, message: string, type?: 'info' | 'error' | 'success') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  showPasswordPrompt: (title: string, message: string, onConfirm: (password: string) => void) => void;
}) => {
  const currentProcess = processes.find((p) => p.projectId === projectId && p.name === processName);
  const headers = currentProcess?.headers;
  const excelTitle = currentProcess?.excelTitle;

  const ProcessComponent = (() => {
    switch (processName) {
      case '사출':
        return Processes.Injection;
      case '인쇄':
        return Processes.Printing;
      case '메탈':
        return Processes.Metal;
      case 'PAINT':
        return Processes.Paint;
      case 'PRINT':
        return Processes.Print;
      case '가공':
        return Processes.Processing;
      case '조립':
        return Processes.Assembly;
      case '포장':
        return Processes.Packaging;
      default:
        return null;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="px-5 py-3.5 bg-slate-800/80 border-b border-slate-700/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <h3 className="font-bold text-slate-100 text-base sm:text-lg">
              {processName} 공정 세부 관리
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-950 text-slate-100">
          {ProcessComponent ? (
            <ProcessComponent
              projectId={projectId}
              processName={processName as ProcessName}
              tasks={tasks}
              processParts={processParts}
              headers={headers}
              excelTitle={excelTitle}
              isReadOnly={isReadOnly}
              onAddTask={onAddTask}
              onUpdateTaskStatus={onUpdateTaskStatus}
              onUpdateTask={onUpdateTask}
              onAddPart={onAddPart}
              onDeletePart={onDeletePart}
              onUpdatePart={onUpdatePart}
              onBatchUpdateParts={onBatchUpdateParts}
              onDeleteParts={onDeleteParts}
              onUploadExcel={onUploadExcel}
              userInitials={userInitials}
              showAlert={showAlert}
              showConfirm={showConfirm}
              showPasswordPrompt={showPasswordPrompt}
            />
          ) : (
            <div className="text-center py-8 text-slate-400 text-xs">
              공정 컴포넌트를 찾을 수 없습니다.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
