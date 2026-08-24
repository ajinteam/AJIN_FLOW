import React, { useState, useMemo, useEffect } from 'react';
import { InfoProject, InfoFile, UserConfig, InfoFolderType } from '../types';
import {
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Search,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  FolderOpen,
  Calendar,
  Layers,
  Sparkles,
  ExternalLink,
  Edit2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  Tag,
  Cpu,
  Hash,
  Eye,
  Check,
  Cloud,
  RefreshCw
} from 'lucide-react';
import { format, differenceInDays, parseISO, isAfter } from 'date-fns';
import { formatFileSize } from '../lib/imageCompressor';
import { FileViewerModal } from './FileViewerModal';
import { ProjectModal } from './ProjectModal';
import { UploadModal } from './UploadModal';
import { uploadSingleFile, deleteFileFromServer, syncFilesFromR2 } from '../lib/api';

interface InfoViewProps {
  projects: InfoProject[];
  files: InfoFile[];
  currentUserInitials: string;
  isMaster: boolean;
  canManage: boolean;
  onUpdateProjects: (projects: InfoProject[]) => void;
  onUpdateFiles: (files: InfoFile[]) => void;
}

export const InfoView: React.FC<InfoViewProps> = ({
  projects,
  files,
  currentUserInitials,
  isMaster,
  canManage,
  onUpdateProjects,
  onUpdateFiles,
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'trash'>('active');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFileFilter, setSelectedFileFilter] = useState<'all' | 'pdf' | 'excel' | 'image'>('all');
  const [isSyncingR2, setIsSyncingR2] = useState<boolean>(false);
  const [syncNotice, setSyncNotice] = useState<string>('');
  
  // Modals state
  const [viewingFile, setViewingFile] = useState<InfoFile | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState<boolean>(false);
  const [editingProject, setEditingProject] = useState<InfoProject | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [targetUploadProjectId, setTargetUploadProjectId] = useState<string | undefined>();
  
  // Expanded project accordion state (which projects show file lists)
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});

  // Mobile Back Button support for tab switching (Requirement #4)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (activeTab !== 'active' && !viewingFile && !isProjectModalOpen && !isUploadModalOpen) {
        setActiveTab('active');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, viewingFile, isProjectModalOpen, isUploadModalOpen]);

  const toggleProjectExpand = (projectId: string) => {
    setExpandedProjectIds((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  // Sync / Scan existing files stored directly in Cloudflare R2
  const handleSyncCloudflareR2 = async () => {
    setIsSyncingR2(true);
    setSyncNotice('');
    try {
      const syncResult = await syncFilesFromR2();
      if (!syncResult.configured) {
        setSyncNotice('Cloudflare R2가 아직 연결되지 않았습니다. Vercel 환경 변수를 확인해주세요.');
        return;
      }

      if (syncResult.objects.length === 0) {
        setSyncNotice('Cloudflare R2 버킷에 저장된 파일이 없습니다.');
        return;
      }

      // Check which objects in R2 are not yet in `files`
      const existingKeys = new Set(files.map((f) => f.storagePath));
      const missingObjects = syncResult.objects.filter((obj) => !existingKeys.has(obj.key));

      if (missingObjects.length === 0) {
        setSyncNotice(`클라우드(R2)의 모든 파일(${syncResult.count}개)이 앱과 이미 100% 동기화되어 있습니다.`);
        return;
      }

      // Ensure we have a target project to associate missing files with
      let targetProj = projects.find((p) => p.status === 'active');
      let updatedProjects = [...projects];

      if (!targetProj) {
        targetProj = {
          id: `proj_r2_sync_${Date.now()}`,
          model: 'R2-CLOUD',
          machineType: '클라우드 동기화 보관함',
          shipmentDate: new Date().toISOString().substring(0, 10),
          productionQty: String(missingObjects.length),
          notes: 'Cloudflare R2에서 자동 동기화된 파일 보관함',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        updatedProjects = [targetProj, ...projects];
        onUpdateProjects(updatedProjects);
      }

      // Create new InfoFile items for missing objects
      const newFiles: InfoFile[] = missingObjects.map((obj) => ({
        id: `file_r2_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        projectId: targetProj!.id,
        fileName: obj.fileName,
        fileType: obj.fileType,
        folder: obj.folder as InfoFolderType,
        storagePath: obj.key,
        fileUrl: obj.url,
        fileSize: obj.size,
        mimeType: obj.fileType === 'pdf' ? 'application/pdf' : obj.fileType === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'image/jpeg',
        uploadedBy: 'Cloudflare_R2',
        uploadedAt: obj.lastModified || new Date().toISOString(),
        updatedAt: obj.lastModified || new Date().toISOString(),
        status: 'active',
        version: 1,
        originalSize: obj.size,
        compressedSize: obj.size,
      }));

      onUpdateFiles([...newFiles, ...files]);
      setExpandedProjectIds((prev) => ({ ...prev, [targetProj!.id]: true }));
      setSyncNotice(`클라우드(R2)에서 ${newFiles.length}개의 이미지/파일을 새로 불러와 동기화했습니다!`);
    } catch (e: any) {
      setSyncNotice('클라우드 동기화 실패: ' + (e?.message || '알 수 없는 오류'));
    } finally {
      setIsSyncingR2(false);
      setTimeout(() => setSyncNotice(''), 6000);
    }
  };

  // Helper to calculate D-Day diff number
  const getDDayDiff = (dateStr: string) => {
    if (!dateStr) return 999999;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = parseISO(dateStr);
      target.setHours(0, 0, 0, 0);
      return differenceInDays(target, today);
    } catch {
      return 999999;
    }
  };

  // Helper to calculate D-Day
  const getDDayBadge = (dateStr: string) => {
    if (!dateStr) return null;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = parseISO(dateStr);
      target.setHours(0, 0, 0, 0);
      const diff = differenceInDays(target, today);

      if (diff === 0) {
        return <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 font-bold text-xs border border-rose-500/30 whitespace-nowrap">D-DAY</span>;
      } else if (diff > 0) {
        return <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-semibold text-xs border border-amber-500/30 whitespace-nowrap">D-{diff}</span>;
      } else {
        return <span className="px-2 py-0.5 rounded-md bg-slate-700 text-slate-400 font-medium text-xs whitespace-nowrap">D+{Math.abs(diff)}</span>;
      }
    } catch {
      return null;
    }
  };

  // Filtered and D-Day sorted projects list (Requirement #3: 프로젝트의 순서를 d-day 순서로 정렬되게)
  const filteredProjects = useMemo(() => {
    let list = projects.filter((p) => {
      if (activeTab === 'trash') return p.status === 'trash';
      if (activeTab === 'completed') return p.status === 'completed';
      return p.status === 'active';
    });

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => {
        const matchesProject =
          (p.model || '').toLowerCase().includes(q) ||
          (p.machineType || '').toLowerCase().includes(q) ||
          (p.notes || '').toLowerCase().includes(q) ||
          (p.shipmentDate || '').toLowerCase().includes(q);

        // Also check if any file inside matches
        const projectFiles = files.filter((f) => f.projectId === p.id && f.status !== 'trash');
        const matchesFile = projectFiles.some((f) => f.fileName.toLowerCase().includes(q));

        return matchesProject || matchesFile;
      });
    }

    // Sort by D-Day: closest upcoming deadline first (e.g. D-0, D-1, D-5, ..., past D+1, D+2, no date last)
    list.sort((a, b) => {
      const diffA = getDDayDiff(a.shipmentDate);
      const diffB = getDDayDiff(b.shipmentDate);
      return diffA - diffB;
    });

    return list;
  }, [projects, files, activeTab, searchQuery]);

  // Trash files that might belong to deleted or active projects
  const trashedFiles = useMemo(() => {
    return files.filter((f) => f.status === 'trash');
  }, [files]);

  // Active files map grouped by projectId
  const activeFilesByProject = useMemo(() => {
    const map: Record<string, InfoFile[]> = {};
    for (const f of files) {
      if (f.status === 'trash') continue;
      if (!map[f.projectId]) map[f.projectId] = [];
      map[f.projectId].push(f);
    }
    return map;
  }, [files]);

  // Handle Project Creation or Update (Requirement #4: 선적일을 수정하면 이전 선적일도 표시되고, 수정된 것은 빨강색으로 표시)
  const handleSaveProject = (projectData: Omit<InfoProject, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => {
    const now = new Date().toISOString();
    if (editingProject) {
      const oldShipmentDate = editingProject.shipmentDate;
      const newShipmentDate = projectData.shipmentDate;
      let previousHistory = editingProject.previousShipmentDates || [];

      if (oldShipmentDate && newShipmentDate && oldShipmentDate !== newShipmentDate) {
        if (!previousHistory.includes(oldShipmentDate)) {
          previousHistory = [...previousHistory, oldShipmentDate];
        }
      }

      const updated = projects.map((p) =>
        p.id === editingProject.id
          ? {
              ...p,
              ...projectData,
              previousShipmentDates: previousHistory,
              updatedAt: now,
            }
          : p
      );
      onUpdateProjects(updated);
      setEditingProject(null);
    } else {
      const newProject: InfoProject = {
        id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        ...projectData,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      onUpdateProjects([newProject, ...projects]);
      // Auto expand the new project
      setExpandedProjectIds((prev) => ({ ...prev, [newProject.id]: true }));
    }
  };

  // Complete Project action (Only Master or 5200 / canManage)
  const handleCompleteProject = (projectId: string) => {
    if (!canManage) {
      alert('완료 권한이 없습니다 (마스터 또는 5200 사용자 전용).');
      return;
    }
    const target = projects.find((p) => p.id === projectId);
    if (!target) return;

    if (confirm(`[${target.model}] ${target.machineType} 프로젝트를 완료 목록으로 이동하시겠습니까?`)) {
      const now = new Date().toISOString();
      const updated = projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              status: 'completed' as const,
              completedAt: now,
              completedBy: currentUserInitials,
              updatedAt: now,
            }
          : p
      );
      onUpdateProjects(updated);
    }
  };

  // Restore Project from Completed or Trash to Active
  const handleRestoreProject = (projectId: string) => {
    const now = new Date().toISOString();
    const updated = projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            status: 'active' as const,
            completedAt: undefined,
            deletedAt: undefined,
            updatedAt: now,
          }
        : p
      );
    onUpdateProjects(updated);
  };

  // Move Project to Trash (3-day retention)
  const handleMoveProjectToTrash = (projectId: string) => {
    if (!canManage) {
      alert('삭제 권한이 없습니다.');
      return;
    }
    const target = projects.find((p) => p.id === projectId);
    if (!target) return;

    if (confirm(`[${target.model}] 프로젝트를 휴지통으로 이동하시겠습니까? (3일 후 자동 영구삭제)`)) {
      const now = new Date().toISOString();
      // Mark project as trash
      const updatedProjects = projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              status: 'trash' as const,
              deletedAt: now,
              updatedAt: now,
            }
          : p
      );
      // Also mark all its files as trash
      const updatedFiles = files.map((f) =>
        f.projectId === projectId
          ? {
              ...f,
              status: 'trash' as const,
              deletedAt: now,
              updatedAt: now,
            }
          : f
      );

      onUpdateProjects(updatedProjects);
      onUpdateFiles(updatedFiles);
    }
  };

  // Move single file to Trash
  const handleMoveFileToTrash = (fileId: string) => {
    if (!canManage) {
      alert('파일 삭제 권한이 없습니다.');
      return;
    }
    const target = files.find((f) => f.id === fileId);
    if (!target) return;

    if (confirm(`"${target.fileName}" 파일을 휴지통으로 이동하시겠습니까?`)) {
      const now = new Date().toISOString();
      const updated = files.map((f) =>
        f.id === fileId
          ? {
              ...f,
              status: 'trash' as const,
              deletedAt: now,
              updatedAt: now,
            }
          : f
      );
      onUpdateFiles(updated);
    }
  };

  // Restore file from Trash
  const handleRestoreFile = (fileId: string) => {
    const updated = files.map((f) =>
      f.id === fileId
        ? {
            ...f,
            status: 'active' as const,
            deletedAt: undefined,
            updatedAt: new Date().toISOString(),
          }
        : f
    );
    onUpdateFiles(updated);
  };

  // Permanent Delete File immediately
  const handlePermanentlyDeleteFile = async (fileId: string) => {
    const target = files.find((f) => f.id === fileId);
    if (!target) return;

    if (confirm(`"${target.fileName}" 파일을 클라우드 및 시스템에서 영구 삭제하시겠습니까?`)) {
      await deleteFileFromServer(target.folder, target.fileName, target.storagePath).catch(() => {});
      const updated = files.filter((f) => f.id !== fileId);
      onUpdateFiles(updated);
    }
  };

  // Permanent Delete Project immediately
  const handlePermanentlyDeleteProject = async (projectId: string) => {
    if (confirm('프로젝트 및 연결된 모든 파일을 클라우드에서 영구 삭제하시겠습니까?')) {
      const projectFiles = files.filter((f) => f.projectId === projectId);
      for (const pf of projectFiles) {
        await deleteFileFromServer(pf.folder, pf.fileName, pf.storagePath).catch(() => {});
      }

      const updatedProjects = projects.filter((p) => p.id !== projectId);
      const updatedFiles = files.filter((f) => f.projectId !== projectId);

      onUpdateProjects(updatedProjects);
      onUpdateFiles(updatedFiles);
    }
  };

  // Empty entire Trash bin
  const handleEmptyTrash = async () => {
    if (confirm('휴지통의 모든 항목을 즉시 클라우드 및 DB에서 영구 삭제하시겠습니까?')) {
      for (const tf of trashedFiles) {
        await deleteFileFromServer(tf.folder, tf.fileName, tf.storagePath).catch(() => {});
      }
      const updatedFiles = files.filter((f) => f.status !== 'trash');
      const updatedProjects = projects.filter((p) => p.status !== 'trash');
      onUpdateFiles(updatedFiles);
      onUpdateProjects(updatedProjects);
    }
  };

  // Upload multiple files & handle automatic overwriting
  const handleUploadFiles = async (projectId: string, uploadedFilesList: File[]) => {
    let currentFilesState = [...files];

    for (const rawFile of uploadedFilesList) {
      const { infoFile } = await uploadSingleFile(rawFile, projectId, currentUserInitials);

      // Check if file with same name already exists in this project -> AUTO OVERWRITE
      const existingIdx = currentFilesState.findIndex(
        (f) => f.projectId === projectId && f.fileName.toLowerCase() === rawFile.name.toLowerCase() && f.status !== 'trash'
      );

      if (existingIdx >= 0) {
        const oldFile = currentFilesState[existingIdx];
        infoFile.version = (oldFile.version || 1) + 1;
        infoFile.id = oldFile.id; // Maintain ID
        currentFilesState[existingIdx] = infoFile;
        console.log(`[Auto-Overwrite] File "${rawFile.name}" updated to v${infoFile.version}`);
      } else {
        currentFilesState = [infoFile, ...currentFilesState];
      }
    }

    onUpdateFiles(currentFilesState);
    // Ensure the project is expanded
    setExpandedProjectIds((prev) => ({ ...prev, [projectId]: true }));
  };

  const activeCount = projects.filter((p) => p.status === 'active').length;
  const completedCount = projects.filter((p) => p.status === 'completed').length;
  const trashCount = projects.filter((p) => p.status === 'trash').length + trashedFiles.length;

  return (
    <div className="space-y-4 pb-16">
      {/* Mobile-Optimized Top Action Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                INFO
              </span>
              <h1 className="text-lg sm:text-xl font-bold text-slate-100">
                도면 및 자료 열람 센터
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              현장 휴대폰 최적화 • PDF 도면, 엑셀 사양서, 사진 실시간 열람
            </p>
          </div>

          {/* Top Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Cloud Sync Button */}
            <button
              onClick={handleSyncCloudflareR2}
              disabled={isSyncingR2}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 border border-slate-700 text-xs sm:text-sm font-semibold transition-all whitespace-nowrap active:scale-95 disabled:opacity-50"
              title="Cloudflare R2 스토리지의 파일과 동기화"
            >
              <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isSyncingR2 ? 'animate-spin text-sky-400' : 'text-sky-400'}`} />
              <span>{isSyncingR2 ? '동기화 중...' : '클라우드 동기화'}</span>
            </button>

            {canManage && (
              <>
                <button
                  onClick={() => {
                    setTargetUploadProjectId(undefined);
                    setIsUploadModalOpen(true);
                  }}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-semibold transition-all shadow-md shadow-sky-600/20 whitespace-nowrap active:scale-95"
                >
                  <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>업로드</span>
                </button>

                <button
                  onClick={() => {
                    setEditingProject(null);
                    setIsProjectModalOpen(true);
                  }}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs sm:text-sm font-semibold transition-all whitespace-nowrap active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                  <span>새 프로젝트</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sync Notification Banner */}
        {syncNotice && (
          <div className="mt-3 p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-sky-400 shrink-0" />
              <span>{syncNotice}</span>
            </div>
            <button onClick={() => setSyncNotice('')} className="text-slate-400 hover:text-white font-bold ml-2">✕</button>
          </div>
        )}

        {/* Tab Navigation & Search Row */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={() => setActiveTab('active')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'active'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <span>🚀 진행중 프로젝트</span>
              <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-900/50 font-mono">
                {activeCount}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('completed')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'completed'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>완료 목록</span>
              <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-slate-900/50 font-mono">
                {completedCount}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('trash')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === 'trash'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>휴지통</span>
              {trashCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[11px] bg-rose-950 text-rose-300 font-mono">
                  {trashCount}
                </span>
              )}
            </button>
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="모델명, 기종, 파일명 검색..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}

      {/* TRASH VIEW */}
      {activeTab === 'trash' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                휴지통에 보관된 항목은 <strong>3일 후 자동으로 영구 삭제</strong>됩니다.
              </span>
            </div>
            {trashCount > 0 && canManage && (
              <button
                onClick={handleEmptyTrash}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold flex items-center justify-center gap-1.5 shrink-0 transition-colors shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                휴지통 비우기
              </button>
            )}
          </div>

          {filteredProjects.length === 0 && trashedFiles.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl">
              <Trash2 className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">휴지통이 비어 있습니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Trashed Projects */}
              {filteredProjects.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-bold text-xs">
                        {p.model}
                      </span>
                      <span className="font-semibold text-slate-200 text-sm">{p.machineType}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      삭제일: {p.deletedAt ? format(parseISO(p.deletedAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestoreProject(p.id)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-semibold flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      복원
                    </button>
                    {canManage && (
                      <button
                        onClick={() => handlePermanentlyDeleteProject(p.id)}
                        className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        영구삭제
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Trashed Files */}
              {trashedFiles.map((f) => (
                <div
                  key={f.id}
                  className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-slate-800 text-slate-400">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-200 break-all leading-snug">{f.fileName}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {formatFileSize(f.fileSize)} • 삭제일:{' '}
                        {f.deletedAt ? format(parseISO(f.deletedAt), 'yyyy-MM-dd HH:mm') : '-'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleRestoreFile(f.id)}
                      className="px-2.5 py-1 rounded-md bg-slate-800 text-sky-400 hover:bg-slate-700 text-xs flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      복원
                    </button>
                    {canManage && (
                      <button
                        onClick={() => handlePermanentlyDeleteFile(f.id)}
                        className="px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white text-xs flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        영구삭제
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ACTIVE & COMPLETED PROJECTS VIEW */}
      {activeTab !== 'trash' && (
        <div className="space-y-4">
          {filteredProjects.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl">
              <FolderOpen className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-300">
                {activeTab === 'completed'
                  ? '완료된 프로젝트가 없습니다.'
                  : '진행 중인 프로젝트가 없습니다.'}
              </h3>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                {activeTab === 'completed'
                  ? '진행 중 프로젝트에서 "완료" 처리하면 이곳에 보관됩니다.'
                  : '상단의 "+ 새 프로젝트" 또는 "업로드" 버튼을 눌러 시작하세요.'}
              </p>
              {activeTab === 'active' && canManage && (
                <button
                  onClick={() => setIsProjectModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-md shadow-sky-600/20"
                >
                  <Plus className="w-4 h-4" />
                  새 프로젝트 만들기
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredProjects.map((project) => {
                const projectFiles = activeFilesByProject[project.id] || [];
                const pdfCount = projectFiles.filter((f) => f.fileType === 'pdf').length;
                const excelCount = projectFiles.filter((f) => f.fileType === 'excel').length;
                const imageCount = projectFiles.filter((f) => f.fileType === 'image').length;
                const isExpanded = expandedProjectIds[project.id] ?? true; // Default expanded for quick mobile viewing

                return (
                  <div
                    key={project.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg transition-all hover:border-slate-700"
                  >
                    {/* Project Card Header (Click to Open / Expand) */}
                    <div className="p-4 sm:p-5 select-none">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Model & Machine Type Header (Requirement #12: 모델과 기종이 표시된 부분을 클릭해서 실행하면 업로드된 파일이 보이게) */}
                        <div
                          onClick={() => toggleProjectExpand(project.id)}
                          className="flex-1 cursor-pointer group"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Model Highlight */}
                            <span className="px-3 py-1 rounded-xl bg-sky-500/20 text-sky-300 font-black text-sm sm:text-base border border-sky-500/30 group-hover:bg-sky-500/30 transition-colors">
                              {project.model}
                            </span>

                            {/* Machine Type */}
                            <span className="text-base sm:text-lg font-bold text-slate-100 group-hover:text-sky-300 transition-colors flex items-center gap-1">
                              {project.machineType}
                            </span>

                            {/* D-Day badge */}
                            {project.shipmentDate && getDDayBadge(project.shipmentDate)}

                            {/* Status badge if completed */}
                            {project.status === 'completed' && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-semibold text-xs border border-emerald-500/30">
                                완료됨 ({project.completedBy || '마스터'})
                              </span>
                            )}
                          </div>

                          {/* Details line: 선적날짜, 생산수량, 비고 (Requirement #4: 선적일을 수정하면 이전 선적일도 표시되고, 수정된 것은 빨강색으로 표시) */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400 mt-2">
                            {project.shipmentDate && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span>선적일:</span>
                                {project.previousShipmentDates && project.previousShipmentDates.length > 0 && (
                                  <div className="flex items-center gap-1">
                                    {project.previousShipmentDates.map((prevD, pIdx) => (
                                      <span
                                        key={pIdx}
                                        className="text-slate-500 line-through font-mono text-[11px]"
                                      >
                                        {prevD}
                                      </span>
                                    ))}
                                    <span className="text-slate-600">→</span>
                                  </div>
                                )}
                                <strong
                                  className={`font-mono ${
                                    project.previousShipmentDates && project.previousShipmentDates.length > 0
                                      ? 'text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20'
                                      : 'text-slate-200'
                                  }`}
                                >
                                  {project.shipmentDate}
                                </strong>
                              </div>
                            )}

                            {project.productionQty && (
                              <div className="flex items-center gap-1">
                                <Hash className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span>생산수량: <strong className="text-emerald-400">{project.productionQty}</strong></span>
                              </div>
                            )}

                            {project.notes && (
                              <div className="flex items-center gap-1 text-slate-400">
                                <span>비고: {project.notes}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card Top Actions: Complete, Upload, Expand */}
                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                          {/* File count badges */}
                          <div className="flex items-center gap-1 text-xs bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700/60">
                            <span title="PDF 도면" className="flex items-center gap-0.5 text-red-400 font-medium">
                              📄 {pdfCount}
                            </span>
                            <span className="text-slate-600">|</span>
                            <span title="엑셀 사양서" className="flex items-center gap-0.5 text-emerald-400 font-medium">
                              📊 {excelCount}
                            </span>
                            <span className="text-slate-600">|</span>
                            <span title="현장 사진" className="flex items-center gap-0.5 text-sky-400 font-medium">
                              🖼️ {imageCount}
                            </span>
                          </div>

                          {/* Complete Button (Requirement #11: 완료버튼을 추가해서 완료실행하면 완료 목록으로 이동저장되게 이는 마스터 또는 5200사용자만 가능하게) */}
                          {project.status === 'active' && canManage && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCompleteProject(project.id);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 transition-all shadow-sm shadow-emerald-600/20 active:scale-95"
                              title="프로젝트 완료 처리"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>완료</span>
                            </button>
                          )}

                          {project.status === 'completed' && canManage && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRestoreProject(project.id);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs font-semibold flex items-center gap-1 transition-colors"
                              title="진행중으로 복원"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>진행중 전환</span>
                            </button>
                          )}

                          {/* Quick Upload directly to this project */}
                          {canManage && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTargetUploadProjectId(project.id);
                                setIsUploadModalOpen(true);
                              }}
                              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                              title="이 프로젝트에 파일 추가"
                            >
                              <Upload className="w-4 h-4" />
                            </button>
                          )}

                          {/* Edit / Trash menu for Master */}
                          {canManage && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingProject(project);
                                  setIsProjectModalOpen(true);
                                }}
                                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
                                title="프로젝트 정보 수정"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveProjectToTrash(project.id);
                                }}
                                className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                                title="휴지통으로 이동"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          {/* Toggle Expand Arrow */}
                          <button
                            onClick={() => toggleProjectExpand(project.id)}
                            className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-200"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expandable File List Section */}
                    {isExpanded && (
                      <div className="bg-slate-950/60 border-t border-slate-800/80 p-3 sm:p-4">
                        {projectFiles.length === 0 ? (
                          <div className="p-6 text-center rounded-xl bg-slate-900/40 border border-slate-800/50">
                            <p className="text-xs text-slate-400 mb-2">
                              등록된 도면이나 파일이 없습니다.
                            </p>
                            {canManage && (
                              <button
                                onClick={() => {
                                  setTargetUploadProjectId(project.id);
                                  setIsUploadModalOpen(true);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                도면 / 파일 추가
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {projectFiles.map((file) => (
                              <div
                                key={file.id}
                                onClick={() => setViewingFile(file)}
                                className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-sky-500/60 hover:bg-slate-850 cursor-pointer transition-all flex items-center justify-between gap-2.5 group shadow-sm"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {/* Thumbnail or File Icon */}
                                  <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-slate-700/60">
                                    {file.fileType === 'pdf' && (
                                      <FileText className="w-5 h-5 text-red-400" />
                                    )}
                                    {file.fileType === 'excel' && (
                                      <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                                    )}
                                    {file.fileType === 'image' && (
                                      file.previewData?.thumbnailUrl ? (
                                        <img
                                          src={file.previewData.thumbnailUrl}
                                          alt={file.fileName}
                                          className="w-full h-full object-cover"
                                        />
                                      ) : (
                                        <ImageIcon className="w-5 h-5 text-sky-400" />
                                      )
                                    )}
                                    {file.fileType === 'other' && (
                                      <FileText className="w-5 h-5 text-slate-400" />
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p
                                        className="font-semibold text-xs sm:text-sm text-slate-200 group-hover:text-sky-300 transition-colors break-all leading-snug"
                                        title={file.fileName}
                                      >
                                        {file.fileName}
                                      </p>
                                      {file.version && file.version > 1 && (
                                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                                          v{file.version} 수정됨
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                                      <span className="font-mono">{formatFileSize(file.fileSize)}</span>
                                      <span>•</span>
                                      <span>{file.uploadedBy}</span>
                                      {file.updatedAt && (
                                        <>
                                          <span>•</span>
                                          <span className={file.version && file.version > 1 ? 'text-amber-400 font-medium' : 'text-slate-400'}>
                                            {file.version && file.version > 1 ? '수정: ' : '등록: '}
                                            {(() => {
                                              try {
                                                const d = typeof file.updatedAt === 'string' ? parseISO(file.updatedAt) : new Date(file.updatedAt);
                                                return format(d, 'yyyy-MM-dd HH:mm');
                                              } catch {
                                                return file.updatedAt.substring(0, 10);
                                              }
                                            })()}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Right action buttons */}
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewingFile(file);
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                                    title="열람"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>

                                  {canManage && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMoveFileToTrash(file.id);
                                      }}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                                      title="휴지통으로 삭제"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODALS */}
      <FileViewerModal
        file={viewingFile}
        onClose={() => setViewingFile(null)}
        canDownload={canManage || isMaster}
      />

      <ProjectModal
        isOpen={isProjectModalOpen}
        projectToEdit={editingProject}
        onClose={() => {
          setIsProjectModalOpen(false);
          setEditingProject(null);
        }}
        onSave={handleSaveProject}
      />

      <UploadModal
        isOpen={isUploadModalOpen}
        projects={projects}
        existingFiles={files}
        defaultProjectId={targetUploadProjectId}
        onClose={() => {
          setIsUploadModalOpen(false);
          setTargetUploadProjectId(undefined);
        }}
        onUploadComplete={handleUploadFiles}
        onCreateNewProjectRequested={() => {
          setEditingProject(null);
          setIsProjectModalOpen(true);
        }}
      />
    </div>
  );
};
