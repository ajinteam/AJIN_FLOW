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
  onAddTask: (pid: string, pname: string, type: string, desc: string) => void;
  onUpdateTaskStatus: (tid: string, status: TaskStatus, pid: string, pname: string) => void;
  onUpdatePart: (partId: string, data: Partial<ProcessPart>, projectId: string, processName: string) => void;
  onBatchUpdateParts: (updates: { id: string, data: Partial<ProcessPart> }[], projectId: string, processName: string) => void;
  onDeleteParts: (projectId: string, processName: string) => void;
  onUploadExcel: (projectId: string, processName: string, file: File) => void;
  userInitials: string;
  showAlert: (title: string, message: string, type?: 'info' | 'error' | 'success') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  showPasswordPrompt: (title: string, message: string, onConfirm: (password: string) => void) => void;
}

const ProcessTable = ({ 
  projectId, 
  processName, 
  parts, 
  headers,
  excelTitle,
  userInitials,
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
    const ids = groupParts.map(p => p.id);
    setLocalParts(prev => prev.map(p => {
      if (ids.includes(p.id)) {
        return { ...p, ...data };
      }
      return p;
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates = localParts.map(p => ({
        id: p.id,
        data: {
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
        <button 
          onClick={handleDeleteAll}
          className="flex items-center gap-1.5 text-rose-500 text-xs font-bold hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors border border-rose-100"
        >
          <Trash2 size={14} />
          <span>데이터 초기화</span>
        </button>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
        >
          <Save size={16} />
          <span>{isSaving ? '저장 중...' : '최종 저장'}</span>
        </button>
      </div>

      <div className="overflow-x-auto border border-slate-900 rounded-sm shadow-sm bg-white">
        {excelTitle && (
          <div className="p-3 border-b border-slate-900 bg-slate-50 text-center">
            <h5 className="text-sm font-black text-slate-900 uppercase tracking-widest">{excelTitle}</h5>
          </div>
        )}
        <table className="w-full border-collapse text-[10px] bg-white">
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
              <th className="border-r border-slate-900 p-1.5 w-[15%] text-center">완료</th>
              <th className="p-1.5 w-[25%] text-center">DELAY 사유</th>
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
                              {part.rawData && part.rawData[i] !== undefined && part.rawData[i] !== null ? String(part.rawData[i]) : ''}
                            </td>
                          );
                        }
                        return (
                          <td key={i} className={cn(
                            "border-r border-slate-900 p-1.5 text-center font-mono text-slate-700 whitespace-nowrap overflow-hidden text-ellipsis",
                            pIdx === 0 && "border-t-2 border-t-slate-900",
                            pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                          )}>
                            {part.rawData && part.rawData[i] !== undefined && part.rawData[i] !== null ? String(part.rawData[i]) : ''}
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
                            {group.moldNo}
                          </td>
                        )}
                        <td className={cn(
                          "border-r border-slate-900 p-1.5 text-center font-mono text-slate-700 whitespace-nowrap overflow-hidden text-ellipsis",
                          pIdx === 0 && "border-t-2 border-t-slate-900",
                          pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                        )}>{part.drwNo}</td>
                        <td className={cn(
                          "border-r border-slate-900 p-1.5 text-center font-bold text-slate-500",
                          pIdx === 0 && "border-t-2 border-t-slate-900",
                          pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                        )}>{part.s}</td>
                        <td className={cn(
                          "border-r border-slate-900 p-1.5 font-medium text-slate-800 px-2 text-left whitespace-nowrap overflow-hidden text-ellipsis",
                          pIdx === 0 && "border-t-2 border-t-slate-900",
                          pIdx === group.parts.length - 1 ? "border-b-2 border-b-slate-900" : "border-b-0"
                        )}>{part.partsName}</td>
                      </>
                    )}
                    
                    {pIdx === 0 && (
                      <>
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
                                <span className="font-black text-[9px]">완료</span>
                                <span className="text-[7px] opacity-80">
                                  {new Date(group.parts[0].completedAt!).toLocaleDateString()}<br/>
                                  {new Date(group.parts[0].completedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {group.parts[0].initials && ` [${group.parts[0].initials}]`}
                                </span>
                              </div>
                            ) : (
                              <span className="font-bold text-[9px]">미완료</span>
                            )}
                          </div>
                        </td>
                        <td 
                          rowSpan={group.parts.length} 
                          className="p-1.5 align-middle bg-white text-left border-t-2 border-t-slate-900 border-b-2 border-b-slate-900"
                        >
                          <div className="flex flex-col gap-1 max-w-[180px] mx-auto">
                            <select 
                              value={group.parts[0].delayType}
                              onChange={(e) => handleUpdateGroupLocal(group.parts, { delayType: e.target.value })}
                              className="w-full p-1 border border-slate-300 rounded text-[9px] font-bold bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">사유 선택</option>
                              {DELAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <textarea 
                              value={group.parts[0].delayReason}
                              onChange={(e) => handleUpdateGroupLocal(group.parts, { delayReason: e.target.value })}
                              placeholder="상세 사유 입력"
                              rows={1}
                              className="w-full p-1 border border-slate-300 rounded text-[9px] bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                            />
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {localParts.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-20 text-slate-400 font-medium bg-slate-50">
                  <AlertCircle className="mx-auto mb-3 opacity-20" size={40} />
                  데이터가 없습니다. 엑셀 파일을 업로드해주세요.<br/>
                  <span className="text-[11px] opacity-60 mt-2 block">(대시보드에서 '{processName}' 텍스트 클릭)</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ProcessBase = ({ name, projectId, tasks, processParts, headers, excelTitle, onAddTask, onUpdateTaskStatus, onBatchUpdateParts, onDeleteParts, onUploadExcel, userInitials, colorClass, showAlert, showConfirm, showPasswordPrompt, showAllStatuses = false }: Omit<ProcessProps, 'onUpdatePart'> & { name: string, colorClass: string, showAllStatuses?: boolean }) => {
  const [newType, setNewType] = React.useState('');
  const [newDesc, setNewDesc] = React.useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
            <h4 className="text-lg font-black text-slate-800">{name} 공정 데이터</h4>
            <p className="text-xs text-slate-400 font-medium">엑셀 파일을 업로드하여 부품 목록을 관리하세요</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            id={`upload-${name}`}
            className="hidden" 
            accept=".xlsx, .xls"
            onChange={handleFileChange}
          />
          <label 
            htmlFor={`upload-${name}`}
            className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-bold text-xs hover:bg-slate-800 transition-all cursor-pointer shadow-lg shadow-slate-200"
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
        onBatchUpdateParts={onBatchUpdateParts}
        onDeleteParts={onDeleteParts}
        showAlert={showAlert}
        showConfirm={showConfirm}
        showPasswordPrompt={showPasswordPrompt}
      />

      <div className="space-y-4 mt-8">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-5 bg-slate-900 rounded-full" />
          <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">{name} 작업 리스트</h4>
        </div>
        
        <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
          <table className="w-full border-collapse text-xs bg-white">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <th className="p-3 text-left w-[20%]">타입</th>
                <th className="p-3 text-left w-[45%]">상세 내용</th>
                <th className="p-3 text-center w-[35%]">상태</th>
              </tr>
              <tr className="bg-white border-b border-slate-100">
                <td className="p-2">
                  <input 
                    type="text" 
                    placeholder="타입 입력" 
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </td>
                <td className="p-2">
                  <input 
                    type="text" 
                    placeholder="상세 내용 입력" 
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </td>
                <td className="p-2 text-center">
                  <button 
                    onClick={() => {
                      if (newType && newDesc) {
                        onAddTask(projectId, name, newType, newDesc);
                        setNewType('');
                        setNewDesc('');
                      }
                    }}
                    className="bg-slate-900 text-white px-4 py-2 rounded-lg text-[10px] font-black hover:bg-slate-800 transition-all"
                  >
                    작업 추가
                  </button>
                </td>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <tr key={task.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-black text-blue-600 uppercase tracking-tighter">{task.type}</td>
                  <td className="p-3 font-bold text-slate-800">{task.description}</td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {showAllStatuses ? (
                        (['pending', 'in-progress', 'completed'] as TaskStatus[]).map(status => (
                          <button
                            key={status}
                            onClick={() => onUpdateTaskStatus(task.id, status, projectId, name)}
                            className={cn(
                              "px-2.5 py-1.5 rounded-lg text-[9px] font-black transition-all flex flex-col items-center",
                              task.status === status 
                                ? (status === 'completed' ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : 
                                   status === 'in-progress' ? "bg-blue-100 text-blue-700 border border-blue-200" : 
                                   "bg-slate-200 text-slate-700 border border-slate-300")
                                : "text-slate-400 hover:bg-slate-100 border border-transparent"
                            )}
                          >
                            <span>{status === 'pending' ? '보류' : status === 'in-progress' ? '진행' : '완료'}</span>
                            {status === 'completed' && task.status === 'completed' && task.completedAt && (
                              <span className="text-[7px] opacity-70 mt-0.5 font-medium leading-none">
                                {new Date(task.completedAt).toLocaleDateString().slice(2)} {new Date(task.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        <button
                          onClick={() => {
                            const newStatus = task.status === 'completed' ? 'pending' : 'completed';
                            onUpdateTaskStatus(task.id, newStatus, projectId, name);
                          }}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-black transition-all min-w-[120px] border",
                            task.status === 'completed' 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm" 
                              : "bg-slate-50 text-slate-400 hover:bg-slate-100 border-slate-200"
                          )}
                        >
                          {task.status === 'completed' ? (
                            <div className="flex flex-col leading-tight">
                              <span className="font-black text-[10px]">완료</span>
                              {task.completedAt && (
                                <span className="text-[8px] opacity-80 font-medium">
                                  {new Date(task.completedAt).toLocaleDateString()} {new Date(task.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {task.initials && ` [${task.initials}]`}
                                </span>
                              )}
                            </div>
                          ) : '완료'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-12 text-center text-slate-400 italic bg-slate-50/30">
                    추가된 작업이 없습니다. 상단 입력란을 통해 작업을 추가하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const Injection = (props: ProcessProps) => <ProcessBase name="사출" colorClass="bg-blue-50/50" showAllStatuses={true} {...props} />;
export const Printing = (props: ProcessProps) => <ProcessBase name="인쇄" colorClass="bg-indigo-50/50" {...props} />;
export const Metal = (props: ProcessProps) => <ProcessBase name="메탈" colorClass="bg-slate-100/50" {...props} />;
export const Paint = (props: ProcessProps) => <ProcessBase name="PAINT" colorClass="bg-rose-50/50" {...props} />;
export const Print = (props: ProcessProps) => <ProcessBase name="PRINT" colorClass="bg-orange-50/50" {...props} />;
export const Processing = (props: ProcessProps) => <ProcessBase name="가공" colorClass="bg-emerald-50/50" {...props} />;
export const Assembly = (props: ProcessProps) => <ProcessBase name="조립" colorClass="bg-amber-50/50" {...props} />;
export const Packaging = (props: ProcessProps) => <ProcessBase name="포장" colorClass="bg-teal-50/50" {...props} />;
