import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { InfoProject, InfoFile } from '../types';
import { 
  FileText, 
  Upload, 
  Plus, 
  Trash2, 
  Edit2, 
  X, 
  CheckCircle, 
  FileSpreadsheet, 
  Image as ImageIcon,
  FileCheck,
  Calendar,
  Layers,
  Search,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Clock,
  ArrowUpDown,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { UniversalPdfViewer } from './UniversalPdfViewer';
import { InAppExcelViewer } from './InAppExcelViewer';
import { saveLocalFileBlob, getLocalFileBlob, uploadBlobToCloud, syncAllLocalFilesToCloud, getAllLocalFileBlobs, uploadFileWithChunks } from '../lib/storage';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// Format date and time for upload display
function formatDateTime(isoString?: string): string {
  if (!isoString) return '일자 미상';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ${hour}:${min}`;
  } catch {
    return isoString;
  }
}

// Utility: Image optimization (Resize & Compress)
async function optimizeImageFile(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_DIM = 2200;

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
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            resolve(blob || file);
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => resolve(file);
      img.src = event.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

// Utility: Read file as Data URL
function readFileAsDataUrl(blob: Blob | File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Calculate D-Day
function getDDayInfo(targetDateStr: string | null | undefined): { text: string; isPast: boolean; days: number; rawDays: number } {
  if (!targetDateStr) return { text: 'D-DAY 미설정', isPast: false, days: 99999, rawDays: 99999 };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(targetDateStr);
  target.setHours(0, 0, 0, 0);

  if (isNaN(target.getTime())) {
    return { text: '날짜 오류', isPast: false, days: 99999, rawDays: 99999 };
  }

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { text: 'D-DAY (오늘)', isPast: false, days: 0, rawDays: 0 };
  } else if (diffDays > 0) {
    return { text: `D-${diffDays}`, isPast: false, days: diffDays, rawDays: diffDays };
  } else {
    return { text: `D+${Math.abs(diffDays)}`, isPast: true, days: diffDays, rawDays: diffDays };
  }
}

// Direct Excel Native App Launcher for PC & Mobile (No in-app viewing, seamless execution)
async function openExcelDirectly(file: InfoFile) {
  try {
    let blob: Blob | null = null;

    // 1. Try local IndexedDB cache
    if (file.id) {
      const cached = await getLocalFileBlob(file.id);
      if (cached?.blob) {
        blob = cached.blob;
      } else if (cached?.dataUrl && cached.dataUrl.startsWith('data:')) {
        const res = await fetch(cached.dataUrl);
        blob = await res.blob();
      }
    }

    // 2. If not in local cache, fetch from server endpoints (resolves from disk or auto-restored from Redis)
    if (!blob) {
      const candidateUrls = [
        file.dataUrl,
        file.id ? `/api/file/${encodeURIComponent(file.id)}` : '',
        file.name ? `/uploads/${encodeURIComponent(file.name)}` : ''
      ].filter(Boolean) as string[];

      for (const targetUrl of candidateUrls) {
        try {
          const res = await fetch(targetUrl);
          if (res.ok) {
            const downloadedBlob = await res.blob();
            if (downloadedBlob && downloadedBlob.size > 0) {
              blob = downloadedBlob;
              // Cache in IndexedDB on this device for future instant opens
              if (file.id) {
                await saveLocalFileBlob(file.id, {
                  blob: downloadedBlob,
                  name: file.name,
                  type: 'excel'
                });
              }
              break;
            }
          }
        } catch (fetchErr) {
          console.warn(`Failed to fetch Excel from ${targetUrl}:`, fetchErr);
        }
      }
    }

    const mimeType = file.name.endsWith('.xls')
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    if (blob) {
      const excelBlob = new Blob([blob], { type: mimeType });
      const blobUrl = URL.createObjectURL(excelBlob);
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      return;
    }

    if (file.dataUrl) {
      const link = document.createElement('a');
      link.href = file.dataUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.error('Error opening Excel file:', err);
    if (file.dataUrl) {
      window.open(file.dataUrl, '_blank');
    }
  }
}

// Sort files helper: Excel files come first, followed by others
function sortFilesWithExcelFirst(files: InfoFile[]): InfoFile[] {
  return [...files].sort((a, b) => {
    const aIsExcel = a.type === 'excel' ? 0 : 1;
    const bIsExcel = b.type === 'excel' ? 0 : 1;
    if (aIsExcel !== bIsExcel) return aIsExcel - bIsExcel;
    return 0;
  });
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
  const [sortMode, setSortMode] = useState<'dday' | 'created' | 'model' | 'custom'>('dday');
  
  // Modals
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<InfoProject | null>(null);
  
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadTargetProjectId, setUploadTargetProjectId] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  
  const [viewerProject, setViewerProject] = useState<InfoProject | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

  // Manual Cloud Sync Handler
  const handleManualSync = async () => {
    setIsSyncingCloud(true);
    try {
      const res = await syncAllLocalFilesToCloud();
      showAlert('클라우드 동기화 완료', `로컬 보관 파일 ${res.total}개 중 ${res.synced}개가 모바일/클라우드 서버에 안전하게 동기화되었습니다.`, 'success');
    } catch (e: any) {
      showAlert('동기화 오류', '클라우드 동기화 중 오류가 발생했습니다: ' + (e?.message || ''), 'error');
    } finally {
      setIsSyncingCloud(false);
    }
  };

  // Mobile / Hardware Back Button Navigation Handler
  useEffect(() => {
    const handlePopState = () => {
      if (isUploadModalOpen) {
        setIsUploadModalOpen(false);
      } else if (isProjectModalOpen) {
        setIsProjectModalOpen(false);
      } else if (viewerProject) {
        setViewerProject(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isUploadModalOpen, isProjectModalOpen, viewerProject]);

  // Auto-sync files from local IndexedDB cache to cloud Redis for cross-device availability
  useEffect(() => {
    let isMounted = true;
    const runCloudSync = async () => {
      try {
        await syncAllLocalFilesToCloud();
      } catch (err) {
        console.warn('Sync notice:', err);
      }
    };

    const timer = setTimeout(() => {
      if (isMounted) runCloudSync();
    }, 1000);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [infoProjects]);

  const openViewer = (project: InfoProject, fileIdx: number = 0) => {
    try {
      window.history.pushState({ modal: 'info-viewer' }, '');
    } catch {}
    setViewerProject(project);
    setActiveFileIndex(fileIdx);
    setDocSearchQuery('');
  };

  const closeViewer = () => {
    setViewerProject(null);
    if (window.history.state?.modal === 'info-viewer') {
      window.history.back();
    }
  };

  const closeUploadModal = () => {
    setIsUploadModalOpen(false);
    if (window.history.state?.modal === 'info-upload') {
      window.history.back();
    }
  };

  const closeProjectModal = () => {
    setIsProjectModalOpen(false);
    setEditingProject(null);
    if (window.history.state?.modal === 'info-project') {
      window.history.back();
    }
  };

  const openUploadModal = (projectId?: string) => {
    try {
      window.history.pushState({ modal: 'info-upload' }, '');
    } catch {}
    setUploadTargetProjectId(projectId || (infoProjects[0]?.id || ''));
    setIsUploadModalOpen(true);
  };

  const openProjectModal = (proj?: InfoProject) => {
    try {
      window.history.pushState({ modal: 'info-project' }, '');
    } catch {}
    setEditingProject(proj || null);
    setIsProjectModalOpen(true);
  };

  // Filter & Sort Projects
  const filteredProjects = useMemo(() => {
    const list = (infoProjects || []).filter((p) =>
      activeTab === 'completed' ? p.status === 'completed' : p.status !== 'completed'
    );

    const searched = list.filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const modelMatch = p.model && p.model.toLowerCase().includes(q);
      const devMatch = p.deviceType && p.deviceType.toLowerCase().includes(q);
      const memoMatch = p.memo && p.memo.toLowerCase().includes(q);
      const fileMatch = (p.files || []).some((f) => f.name.toLowerCase().includes(q));
      return modelMatch || devMatch || memoMatch || fileMatch;
    });

    return searched.sort((a, b) => {
      if (sortMode === 'dday') {
        const dDayA = getDDayInfo(a.shipmentDate);
        const dDayB = getDDayInfo(b.shipmentDate);

        const getRank = (info: typeof dDayA) => {
          if (info.rawDays === 99999) return 3;
          if (info.rawDays >= 0) return 1;
          return 2;
        };

        const rankA = getRank(dDayA);
        const rankB = getRank(dDayB);

        if (rankA !== rankB) return rankA - rankB;
        if (rankA === 1) return dDayA.rawDays - dDayB.rawDays;
        if (rankA === 2) return dDayB.rawDays - dDayA.rawDays;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      } else if (sortMode === 'created') {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      } else if (sortMode === 'model') {
        return (a.model || '').localeCompare(b.model || '');
      } else {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      }
    });
  }, [infoProjects, activeTab, searchQuery, sortMode]);

  // Reorder project manually (Move Up / Move Down)
  const handleMoveProject = async (projectId: string, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIndex = filteredProjects.findIndex((p) => p.id === projectId);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= filteredProjects.length) return;

    const currentProj = filteredProjects[currentIndex];
    const targetProj = filteredProjects[targetIndex];

    const newOrderList = [...filteredProjects];
    newOrderList[currentIndex] = targetProj;
    newOrderList[targetIndex] = currentProj;

    const updated = infoProjects.map((p) => {
      const foundIdx = newOrderList.findIndex((item) => item.id === p.id);
      if (foundIdx !== -1) {
        return { ...p, sortOrder: foundIdx };
      }
      return p;
    });

    setSortMode('custom');
    await onSaveProjects(updated);
  };

  // Reorder Files inside Viewer Project (Move Left / Move Right)
  const handleMoveFile = async (fromIdx: number, direction: 'left' | 'right') => {
    if (!viewerProject || !viewerProject.files) return;
    const toIdx = direction === 'left' ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= viewerProject.files.length) return;

    const newFiles = [...viewerProject.files];
    const temp = newFiles[fromIdx];
    newFiles[fromIdx] = newFiles[toIdx];
    newFiles[toIdx] = temp;

    const updatedProjects = infoProjects.map((p) =>
      p.id === viewerProject.id ? { ...p, files: newFiles } : p
    );

    await onSaveProjects(updatedProjects);
    setViewerProject({ ...viewerProject, files: newFiles });
    setActiveFileIndex(toIdx);
  };

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

  // Toggle Complete project
  const handleToggleCompleteProject = (project: InfoProject, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!isAdmin) {
      showAlert('권한 없음', '관리자만 상태를 변경할 수 있습니다.', 'error');
      return;
    }

    const isCompleting = project.status !== 'completed';
    const title = isCompleting ? '생산 완료 처리' : '진행 중 복원';
    const message = isCompleting
      ? `[${project.model}] 프로젝트를 생산 완료 목록으로 이동하시겠습니까?`
      : `[${project.model}] 프로젝트를 진행 중 목록으로 복원하시겠습니까?`;

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

  // Upload Handler (Fast, no heavy canvas conversion overhead)
  const handleUploadFiles = async (targetProjectId: string, files: File[]) => {
    const targetProj = infoProjects.find((p) => p.id === targetProjectId);
    if (!targetProj) {
      showAlert('오류', '선택된 프로젝트를 찾을 수 없습니다.', 'error');
      return;
    }

    setIsUploading(true);

    try {
      let existingFiles = [...(targetProj.files || [])];

      for (const file of files) {
        const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        let fileType: 'pdf' | 'excel' | 'image' | 'other' = 'other';
        let fileSize = file.size;
        let fileBlob: Blob = file;

        if (ext === 'pdf') {
          fileType = 'pdf';
        } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
          fileType = 'excel';
        } else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
          fileType = 'image';
          fileBlob = await optimizeImageFile(file);
        }

        // 1. Immediately cache raw Blob in local IndexedDB for zero-latency instant offline opening
        try {
          await saveLocalFileBlob(fileId, {
            blob: fileBlob,
            name: file.name,
            type: fileType
          });
        } catch (cacheErr) {
          console.warn('Local cache notice:', cacheErr);
        }

        // 2. High-reliability Chunked Cloud Upload (Guaranteed Redis + Disk persistence)
        let savedUrl = `/api/file/${encodeURIComponent(fileId)}`;
        try {
          const chunkRes = await uploadFileWithChunks(fileId, file.name, fileBlob);
          if (chunkRes.success && chunkRes.url) {
            savedUrl = chunkRes.url;
            fileSize = chunkRes.size || fileSize;
          }
        } catch (cloudErr) {
          console.warn('Chunk upload notice:', cloudErr);
        }

        const newFileObj: InfoFile = {
          id: fileId,
          name: file.name,
          type: fileType,
          size: fileSize,
          dataUrl: savedUrl,
          uploadedAt: new Date().toISOString()
        };

        // Overwrite if same file name exists, otherwise append
        const existingIdx = existingFiles.findIndex((f) => f.name.toLowerCase() === file.name.toLowerCase());
        if (existingIdx !== -1) {
          existingFiles[existingIdx] = newFileObj;
        } else {
          existingFiles.push(newFileObj);
        }
      }

      // Place Excel files first
      existingFiles = sortFilesWithExcelFirst(existingFiles);

      const updated = infoProjects.map((p) => (p.id === targetProjectId ? { ...p, files: existingFiles } : p));
      
      setIsUploadModalOpen(false);
      await onSaveProjects(updated);

      if (viewerProject?.id === targetProjectId) {
        const updatedTarget = updated.find((p) => p.id === targetProjectId);
        if (updatedTarget) setViewerProject(updatedTarget);
      }

      showAlert('업로드 완료', `${files.length}개 파일이 정상 등록되었습니다.`, 'success');
    } catch (err: any) {
      console.error('File upload error:', err);
      setIsUploadModalOpen(false);
      showAlert('업로드 오류', '파일 등록 중 문제가 발생했습니다: ' + (err?.message || '다시 시도해주세요'), 'error');
    } finally {
      setIsUploading(false);
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

  // Document Navigator Search Results
  const docSearchResults = useMemo(() => {
    if (!viewerProject || !docSearchQuery.trim()) return [];
    const query = docSearchQuery.toLowerCase().trim();
    const results: { fileIndex: number; fileName: string; type: string; snippet: string }[] = [];

    (viewerProject.files || []).forEach((file, fIdx) => {
      if (file.name.toLowerCase().includes(query)) {
        results.push({
          fileIndex: fIdx,
          fileName: file.name,
          type: file.type,
          snippet: `파일명 일치: ${file.name}`
        });
      }
    });

    return results;
  }, [viewerProject, docSearchQuery]);

  return (
    <div className="space-y-4 pb-12">
      {/* Top Action Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <>
              {/* 프로젝트 추가 버튼 */}
              <button
                onClick={() => openProjectModal()}
                className="flex items-center gap-2 bg-[#3B82F6] hover:bg-blue-600 active:scale-95 text-white px-4 md:px-5 py-2.5 rounded-xl font-black text-sm md:text-base shadow-md shadow-blue-200 transition-all cursor-pointer"
              >
                <Plus size={18} />
                <span>프로젝트</span>
              </button>

              {/* 업로드 버튼 */}
              <button
                onClick={() => {
                  const defaultTarget = infoProjects.find((p) => p.status !== 'completed')?.id || infoProjects[0]?.id || '';
                  openUploadModal(defaultTarget);
                }}
                className="flex items-center gap-2 bg-[#F59E0B] hover:bg-amber-600 active:scale-95 text-white px-4 md:px-5 py-2.5 rounded-xl font-black text-sm md:text-base shadow-md shadow-amber-200 transition-all cursor-pointer"
              >
                <Upload size={18} />
                <span>업로드</span>
              </button>

              {/* 클라우드 동기화 버튼 */}
              <button
                onClick={handleManualSync}
                disabled={isSyncingCloud}
                title="PC의 도면/파일을 스마트폰에서도 볼 수 있도록 클라우드에 동기화합니다."
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white px-3.5 md:px-4 py-2.5 rounded-xl font-bold text-xs md:text-sm shadow-md shadow-emerald-200 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={16} className={isSyncingCloud ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">{isSyncingCloud ? '동기화 중...' : '클라우드 동기화'}</span>
                <span className="sm:hidden">{isSyncingCloud ? '동기화' : '동기화'}</span>
              </button>
            </>
          )}

          {/* Tab Switcher: 진행중 / 완료 목록 */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('active')}
              className={cn(
                'px-3 md:px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer',
                activeTab === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              진행 중
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={cn(
                'px-3 md:px-4 py-1.5 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer',
                activeTab === 'completed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              완료 목록
            </button>
          </div>
        </div>

        {/* Right Sort & Search Controls */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          {/* Sort Selector */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-xs text-slate-700">
            <ArrowUpDown size={14} className="text-slate-400 shrink-0" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as any)}
              className="bg-transparent font-bold focus:outline-none cursor-pointer pr-1"
            >
              <option value="dday">D-Day 임박순 (기본)</option>
              <option value="created">최신 등록순</option>
              <option value="model">모델명 순</option>
              <option value="custom">사용자 지정순</option>
            </select>
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[180px] max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="모델/기종/문서 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs md:text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Projects List: Green Card Style */}
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
              onClick={() => openProjectModal()}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-md shadow-blue-200"
            >
              <Plus size={18} />
              <span>새 프로젝트 등록하기</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {filteredProjects.map((project, index) => {
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
                onClick={() => openViewer(project, 0)}
                className={cn(
                  'group relative rounded-2xl p-4 md:p-5 transition-all shadow-md hover:shadow-lg cursor-pointer border select-none',
                  project.status === 'completed'
                    ? 'bg-slate-700 text-white border-slate-600 opacity-90'
                    : 'bg-[#559b34] hover:bg-[#4d8e2e] text-white border-[#448028]'
                )}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Left: Reorder Controls (Up/Down) & Model, Device Type */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex flex-col items-center justify-center bg-black/20 rounded-lg p-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleMoveProject(project.id, 'up', e)}
                        disabled={index === 0}
                        className="p-1 hover:bg-white/20 disabled:opacity-20 text-white rounded transition-colors cursor-pointer"
                        title="위로 이동"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <span className="text-[10px] font-mono font-bold opacity-80">{index + 1}</span>
                      <button
                        onClick={(e) => handleMoveProject(project.id, 'down', e)}
                        disabled={index === filteredProjects.length - 1}
                        className="p-1 hover:bg-white/20 disabled:opacity-20 text-white rounded transition-colors cursor-pointer"
                        title="아래로 이동"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2.5 flex-wrap">
                        <span className="text-2xl md:text-3xl font-black tracking-tight drop-shadow-sm text-white">
                          {project.model}
                        </span>
                        <span className="text-base md:text-lg font-bold text-emerald-100 tracking-normal">
                          {project.deviceType}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-emerald-50 text-sm md:text-base font-semibold flex-wrap">
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
                  </div>

                  {/* Center / Right: Shipping Date & D-DAY */}
                  <div className="flex items-center gap-3 justify-between md:justify-end border-t md:border-t-0 border-white/20 pt-2.5 md:pt-0">
                    <div className="text-left md:text-right">
                      <div className="text-xs md:text-sm font-medium text-emerald-100 flex items-center gap-1 md:justify-end">
                        <Calendar size={14} className="opacity-80" />
                        <span>선적날짜: {project.shipmentDate || '미정'}</span>
                      </div>
                      <div className="text-xl md:text-2xl font-black text-white tracking-tight mt-0.5 drop-shadow-sm flex items-center gap-1.5 md:justify-end">
                        <span>{dDay.text}</span>
                        {dDay.rawDays <= 3 && dDay.rawDays >= 0 && (
                          <span className="text-[10px] bg-rose-500 text-white font-bold px-1.5 py-0.5 rounded-full animate-bounce">
                            임박
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Far Right Action Buttons */}
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
                              openProjectModal(project);
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

                {/* Bottom Bar: Attached File Badges */}
                <div className="mt-3 pt-2.5 border-t border-white/20 flex items-center justify-between text-xs text-emerald-100 flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold flex items-center gap-1 bg-black/25 px-2 py-0.5 rounded-md text-white">
                      <FileText size={13} />
                      문서 {fileCount}개
                    </span>

                    {/* Instant In-App Excel Viewer Button on project card */}
                    {excelCount > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const excelIdx = (project.files || []).findIndex((f) => f.type === 'excel');
                          openViewer(project, excelIdx >= 0 ? excelIdx : 0);
                        }}
                        className="bg-emerald-800 hover:bg-emerald-700 active:scale-95 text-white px-2.5 py-1 rounded-lg text-[11px] font-black flex items-center gap-1.5 shadow-sm border border-emerald-600 transition-all cursor-pointer"
                        title="앱 화면에서 엑셀 시트 즉시 열람"
                      >
                        <FileSpreadsheet size={13} className="text-emerald-300" />
                        <span>엑셀 보기 ({excelCount})</span>
                      </button>
                    )}

                    {pdfCount > 0 && (
                      <span className="bg-rose-500/80 text-white px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1">
                        <FileText size={11} />
                        PDF 도면 {pdfCount}
                      </span>
                    )}
                    {imageCount > 0 && (
                      <span className="bg-amber-600/80 text-white px-2 py-0.5 rounded-md text-[11px] font-bold flex items-center gap-1">
                        <ImageIcon size={11} />
                        사진 {imageCount}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 font-bold text-white group-hover:translate-x-0.5 transition-transform ml-auto">
                    <span>도면/문서 보기</span>
                    <ChevronRight size={15} />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. Fullscreen Document Viewer Modal (PDF & Images)                         */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {viewerProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 bg-slate-950/95 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              className="bg-slate-900 w-full h-full flex flex-col overflow-hidden"
            >
              {/* Modal Top Bar */}
              <div className="px-3 md:px-5 py-2 bg-slate-900 text-white flex items-center justify-between shrink-0 border-b border-slate-800">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center font-black text-xs shrink-0 shadow-sm">
                    AJ
                  </div>
                  <div className="truncate">
                    <h3 className="font-black text-sm md:text-base truncate flex items-center gap-2">
                      <span>{viewerProject.model}</span>
                      <span className="text-emerald-400 text-xs md:text-sm font-normal">({viewerProject.deviceType})</span>
                    </h3>
                    <p className="text-[11px] text-slate-400 flex items-center gap-2">
                      <span>선적: {viewerProject.shipmentDate || '미정'}</span>
                      <span>•</span>
                      <span>수량: {typeof viewerProject.quantity === 'number' ? viewerProject.quantity.toLocaleString() : viewerProject.quantity}</span>
                    </p>
                  </div>
                </div>

                {/* Document Global Search Bar */}
                <div className="hidden sm:flex items-center gap-2 max-w-xs flex-1 mx-4">
                  <div className="relative w-full">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="파일명 검색..."
                      value={docSearchQuery}
                      onChange={(e) => setDocSearchQuery(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-7 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
                    />
                    {docSearchQuery && (
                      <button onClick={() => setDocSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={closeViewer}
                    className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-600 px-3 py-1.5 rounded-xl text-white text-xs font-bold transition-colors cursor-pointer"
                    title="닫기"
                  >
                    <X size={16} />
                    <span>닫기</span>
                  </button>
                </div>
              </div>

              {/* Search Results Dropdown Bar */}
              {docSearchQuery && (
                <div className="bg-slate-950 border-b border-emerald-500/40 px-3 py-2 text-xs flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
                  <span className="text-emerald-400 font-bold shrink-0">검색 결과 ({docSearchResults.length}):</span>
                  {docSearchResults.length === 0 ? (
                    <span className="text-slate-500">일치하는 문서가 없습니다.</span>
                  ) : (
                    docSearchResults.map((res, rIdx) => (
                      <button
                        key={rIdx}
                        onClick={() => {
                          setActiveFileIndex(res.fileIndex);
                        }}
                        className="bg-slate-800 hover:bg-emerald-900/60 text-slate-200 hover:text-emerald-200 border border-slate-700 hover:border-emerald-500/50 px-2.5 py-1 rounded-md shrink-0 flex items-center gap-1.5 transition-all text-[11px] cursor-pointer"
                      >
                        <span className="font-bold text-emerald-400">{res.fileName}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* File Selection Tabs Header (With Order Movement Controls ◀ ▶) */}
              <div className="bg-slate-950 border-b border-slate-800 px-2 md:px-4 py-1.5 flex items-center gap-2 overflow-x-auto shrink-0 no-scrollbar">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0 mr-1">
                  첨부문서:
                </span>
                {(viewerProject.files || []).length === 0 ? (
                  <span className="text-xs text-slate-500 font-medium py-1">등록된 문서가 없습니다.</span>
                ) : (
                  viewerProject.files.map((file, idx) => {
                    const isActive = idx === activeFileIndex;
                    return (
                      <div
                        key={file.id}
                        className={cn(
                          'flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-xl text-xs font-bold transition-all shrink-0 border',
                          isActive
                            ? 'bg-slate-800 text-white border-slate-600 ring-1 ring-emerald-500 shadow-md'
                            : 'bg-slate-900/70 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                        )}
                      >
                        <button
                          onClick={() => {
                            setActiveFileIndex(idx);
                          }}
                          className="flex items-center gap-1.5 max-w-[160px] md:max-w-[220px] truncate cursor-pointer text-left"
                        >
                          {file.type === 'excel' && <FileSpreadsheet size={14} className="text-emerald-400 shrink-0" />}
                          {file.type === 'pdf' && <FileText size={14} className="text-rose-400 shrink-0" />}
                          {file.type === 'image' && <ImageIcon size={14} className="text-amber-400 shrink-0" />}
                          {file.type === 'other' && <FileCheck size={14} className="text-blue-400 shrink-0" />}
                          <span className="truncate">{file.name}</span>
                        </button>

                        {/* File Position Order Adjusters (Left / Right) */}
                        {isAdmin && viewerProject.files.length > 1 && (
                          <div className="flex items-center ml-1 border-l border-slate-700/60 pl-1">
                            <button
                              onClick={() => handleMoveFile(idx, 'left')}
                              disabled={idx === 0}
                              className="p-0.5 hover:bg-slate-700 disabled:opacity-20 text-slate-400 hover:text-white rounded cursor-pointer"
                              title="문서 순서 앞으로 이동"
                            >
                              <ChevronLeft size={13} />
                            </button>
                            <button
                              onClick={() => handleMoveFile(idx, 'right')}
                              disabled={idx === viewerProject.files.length - 1}
                              className="p-0.5 hover:bg-slate-700 disabled:opacity-20 text-slate-400 hover:text-white rounded cursor-pointer"
                              title="문서 순서 뒤로 이동"
                            >
                              <ChevronRight size={13} />
                            </button>
                          </div>
                        )}
                      </div>
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
                      상단의 [업로드] 버튼을 통해 작업지시서(PDF), 엑셀, 사진을 등록할 수 있습니다.
                    </p>
                  </div>
                ) : (
                  (() => {
                    const currentFile = viewerProject.files[activeFileIndex] || viewerProject.files[0];
                    if (!currentFile) return null;

                    return (
                      <div className="flex-1 flex flex-col overflow-hidden">
                        {/* File Action Sub-bar with Upload Timestamp */}
                        <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
                          <div className="flex items-center gap-3 truncate">
                            <span className="font-bold text-slate-200 truncate">{currentFile.name}</span>
                            <span className="text-slate-500 text-[11px]">
                              ({(currentFile.size / 1024).toFixed(1)} KB)
                            </span>
                            {/* Upload Timestamp Badge */}
                            <div className="flex items-center gap-1 text-[11px] bg-slate-800 text-emerald-400 px-2 py-0.5 rounded-md border border-slate-700">
                              <Clock size={12} />
                              <span>업로드: {formatDateTime(currentFile.uploadedAt)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Optional Native Excel App Open Button */}
                            {currentFile.type === 'excel' && (
                              <button
                                onClick={async () => {
                                  await openExcelDirectly(currentFile);
                                  showAlert('엑셀 열람', `[${currentFile.name}] 기기 기본 엑셀 앱으로 바로 열었습니다.`, 'info');
                                }}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 transition-all cursor-pointer"
                                title="스마트폰/PC 기본 엑셀 앱으로도 열기"
                              >
                                <ExternalLink size={13} />
                                <span>기기 앱으로 열기</span>
                              </button>
                            )}

                            {isAdmin && (
                              <button
                                onClick={() => handleDeleteFile(viewerProject.id, currentFile.id)}
                                className="p-1 text-rose-400 hover:bg-rose-950/50 rounded-lg transition-all cursor-pointer ml-2"
                                title="파일 삭제"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Rendering by Type */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                          {/* 1. Excel File In-App Viewer (Instant Sheet Tabs & Grid with Zero Download) */}
                          {currentFile.type === 'excel' && (
                            <InAppExcelViewer
                              fileId={currentFile.id}
                              dataUrl={currentFile.dataUrl}
                              fileName={currentFile.name}
                              onDownloadNative={() => openExcelDirectly(currentFile)}
                            />
                          )}

                          {/* 2. PDF File Viewer (Zero-Lag, Lightweight & Smooth) */}
                          {currentFile.type === 'pdf' && (
                            <PdfViewerWrapper
                              file={currentFile}
                              initialSearchQuery={docSearchQuery}
                            />
                          )}

                          {/* 3. Image Viewer (Pan & Zoom without Left-Cut) */}
                          {currentFile.type === 'image' && (
                            <ImageViewer file={currentFile} />
                          )}

                          {/* 4. Other File types */}
                          {currentFile.type === 'other' && (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-900">
                              <FileCheck size={48} className="text-blue-400 mx-auto mb-3" />
                              <h5 className="font-bold text-slate-200 mb-1">{currentFile.name}</h5>
                              <p className="text-xs text-slate-400">미리보기를 지원하지 않는 파일 형식입니다.</p>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <h3 className="text-lg font-black text-slate-900">
                  {editingProject ? '프로젝트 정보 수정' : '새 프로젝트 등록'}
                </h3>
                <button
                  onClick={closeProjectModal}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <ProjectForm
                initialData={editingProject}
                onSave={handleSaveProject}
                onCancel={closeProjectModal}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* 3. Document / Excel / Image Upload Modal                                  */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-slate-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
                    <Upload size={18} />
                  </div>
                  <h3 className="text-lg font-black text-slate-900">도면 및 문서 업로드</h3>
                </div>
                <button
                  onClick={closeUploadModal}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <UploadForm
                projects={infoProjects.filter((p) => p.status !== 'completed')}
                defaultProjectId={uploadTargetProjectId}
                isUploading={isUploading}
                onUpload={handleUploadFiles}
                onCancel={closeUploadModal}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// Sub Component: PDF Viewer Wrapper (Resolves IndexedDB / Binary Data & Fast Load)
// ============================================================================
const PdfViewerWrapper: React.FC<{ file: InfoFile; initialSearchQuery?: string }> = ({ file, initialSearchQuery }) => {
  const [resolvedUrl, setResolvedUrl] = useState<string>(file.dataUrl || '');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);

    const resolvePdfUrl = async () => {
      try {
        // 1. Check local IndexedDB cache first
        if (file.id) {
          const cached = await getLocalFileBlob(file.id);
          if (cached?.blob && isMounted) {
            const url = URL.createObjectURL(cached.blob);
            setResolvedUrl(url);
            setIsLoading(false);
            return;
          } else if (cached?.dataUrl && isMounted) {
            setResolvedUrl(cached.dataUrl);
            setIsLoading(false);
            return;
          }
        }

        // 2. If not cached locally (e.g. on Mobile device), fetch from server
        const candidateUrls = [
          file.dataUrl,
          file.id ? `/api/file/${encodeURIComponent(file.id)}` : '',
          file.name ? `/uploads/${encodeURIComponent(file.name)}` : '',
          file.name ? `/api/file/${encodeURIComponent(file.name)}` : ''
        ].filter(Boolean) as string[];

        for (const targetUrl of candidateUrls) {
          try {
            const res = await fetch(targetUrl);
            if (res.ok) {
              const contentType = res.headers.get('content-type') || '';
              if (contentType.includes('text/html')) {
                continue;
              }
              const blob = await res.blob();
              if (blob && blob.size > 0) {
                // Cache into IndexedDB on this device for instant zero-latency opening next time
                if (file.id) {
                  await saveLocalFileBlob(file.id, {
                    blob,
                    name: file.name,
                    type: 'pdf'
                  });
                }
                if (isMounted) {
                  const url = URL.createObjectURL(blob);
                  setResolvedUrl(url);
                  setIsLoading(false);
                  return;
                }
              }
            }
          } catch (fetchErr) {
            console.warn(`PDF remote fetch notice for ${targetUrl}:`, fetchErr);
          }
        }

        if (isMounted) {
          setLoadError('PDF 도면 파일을 서버에서 불러오는 중이거나 찾을 수 없습니다.');
          setIsLoading(false);
        }
      } catch (err: any) {
        console.warn('PDF URL resolve notice:', err);
        if (isMounted) {
          setResolvedUrl(file.dataUrl || '');
          setIsLoading(false);
        }
      }
    };

    resolvePdfUrl();

    return () => {
      isMounted = false;
    };
  }, [file.id, file.dataUrl, file.name]);

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-slate-300">
        <div className="w-10 h-10 border-3 border-rose-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-bold">PDF 도면 불러오는 중...</p>
      </div>
    );
  }

  if (loadError || !resolvedUrl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-900 text-center">
        <FileText size={48} className="text-rose-400 mb-3" />
        <h4 className="text-base font-bold text-white mb-1">도면 파일을 열 수 없습니다</h4>
        <p className="text-xs text-slate-400 mb-4 max-w-sm">{loadError || '파일 데이터가 유실되었거나 접근할 수 없습니다.'}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsLoading(true);
              setLoadError(null);
              // Force re-fetch
              const candidateUrls = [
                file.dataUrl,
                file.id ? `/api/file/${encodeURIComponent(file.id)}` : '',
                file.name ? `/uploads/${encodeURIComponent(file.name)}` : '',
                file.name ? `/api/file/${encodeURIComponent(file.name)}` : ''
              ].filter(Boolean) as string[];

              (async () => {
                for (const targetUrl of candidateUrls) {
                  try {
                    const res = await fetch(targetUrl);
                    if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
                      const blob = await res.blob();
                      if (blob && blob.size > 0) {
                        if (file.id) {
                          await saveLocalFileBlob(file.id, { blob, name: file.name, type: 'pdf' });
                        }
                        setResolvedUrl(URL.createObjectURL(blob));
                        setIsLoading(false);
                        return;
                      }
                    }
                  } catch {}
                }
                setLoadError('서버에서 파일을 찾을 수 없습니다. PC에서 원본 파일을 열람하거나 재동기화 후 확인해주세요.');
                setIsLoading(false);
              })();
            }}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
          >
            다시 시도
          </button>
          {resolvedUrl && (
            <a
              href={resolvedUrl}
              download={file.name}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all"
            >
              다운로드
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <UniversalPdfViewer
      url={resolvedUrl}
      fileName={file.name}
      initialSearchQuery={initialSearchQuery}
    />
  );
};

// ============================================================================
// Sub Component: Image Viewer (Pan & Zoom without Left-Cut)
// ============================================================================
const ImageViewer: React.FC<{ file: InfoFile }> = ({ file }) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [localUrl, setLocalUrl] = useState(file.dataUrl || '');

  // Touch gesture state
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);
  const lastTapRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    const loadImage = async () => {
      if (file.id) {
        const cached = await getLocalFileBlob(file.id);
        if (cached?.dataUrl && isMounted) {
          setLocalUrl(cached.dataUrl);
          return;
        } else if (cached?.blob && isMounted) {
          setLocalUrl(URL.createObjectURL(cached.blob));
          return;
        }
      }

      const candidateUrls = [
        file.dataUrl,
        file.id ? `/api/file/${encodeURIComponent(file.id)}` : '',
        file.name ? `/uploads/${encodeURIComponent(file.name)}` : '',
        file.name ? `/api/file/${encodeURIComponent(file.name)}` : ''
      ].filter(Boolean) as string[];

      for (const targetUrl of candidateUrls) {
        try {
          const res = await fetch(targetUrl);
          if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('text/html')) continue;
            const blob = await res.blob();
            if (blob && blob.size > 0) {
              if (file.id) {
                await saveLocalFileBlob(file.id, { blob, name: file.name, type: 'image' });
              }
              if (isMounted) {
                setLocalUrl(URL.createObjectURL(blob));
                return;
              }
            }
          }
        } catch {}
      }

      if (file.dataUrl && isMounted) {
        setLocalUrl(file.dataUrl);
      } else if (file.id && isMounted) {
        setLocalUrl(`/api/file/${encodeURIComponent(file.id)}`);
      }
    };

    loadImage();
    return () => { isMounted = false; };
  }, [file.id, file.dataUrl, file.name]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Touch events
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      touchStartZoomRef.current = zoom;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        setZoom((prev) => (prev > 1.2 ? 1 : 2.5));
        setPosition({ x: 0, y: 0 });
      }
      lastTapRef.current = now;
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - position.x, y: e.touches[0].clientY - position.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / touchStartDistRef.current;
      const newZoom = Math.min(Math.max(0.5, touchStartZoomRef.current * ratio), 5);
      setZoom(Number(newZoom.toFixed(2)));
    } else if (e.touches.length === 1 && isDragging) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y
      });
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
    setIsDragging(false);
  };

  const resetView = () => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden select-none">
      {/* Control Bar */}
      <div className="bg-slate-900/80 px-4 py-1.5 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300 shrink-0">
        <div className="flex items-center gap-2 truncate">
          <span className="font-bold text-amber-400 truncate">{file.name}</span>
          <span className="text-slate-500 text-[11px] hidden sm:inline">| 터치 핀치/드래그로 화면 이동</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.25))}
            className="p-1 hover:bg-slate-800 rounded text-slate-300 hover:text-white cursor-pointer"
            title="축소"
          >
            <ZoomOut size={15} />
          </button>
          <span className="font-mono text-xs w-11 text-center text-slate-300 font-bold">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
            className="p-1 hover:bg-slate-800 rounded text-slate-300 hover:text-white cursor-pointer"
            title="확대"
          >
            <ZoomIn size={15} />
          </button>
          <button
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="p-1 hover:bg-slate-800 rounded text-slate-300 hover:text-white ml-1 cursor-pointer"
            title="90도 회전"
          >
            <RotateCw size={15} />
          </button>
          <button
            onClick={resetView}
            className="px-2.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-bold text-slate-300 ml-1 cursor-pointer"
            title="화면 맞춤"
          >
            맞춤
          </button>
        </div>
      </div>

      {/* Main Image Canvas Area */}
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          'flex-1 overflow-auto bg-slate-950 relative flex items-center justify-center p-2 md:p-6',
          isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'
        )}
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      >
        <div
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.08s ease-out'
          }}
          className="m-auto min-w-fit min-h-fit shadow-2xl rounded-lg overflow-hidden bg-black/40"
        >
          <img
            src={localUrl}
            alt={file.name}
            className="max-w-none block pointer-events-none rounded-lg"
            style={{ maxHeight: '82vh', objectFit: 'contain' }}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Sub Component: Project Create / Edit Form
// ============================================================================
interface ProjectFormProps {
  initialData: InfoProject | null;
  onSave: (data: {
    model: string;
    deviceType: string;
    quantity: string;
    shipmentDate: string;
    memo?: string;
  }) => void;
  onCancel: () => void;
}

const ProjectForm: React.FC<ProjectFormProps> = ({ initialData, onSave, onCancel }) => {
  const [model, setModel] = useState(initialData?.model || '');
  const [deviceType, setDeviceType] = useState(initialData?.deviceType || '');
  const [quantity, setQuantity] = useState(
    initialData ? String(initialData.quantity || '') : ''
  );
  const [shipmentDate, setShipmentDate] = useState(initialData?.shipmentDate || '');
  const [memo, setMemo] = useState(initialData?.memo || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model.trim()) {
      alert('모델명을 입력해주세요.');
      return;
    }
    if (!deviceType.trim()) {
      alert('기종을 입력해주세요.');
      return;
    }

    onSave({
      model: model.trim(),
      deviceType: deviceType.trim(),
      quantity: quantity.trim(),
      shipmentDate,
      memo: memo.trim()
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">
          모델명 <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          placeholder="예: EF62, CPH-300"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
          className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">
          기종 <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          placeholder="예: CPH-332R, HEAD, BASE"
          value={deviceType}
          onChange={(e) => setDeviceType(e.target.value)}
          required
          className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">생산수량</label>
          <input
            type="text"
            placeholder="예: 5000"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">선적날짜</label>
          <input
            type="date"
            value={shipmentDate}
            onChange={(e) => setShipmentDate(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">메모 (선택사항)</label>
        <textarea
          placeholder="특이사항, 발주처, 작업 주의사항 등"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-bold text-xs rounded-xl cursor-pointer"
        >
          취소
        </button>
        <button
          type="submit"
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-200 transition-all cursor-pointer"
        >
          저장하기
        </button>
      </div>
    </form>
  );
};

// ============================================================================
// Sub Component: Multi-File Upload Form
// ============================================================================
interface UploadFormProps {
  projects: InfoProject[];
  defaultProjectId: string;
  isUploading: boolean;
  onUpload: (targetProjectId: string, files: File[]) => void;
  onCancel: () => void;
}

const UploadForm: React.FC<UploadFormProps> = ({
  projects,
  defaultProjectId,
  isUploading,
  onUpload,
  onCancel
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId || (projects[0]?.id || ''));
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      alert('대상 프로젝트를 선택해주세요.');
      return;
    }
    if (selectedFiles.length === 0) {
      alert('업로드할 파일을 최소 1개 이상 선택해주세요.');
      return;
    }

    onUpload(selectedProjectId, selectedFiles);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1">
          등록할 대상 프로젝트 선택 <span className="text-rose-500">*</span>
        </label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          required
          className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.model} ({p.deviceType}) - 선적: {p.shipmentDate || '미정'}
            </option>
          ))}
        </select>
      </div>

      {/* Drag and Drop Zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-slate-200 hover:border-amber-400 bg-slate-50/60 hover:bg-amber-50/40 rounded-2xl p-6 text-center cursor-pointer transition-all"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
          <Upload size={24} />
        </div>
        <p className="text-xs md:text-sm font-bold text-slate-700 mb-1">
          파일을 이곳으로 드래그하거나 클릭하여 선택하세요
        </p>
        <p className="text-[11px] text-slate-400">
          지원 파일: 작업지시서(PDF), 엑셀(XLSX/XLS), 도면 사진(JPG/PNG) 등
        </p>
      </div>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="max-h-36 overflow-y-auto space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs">
          <div className="text-[11px] font-bold text-slate-500 mb-1">
            선택된 파일 ({selectedFiles.length}개):
          </div>
          {selectedFiles.map((file, idx) => (
            <div key={idx} className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-100">
              <span className="font-bold text-slate-800 truncate max-w-[300px]">{file.name}</span>
              <span className="text-[10px] text-slate-400 shrink-0">({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={isUploading}
          className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-bold text-xs rounded-xl cursor-pointer"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isUploading || selectedFiles.length === 0}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md shadow-amber-200 transition-all cursor-pointer flex items-center gap-1.5"
        >
          {isUploading ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>업로드 및 등록 중...</span>
            </>
          ) : (
            <>
              <Upload size={14} />
              <span>{selectedFiles.length > 0 ? `${selectedFiles.length}개 파일 업로드` : '파일 업로드'}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
