import React from 'react';
import { Task, TaskStatus, ProcessPart, ProcessName } from '../types';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertCircle, Save, Trash2 } from 'lucide-react';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

interface ProcessProps {
  projectId: string;
  processName: string;
  tasks: Task[];
  processParts: ProcessPart[];
  headers?: string[];
  excelTitle?: string | null;
  isReadOnly?: boolean;
  onAddTask: (pid: string, pname: string, type: string, desc: string) => void;
  onUpdateTaskStatus: (tid: string, status: TaskStatus, pid: string, pname: string) => void;
  onUpdateTask: (tid: string, data: Partial<Task>, pid: string, pname: string) => void;
  onAddPart: (projectId: string, processName: string, data: Partial<ProcessPart>) => void;
  onDeletePart: (partId: string, projectId: string, processName: string) => void;
  onUpdatePart: (partId: string, data: Partial<ProcessPart>, projectId: string, processName: string) => void;
  onBatchUpdateParts: (updates: { id: string, data: Partial<ProcessPart> }[], projectId: string, processName: string) => void;
  onDeleteParts: (projectId: string, processName: string) => void;
  onUploadExcel: (projectId: string, processName: string, file: File) => void;
  userInitials: string;
  showAlert: (title: string, message: string, type?: 'info' | 'error' | 'success') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  showPasswordPrompt: (title: string, message: string, onConfirm: (password: string) => void) => void;
}

const AutoResizeTextarea = ({ value, onChange, className, disabled, placeholder }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      rows={1}
      className={cn("w-full bg-transparent border-none outline-none resize-none overflow-hidden py-1", className)}
    />
  );
};

const ProcessTable = ({ 
  projectId, 
  processName, 
  parts, 
  headers,
  excelTitle,
  userInitials,
  isReadOnly,
  onAddPart,
  onDeletePart,
  onBatchUpdateParts, 
  onDeleteParts, 
  showAlert, 
  showConfirm, 
  showPasswordPrompt 
}: {
  projectId: string;
  processName: string;
  parts: ProcessPart[];
  headers?: string[];
  excelTitle?: string | null;
  userInitials: string;
  isReadOnly?: boolean;
  onAddPart: (projectId: string, processName: string, data: Partial<ProcessPart>) => void;
  onDeletePart: (partId: string, projectId: string, processName: string) => void;
  onBatchUpdateParts: (updates: { id: string, data: Partial<ProcessPart> }[], projectId: string, processName: string) => void;
  onDeleteParts: (projectId: string, processName: string) => void;
  showAlert: (title: string, message: string, type?: 'info' | 'error' | 'success') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  showPasswordPrompt: (title: string, message: string, onConfirm: (password: string) => void) => void;
}) => {
  const DELAY_TYPES = ['금형수리', '사출불량', '인쇄불량', '재작업', '금형파손', '기타'];
  const [localParts, setLocalParts] = React.useState<ProcessPart[]>([]);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    const sorted = [...parts].sort((a, b) => a.order - b.order);
    setLocalParts(sorted);
  }, [parts]);

  const handleToggleCompleteGroup = (groupParts: ProcessPart[]) => {
    if (isReadOnly) return;
    const ids = groupParts.map(p => p.id);
    const isAnyIncomplete = groupParts.some(p => !p.completedAt);
    const newCompletedAt = isAnyIncomplete ? new Date().toISOString() : null;
    const newInitials = isAnyIncomplete ? (userInitials || '') : null;
    
    setLocalParts(prev => prev.map(p => {
      if (ids.includes(p.id)) {
        return { ...p, completedAt: newCompletedAt, initials: newInitials };
      }
      return p;
    }));
  };

  const handleUpdateGroupLocal = (groupParts: ProcessPart[], data: Partial<ProcessPart>) => {
    if (isReadOnly) return;
    const ids = groupParts.map(p => p.id);
    setLocalParts(prev => prev.map(p => {
      if (ids.includes(p.id)) {
        return { ...p, ...data };
      }
      return p;
    }));
  };

  const handleSave = async () => {
    if (isReadOnly) return;
    setIsSaving(true);
    try {
      const updates = localParts.map(p => ({
        id: p.id,
        data: {
          moldNo: p.moldNo || '',
          drwNo: p.drwNo || '',
          s: p.s || '',
          partsName: p.partsName || '',
          plannedAt: p.plannedAt || null,
          completedAt: p.completedAt || null,
          initials: p.initials || null,
          delayReason: p.delayReason || '',
          delayType: p.delayType || ''
        }
      }));
      await onBatchUpdateParts(updates, projectId, processName);
      showAlert('저장 완료', '데이터가 성공적으로 저장되었습니다.', 'success');
    } catch (error) {
      console.error(error);
      showAlert('오류', '저장 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    if (isReadOnly) return;
    const isAuthorized = localStorage.getItem('isAuthorized') === 'true';
    if (!isAuthorized) {
      showAlert('권한 없음', '데이터 초기화 권한이 없습니다.', 'error');
      return;
    }

    showPasswordPrompt('데이터 초기화', '데이터를 삭제하시겠습니까? 비밀번호를 입력하세요.', async (password) => {
      const storedPassword = localStorage.getItem('currentUserPassword');
      const inputPassword = password.trim();
      if (inputPassword === storedPassword || inputPassword === 'AJ5200' || inputPassword.toUpperCase() === 'AJ5200') {
        showConfirm('최종 확인', '정말로 모든 데이터를 삭제하시겠습니까?', async () => {
          await onDeleteParts(projectId, processName);
          showAlert('초기화 완료', '데이터가 초기화되었습니다.', 'success');
        });
      } else {
        showAlert('오류', '비밀번호가 틀렸습니다.', 'error');
      }
    });
  };

  const [newPart, setNewPart] = React.useState({
    moldNo: '',
    drwNo: '',
    s: '',
    partsName: '',
    plannedAt: ''
  });

  const handleAddRow = () => {
    if (isReadOnly) return;
    if (!newPart.moldNo && !newPart.drwNo && !newPart.partsName) {
      showAlert('입력 오류', '최소한 하나의 필드는 입력해야 합니다.', 'error');
      return;
    }
    onAddPart(projectId, processName, {
      ...newPart,
      plannedAt: newPart.plannedAt || null
    });
    setNewPart({
      moldNo: '',
      drwNo: '',
      s: '',
      partsName: '',
      plannedAt: ''
    });
  };

  const handleDeleteRow = (partId: string) => {
    if (isReadOnly) return;
    showConfirm('행 삭제', '이 행을 삭제하시겠습니까?', () => {
      onDeletePart(partId, projectId, processName);
    });
  };

  const handleLocalUpdate = (id: string, data: Partial<ProcessPart>) => {
    setLocalParts(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
  };

  const calculateDelay = (plannedAt: string | null | undefined, completedAt: string | null | undefined) => {
    if (!plannedAt) return { text: '-', color: 'text-slate-400' };
    
    const plan = new Date(plannedAt);
    const target = completedAt ? new Date(completedAt) : new Date();
    
    // Reset hours to compare only dates
    plan.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    
    const diffTime = target.getTime() - plan.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) return { text: `+${diffDays}`, color: 'text-rose-600' };
    if (diffDays < 0) return { text: `${diffDays}`, color: 'text-blue-600' };
    return { text: '0', color: 'text-slate-900' };
  };

  const groups = React.useMemo(() => {
    const result: { moldNo: string; parts: ProcessPart[] }[] = [];
    let currentGroup: { moldNo: string; parts: ProcessPart[] } | null = null;

    localParts.forEach(part => {
      const moldNo = part.moldNo?.trim() || '';
      // If moldNo is empty or matches current group, it belongs to the current group
      if (currentGroup && (!moldNo || currentGroup.moldNo === moldNo)) {
        currentGroup.parts.push(part);
      } else {
        currentGroup = { moldNo: moldNo, parts: [part] };
        result.push(currentGroup);
      }
    });
    return result;
  }, [localParts]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <button 
            onClick={handleDeleteAll}
            disabled={isReadOnly}
            className="flex items-center gap-1.5 text-rose-500 text-sm font-bold hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors border border-rose-100 disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} />
            <span>데이터 초기화</span>
          </button>
          <span className="text-xs text-slate-400 font-medium italic">
            * 최종 저장 후 계획날짜 변경 불가
          </span>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving || isReadOnly}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save size={16} />
          <span>{isSaving ? '저장 중...' : '최종 저장'}</span>
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-900 rounded-sm shadow-sm bg-white">
        {excelTitle && (
          <div className="p-3 border-b border-slate-900 bg-slate-50 text-center">
            <h5 className="text-base font-black text-slate-900 uppercase tracking-widest">{excelTitle}</h5>
          </div>
        )}
        <table className="w-full border-collapse text-xs bg-white">
          <thead>
            <tr className="bg-white text-slate-900 font-bold uppercase border-b border-slate-900">
              {headers && headers.length > 0 ? (
                headers.map((h, i) => (
                  <th key={i} className="border-r border-slate-900 p-1.5 text-center min-w-[80px]">{h || '-'}</th>
                ))
              ) : (
                <>
                  <th className="border-r border-slate-900 p-1.5 w-[12%] text-center">MOLD</th>
                  <th className="border-r border-slate-900 p-1.5 w-[15%] text-center">DN</th>
                  <th className="border-r border-slate-900 p-1.5 w-[5%] text-center">S</th>
                  <th className="border-r border-slate-900 p-1.5 w-[28%] text-center">PART NAME</th>
                </>
              )}
              <th className="border-r border-slate-900 p-1.5 w-[10%] text-center">계획</th>
              <th className="border-r border-slate-900 p-1.5 w-[12%] text-center">완료</th>
              <th className="border-r border-slate-900 p-1.5 w-[8%] text-center">지연(일)</th>
              <th className="border-r border-slate-900 p-1.5 w-[20%] text-center">DELAY 사유</th>
              <th className="p-1.5 w-[5%] text-center">삭제</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, gIdx) => (
              <React.Fragment key={gIdx}>
                {group.parts.map((part, pIdx) => (
                  <tr 
                    key={part.id} 
                    className={cn(
                      "h-10 hover:bg-slate-50 transition-colors border-none"
                    )}
                  >
                    {headers && headers.length > 0 ? (
                      headers.map((_, i) => {
                        // First column (usually MOLD/Process) gets rowSpan
                        if (i === 0) {
                          if (pIdx > 0) return null;
                          return (
                            <td 
                              key={i} 
                              rowSpan={group.parts.length}
                              className={cn(
                                "border-r border-slate-900 p-1.5 text-center font-bold bg-white align-middle text-slate-900 border-t-2 border-t-slate-900 border-b-2 border-b-slate-900",
                              )}
                            >
                              <AutoResizeTextarea 
                                value={part.moldNo || ''}
                                onChange={(e) => handleLocalUpdate(part.id, { moldNo: e.target.value })}
                                className="text-center font-bold focus:bg-blue-50"
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={i} className={cn(
                            "border-r border-slate-900 p-1.5 text-center font-mono text-slate-700 break-words whitespace-normal",
                            pIdx === 0 && "border-t-2 border-t-slate-900",
                            pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                          )}>
                            {part.rawData && part.rawData[i] !== undefined && part.rawData[i] !== null ? (
                              String(part.rawData[i])
                            ) : (
                            <AutoResizeTextarea 
                              value={i === 1 ? (part.drwNo || '') : i === 2 ? (part.s || '') : i === 3 ? (part.partsName || '') : ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (i === 1) handleLocalUpdate(part.id, { drwNo: val });
                                else if (i === 2) handleLocalUpdate(part.id, { s: val });
                                else if (i === 3) handleLocalUpdate(part.id, { partsName: val });
                              }}
                              disabled={isReadOnly}
                              className="text-center font-mono focus:bg-blue-50 disabled:cursor-default"
                            />
                            )}
                          </td>
                        );
                      })
                    ) : (
                      <>
                        {pIdx === 0 && (
                          <td 
                            rowSpan={group.parts.length} 
                            className="border-r border-slate-900 border-t-2 border-t-slate-900 border-b-2 border-b-slate-900 p-1.5 text-center font-bold bg-white align-middle text-slate-900"
                          >
                            <AutoResizeTextarea 
                              value={part.moldNo || ''}
                              onChange={(e) => handleLocalUpdate(part.id, { moldNo: e.target.value })}
                              disabled={isReadOnly}
                              className="text-center font-bold focus:bg-blue-50 disabled:cursor-default"
                            />
                          </td>
                        )}
                        <td className={cn(
                          "border-r border-slate-900 p-1.5 text-center font-mono text-slate-700 break-words whitespace-normal",
                          pIdx === 0 && "border-t-2 border-t-slate-900",
                          pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                        )}>
                          <AutoResizeTextarea 
                            value={part.drwNo || ''}
                            onChange={(e) => handleLocalUpdate(part.id, { drwNo: e.target.value })}
                            disabled={isReadOnly}
                            className="text-center font-mono focus:bg-blue-50 disabled:cursor-default"
                          />
                        </td>
                        <td className={cn(
                          "border-r border-slate-900 p-1.5 text-center font-bold text-slate-500",
                          pIdx === 0 && "border-t-2 border-t-slate-900",
                          pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                        )}>
                          <AutoResizeTextarea 
                            value={part.s || ''}
                            onChange={(e) => handleLocalUpdate(part.id, { s: e.target.value })}
                            disabled={isReadOnly}
                            className="text-center font-bold focus:bg-blue-50 disabled:cursor-default"
                          />
                        </td>
                        <td className={cn(
                          "border-r border-slate-900 p-1.5 font-medium text-slate-800 px-2 text-left break-words whitespace-normal",
                          pIdx === 0 && "border-t-2 border-t-slate-900",
                          pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                        )}>
                          <AutoResizeTextarea 
                            value={part.partsName || ''}
                            onChange={(e) => handleLocalUpdate(part.id, { partsName: e.target.value })}
                            disabled={isReadOnly}
                            className="text-left font-medium focus:bg-blue-50 disabled:cursor-default"
                          />
                        </td>
                      </>
                    )}
                    
                    {pIdx === 0 && (
                      <>
                        <td 
                          rowSpan={group.parts.length} 
                          className="border-r border-slate-900 border-t-2 border-t-slate-900 border-b-2 border-b-slate-900 p-1.5 text-center align-middle bg-white"
                        >
                          <input 
                            type="date"
                            value={part.plannedAt ? new Date(part.plannedAt).toISOString().split('T')[0] : ''}
                            onChange={(e) => handleUpdateGroupLocal(group.parts, { plannedAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                            disabled={isReadOnly || !!parts.find(p => p.id === part.id)?.plannedAt}
                            className={cn(
                              "w-full bg-transparent border-none text-center font-bold outline-none focus:bg-blue-50 text-xs",
                              (isReadOnly || parts.find(p => p.id === part.id)?.plannedAt) && "opacity-50 cursor-not-allowed"
                            )}
                          />
                        </td>
                        <td 
                          rowSpan={group.parts.length} 
                          className="border-r border-slate-900 border-t-2 border-t-slate-900 border-b-2 border-b-slate-900 p-1.5 text-center align-middle bg-white"
                        >
                          <div 
                            className={cn(
                              "cursor-pointer p-1 rounded-md transition-all min-h-[36px] flex items-center justify-center border border-dashed mx-auto w-full max-w-[100px]",
                              group.parts.every(p => p.completedAt) 
                                ? "bg-emerald-50 border-emerald-400 text-emerald-800" 
                                : "bg-slate-50 border-slate-200 text-slate-300 hover:border-blue-400 hover:bg-blue-50"
                            )}
                            onClick={() => handleToggleCompleteGroup(group.parts)}
                          >
                            {group.parts.every(p => p.completedAt) ? (
                              <div className="flex flex-col leading-tight">
                                <span className="font-black text-xs">완료</span>
                                <span className="text-[9px] opacity-80">
                                  {new Date(group.parts[0].completedAt!).toLocaleDateString()}<br/>
                                  {new Date(group.parts[0].completedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {group.parts[0].initials && ` [${group.parts[0].initials}]`}
                                </span>
                              </div>
                            ) : (
                              <span className="font-bold text-xs">미완료</span>
                            )}
                          </div>
                        </td>
                        <td 
                          rowSpan={group.parts.length} 
                          className={cn(
                            "border-r border-slate-900 border-t-2 border-t-slate-900 border-b-2 border-b-slate-900 p-1.5 text-center align-middle bg-white font-bold",
                            calculateDelay(group.parts[0].plannedAt, group.parts[0].completedAt).color
                          )}
                        >
                          {calculateDelay(group.parts[0].plannedAt, group.parts[0].completedAt).text}
                        </td>
                        <td 
                          rowSpan={group.parts.length} 
                          className="border-r border-slate-900 p-1.5 align-middle bg-white text-left border-t-2 border-t-slate-900 border-b-2 border-b-slate-900"
                        >
                          <div className="flex flex-col gap-1 max-w-[180px] mx-auto">
                            <select 
                              value={group.parts[0].delayType}
                              onChange={(e) => handleUpdateGroupLocal(group.parts, { delayType: e.target.value })}
                              disabled={isReadOnly}
                              className="w-full p-1 border border-slate-300 rounded text-xs font-bold bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-default"
                            >
                              <option value="">사유 선택</option>
                              {DELAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <AutoResizeTextarea 
                              value={group.parts[0].delayReason}
                              onChange={(e) => handleUpdateGroupLocal(group.parts, { delayReason: e.target.value })}
                              disabled={isReadOnly}
                              placeholder="상세 사유 입력"
                              className="p-1 border border-slate-300 rounded text-xs bg-slate-50 focus:ring-1 focus:ring-blue-500 disabled:cursor-default"
                            />
                          </div>
                        </td>
                        <td 
                          rowSpan={group.parts.length}
                          className="p-1.5 text-center align-middle bg-white border-t-2 border-t-slate-900 border-b-2 border-b-slate-900"
                        >
                          <button 
                            onClick={() => handleDeleteRow(part.id)}
                            className="text-rose-400 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {/* New Row Input Area */}
            <tr className="bg-blue-50/50 border-t-2 border-t-slate-900 h-12">
              {headers && headers.length > 0 ? (
                headers.map((_, i) => (
                  <td key={i} className="border-r border-slate-900 p-1.5">
                    <AutoResizeTextarea 
                      placeholder={headers[i]}
                      value={i === 0 ? newPart.moldNo : i === 1 ? newPart.drwNo : i === 2 ? newPart.s : i === 3 ? newPart.partsName : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (i === 0) setNewPart(prev => ({ ...prev, moldNo: val }));
                        else if (i === 1) setNewPart(prev => ({ ...prev, drwNo: val }));
                        else if (i === 2) setNewPart(prev => ({ ...prev, s: val }));
                        else if (i === 3) setNewPart(prev => ({ ...prev, partsName: val }));
                      }}
                      className="bg-white/80 border border-blue-200 rounded px-2 py-1 text-center font-bold focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                ))
              ) : (
                <>
                  <td className="border-r border-slate-900 p-1.5">
                    <AutoResizeTextarea 
                      placeholder="MOLD"
                      value={newPart.moldNo}
                      onChange={(e) => setNewPart(prev => ({ ...prev, moldNo: e.target.value }))}
                      className="bg-white/80 border border-blue-200 rounded px-2 py-1 text-center font-bold focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                  <td className="border-r border-slate-900 p-1.5">
                    <AutoResizeTextarea 
                      placeholder="DN"
                      value={newPart.drwNo}
                      onChange={(e) => setNewPart(prev => ({ ...prev, drwNo: e.target.value }))}
                      className="bg-white/80 border border-blue-200 rounded px-2 py-1 text-center font-mono focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                  <td className="border-r border-slate-900 p-1.5">
                    <AutoResizeTextarea 
                      placeholder="S"
                      value={newPart.s}
                      onChange={(e) => setNewPart(prev => ({ ...prev, s: e.target.value }))}
                      className="bg-white/80 border border-blue-200 rounded px-2 py-1 text-center font-bold focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                  <td className="border-r border-slate-900 p-1.5">
                    <AutoResizeTextarea 
                      placeholder="PART NAME"
                      value={newPart.partsName}
                      onChange={(e) => setNewPart(prev => ({ ...prev, partsName: e.target.value }))}
                      className="bg-white/80 border border-blue-200 rounded px-2 py-1 text-left font-medium focus:ring-2 focus:ring-blue-400"
                    />
                  </td>
                </>
              )}
              <td className="border-r border-slate-900 p-1.5">
                <input 
                  type="date"
                  value={newPart.plannedAt}
                  onChange={(e) => setNewPart(prev => ({ ...prev, plannedAt: e.target.value }))}
                  className="w-full bg-white/80 border border-blue-200 rounded px-2 py-1 text-center font-bold outline-none focus:ring-2 focus:ring-blue-400 text-[9px]"
                />
              </td>
              <td className="border-r border-slate-900 p-1.5 text-center text-slate-400 italic">자동 생성</td>
              <td className="border-r border-slate-900 p-1.5 text-center text-slate-400 italic">-</td>
              <td className="border-r border-slate-900 p-1.5 text-center text-slate-400 italic">-</td>
              <td className="p-1.5 text-center">
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
                  <Save size={12} className="text-blue-600" />
                </div>
              </td>
            </tr>
            {localParts.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-20 text-slate-400 font-medium bg-slate-50">
                  <AlertCircle className="mx-auto mb-3 opacity-20" size={40} />
                  데이터가 없습니다. 엑셀 파일을 업로드해주세요.<br/>
                  <span className="text-[11px] opacity-60 mt-2 block">(대시보드에서 '{processName}' 텍스트 클릭)</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center pt-2">
        <button 
          onClick={handleAddRow}
          disabled={isReadOnly}
          className="flex items-center gap-2 bg-slate-900 text-white px-12 py-3 rounded-xl font-black text-sm hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
        >
          <Save size={18} />
          <span>새로운 행 추가하기</span>
        </button>
      </div>
    </div>
  );
};

const ProcessBase = ({ name, projectId, processParts, headers, excelTitle, isReadOnly, onAddPart, onDeletePart, onBatchUpdateParts, onDeleteParts, onUploadExcel, userInitials, colorClass, showAlert, showConfirm, showPasswordPrompt }: Omit<ProcessProps, 'onUpdatePart' | 'tasks' | 'onAddTask' | 'onUpdateTaskStatus' | 'onUpdateTask'> & { name: string, colorClass: string }) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnly) return;
    const isAuthorized = localStorage.getItem('isAuthorized') === 'true';
    const isAdmin = userInitials === 'MASTER';
    
    if (!isAdmin && !isAuthorized) {
      showAlert('권한 없음', '엑셀 업로드 권한이 없습니다.', 'error');
      // Reset input
      e.target.value = '';
      return;
    }

    const file = e.target.files?.[0];
    if (file) {
      onUploadExcel(projectId, name, file);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colorClass)}>
            <Save size={20} className="text-slate-600" />
          </div>
          <div>
            <h4 className="text-xl font-black text-slate-800">{name} 공정 데이터</h4>
            <p className="text-sm text-slate-400 font-medium">엑셀 파일을 업로드하거나 행을 직접 추가하여 부품 목록을 관리하세요</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            id={`upload-${name}`}
            className="hidden" 
            accept=".xlsx, .xls"
            onChange={handleFileChange}
            disabled={isReadOnly}
          />
          <label 
            htmlFor={`upload-${name}`}
            className={cn(
              "flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all cursor-pointer shadow-lg shadow-slate-200",
              isReadOnly && "opacity-20 cursor-not-allowed grayscale"
            )}
            onClick={(e) => isReadOnly && e.preventDefault()}
          >
            <Save size={14} />
            <span>엑셀 업로드</span>
          </label>
        </div>
      </div>

      <ProcessTable 
        projectId={projectId}
        processName={name}
        parts={processParts}
        headers={headers}
        excelTitle={excelTitle}
        userInitials={userInitials}
        isReadOnly={isReadOnly}
        onAddPart={onAddPart}
        onDeletePart={onDeletePart}
        onBatchUpdateParts={onBatchUpdateParts}
        onDeleteParts={onDeleteParts}
        showAlert={showAlert}
        showConfirm={showConfirm}
        showPasswordPrompt={showPasswordPrompt}
      />
    </div>
  );
};

export const Injection = (props: ProcessProps) => <ProcessBase name="사출" colorClass="bg-blue-50/50" {...props} />;
export const Printing = (props: ProcessProps) => <ProcessBase name="인쇄" colorClass="bg-indigo-50/50" {...props} />;
export const Metal = (props: ProcessProps) => <ProcessBase name="메탈" colorClass="bg-slate-100/50" {...props} />;
export const Paint = (props: ProcessProps) => <ProcessBase name="PAINT" colorClass="bg-rose-50/50" {...props} />;
export const Print = (props: ProcessProps) => <ProcessBase name="PRINT" colorClass="bg-orange-50/50" {...props} />;
export const Processing = (props: ProcessProps) => <ProcessBase name="가공" colorClass="bg-emerald-50/50" {...props} />;
export const Assembly = (props: ProcessProps) => <ProcessBase name="조립" colorClass="bg-amber-50/50" {...props} />;
export const Packaging = (props: ProcessProps) => <ProcessBase name="포장" colorClass="bg-teal-50/50" {...props} />;
