import React, { useState } from 'react';
import { UserConfig } from '../types';
import { Users, Plus, Trash2, X, Shield, Check, Lock, Edit3, Eye, EyeOff, Key } from 'lucide-react';

interface UserManagementModalProps {
  isOpen: boolean;
  users: UserConfig[];
  currentUserId?: string;
  onClose: () => void;
  onSaveUsers: (users: UserConfig[]) => void;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  users,
  onClose,
  onSaveUsers,
}) => {
  const [localUsers, setLocalUsers] = useState<UserConfig[]>(users);
  const [initials, setInitials] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showFormPassword, setShowFormPassword] = useState(true); // Default visible so admin can see while creating/editing
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [canAccessFlow, setCanAccessFlow] = useState(true);
  const [canAccessInfo, setCanAccessInfo] = useState(true);
  const [canManageInfo, setCanManageInfo] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [error, setError] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  React.useEffect(() => {
    setLocalUsers(users);
    // Initialize visible passwords map so Master/5200 can see them immediately
    const initialVisibility: Record<string, boolean> = {};
    users.forEach((u) => {
      initialVisibility[u.id] = true;
    });
    setVisiblePasswords(initialVisibility);
  }, [users, isOpen]);

  if (!isOpen) return null;

  const togglePasswordVisibility = (userId: string) => {
    setVisiblePasswords((prev) => ({
      ...prev,
      [userId]: !prev[userId],
    }));
  };

  const handleAddOrUpdateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!initials.trim() || !password.trim()) {
      setError('이니셜과 비밀번호를 입력해 주세요.');
      return;
    }

    const trimmedInitials = initials.trim().toUpperCase();

    if (editingUserId) {
      const updated = localUsers.map((u) => {
        if (u.id === editingUserId) {
          return {
            ...u,
            initials: trimmedInitials,
            name: name.trim() || trimmedInitials,
            password: password.trim(),
            canAccessFlow,
            canAccessInfo,
            canManageInfo: trimmedInitials === '5200' || trimmedInitials === 'MASTER' ? true : canManageInfo,
            isAuthorized,
          };
        }
        return u;
      });
      setLocalUsers(updated);
      onSaveUsers(updated);
      resetForm();
    } else {
      if (localUsers.some((u) => u.initials.toUpperCase() === trimmedInitials)) {
        setError('이미 등록된 이니셜입니다.');
        return;
      }

      const newUser: UserConfig = {
        id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        initials: trimmedInitials,
        name: name.trim() || trimmedInitials,
        password: password.trim(),
        canAccessFlow,
        canAccessInfo,
        canManageInfo: trimmedInitials === '5200' || trimmedInitials === 'MASTER' ? true : canManageInfo,
        isAuthorized,
      };

      const updated = [...localUsers, newUser];
      setLocalUsers(updated);
      onSaveUsers(updated);
      resetForm();
    }
  };

  const handleEditClick = (u: UserConfig) => {
    setEditingUserId(u.id);
    setInitials(u.initials);
    setName(u.name || u.initials);
    setPassword(u.password);
    setCanAccessFlow(u.canAccessFlow !== false);
    setCanAccessInfo(u.canAccessInfo !== false);
    setCanManageInfo(u.canManageInfo === true || u.initials === '5200');
    setIsAuthorized(Boolean(u.isAuthorized));
    setError('');
  };

  const handleDeleteUser = (userId: string) => {
    const target = localUsers.find((u) => u.id === userId);
    if (target?.initials === '5200' || target?.initials === 'MASTER') {
      alert('기본 마스터 계정은 삭제할 수 없습니다.');
      return;
    }
    if (confirm('해당 사용자를 삭제하시겠습니까?')) {
      const updated = localUsers.filter((u) => u.id !== userId);
      setLocalUsers(updated);
      onSaveUsers(updated);
    }
  };

  const resetForm = () => {
    setEditingUserId(null);
    setInitials('');
    setName('');
    setPassword('');
    setCanAccessFlow(true);
    setCanAccessInfo(true);
    setCanManageInfo(false);
    setIsAuthorized(false);
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-100 text-base">사용자 등록 및 권한 / 비밀번호 관리</h2>
              <p className="text-xs text-slate-400">사용자 계정 생성, 비밀번호 열람·수정 및 접근 권한을 관리합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* User Registration Form */}
          <form onSubmit={handleAddOrUpdateUser} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-purple-400" />
                {editingUserId ? '사용자 정보 및 비밀번호 수정' : '새 사용자 등록'}
              </span>
              {editingUserId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  수정 취소
                </button>
              )}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">이니셜 / ID</label>
                <input
                  type="text"
                  required
                  placeholder="예: 5200, KDH, AJ"
                  value={initials}
                  onChange={(e) => setInitials(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 uppercase font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">이름 (선택)</label>
                <input
                  type="text"
                  placeholder="예: 관리자 / 김작업"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-medium text-slate-400">비밀번호</label>
                  <button
                    type="button"
                    onClick={() => setShowFormPassword(!showFormPassword)}
                    className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-0.5"
                  >
                    {showFormPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{showFormPassword ? '숨김' : '표시'}</span>
                  </button>
                </div>
                <input
                  type={showFormPassword ? 'text' : 'password'}
                  required
                  placeholder="접속 비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-amber-300 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Permissions Toggles */}
            <div className="pt-2 border-t border-slate-700/60">
              <label className="block text-[11px] font-semibold text-slate-300 mb-2">권한 부여</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {/* Flow access */}
                <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-700/50 cursor-pointer hover:bg-slate-900">
                  <input
                    type="checkbox"
                    checked={canAccessFlow}
                    onChange={(e) => setCanAccessFlow(e.target.checked)}
                    className="rounded border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-slate-200">공정 관리 (FLOW) 접근</span>
                </label>

                {/* Info access */}
                <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-700/50 cursor-pointer hover:bg-slate-900">
                  <input
                    type="checkbox"
                    checked={canAccessInfo}
                    onChange={(e) => setCanAccessInfo(e.target.checked)}
                    className="rounded border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-slate-200">정보/도면 (INFO) 열람</span>
                </label>

                {/* Manage Info */}
                <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-700/50 cursor-pointer hover:bg-slate-900">
                  <input
                    type="checkbox"
                    checked={canManageInfo || initials.toUpperCase() === '5200'}
                    disabled={initials.toUpperCase() === '5200'}
                    onChange={(e) => setCanManageInfo(e.target.checked)}
                    className="rounded border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <span className="text-slate-200 block">INFO 업로드/편집/삭제/완료 권한</span>
                    <span className="text-[10px] text-slate-400">마스터 & 5200은 기본 허용</span>
                  </div>
                </label>

                {/* Admin */}
                <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-700/50 cursor-pointer hover:bg-slate-900">
                  <input
                    type="checkbox"
                    checked={isAuthorized}
                    onChange={(e) => setIsAuthorized(e.target.checked)}
                    className="rounded border-slate-700 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-slate-200">전체 관리자 (Authorized)</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{editingUserId ? '수정 저장' : '사용자 추가'}</span>
              </button>
            </div>
          </form>

          {/* User List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-300">
                등록된 사용자 목록 ({localUsers.length}명)
              </h3>
              <span className="text-[11px] text-slate-400">
                비밀번호 열람 및 즉시 수정 가능
              </span>
            </div>
            <div className="space-y-2">
              {localUsers.map((u) => {
                const isSpecial = u.initials === '5200' || u.initials === 'MASTER';
                const isPwVisible = visiblePasswords[u.id] ?? true;

                return (
                  <div
                    key={u.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs gap-2.5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-purple-500/20 text-purple-300 font-bold flex items-center justify-center font-mono shrink-0">
                        {u.initials}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-200">{u.name || u.initials}</span>
                          <span className="text-slate-400 font-mono text-[11px]">(ID: {u.initials})</span>
                          
                          {/* Visible Password Pill for Master & 5200 */}
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-[11px]">
                            <Key className="w-3 h-3 text-amber-400 shrink-0" />
                            <span className="text-slate-400">PW:</span>
                            <span className="font-mono font-bold text-amber-300 tracking-wider">
                              {isPwVisible ? u.password : '••••••'}
                            </span>
                            <button
                              type="button"
                              onClick={() => togglePasswordVisibility(u.id)}
                              className="text-slate-400 hover:text-slate-200 ml-1"
                              title={isPwVisible ? '비밀번호 가리기' : '비밀번호 보기'}
                            >
                              {isPwVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                          </div>

                          {isSpecial && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-medium text-[10px] border border-purple-500/30">
                              최고관리자
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              u.canAccessFlow !== false
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-slate-800 text-slate-500 line-through'
                            }`}
                          >
                            Flow 접근
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              u.canAccessInfo !== false
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-slate-800 text-slate-500 line-through'
                            }`}
                          >
                            Info 접근
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              u.canManageInfo || isSpecial
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            {u.canManageInfo || isSpecial ? 'Info 업로드/완료 권한' : 'Info 읽기전용'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                      <button
                        onClick={() => handleEditClick(u)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold flex items-center gap-1 transition-colors"
                        title="수정"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-purple-400" />
                        <span>수정</span>
                      </button>
                      {!isSpecial && (
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-slate-800 bg-slate-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
