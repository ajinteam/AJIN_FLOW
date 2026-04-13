import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Project, Process, Task, PROCESS_LIST, ProcessName, TaskStatus, UserConfig, ProcessPart } from './types';
import { format, differenceInDays, parseISO } from 'date-fns';
import { Plus, Settings as SettingsIcon, LogOut, ChevronRight, Edit2, CheckCircle2, Clock, AlertCircle, Trash2, Save, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface RedisErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

function handleRedisError(error: unknown, operationType: OperationType, path: string | null) {
  let message = error instanceof Error ? error.message : String(error);
  
  if (message.includes('WRONGTYPE')) {
    message = `Redis 데이터 타입 오류: "${path}" 키가 잘못된 형식으로 저장되어 있습니다. 데이터를 초기화하거나 Redis 콘솔에서 해당 키를 삭제해 주세요.`;
  }

  const errInfo: RedisErrorInfo = {
    error: message,
    operationType,
    path
  };
  console.error('Redis Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const PROCESS_COLORS: Record<ProcessName, string> = {
  '사출': 'bg-sky-50/50',
  '인쇄': 'bg-indigo-50/50',
  '메탈': 'bg-slate-100/50',
  'PAINT': 'bg-rose-50/50',
  'PRINT': 'bg-orange-50/50',
  '가공': 'bg-emerald-50/50',
  '조립': 'bg-amber-50/50',
  '포장': 'bg-teal-50/50',
};

const MASTER_PASSWORD = 'AJ5200';

// Simple Auth Component
const Auth = ({ users, onLogin }: { users: UserConfig[], onLogin: (initials: string, password: string) => void }) => {
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
        onLogin('MASTER', MASTER_PASSWORD);
        localStorage.setItem('isAuthorized', 'true');
        localStorage.setItem('currentUserPassword', MASTER_PASSWORD);
        return;
      }

      const user = users.find(u => u.password.toUpperCase() === inputPassword);

      if (user) {
        onLogin(user.initials, user.password);
        localStorage.setItem('isAuthorized', user.isAuthorized ? 'true' : 'false');
        localStorage.setItem('currentUserPassword', user.password);
      } else {
        setError('비밀번호가 틀렸습니다.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-10 rounded-3xl shadow-2xl w-full max-w-md border border-slate-200"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
            <SettingsIcon className="text-white" size={32} />
          </div>
          <h1 className="text-2xl font-black text-slate-800 text-center">생산공정 관리 시스템</h1>
          <p className="text-slate-400 text-sm mt-1">비밀번호를 입력하여 접속하세요</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-6 py-4 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-center text-2xl tracking-widest font-bold"
              placeholder="••••••"
              required
              autoFocus
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}
          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 disabled:opacity-50"
          >
            {loading ? '확인 중...' : '접속하기'}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

// Settings Modal Component
const SettingsModal = ({ users, persistData, onClose, showConfirm }: { 
  users: UserConfig[], 
  persistData: (updates: any) => Promise<void>,
  onClose: () => void, 
  showConfirm: (title: string, message: string, onConfirm: () => void) => void 
}) => {
  const [newInitials, setNewInitials] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const handleAddOrUpdateUser = async () => {
    if (!newInitials || !newPassword) return;
    
    let updatedUsers = [...users];
    if (editingUserId) {
      updatedUsers = updatedUsers.map(u => u.id === editingUserId ? {
        ...u,
        initials: newInitials.toUpperCase(),
        password: newPassword
      } : u);
      setEditingUserId(null);
    } else {
      updatedUsers.push({
        id: Date.now().toString(),
        initials: newInitials.toUpperCase(),
        password: newPassword,
        isAuthorized: false
      });
    }
    
    await persistData({ users: updatedUsers });
    setNewInitials('');
    setNewPassword('');
  };

  const toggleAuthorization = async (user: UserConfig) => {
    const updatedUsers = users.map(u => u.id === user.id ? {
      ...u,
      isAuthorized: !u.isAuthorized
    } : u);
    await persistData({ users: updatedUsers });
  };

  const handleEditClick = (user: UserConfig) => {
    setNewInitials(user.initials);
    setNewPassword(user.password);
    setEditingUserId(user.id);
  };

  const handleDeleteUser = async (id: string) => {
    showConfirm('사용자 삭제', '사용자를 삭제하시겠습니까?', async () => {
      const updatedUsers = users.filter(u => u.id !== id);
      await persistData({ users: updatedUsers });
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="px-8 py-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-black text-xl text-slate-800">시스템 설정</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-8 space-y-8">
          <div>
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">
              {editingUserId ? '사용자 수정' : '사용자 추가'}
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <input 
                type="text" 
                placeholder="이니셜 (예: AJ)" 
                value={newInitials}
                onChange={(e) => setNewInitials(e.target.value)}
                className="px-4 py-3 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input 
                type="text" 
                placeholder="비밀번호" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="px-4 py-3 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button 
                onClick={handleAddOrUpdateUser}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
              >
                {editingUserId ? '수정 완료' : '사용자 등록'}
              </button>
              {editingUserId && (
                <button 
                  onClick={() => {
                    setEditingUserId(null);
                    setNewInitials('');
                    setNewPassword('');
                  }}
                  className="px-6 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                >
                  취소
                </button>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">사용자 목록</h4>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 no-scrollbar">
              {users.map(user => (
                <div key={user.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-4">
                    <span className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-black text-blue-600 shadow-sm border border-slate-100">
                      {user.initials}
                    </span>
                    <span className="font-mono text-slate-600">{user.password}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => toggleAuthorization(user)}
                      className={cn(
                        "px-2 py-1 rounded text-[10px] font-bold transition-colors",
                        user.isAuthorized ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
                      )}
                    >
                      {user.isAuthorized ? '권한있음' : '권한없음'}
                    </button>
                    <button 
                      onClick={() => handleEditClick(user)}
                      className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => handleDeleteUser(user.id)}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button 
              onClick={() => {
                showConfirm('데이터 초기화', '모든 생산 데이터를 초기화하시겠습니까? (사용자 정보는 유지됩니다)', async () => {
                  try {
                    const res = await fetch('/api/reset', { method: 'POST' });
                    if (res.ok) {
                      window.location.reload();
                    } else {
                      alert('초기화 실패');
                    }
                  } catch (e) {
                    alert('초기화 중 오류 발생');
                  }
                });
              }}
              className="w-full bg-red-50 text-red-600 py-3 rounded-xl font-bold hover:bg-red-100 transition-all border border-red-100 flex items-center justify-center gap-2"
            >
              <Trash2 size={18} />
              전체 데이터 초기화
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "알 수 없는 오류가 발생했습니다.";
      try {
        const parsed = JSON.parse((this.state.error as any).message);
        if (parsed.error && parsed.error.includes('permission-denied')) {
          errorMessage = "데이터 접근 권한이 없습니다. 시스템 관리자에게 문의하세요.";
        }
      } catch (e) {
        errorMessage = (this.state.error as any)?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-black text-slate-800 mb-2">오류가 발생했습니다</h2>
            <p className="text-slate-500 mb-6 text-sm leading-relaxed">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-all"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

// Main Dashboard
export default function App() {
  const [data, setData] = useState({
    users: [] as UserConfig[],
    projects: [] as Project[],
    processes: [] as Process[],
    tasks: [] as Task[],
    processParts: [] as ProcessPart[]
  });
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        let msg = errorData.error || `Server error: ${res.status}`;
        if (res.status === 404) {
          msg = "서버 연결 오류 (404): API 경로를 찾을 수 없습니다. 관리자에게 문의하세요.";
        }
        throw new Error(msg);
      }
      const json = await res.json();
      const sanitizedData = {
        users: Array.isArray(json.users) ? json.users : [],
        projects: Array.isArray(json.projects) ? json.projects : [],
        processes: Array.isArray(json.processes) ? json.processes : [],
        tasks: Array.isArray(json.tasks) ? json.tasks : [],
        processParts: Array.isArray(json.processParts) ? json.processParts : []
      };
      setData(sanitizedData);
      setGlobalError(null);
    } catch (error) {
      console.error("Fetch error:", error);
      setGlobalError(error instanceof Error ? error.message : "데이터를 불러오는데 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const persistData = async (updates: any) => {
    const newData = {
      users: updates.users !== undefined ? updates.users : data.users,
      projects: updates.projects !== undefined ? updates.projects : data.projects,
      processes: updates.processes !== undefined ? updates.processes : data.processes,
      tasks: updates.tasks !== undefined ? updates.tasks : data.tasks,
      processParts: updates.processParts !== undefined ? updates.processParts : data.processParts,
    };
    
    // Optimistic update
    setData(newData);

    try {
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newData)
      });
      if (!res.ok) throw new Error('Failed to save');
    } catch (error) {
      console.error("Persist error:", error);
      // Revert on error
      fetchData();
    }
  };

  if (globalError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-200 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-black text-slate-800 mb-2">설정 오류</h2>
          <p className="text-slate-500 mb-6 text-sm leading-relaxed">{globalError}</p>
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => fetchData()}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all"
            >
              다시 시도
            </button>
            {globalError.includes('wrong data type') && (
              <button 
                onClick={async () => {
                  if (confirm('데이터를 초기화하시겠습니까? (모든 데이터가 삭제됩니다)')) {
                    try {
                      const res = await fetch('/api/reset', { method: 'POST' });
                      if (res.ok) {
                        fetchData();
                      } else {
                        alert('초기화 실패');
                      }
                    } catch (e) {
                      alert('초기화 중 오류 발생');
                    }
                  }
                }}
                className="w-full bg-red-50 text-red-600 py-3 rounded-xl font-bold hover:bg-red-100 transition-all border border-red-100"
              >
                데이터 강제 초기화
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Dashboard 
        initialData={data} 
        persistData={persistData} 
        refreshData={fetchData}
      />
    </ErrorBoundary>
  );
}

function Dashboard({ initialData, persistData, refreshData }: { 
  initialData: any, 
  persistData: (updates: any) => Promise<void>,
  refreshData: () => Promise<void>
}) {
  const [userInitials, setUserInitials] = useState<string | null>(localStorage.getItem('userInitials'));
  const [projects, setProjects] = useState<Project[]>(initialData.projects || []);
  const [processes, setProcesses] = useState<Process[]>(initialData.processes || []);
  const [tasks, setTasks] = useState<Task[]>(initialData.tasks || []);
  const [processParts, setProcessParts] = useState<ProcessPart[]>(initialData.processParts || []);
  const [users, setUsers] = useState<UserConfig[]>(initialData.users || []);

  useEffect(() => {
    setProjects(initialData.projects || []);
    setProcesses(initialData.processes || []);
    setTasks(initialData.tasks || []);
    setProcessParts(initialData.processParts || []);
    setUsers(initialData.users || []);
  }, [initialData]);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<{ projectId: string, name: ProcessName } | null>(null);
  const [isProcessModalOpen, setIsProcessModalOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: (password: string) => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
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

  const showAlert = (title: string, message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setAlertModal({ isOpen: true, title, message, type });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

  const showPasswordPrompt = (title: string, message: string, onConfirm: (password: string) => void) => {
    setPasswordModal({ isOpen: true, title, message, onConfirm });
  };

  useEffect(() => {
    if (userInitials) {
      localStorage.setItem('userInitials', userInitials);
    } else {
      localStorage.removeItem('userInitials');
    }
  }, [userInitials]);

  const handleCreateProject = async (data: Omit<Project, 'id' | 'createdAt' | 'sortOrder'>) => {
    const maxSortOrder = projects.length > 0 ? Math.max(...projects.map(p => p.sortOrder || 0)) : 0;
    const newProjectId = Date.now().toString();
    const newProject: Project = {
      ...data,
      id: newProjectId,
      createdAt: new Date().toISOString(),
      sortOrder: maxSortOrder + 1,
      status: 'active'
    };

    const newProjects = [...projects, newProject];
    
    // Initialize processes for the new project
    const newProcesses = [...processes];
    PROCESS_LIST.forEach((name) => {
      newProcesses.push({
        id: (Date.now() + Math.random()).toString(),
        projectId: newProjectId,
        name,
        targetDate: '', // Start empty so it shows D-0
        progress: 0
      });
    });

    await persistData({ projects: newProjects, processes: newProcesses });
    setIsProjectModalOpen(false);
  };

  const handleUpdateProject = async (id: string, data: Partial<Project>) => {
    const project = projects.find(p => p.id === id);
    if (project?.status === 'completed') {
      showAlert('수정 불가', '생산 완료된 프로젝트는 수정할 수 없습니다.', 'error');
      return;
    }
    
    const updatedProjects = projects.map(p => {
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

    await persistData({ projects: updatedProjects });
    setSelectedProject(null);
  };

  const handleDeleteProject = async (id: string) => {
    const isAuthorized = userInitials === 'MASTER' || localStorage.getItem('isAuthorized') === 'true';
    if (!isAuthorized) {
      showAlert('권한 없음', '데이터 삭제 권한이 없습니다.', 'error');
      return;
    }

    showPasswordPrompt('프로젝트 삭제', '프로젝트를 삭제하시겠습니까? 비밀번호를 입력하세요.', async (password) => {
      const storedPassword = localStorage.getItem('currentUserPassword');
      const inputPassword = password.trim().toUpperCase();
      if (inputPassword === storedPassword?.toUpperCase() || inputPassword === MASTER_PASSWORD.toUpperCase()) {
        showConfirm('최종 확인', '정말로 이 프로젝트와 관련된 모든 데이터를 삭제하시겠습니까?', async () => {
          try {
            const updatedProjects = projects.filter(p => p.id !== id);
            const updatedProcesses = processes.filter(p => p.projectId !== id);
            const updatedTasks = tasks.filter(t => t.projectId !== id);
            const updatedParts = processParts.filter(p => p.projectId !== id);

            await persistData({ 
              projects: updatedProjects, 
              processes: updatedProcesses, 
              tasks: updatedTasks, 
              processParts: updatedParts 
            });
            showAlert('삭제 완료', '프로젝트가 성공적으로 삭제되었습니다.', 'success');
          } catch (error) {
            console.error(error);
            showAlert('오류', '삭제 중 오류가 발생했습니다.', 'error');
          }
        });
      } else {
        showAlert('오류', '비밀번호가 틀렸습니다.', 'error');
      }
    });
  };

  const handleMoveProject = async (id: string, direction: 'up' | 'down') => {
    const index = projects.findIndex(p => p.id === id);
    const newProjects = [...projects];
    if (direction === 'up' && index > 0) {
      const prev = newProjects[index - 1];
      const curr = newProjects[index];
      const tempOrder = prev.sortOrder;
      prev.sortOrder = curr.sortOrder;
      curr.sortOrder = tempOrder;
      newProjects[index - 1] = curr;
      newProjects[index] = prev;
    } else if (direction === 'down' && index < projects.length - 1) {
      const next = newProjects[index + 1];
      const curr = newProjects[index];
      const tempOrder = next.sortOrder;
      next.sortOrder = curr.sortOrder;
      curr.sortOrder = tempOrder;
      newProjects[index + 1] = curr;
      newProjects[index] = next;
    }
    await persistData({ projects: newProjects });
  };

  const handleUpdateProcessDate = async (processId: string, date: string) => {
    const updatedProcesses = processes.map(proc => {
      if (proc.id === processId) {
        const history = proc.targetDateHistory || [];
        if (proc.targetDate.split('T')[0] !== date.split('T')[0]) {
          const newHistory = [...history, proc.targetDate];
          return { ...proc, targetDate: date, targetDateHistory: newHistory };
        }
      }
      return proc;
    });
    await persistData({ processes: updatedProcesses });
  };

  const handleAddTask = async (projectId: string, processName: string, type: string, description: string) => {
    const newTask: Task = {
      id: Date.now().toString(),
      projectId,
      processName,
      type,
      description,
      status: 'pending'
    };
    const updatedTasks = [...tasks, newTask];
    const updatedProcesses = getUpdatedProcessesProgress(projectId, processName, processParts, updatedTasks, processes);
    await persistData({ tasks: updatedTasks, processes: updatedProcesses });
  };

  const handleUpdateTaskStatus = async (taskId: string, status: TaskStatus, projectId: string, processName: string) => {
    const updatedTasks = tasks.map(t => {
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
    const updatedProcesses = getUpdatedProcessesProgress(projectId, processName, processParts, updatedTasks, processes);
    await persistData({ tasks: updatedTasks, processes: updatedProcesses });
  };

  const handleUpdateTask = async (taskId: string, data: Partial<Task>, projectId: string, processName: string) => {
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, ...data } : t);
    const updatedProcesses = getUpdatedProcessesProgress(projectId, processName, processParts, updatedTasks, processes);
    await persistData({ tasks: updatedTasks, processes: updatedProcesses });
  };

  const handleUploadExcel = async (projectId: string, processName: string, file: File) => {
    const project = projects.find(p => p.id === projectId);
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
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", range: 0 }) as any[][];

        if (jsonData.length === 0) {
          showAlert('오류', '엑셀 파일에 데이터가 없습니다.', 'error');
          return;
        }

        // Improved header detection with scoring
        const keywords = [
          'MOLD', '인쇄물', '부품명', 'PART', '공정', '도번', '품명', 'DWG', 
          'DESCRIPTION', '완료', 'DELAY', 'NO', 'NAME', 'S', '비고', 'REMARK',
          'TYPE', 'DN', '도면', 'DRAWING'
        ];
        
        let headerRowIndex = -1;
        let maxMatches = 0;

        for (let i = 0; i < Math.min(jsonData.length, 50); i++) {
          const row = jsonData[i];
          if (row && row.some(cell => cell !== "")) {
            let matches = 0;
            row.forEach(cell => {
              const cellVal = String(cell).toUpperCase().replace(/\s/g, '');
              if (!cellVal) return;

              const hasMatch = keywords.some(k => {
                if (k === 'S') return cellVal === 'S';
                if (k === 'DN' || k === 'TYPE' || k === 'NO') {
                  return cellVal === k || cellVal.includes(k);
                }
                return cellVal.includes(k);
              });
              
              if (hasMatch) {
                matches++;
              }
            });
            
            if (matches > maxMatches) {
              maxMatches = matches;
              headerRowIndex = i;
            }
          }
        }

        if (headerRowIndex === -1 || maxMatches === 0) {
          for (let i = 0; i < jsonData.length; i++) {
            if (jsonData[i] && jsonData[i].some(cell => cell !== "")) {
              headerRowIndex = i;
              break;
            }
          }
        }
        if (headerRowIndex === -1) headerRowIndex = 0;

        const rawHeaders = (jsonData[headerRowIndex] || []) as string[];
        const headers: string[] = [];
        const headerIndices: number[] = [];
        
        rawHeaders.forEach((h, idx) => {
          const s = String(h).toUpperCase().replace(/\s/g, '');
          if (!s.includes('완료') && !s.includes('DELAY') && h) {
            headers.push(h);
            headerIndices.push(idx);
          }
        });

        const dataRows = jsonData.slice(headerRowIndex + 1);
        
        let excelTitle = "";
        for (let i = 0; i < headerRowIndex; i++) {
          const row = jsonData[i];
          if (row && row.some(cell => cell !== "")) {
            excelTitle = String(row.find(cell => cell !== "") || "");
            break;
          }
        }

        const updatedProcesses = processes.map(proc => {
          if (proc.projectId === projectId && proc.name === processName) {
            return { ...proc, headers, excelTitle: excelTitle || null };
          }
          return proc;
        });

        const findRawIdx = (keys: string[]) => rawHeaders.findIndex(h => {
          const s = String(h).toUpperCase().replace(/\s/g, '');
          return keys.some(k => {
            if (k === 'S') return s === 'S';
            return s.includes(k);
          });
        });

        const moldIdx = findRawIdx(['MOLD', '공정', 'NO', 'TYPE']);
        const drwIdx = findRawIdx(['도번', 'DWG', 'DRAWING', 'DN']);
        const nameIdx = findRawIdx(['품명', '부품', 'PART', 'NAME']);
        const sIdx = findRawIdx(['S', '작업', '상태']);

        const newParts: ProcessPart[] = [];
        dataRows.forEach((row, idx) => {
          if (row.every(cell => !cell)) return;
          
          const defaultLocation = ['사출', '인쇄', '메탈'].includes(processName) ? '서울' : '대천';
          
          newParts.push({
            id: (Date.now() + Math.random()).toString(),
            projectId,
            processName,
            moldNo: moldIdx !== -1 && row[moldIdx] ? String(row[moldIdx]) : (row[0] ? String(row[0]) : ''),
            drwNo: drwIdx !== -1 && row[drwIdx] ? String(row[drwIdx]) : (row[1] ? String(row[1]) : ''),
            s: sIdx !== -1 && row[sIdx] ? String(row[sIdx]) : (row[2] ? String(row[2]) : ''),
            partsName: nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]) : (row[3] ? String(row[3]) : ''),
            productionLocation: defaultLocation,
            plannedAt: null,
            completedAt: null,
            delayReason: '',
            delayType: '',
            order: idx,
            rawData: headerIndices.map(hIdx => row[hIdx])
          });
        });

        const updatedParts = [...processParts.filter(p => !(p.projectId === projectId && p.processName === processName)), ...newParts];
        const finalProcesses = getUpdatedProcessesProgress(projectId, processName, updatedParts, tasks, updatedProcesses);
        
        await persistData({ processParts: updatedParts, processes: finalProcesses });
        showAlert('업로드 완료', `${dataRows.length}개의 부품 데이터가 업로드되었습니다.`, 'success');
      } catch (error) {
        console.error('Excel upload error:', error);
        showAlert('오류', '엑셀 파일 처리 중 오류가 발생했습니다.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleBatchUpdateParts = async (updates: { id: string, data: Partial<ProcessPart> }[], projectId: string, processName: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project?.status === 'completed') return;
    
    const updatedParts = processParts.map(p => {
      const update = updates.find(u => u.id === p.id);
      if (update) {
        return { ...p, ...update.data };
      }
      return p;
    });
    
    const updatedProcesses = getUpdatedProcessesProgress(projectId, processName, updatedParts, tasks, processes);
    await persistData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleUpdatePart = async (partId: string, data: Partial<ProcessPart>, projectId: string, processName: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project?.status === 'completed') return;
    
    const updatedParts = processParts.map(p => p.id === partId ? { ...p, ...data } : p);
    const updatedProcesses = getUpdatedProcessesProgress(projectId, processName, updatedParts, tasks, processes);
    await persistData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleAddPart = async (projectId: string, processName: string, data: Partial<ProcessPart>) => {
    const project = projects.find(p => p.id === projectId);
    if (project?.status === 'completed') return;
    const maxOrder = processParts
      .filter(p => p.projectId === projectId && p.processName === processName)
      .reduce((max, p) => Math.max(max, p.order || 0), 0);

    const defaultLocation = ['사출', '인쇄', '메탈'].includes(processName) ? '서울' : '대천';

    const newPart: ProcessPart = {
      id: Date.now().toString(),
      projectId,
      processName,
      moldNo: data.moldNo || '',
      drwNo: data.drwNo || '',
      s: data.s || '',
      partsName: data.partsName || '',
      productionLocation: data.productionLocation || defaultLocation,
      completedAt: null,
      delayReason: '',
      delayType: '',
      order: maxOrder + 1,
      ...data
    } as ProcessPart;

    const updatedParts = [...processParts, newPart];
    const updatedProcesses = getUpdatedProcessesProgress(projectId, processName, updatedParts, tasks, processes);
    await persistData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleDeletePart = async (partId: string, projectId: string, processName: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project?.status === 'completed') return;
    const updatedParts = processParts.filter(p => p.id !== partId);
    const updatedProcesses = getUpdatedProcessesProgress(projectId, processName, updatedParts, tasks, processes);
    await persistData({ processParts: updatedParts, processes: updatedProcesses });
  };

  const handleDeleteParts = async (projectId: string, processName: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project?.status === 'completed') return;
    
    const updatedParts = processParts.filter(p => !(p.projectId === projectId && p.processName === processName));
    const updatedTasks = tasks.filter(t => !(t.projectId === projectId && t.processName === processName));
    const updatedProcesses = processes.map(proc => {
      if (proc.projectId === projectId && proc.name === processName) {
        return { 
          ...proc, 
          progress: 0,
          headers: [],
          excelTitle: null,
          targetDate: '',
          targetDateHistory: []
        };
      }
      return proc;
    });
    
    await persistData({ processParts: updatedParts, tasks: updatedTasks, processes: updatedProcesses });
  };

  const handleCompleteProject = async (projectId: string) => {
    showConfirm('생산 완료', '이 프로젝트를 생산 완료 처리하시겠습니까?', async () => {
      const updatedProjects = projects.map(p => p.id === projectId ? {
        ...p,
        status: 'completed' as const,
        completedAt: new Date().toISOString()
      } : p);
      await persistData({ projects: updatedProjects });
      showAlert('완료 처리', '프로젝트가 생산 완료 목록으로 이동되었습니다.', 'success');
    });
  };

  const handleExportToExcel = (project: Project) => {
    const projectParts = processParts.filter(p => p.projectId === project.id);
    
    const wb = XLSX.utils.book_new();
    
    // Project Info Sheet
    const projectInfo = [
      ['프로젝트명', project.name],
      ['모델명', project.model],
      ['목표수량', project.targetQuantity],
      ['FO 날짜', format(parseISO(project.foDate), 'yyyy-MM-dd')],
      ['생성일', format(parseISO(project.createdAt), 'yyyy-MM-dd')],
      ['상태', project.status === 'completed' ? '생산완료' : '진행중']
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(projectInfo);
    XLSX.utils.book_append_sheet(wb, wsInfo, '프로젝트 정보');

    // Export each process to a separate sheet
    PROCESS_LIST.forEach(procName => {
      const procParts = projectParts.filter(p => p.processName === procName);
      if (procParts.length === 0) return;

      const partsData = procParts.sort((a, b) => (a.order || 0) - (b.order || 0)).map(p => {
        // Calculate delay for export
        let delayText = '-';
        if (p.plannedAt) {
          const plan = new Date(p.plannedAt);
          const target = p.completedAt ? new Date(p.completedAt) : new Date();
          plan.setHours(0, 0, 0, 0);
          target.setHours(0, 0, 0, 0);
          const diffTime = target.getTime() - plan.getTime();
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
          delayText = diffDays > 0 ? `+${diffDays}` : `${diffDays}`;
        }

        return {
          'MOLD': p.moldNo,
          'DRW NO': p.drwNo,
          'S': p.s,
          '부품명': p.partsName,
          '계획일': p.plannedAt ? format(parseISO(p.plannedAt), 'yyyy-MM-dd') : '-',
          '완료일': p.completedAt ? format(parseISO(p.completedAt), 'yyyy-MM-dd HH:mm') : '미완료',
          '지연(일)': delayText,
          '지연유형': p.delayType || '-',
          '지연사유': p.delayReason || '-',
          '작업자': p.initials || '-'
        };
      });

      const ws = XLSX.utils.json_to_sheet(partsData);
      XLSX.utils.book_append_sheet(wb, ws, procName);
    });

    XLSX.writeFile(wb, `${project.model}_생산현황_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  const getUpdatedProcessesProgress = (projectId: string, processName: string, currentParts: ProcessPart[], currentTasks: Task[], currentProcesses: Process[]) => {
    const parts = currentParts.filter(p => p.projectId === projectId && p.processName === processName);
    const tasks = currentTasks.filter(t => t.projectId === projectId && t.processName === processName);
    
    const totalItems = parts.length + tasks.length;
    if (totalItems === 0) {
      return currentProcesses.map(proc => {
        if (proc.projectId === projectId && proc.name === processName) {
          return { ...proc, progress: 0 };
        }
        return proc;
      });
    }

    const completedParts = parts.filter(p => p.completedAt).length;
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const progress = Math.round(((completedParts + completedTasks) / totalItems) * 100);

    return currentProcesses.map(proc => {
      if (proc.projectId === projectId && proc.name === processName) {
        return { ...proc, progress };
      }
      return proc;
    });
  };

  if (!userInitials) {
    return <Auth users={users} onLogin={(initials) => setUserInitials(initials)} />;
  }

  const today = new Date();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-100">
            <SettingsIcon className="text-white" size={16} />
          </div>
          <h1 className="text-lg font-black tracking-tight text-slate-800">Flow</h1>
          <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-xl border border-slate-100">
            <span className="w-6 h-6 rounded-md bg-blue-100 text-blue-600 flex items-center justify-center font-black text-[10px]">
              {userInitials}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowCompleted(!showCompleted)}
            className={cn(
              "px-3 py-2 rounded-xl font-bold transition-all text-xs",
              showCompleted ? "bg-blue-600 text-white shadow-lg shadow-blue-100" : "bg-white text-slate-600 border border-slate-200"
            )}
          >
            {showCompleted ? '진행 중' : '완료 목록'}
          </button>
          {userInitials === 'MASTER' && (
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
            >
              <SettingsIcon size={20} />
            </button>
          )}
          <button 
            onClick={() => setIsProjectModalOpen(true)}
            className="flex items-center gap-1 bg-blue-600 text-white px-3 py-2 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 text-xs"
          >
            <Plus size={16} />
            <span>PROJ</span>
          </button>
          <button 
            onClick={() => setUserInitials(null)}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-2 max-w-[1800px] mx-auto">
        <div className="space-y-3">
          {projects
            .filter(p => showCompleted ? p.status === 'completed' : (p.status === 'active' || !p.status))
            .map((project, index) => {
            const projectProcesses = processes.filter(p => p.projectId === project.id);
            const totalProgress = projectProcesses.length > 0 
              ? Math.round(projectProcesses.reduce((acc, p) => acc + p.progress, 0) / projectProcesses.length)
              : 0;
            const foDDay = project.foDate ? differenceInDays(parseISO(project.foDate), today) : 0;

            return (
              <div key={project.id} className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
                {/* Project Header - Mobile Optimized */}
                <div className="bg-slate-900 px-4 py-2 flex flex-col gap-2 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-row gap-2">
                        <button 
                          onClick={() => handleMoveProject(project.id, 'up')}
                          disabled={index === 0 || project.status === 'completed'}
                          className="p-1.5 bg-slate-800 rounded-lg disabled:opacity-20"
                        >
                          <ChevronRight className="-rotate-90" size={14} />
                        </button>
                        <button 
                          onClick={() => handleMoveProject(project.id, 'down')}
                          disabled={index === projects.length - 1 || project.status === 'completed'}
                          className="p-1.5 bg-slate-800 rounded-lg disabled:opacity-20"
                        >
                          <ChevronRight className="rotate-90" size={14} />
                        </button>
                        <button 
                          onClick={() => handleExportToExcel(project)}
                          className="p-1.5 bg-slate-800 rounded-lg text-emerald-500 hover:text-emerald-400 transition-colors"
                          title="엑셀 내보내기"
                        >
                          <Save size={14} />
                        </button>
                        {project.status !== 'completed' && (
                          <button 
                            onClick={() => handleCompleteProject(project.id)}
                            className="p-1.5 bg-slate-800 rounded-lg text-blue-500 hover:text-blue-400 transition-colors"
                            title="생산 완료"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        )}
                        <button 
                          onClick={() => handleDeleteProject(project.id)}
                          className="p-1.5 bg-slate-800 rounded-lg text-slate-500 hover:text-rose-500 transition-colors"
                          title="프로젝트 삭제"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div>
                        <h2 className="text-2xl font-black tracking-tight leading-none flex items-center gap-2">
                          {project.name}
                          {project.status === 'completed' && (
                            <span className="text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
                              생산완료 ({project.completedAt ? format(parseISO(project.completedAt), 'yyyy-MM-dd') : ''})
                            </span>
                          )}
                        </h2>
                        <p className="text-slate-400 font-mono text-xs mt-1">{project.model}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-2xl font-black leading-none", !project.foDate ? "text-blue-400" : (foDDay < 0 ? "text-rose-500" : "text-blue-400"))}>
                        {!project.foDate || foDDay === 0 ? 'D-0' : foDDay > 0 ? `D-${foDDay}` : `D+${Math.abs(foDDay)}`}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        {project.foDateHistory && project.foDateHistory.length > 0 && (
                          <div className="flex gap-1">
                            {project.foDateHistory.map((h, idx) => (
                              <span key={idx} className="text-[10px] font-bold text-slate-400">
                                {h.split('T')[0]}
                              </span>
                            ))}
                          </div>
                        )}
                        <button 
                          onClick={() => {
                            if (project.status !== 'completed') {
                              setSelectedProject(project);
                            }
                          }}
                          className={cn(
                            "text-[10px] font-black font-mono",
                            project.status === 'completed' ? "text-slate-500 cursor-default" : (project.foDateHistory && project.foDateHistory.length > 0 ? "text-red-500 hover:text-red-400" : "text-slate-400 hover:text-blue-400")
                          )}
                        >
                          {project.foDate ? project.foDate.split('T')[0] : '연도-월-일'}
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between border-t border-slate-800 pt-3 pb-2">
                    <div className="flex gap-6">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">PROGRESS</span>
                        <span className="text-lg font-black text-blue-400">{totalProgress}%</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">QTY</span>
                        <span className="text-lg font-black">{project.targetQuantity.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Process Grid - No Horizontal Scroll */}
                <div className="grid grid-cols-4 border-t border-slate-100">
                  {PROCESS_LIST.map(name => {
                    const proc = projectProcesses.find(p => p.name === name);
                    const dDay = (proc && proc.targetDate) ? differenceInDays(parseISO(proc.targetDate), today) : 0;
                    return (
                      <div 
                        key={name} 
                        className={cn(
                          "p-3 border-r border-b border-slate-100 last:border-r-0 flex flex-col items-center justify-between min-h-[100px]", 
                          PROCESS_COLORS[name]
                        )}
                      >
                        <div 
                          className="text-[11px] font-black text-slate-600 uppercase tracking-tighter mb-1 cursor-pointer hover:text-blue-600"
                          onClick={() => {
                            setSelectedProcess({ projectId: project.id, name });
                            setIsProcessModalOpen(true);
                          }}
                        >
                          {name}
                        </div>
                        
                        <div 
                          className="text-3xl font-black text-slate-900 cursor-pointer active:scale-95 transition-transform"
                          onClick={() => {
                            setSelectedProcess({ projectId: project.id, name });
                            setIsProcessModalOpen(true);
                          }}
                        >
                          {proc?.progress || 0}<span className="text-xs font-bold text-slate-400 ml-0.5">%</span>
                        </div>

                        <div className="w-full mt-2 flex items-center justify-center gap-1">
                          {proc?.targetDateHistory && proc.targetDateHistory.length > 0 && (
                            <div className="flex flex-col items-end">
                              {proc.targetDateHistory.map((h, idx) => (
                                <div key={idx} className="text-[8px] font-black font-mono text-black leading-none">
                                  {h.split('T')[0]}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-col items-center">
                            <input 
                              type="date" 
                              value={proc?.targetDate.split('T')[0] || ''}
                              onChange={(e) => proc && handleUpdateProcessDate(proc.id, new Date(e.target.value).toISOString())}
                              className={cn(
                                "text-[10px] font-black font-mono bg-transparent border-none p-0 focus:ring-0 cursor-pointer text-center w-full",
                                proc?.targetDateHistory && proc.targetDateHistory.length > 0 ? "text-red-600" : "text-slate-500"
                              )}
                            />
                            <div className={cn("text-xs font-black text-center mt-0.5", dDay < 0 ? "text-rose-500" : dDay === 0 ? "text-blue-600" : "text-slate-500")}>
                              {dDay === 0 ? 'D-0' : dDay > 0 ? `-${dDay}` : `+${Math.abs(dDay)}`}
                            </div>
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
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsModal 
            users={users} 
            persistData={persistData} 
            onClose={() => setIsSettingsOpen(false)} 
            showConfirm={showConfirm} 
          />
        )}
        {isProjectModalOpen && (
          <ProjectModal 
            onClose={() => setIsProjectModalOpen(false)} 
            onSubmit={handleCreateProject} 
          />
        )}
        {selectedProject && (
          <ProjectModal 
            project={selectedProject}
            onClose={() => setSelectedProject(null)} 
            onSubmit={(data) => handleUpdateProject(selectedProject.id, data)} 
          />
        )}
        {isProcessModalOpen && selectedProcess && (
          <ProcessModal 
            projectId={selectedProcess.projectId}
            processName={selectedProcess.name}
            tasks={tasks.filter(t => t.projectId === selectedProcess.projectId && t.processName === selectedProcess.name)}
            processParts={processParts.filter(p => p.projectId === selectedProcess.projectId && p.processName === selectedProcess.name)}
            processes={processes}
            isReadOnly={projects.find(p => p.id === selectedProcess.projectId)?.status === 'completed'}
            onClose={() => setIsProcessModalOpen(false)}
            onAddTask={handleAddTask}
            onUpdateTaskStatus={handleUpdateTaskStatus}
            onUpdateTask={handleUpdateTask}
            onAddPart={handleAddPart}
            onDeletePart={handleDeletePart}
            onUpdatePart={handleUpdatePart}
            onBatchUpdateParts={handleBatchUpdateParts}
            onDeleteParts={handleDeleteParts}
            onUploadExcel={handleUploadExcel}
            userInitials={userInitials || ''}
            showAlert={showAlert}
            showConfirm={showConfirm}
            showPasswordPrompt={showPasswordPrompt}
          />
        )}
      </AnimatePresence>

      {/* Custom Modals */}
      <AnimatePresence>
        {passwordModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Clock size={24} />
                </div>
                <h3 className="text-lg font-black text-slate-800 mb-1">{passwordModal.title}</h3>
                <p className="text-slate-500 text-sm mb-6">{passwordModal.message}</p>
                <input 
                  type="password"
                  autoFocus
                  placeholder="비밀번호 입력"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500 text-center text-xl tracking-widest mb-4"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      setPasswordModal(prev => ({ ...prev, isOpen: false }));
                      passwordModal.onConfirm(val);
                    }
                  }}
                />
                <div className="flex gap-2">
                  <button 
                    onClick={() => setPasswordModal(prev => ({ ...prev, isOpen: false }))}
                    className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    onClick={(e) => {
                      const input = (e.currentTarget.parentElement?.previousElementSibling as HTMLInputElement);
                      setPasswordModal(prev => ({ ...prev, isOpen: false }));
                      passwordModal.onConfirm(input.value);
                    }}
                    className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
                  >
                    확인
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {alertModal.isOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4",
                  alertModal.type === 'success' ? "bg-emerald-100 text-emerald-600" :
                  alertModal.type === 'error' ? "bg-rose-100 text-rose-600" : "bg-blue-100 text-blue-600"
                )}>
                  {alertModal.type === 'success' ? <CheckCircle2 size={24} /> :
                   alertModal.type === 'error' ? <AlertCircle size={24} /> : <AlertCircle size={24} />}
                </div>
                <h3 className="text-lg font-black text-slate-800 mb-1">{alertModal.title}</h3>
                <p className="text-slate-500 text-sm mb-6">{alertModal.message}</p>
                <button 
                  onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                  className="w-full px-4 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <AlertCircle size={24} />
                </div>
                <h3 className="text-lg font-black text-slate-800 mb-1">{confirmModal.title}</h3>
                <p className="text-slate-500 text-sm mb-6">{confirmModal.message}</p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                    className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                  >
                    취소
                  </button>
                  <button 
                    onClick={() => {
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                      confirmModal.onConfirm();
                    }}
                    className="flex-1 px-4 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-colors"
                  >
                    최종 확인
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Modal Components
const ProjectModal = ({ project, onClose, onSubmit }: { 
  project?: Project, 
  onClose: () => void, 
  onSubmit: (data: any) => void 
}) => {
  const [name, setName] = useState(project?.name || '');
  const [model, setModel] = useState(project?.model || '');
  const [quantity, setQuantity] = useState(project?.targetQuantity || 5000);
  const [foDate, setFoDate] = useState(project?.foDate?.split('T')[0] || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">{project ? '프로젝트 수정' : '새 프로젝트 생성'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">닫기</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">프로젝트명</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: CPH-329R3"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">모델명</label>
            <input 
              type="text" 
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="예: EF-510"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">생산수량 (CH)</label>
            <input 
              type="number" 
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">팩토리 아웃 (FO) 날짜</label>
            <input 
              type="date" 
              value={foDate}
              onChange={(e) => setFoDate(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button 
            onClick={() => onSubmit({ name, model, targetQuantity: quantity, foDate: foDate ? new Date(foDate).toISOString() : '' })}
            className="w-full bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors"
          >
            {project ? '수정 완료' : '생성하기'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

import * as Processes from './processes';

const ProcessModal = ({ projectId, processName, tasks, processParts, processes, isReadOnly, onClose, onAddTask, onUpdateTaskStatus, onUpdateTask, onAddPart, onDeletePart, onUpdatePart, onBatchUpdateParts, onDeleteParts, onUploadExcel, userInitials, showAlert, showConfirm, showPasswordPrompt }: {
  projectId: string,
  processName: string,
  tasks: Task[],
  processParts: ProcessPart[],
  processes: Process[],
  isReadOnly?: boolean,
  onClose: () => void,
  onAddTask: (pid: string, pname: string, type: string, desc: string) => void,
  onUpdateTaskStatus: (tid: string, status: TaskStatus, pid: string, pname: string) => void,
  onUpdateTask: (tid: string, data: Partial<Task>, pid: string, pname: string) => void,
  onAddPart: (projectId: string, processName: string, data: Partial<ProcessPart>) => void,
  onDeletePart: (partId: string, projectId: string, processName: string) => void,
  onUpdatePart: (partId: string, data: Partial<ProcessPart>, projectId: string, processName: string) => void,
  onBatchUpdateParts: (updates: { id: string, data: Partial<ProcessPart> }[], projectId: string, processName: string) => void,
  onDeleteParts: (projectId: string, processName: string) => void,
  onUploadExcel: (projectId: string, processName: string, file: File) => void,
  userInitials: string,
  showAlert: (title: string, message: string, type?: 'info' | 'error' | 'success') => void,
  showConfirm: (title: string, message: string, onConfirm: () => void) => void,
  showPasswordPrompt: (title: string, message: string, onConfirm: (password: string) => void) => void
}) => {
  const progress = (() => {
    const totalItems = processParts.length + tasks.length;
    if (totalItems === 0) return 0;
    const completedParts = processParts.filter(p => p.completedAt).length;
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    return Math.round(((completedParts + completedTasks) / totalItems) * 100);
  })();

  // Map process name to component
  const ProcessComponent = (() => {
    switch (processName) {
      case '사출': return Processes.Injection;
      case '인쇄': return Processes.Printing;
      case '메탈': return Processes.Metal;
      case 'PAINT': return Processes.Paint;
      case 'PRINT': return Processes.Print;
      case '가공': return Processes.Processing;
      case '조립': return Processes.Assembly;
      case '포장': return Processes.Packaging;
      default: return null;
    }
  })();

  const currentProcess = processes.find(p => p.projectId === projectId && p.name === processName);
  const headers = currentProcess?.headers;
  const excelTitle = currentProcess?.excelTitle;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-slate-800 text-xl">{processName} 공정 상세</h3>
            <span className="bg-blue-100 text-blue-600 px-2 py-0.5 rounded text-base font-bold">{progress}%</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">닫기</button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
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
            <div className="text-center py-8 text-slate-400">공정 정보를 찾을 수 없습니다.</div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

