import React, { useState, useMemo, useRef, useCallback } from 'react';
import { InfoProject, InfoFile } from '../types';
import { 
  FileText, 
  Image as ImageIcon, 
  FileSpreadsheet, 
  Upload, 
  Plus, 
  Trash2, 
  Edit2, 
  CheckCircle, 
  X, 
  Calendar, 
  Layers, 
  Download, 
  Maximize2, 
  Search, 
  FileCheck, 
  Clock, 
  Eye, 
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Move
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { UniversalPdfViewer } from './UniversalPdfViewer';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// Utility: Image optimization using HTML Canvas to reduce base64 size
async function optimizeImageFile(file: File): Promise<{ dataUrl: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const MAX_DIM = 1600;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: event.target?.result as string, size: file.size });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        // Estimate size in bytes
        const head = 'data:image/jpeg;base64,';
        const size = Math.round(((dataUrl.length - head.length) * 3) / 4);
        resolve({ dataUrl, size });
      };
      img.onerror = reject;
      img.src = event.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Utility: Read generic file as Base64 data URL
async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Utility: Parse Excel sheets to 2D arrays for PDF-like rendering
async function parseExcelFile(file: File): Promise<{ name: string; data: any[][] }[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result;
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheets: { name: string; data: any[][] }[] = [];
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
          sheets.push({ name: sheetName, data: sheetData });
        });
        resolve(sheets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Calculate D-Day string and badge color
function getDDayInfo(targetDateStr: string | null | undefined): { text: string; isPast: boolean; days: number } {
  if (!targetDateStr) return { text: 'D-DAY 미설정', isPast: false, days: 0 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(targetDateStr);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { text: 'D-DAY', isPast: false, days: 0 };
  } else if (diffDays > 0) {
    return { text: `D-${diffDays}`, isPast: false, days: diffDays };
  } else {
    return { text: `D+${Math.abs(diffDays)}`, isPast: true, days: diffDays };
  }
}

interface InfoViewProps {
  infoProjects: InfoProject[];
  userInitials: string;
  isAdmin: boolean;
  onSaveProjects: (projects: InfoProject[]) => Promise<void>;
  showAlert: (title: string, message: string, type?: 'info' | 'error' | 'success') => void;
  showConfirm: (title: string, message: string, onConfirm: () => void) => void;
  showPasswordPrompt: (title: string, message: string, onConfirm: (password: string) => void) => void;
}

export const InfoView: React.FC<InfoViewProps> = ({
  infoProjects,
  userInitials,
  isAdmin,
  onSaveProjects,
  showAlert,
  showConfirm,
  showPasswordPrompt
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<InfoProject | null>(null);
  
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadTargetProjectId, setUploadTargetProjectId] = useState<string>('');
  
  const [viewerProject, setViewerProject] = useState<InfoProject | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);

  // Filter projects by active tab and search
  const filteredProjects = useMemo(() => {
    return (infoProjects || [])
      .filter((p) => (activeTab === 'completed' ? p.status === 'completed' : p.status !== 'completed'))
      .filter((p) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          (p.model && p.model.toLowerCase().includes(q)) ||
          (p.deviceType && p.deviceType.toLowerCase().includes(q)) ||
          (p.memo && p.memo.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [infoProjects, activeTab, searchQuery]);

  // Project Add / Edit submit
  const handleSaveProject = async (formData: {
    model: string;
    deviceType: string;
    quantity: string;
    shipmentDate: string;
    memo?: string;
  }) => {
    let updated: InfoProject[];
    if (editingProject) {
      updated = infoProjects.map((p) =>
        p.id === editingProject.id
          ? {
              ...p,
              model: formData.model.trim(),
              deviceType: formData.deviceType.trim(),
              quantity: formData.quantity.trim(),
              shipmentDate: formData.shipmentDate,
              memo: formData.memo || ''
            }
          : p
      );
    } else {
      const maxSort = infoProjects.length > 0 ? Math.max(...infoProjects.map((p) => p.sortOrder || 0)) : 0;
      const newProj: InfoProject = {
        id: Date.now().toString(),
        model: formData.model.trim(),
        deviceType: formData.deviceType.trim(),
        quantity: formData.quantity.trim(),
        shipmentDate: formData.shipmentDate,
        status: 'active',
        createdAt: new Date().toISOString(),
        sortOrder: maxSort + 1,
        files: [],
        memo: formData.memo || ''
      };
      updated = [newProj, ...infoProjects];
    }

    await onSaveProjects(updated);
    setIsProjectModalOpen(false);
    setEditingProject(null);
    showAlert('저장 완료', '프로젝트 정보가 저장되었습니다.', 'success');
  };

  // Delete project
  const handleDeleteProject = (projectId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!isAdmin) {
      showAlert('권한 없음', '프로젝트 삭제 권한이 없습니다.', 'error');
      return;
    }

    showPasswordPrompt('프로젝트 삭제', '프로젝트를 삭제하시겠습니까? 비밀번호를 입력하세요.', (password) => {
      const storedPassword = localStorage.getItem('currentUserPassword');
      const inputPassword = password.trim().toUpperCase();
      if (inputPassword === storedPassword?.toUpperCase() || inputPassword === 'AJ5200') {
        showConfirm('삭제 최종 확인', '정말로 이 프로젝트와 모든 첨부 문서를 삭제하시겠습니까?', async () => {
          const updated = infoProjects.filter((p) => p.id !== projectId);
          await onSaveProjects(updated);
          if (viewerProject?.id === projectId) {
            setViewerProject(null);
          }
          showAlert('삭제 완료', '프로젝트가 성공적으로 삭제되었습니다.', 'success');
        });
      } else {
        showAlert('오류', '비밀번호가 틀렸습니다.', 'error');
      }
    });
  };

  // Complete project
  const handleToggleCompleteProject = (project: InfoProject, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!isAdmin) {
      showAlert('권한 없음', '생산완료 처리 권한이 없습니다.', 'error');
      return;
    }

    const isCompleting = project.status !== 'completed';
    const title = isCompleting ? '생산 완료 처리' : '진행 중 복원';
    const message = isCompleting
      ? `[${project.model} - ${project.deviceType}] 프로젝트를 생산 완료 목록으로 이동하시겠습니까?`
      : `[${project.model} - ${project.deviceType}] 프로젝트를 다시 진행 중 목록으로 복원하시겠습니까?`;

    showConfirm(title, message, async () => {
      const updated = infoProjects.map((p) => {
        if (p.id === project.id) {
          return {
            ...p,
            status: isCompleting ? ('completed' as const) : ('active' as const),
            completedAt: isCompleting ? new Date().toISOString() : undefined
          };
        }
        return p;
      });
      await onSaveProjects(updated);
      showAlert('처리 완료', isCompleting ? '생산 완료 목록으로 이동되었습니다.' : '진행 중 목록으로 복원되었습니다.', 'success');
    });
  };

  // Upload files handler (PDF, Excel, Images with streaming server upload & overwrite)
  const handleUploadFiles = async (targetProjectId: string, files: File[]) => {
    const targetProj = infoProjects.find((p) => p.id === targetProjectId);
    if (!targetProj) {
      showAlert('오류', '선택된 프로젝트를 찾을 수 없습니다.', 'error');
      return;
    }

    try {
      const existingFiles = [...(targetProj.files || [])];

      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        let fileType: 'pdf' | 'excel' | 'image' | 'other' = 'other';
        let fileSize = file.size;
        let parsedSheets: { name: string; data: any[][] }[] | undefined = undefined;
        let fileToUpload: File | Blob = file;

        if (ext === 'pdf') {
          fileType = 'pdf';
        } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
          fileType = 'excel';
          try {
            parsedSheets = await parseExcelFile(file);
          } catch (e) {
            console.warn('Excel parsing warning:', e);
          }
        } else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
          fileType = 'image';
          try {
            const optimized = await optimizeImageFile(file);
            const res = await fetch(optimized.dataUrl);
            fileToUpload = await res.blob();
            fileSize = optimized.size;
          } catch (e) {
            fileToUpload = file;
          }
        }

        // Fast streaming FormData upload (supports large PDFs up to 100MB)
        const formData = new FormData();
        formData.append('file', fileToUpload, file.name);

        const uploadRes = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({}));
          throw new Error(errData.error || `${file.name} 업로드 서버 처리 오류 (${uploadRes.status})`);
        }

        const uploadJson = await uploadRes.json();
        const savedUrl = uploadJson.url || `/uploads/${encodeURIComponent(uploadJson.filename || file.name)}`;
        fileSize = uploadJson.size || fileSize;

        const newFileObj: InfoFile = {
          id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 4),
          name: file.name,
          type: fileType,
          size: fileSize,
          dataUrl: savedUrl,
          uploadedAt: new Date().toISOString(),
          parsedSheets
        };

        // Automatic Overwrite check: If same filename exists, replace it; otherwise append
        const existingIdx = existingFiles.findIndex((f) => f.name.toLowerCase() === file.name.toLowerCase());
        if (existingIdx !== -1) {
          existingFiles[existingIdx] = newFileObj;
        } else {
          existingFiles.push(newFileObj);
        }
      }

      const updated = infoProjects.map((p) => (p.id === targetProjectId ? { ...p, files: existingFiles } : p));
      await onSaveProjects(updated);
      setIsUploadModalOpen(false);

      if (viewerProject?.id === targetProjectId) {
        const updatedTarget = updated.find((p) => p.id === targetProjectId);
        if (updatedTarget) setViewerProject(updatedTarget);
      }

      showAlert('업로드 완료', `${files.length}개 파일이 성공적으로 등록되었습니다. (동일 이름 파일은 자동 덮어쓰기 적용)`, 'success');
    } catch (err: any) {
      console.error('File upload error:', err);
      showAlert('업로드 오류', err.message || '파일 처리 중 오류가 발생했습니다.', 'error');
    }
  };

  // Delete file from project
  const handleDeleteFile = async (projectId: string, fileId: string) => {
    if (!isAdmin) {
      showAlert('권한 없음', '파일 삭제 권한이 없습니다.', 'error');
      return;
    }

    showConfirm('파일 삭제', '이 파일을 삭제하시겠습니까?', async () => {
      const updated = infoProjects.map((p) => {
        if (p.id === projectId) {
          return {
            ...p,
            files: (p.files || []).filter((f) => f.id !== fileId)
          };
        }
        return p;
      });

      await onSaveProjects(updated);
      const updatedTarget = updated.find((p) => p.id === projectId);
      if (updatedTarget) {
        setViewerProject(updatedTarget);
        if (activeFileIndex >= updatedTarget.files.length) {
          setActiveFileIndex(Math.max(0, updatedTarget.files.length - 1));
        }
      }
      showAlert('삭제 완료', '파일이 삭제되었습니다.', 'success');
    });
  };

  return (
    <div className="space-y-4 pb-12">
      {/* Top Action Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              {/* 프로젝트 추가 버튼 (Blue - like image.png sketch) */}
              <button
                onClick={() => {
                  setEditingProject(null);
                  setIsProjectModalOpen(true);
                }}
                className="flex items-center gap-2 bg-[#3B82F6] hover:bg-blue-600 active:scale-95 text-white px-4 md:px-5 py-2.5 rounded-xl font-black text-sm md:text-base shadow-md shadow-blue-200 transition-all cursor-pointer"
              >
                <Plus size={18} />
                <span>프로젝트</span>
              </button>

              {/* 업로드 버튼 (Yellow/Amber - like image.png sketch) */}
              <button
                onClick={() => {
                  const defaultTarget = infoProjects.find((p) => p.status !== 'completed')?.id || infoProjects[0]?.id || '';
                  setUploadTargetProjectId(defaultTarget);
                  setIsUploadModalOpen(true);
                }}
                className="flex items-center gap-2 bg-[#F59E0B] hover:bg-amber-600 active:scale-95 text-white px-4 md:px-5 py-2.5 rounded-xl font-black text-sm md:text-base shadow-md shadow-amber-200 transition-all cursor-pointer"
              >
                <Upload size={18} />
                <span>업로드</span>
              </button>
            </>
          )}

          {/* Tab Switcher: 진행중 / 완료 목록 */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('active')}
              className={cn(
                'px-3 md:px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition-all',
                activeTab === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              진행 중
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={cn(
                'px-3 md:px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition-all',
                activeTab === 'completed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              완료 목록
            </button>
          </div>
        </div>

        {/* Quick Search on Mobile / Tablet */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="모델/기종 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs md:text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Projects List: Green Card Style Matching image.png sketch */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Layers size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-800 mb-1">
            {activeTab === 'completed' ? '완료된 프로젝트가 없습니다' : '등록된 프로젝트가 없습니다'}
          </h3>
          <p className="text-slate-400 text-sm mb-6">
            {isAdmin ? '상단의 [프로젝트] 버튼을 눌러 새 프로젝트를 등록하세요.' : '관리자가 등록한 프로젝트가 표시됩니다.'}
          </p>
          {isAdmin && activeTab !== 'completed' && (
            <button
              onClick={() => {
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-md shadow-blue-200"
            >
              <Plus size={18} />
              <span>새 프로젝트 등록하기</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {filteredProjects.map((project) => {
            const dDay = getDDayInfo(project.shipmentDate);
            const fileCount = project.files?.length || 0;
            const pdfCount = project.files?.filter((f) => f.type === 'pdf').length || 0;
            const excelCount = project.files?.filter((f) => f.type === 'excel').length || 0;
            const imageCount = project.files?.filter((f) => f.type === 'image').length || 0;

            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => {
                  setViewerProject(project);
                  setActiveFileIndex(0);
                }}
                className={cn(
                  'group relative rounded-2xl p-4 md:p-5 transition-all shadow-md hover:shadow-lg cursor-pointer border select-none',
                  // Green layout matching image.png sketch
                  project.status === 'completed'
                    ? 'bg-slate-700 text-white border-slate-600 opacity-90'
                    : 'bg-[#559b34] hover:bg-[#4d8e2e] text-white border-[#448028]'
                )}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Left: Model, Device Type, Production Quantity (Matching sketch) */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <span className="text-2xl md:text-3xl font-black tracking-tight drop-shadow-sm text-white">
                        {project.model}
                      </span>
                      <span className="text-base md:text-lg font-bold text-emerald-100 tracking-normal">
                        {project.deviceType}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-emerald-50 text-sm md:text-base font-semibold">
                      <span>생산수량:</span>
                      <span className="font-bold text-white bg-black/20 px-2 py-0.5 rounded-lg">
                        {typeof project.quantity === 'number'
                          ? project.quantity.toLocaleString()
                          : project.quantity || '0'}
                      </span>
                      {project.memo && (
                        <span className="text-xs opacity-85 truncate max-w-[200px] bg-white/10 px-2 py-0.5 rounded-md">
                          {project.memo}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Center / Right: Shipping Date & D-DAY (Matching sketch) */}
                  <div className="flex items-center gap-3 justify-between md:justify-end border-t md:border-t-0 border-white/20 pt-2.5 md:pt-0">
                    <div className="text-left md:text-right">
                      <div className="text-xs md:text-sm font-medium text-emerald-100 flex items-center gap-1 md:justify-end">
                        <Calendar size={14} className="opacity-80" />
                        <span>선적날짜: {project.shipmentDate || '미정'}</span>
                      </div>
                      <div className="text-xl md:text-2xl font-black text-white tracking-tight mt-0.5 drop-shadow-sm">
                        {dDay.text}
                      </div>
                    </div>

                    {/* Far Right Action Buttons (생산완료 버튼 & Admin options) */}
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {isAdmin && (
                        <>
                          <button
                            onClick={(e) => handleToggleCompleteProject(project, e)}
                            className={cn(
                              'px-3 md:px-4 py-2 rounded-xl font-bold text-xs md:text-sm transition-all shadow-sm flex items-center gap-1.5 active:scale-95 cursor-pointer',
                              project.status === 'completed'
                                ? 'bg-slate-800 text-slate-200 hover:bg-slate-900 border border-slate-600'
                                : 'bg-white text-[#3f7a24] hover:bg-emerald-50 border border-white/80'
                            )}
                            title="생산완료"
                          >
                            <CheckCircle size={16} />
                            <span>{project.status === 'completed' ? '완료취소' : '생산완료'}</span>
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProject(project);
                              setIsProjectModalOpen(true);
                            }}
                            className="p-2 bg-black/20 hover:bg-black/30 text-white rounded-xl transition-all"
                            title="프로젝트 수정"
                          >
                            <Edit2 size={16} />
                          </button>

                          <button
                            onClick={(e) => handleDeleteProject(project.id, e)}
                            className="p-2 bg-black/20 hover:bg-rose-600 text-white rounded-xl transition-all"
                            title="프로젝트 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bottom Bar: Attached File Badge & Click Prompt */}
                <div className="mt-3 pt-2.5 border-t border-white/20 flex items-center justify-between text-xs text-emerald-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold flex items-center gap-1 bg-black/20 px-2 py-0.5 rounded-md text-white">
                      <FileText size={13} />
                      문서 {fileCount}개
                    </span>
                    {pdfCount > 0 && <span className="bg-rose-500/80 text-white px-1.5 py-0.5 rounded text-[11px] font-bold">PDF {pdfCount}</span>}
                    {excelCount > 0 && <span className="bg-emerald-800/80 text-white px-1.5 py-0.5 rounded text-[11px] font-bold">엑셀 {excelCount}</span>}
                    {imageCount > 0 && <span className="bg-amber-600/80 text-white px-1.5 py-0.5 rounded text-[11px] font-bold">사진 {imageCount}</span>}
                  </div>

                  <div className="flex items-center gap-1 font-bold text-white group-hover:translate-x-0.5 transition-transform">
                    <span>터치하여 문서 열람</span>
                    <ChevronRight size={15} />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. File Viewer & Document Preview Modal (Edge-to-Edge & Mobile Optimized)  */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {viewerProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-1.5 bg-slate-950/90 backdrop-blur-sm overflow-hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="bg-slate-900 w-full h-full rounded-none md:rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-800"
            >
              {/* Modal Header */}
              <div className="px-3 md:px-5 py-2.5 bg-slate-900 text-white flex items-center justify-between shrink-0 border-b border-slate-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center font-black text-xs shrink-0 shadow-sm">
                    Info
                  </div>
                  <div className="truncate">
                    <h3 className="font-black text-sm md:text-base truncate flex items-center gap-2">
                      <span>{viewerProject.model}</span>
                      <span className="text-emerald-400 text-xs md:text-sm font-normal">({viewerProject.deviceType})</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      선적: {viewerProject.shipmentDate || '미정'} | 수량:{' '}
                      {typeof viewerProject.quantity === 'number'
                        ? viewerProject.quantity.toLocaleString()
                        : viewerProject.quantity}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setViewerProject(null)}
                    className="p-2 hover:bg-slate-800 text-slate-300 hover:text-white rounded-full transition-colors cursor-pointer"
                    title="닫기"
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              {/* File Selection Tabs Header */}
              <div className="bg-slate-950 border-b border-slate-800 px-2 md:px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
                {(viewerProject.files || []).length === 0 ? (
                  <span className="text-xs text-slate-500 font-medium py-1">등록된 첨부 문서/사진이 없습니다.</span>
                ) : (
                  viewerProject.files.map((file, idx) => {
                    const isActive = idx === activeFileIndex;
                    return (
                      <button
                        key={file.id}
                        onClick={() => setActiveFileIndex(idx)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 max-w-[200px] cursor-pointer',
                          isActive
                            ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                            : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                        )}
                      >
                        {file.type === 'pdf' && <FileText size={13} className="text-rose-400 shrink-0" />}
                        {file.type === 'excel' && <FileSpreadsheet size={13} className="text-emerald-400 shrink-0" />}
                        {file.type === 'image' && <ImageIcon size={13} className="text-amber-400 shrink-0" />}
                        {file.type === 'other' && <FileCheck size={13} className="text-blue-400 shrink-0" />}
                        <span className="truncate">{file.name}</span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* File Viewer Main Body */}
              <div className="flex-1 bg-slate-950 overflow-hidden flex flex-col">
                {(viewerProject.files || []).length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-900">
                    <div className="w-16 h-16 bg-slate-800 text-slate-400 rounded-3xl flex items-center justify-center mb-3">
                      <FileText size={32} />
                    </div>
                    <h4 className="text-base font-bold text-slate-200 mb-1">업로드된 파일이 없습니다</h4>
                    <p className="text-xs text-slate-400 max-w-xs">
                      상단의 [업로드] 버튼을 통해 작업지시서(PDF), 부품표(Excel), 사진을 등록할 수 있습니다.
                    </p>
                  </div>
                ) : (
                  (() => {
                    const currentFile = viewerProject.files[activeFileIndex] || viewerProject.files[0];
                    if (!currentFile) return null;

                    return (
                      <div className="flex-1 flex flex-col overflow-hidden">
                        {/* File Action sub-bar (Only shown for non-PDF or extra actions) */}
                        <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
                          <div className="flex items-center gap-2 truncate">
                            <span className="font-bold text-slate-200 truncate">{currentFile.name}</span>
                            <span className="text-slate-500 text-[11px]">
                              ({(currentFile.size / 1024).toFixed(1)} KB)
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <a
                              href={currentFile.dataUrl}
                              download={currentFile.name}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-all"
                            >
                              <Download size={13} />
                              <span>다운로드</span>
                            </a>
                            {isAdmin && (
                              <button
                                onClick={() => handleDeleteFile(viewerProject.id, currentFile.id)}
                                className="p-1 text-rose-400 hover:bg-rose-950/50 rounded-lg transition-all cursor-pointer"
                                title="파일 삭제"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Rendering by Type (Edge-to-Edge full screen viewport) */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                          {/* 1. PDF File Viewer (Canvas-based Universal PDF Viewer with Mouse Drag & Mobile support) */}
                          {currentFile.type === 'pdf' && (
                            <UniversalPdfViewer
                              url={currentFile.dataUrl}
                              fileName={currentFile.name}
                            />
                          )}

                          {/* 2. Excel File Viewer (PDF-Look Conversion Table) */}
                          {currentFile.type === 'excel' && (
                            <ExcelPdfLikeViewer file={currentFile} />
                          )}

                          {/* 3. Image Viewer */}
                          {currentFile.type === 'image' && (
                            <ImageViewer file={currentFile} />
                          )}

                          {/* 4. Other File types */}
                          {currentFile.type === 'other' && (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-900">
                              <FileCheck size={48} className="text-blue-400 mx-auto mb-3" />
                              <h5 className="font-bold text-slate-200 mb-1">{currentFile.name}</h5>
                              <p className="text-xs text-slate-400 mb-4">미리보기를 지원하지 않는 파일 형식입니다.</p>
                              <a
                                href={currentFile.dataUrl}
                                download={currentFile.name}
                                className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-xs hover:bg-blue-700"
                              >
                                <Download size={14} />
                                <span>파일 다운로드</span>
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 2. Project Create / Edit Modal                                            */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isProjectModalOpen && (
          <ProjectFormModal
            project={editingProject}
            onClose={() => {
              setIsProjectModalOpen(false);
              setEditingProject(null);
            }}
            onSave={handleSaveProject}
          />
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 3. Upload Modal (PDF, Excel, Photo with auto-compression)                 */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <UploadModal
            projects={infoProjects.filter((p) => p.status !== 'completed')}
            selectedProjectId={uploadTargetProjectId}
            onClose={() => setIsUploadModalOpen(false)}
            onUpload={handleUploadFiles}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// Sub-Component: Excel-to-PDF Print Look Viewer
// ============================================================================
const ExcelPdfLikeViewer: React.FC<{ file: InfoFile }> = ({ file }) => {
  const [selectedSheetIdx, setSelectedSheetIdx] = useState<number>(0);
  const sheets = file.parsedSheets || [];

  if (sheets.length === 0) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <AlertCircle size={36} className="text-amber-500 mx-auto mb-2" />
        <p className="text-sm font-bold text-slate-700">엑셀 시트 데이터를 불러올 수 없습니다.</p>
        <a
          href={file.dataUrl}
          download={file.name}
          className="inline-flex items-center gap-1.5 mt-3 text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold"
        >
          <Download size={13} />
          <span>원본 엑셀 다운로드</span>
        </a>
      </div>
    );
  }

  const currentSheet = sheets[selectedSheetIdx] || sheets[0];
  const rows = currentSheet?.data || [];

  return (
    <div className="w-full h-full flex flex-col bg-white rounded-2xl shadow-sm border border-slate-300 overflow-hidden">
      {/* Sheet Tabs */}
      {sheets.length > 1 && (
        <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
          {sheets.map((sheet, idx) => (
            <button
              key={idx}
              onClick={() => setSelectedSheetIdx(idx)}
              className={cn(
                'px-3 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer',
                idx === selectedSheetIdx ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
              )}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* PDF Document Print Look Table */}
      <div className="flex-1 overflow-auto p-4 md:p-6 bg-slate-100">
        <div className="bg-white shadow-md border border-slate-300 rounded-sm p-4 md:p-6 max-w-5xl mx-auto min-h-[500px]">
          {/* Header Banner (PDF Document look) */}
          <div className="border-b-2 border-slate-900 pb-3 mb-4 flex items-center justify-between">
            <div>
              <h4 className="text-base md:text-lg font-black text-slate-900 tracking-tight uppercase">
                {currentSheet.name || file.name}
              </h4>
              <p className="text-[11px] text-slate-400 font-mono">DOCUMENT VIEWER (PDF CONVERTED STYLE)</p>
            </div>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200 font-bold">
              총 {rows.length}행
            </span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs md:text-sm font-sans">
              <tbody>
                {rows.map((row, rIdx) => {
                  const isHeader = rIdx === 0;
                  return (
                    <tr
                      key={rIdx}
                      className={cn(
                        'transition-colors',
                        isHeader ? 'bg-slate-900 text-white font-black' : rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white',
                        'border-b border-slate-200 hover:bg-sky-50/50'
                      )}
                    >
                      {row.map((cell: any, cIdx: number) => (
                        <td
                          key={cIdx}
                          className={cn(
                            'p-2 md:p-2.5 border-r border-slate-200 last:border-r-0 break-words',
                            isHeader && 'text-center border-slate-700',
                            typeof cell === 'number' ? 'text-right font-mono' : 'text-left'
                          )}
                        >
                          {cell !== null && cell !== undefined ? String(cell) : ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Sub-Component: High Definition Image Viewer with Controls & Mouse Pan Drag
// ============================================================================
const ImageViewer: React.FC<{ file: InfoFile }> = ({ file }) => {
  const [scale, setScale] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    if (e.button !== 0) return; // Left mouse button only

    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();

    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    containerRef.current.scrollTop = dragStart.scrollTop - dy;
  }, [isDragging, dragStart]);

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => setIsDragging(false);

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 overflow-hidden relative select-none">
      {/* Zoom / Rotate Controls Bar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-xl text-white border border-slate-800 shadow-xl">
        <button
          onClick={() => setScale((s) => Math.max(0.4, Number((s - 0.25).toFixed(2))))}
          className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          title="축소"
        >
          <ZoomOut size={16} />
        </button>
        <span className="text-xs font-mono font-bold px-1.5">{Math.round(scale * 100)}%</span>
        <button
          onClick={() => setScale((s) => Math.min(4, Number((s + 0.25).toFixed(2))))}
          className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          title="확대"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => setRotation((r) => (r + 90) % 360)}
          className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors ml-1 border-l border-slate-700 pl-2 cursor-pointer"
          title="90도 회전"
        >
          <RotateCw size={16} />
        </button>
        <button
          onClick={() => {
            setScale(1);
            setRotation(0);
            if (containerRef.current) {
              containerRef.current.scrollLeft = 0;
              containerRef.current.scrollTop = 0;
            }
          }}
          className="px-2 py-1 text-[11px] font-bold hover:bg-slate-800 rounded-lg transition-colors text-emerald-400 cursor-pointer"
        >
          초기화
        </button>
      </div>

      {/* Center Drag Guide for Desktop */}
      <div className="absolute bottom-3 left-3 z-10 hidden md:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 pointer-events-none">
        <Move size={13} className="text-emerald-400 animate-pulse" />
        <span>마우스 좌클릭 드래그로 이동</span>
      </div>

      {/* Image Container with Left Click Drag */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "flex-1 overflow-auto flex items-center justify-center p-4",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      >
        <img
          src={file.dataUrl}
          alt={file.name}
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
            maxHeight: scale <= 1 ? '95%' : 'none',
            maxWidth: scale <= 1 ? '95%' : 'none',
            objectFit: 'contain'
          }}
          className="rounded-lg shadow-2xl pointer-events-none select-none"
        />
      </div>
    </div>
  );
};

// ============================================================================
// Sub-Component: Project Create / Edit Modal Form
// ============================================================================
const ProjectFormModal: React.FC<{
  project: InfoProject | null;
  onClose: () => void;
  onSave: (data: {
    model: string;
    deviceType: string;
    quantity: string;
    shipmentDate: string;
    memo?: string;
  }) => Promise<void>;
}> = ({ project, onClose, onSave }) => {
  const [model, setModel] = useState(project?.model || '');
  const [deviceType, setDeviceType] = useState(project?.deviceType || '');
  const [quantity, setQuantity] = useState(project?.quantity ? String(project.quantity) : '');
  const [shipmentDate, setShipmentDate] = useState(
    project?.shipmentDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  );
  const [memo, setMemo] = useState(project?.memo || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!model.trim() || !deviceType.trim()) {
      alert('모델명과 기종을 모두 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        model,
        deviceType,
        quantity,
        shipmentDate,
        memo
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200"
      >
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center font-bold">
              <Plus size={18} />
            </div>
            <h3 className="font-black text-lg">{project ? '프로젝트 정보 수정' : '새 프로젝트 등록'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase mb-1.5">
              모델명 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="예: EF62, A20, ULTRA"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase mb-1.5">
              기종 (Device / Code) <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="예: CPH-332R, SM-A536N"
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black text-slate-700 uppercase mb-1.5">
                생산수량
              </label>
              <input
                type="text"
                placeholder="예: 5,000"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 outline-none transition-all text-center"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 uppercase mb-1.5">
                선적날짜
              </label>
              <input
                type="date"
                required
                value={shipmentDate}
                onChange={(e) => setShipmentDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold text-slate-900 outline-none transition-all text-center text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 uppercase mb-1.5">
              메모 / 참고사항
            </label>
            <input
              type="text"
              placeholder="특이사항이나 비고 입력"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 text-xs text-slate-800 outline-none transition-all"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-colors text-sm"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors text-sm shadow-md shadow-blue-200 disabled:opacity-50"
            >
              {isSubmitting ? '저장 중...' : project ? '수정 완료' : '등록하기'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

// ============================================================================
// Sub-Component: File Upload Modal (PDF, Excel, Images with Compression)
// ============================================================================
const UploadModal: React.FC<{
  projects: InfoProject[];
  selectedProjectId: string;
  onClose: () => void;
  onUpload: (projectId: string, files: File[]) => Promise<void>;
}> = ({ projects, selectedProjectId, onClose, onUpload }) => {
  const [targetId, setTargetId] = useState<string>(selectedProjectId || projects[0]?.id || '');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) {
      alert('업로드할 대상 프로젝트를 선택하세요.');
      return;
    }
    if (selectedFiles.length === 0) {
      alert('업로드할 파일을 최소 1개 이상 선택하세요.');
      return;
    }

    setIsUploading(true);
    try {
      await onUpload(targetId, selectedFiles);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
      >
        <div className="px-6 py-4 bg-[#F59E0B] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center font-bold">
              <Upload size={18} />
            </div>
            <h3 className="font-black text-lg">문서 및 사진 업로드</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-black/10 rounded-full transition-colors text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Project Selector */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase mb-1.5">
              업로드할 프로젝트 선택 <span className="text-rose-500">*</span>
            </label>
            {projects.length === 0 ? (
              <p className="text-xs text-rose-500 font-bold bg-rose-50 p-3 rounded-xl border border-rose-100">
                진행 중인 프로젝트가 없습니다. 먼저 프로젝트를 등록하세요.
              </p>
            ) : (
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-bold text-slate-900 text-sm outline-none cursor-pointer"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.model} - {p.deviceType} (선적: {p.shipmentDate || '미정'})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Drag & Drop File Picker */}
          <div>
            <label className="block text-xs font-black text-slate-700 uppercase mb-1.5">
              파일 첨부 (PDF, 엑셀, 사진)
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-amber-500 bg-slate-50 hover:bg-amber-50/30 rounded-2xl p-6 text-center cursor-pointer transition-all"
            >
              <input
                type="file"
                multiple
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".pdf, .xlsx, .xls, .csv, .jpg, .jpeg, .png, .webp"
                className="hidden"
              />
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Upload size={24} />
              </div>
              <p className="text-sm font-bold text-slate-800">
                파일을 드래그하거나 <span className="text-amber-600 underline">클릭하여 선택</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                PDF, 엑셀(.xlsx), 사진(JPG, PNG) 지원 (사진은 자동 최적화 압축)
              </p>
            </div>
          </div>

          {/* Selected Files List */}
          {selectedFiles.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 no-scrollbar">
              <span className="text-[11px] font-bold text-slate-400 uppercase">
                선택된 파일 ({selectedFiles.length}개)
              </span>
              {selectedFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-slate-100 rounded-xl text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <FileText size={14} className="text-amber-600 shrink-0" />
                    <span className="font-bold text-slate-800 truncate">{f.name}</span>
                    <span className="text-slate-400 text-[10px]">({(f.size / 1024).toFixed(1)} KB)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFiles(selectedFiles.filter((_, idx) => idx !== i))}
                    className="p-1 text-slate-400 hover:text-rose-500 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-colors text-sm"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isUploading || !targetId || selectedFiles.length === 0}
              className="flex-1 bg-[#F59E0B] hover:bg-amber-600 text-white py-3 rounded-xl font-bold transition-all text-sm shadow-md shadow-amber-200 disabled:opacity-50 cursor-pointer"
            >
              {isUploading ? '업로드 중...' : '업로드 실행'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
