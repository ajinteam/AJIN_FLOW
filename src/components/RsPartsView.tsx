import React, { useState, useMemo, useRef } from 'react';
import {
  Search,
  Upload,
  FolderOpen,
  RefreshCw,
  Trash2,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  X,
  AlertTriangle,
  CheckCircle2,
  Cloud,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { RsPartFile } from '../types';
import { formatFileSize } from '../lib/imageCompressor';
import {
  deleteFileFromServer,
  detectFileTypeAndFolder,
  getBaseFileName,
  syncRsPartsFromR2,
  uploadRsPartFile,
} from '../lib/api';

interface RsPartsViewProps {
  files: RsPartFile[];
  currentUserInitials: string;
  canManage: boolean;
  onUpdateFiles: (files: RsPartFile[]) => void;
  onRefresh: () => Promise<void>;
}

interface StagedRsFile {
  file: File;
  fileType: 'pdf' | 'excel' | 'image' | 'other';
  willOverwrite: boolean;
}

export const RsPartsView: React.FC<RsPartsViewProps> = ({
  files,
  currentUserInitials,
  canManage,
  onUpdateFiles,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [exactMatchOnly, setExactMatchOnly] = useState<boolean>(true);
  const [showAllFiles, setShowAllFiles] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isSyncingR2, setIsSyncingR2] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [stagedFiles, setStagedFiles] = useState<StagedRsFile[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<RsPartFile | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const showTempMessage = (type: 'info' | 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Search logic:
  // If searchQuery is e.g. "HO-26":
  // - Exact match checks full fileName ("ho-26.pdf") OR baseName without extension ("ho-26").
  // - When exactMatchOnly is true, returns ONLY files matching "HO-26" exactly (e.g. HO-26.pdf, HO-26.jpg),
  //   excluding HO-260.pdf or HO-26-A.pdf.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { exact: [] as RsPartFile[], partial: [] as RsPartFile[] };

    const exact: RsPartFile[] = [];
    const partial: RsPartFile[] = [];

    for (const f of files) {
      const fullLower = f.fileName.toLowerCase();
      const baseLower = (f.baseName || getBaseFileName(f.fileName)).toLowerCase();

      if (fullLower === q || baseLower === q) {
        exact.push(f);
      } else if (fullLower.includes(q) || baseLower.includes(q)) {
        partial.push(f);
      }
    }

    return { exact, partial };
  }, [files, searchQuery]);

  const displayedSearchFiles = exactMatchOnly
    ? searchResults.exact
    : [...searchResults.exact, ...searchResults.partial];

  const sortedAllFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.uploadedAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.uploadedAt || 0).getTime();
      return timeB - timeA;
    });
  }, [files]);

  const getNewWindowUrl = (fileId: string) => {
    return `${window.location.origin}/?rsView=${encodeURIComponent(fileId)}`;
  };

  const handleRefreshClick = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
      showTempMessage('success', '최신 RS Parts 목록을 새로고침했습니다.');
    } catch {
      showTempMessage('error', '새로고침 중 오류가 발생했습니다.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSyncR2Folder = async () => {
    if (!canManage || isSyncingR2) return;
    setIsSyncingR2(true);
    try {
      const res = await syncRsPartsFromR2();
      if (!res.configured) {
        showTempMessage('error', 'Cloudflare R2 환경 설정이 연결되지 않았습니다.');
        return;
      }
      const existingPaths = new Set(files.map((f) => f.storagePath));
      const existingNames = new Set(files.map((f) => f.fileName.toLowerCase()));
      const newItems = res.objects.filter(
        (obj) => !existingPaths.has(obj.key) && !existingNames.has(obj.fileName.toLowerCase())
      );

      if (newItems.length === 0) {
        showTempMessage('info', `RS-pdf 폴더의 모든 파일(${res.count}개)이 이미 동기화되어 있습니다.`);
        return;
      }

      const now = new Date().toISOString();
      const mapped: RsPartFile[] = newItems.map((obj) => ({
        id: `rs_r2_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        fileName: obj.fileName,
        baseName: getBaseFileName(obj.fileName),
        fileType: obj.fileType,
        folder: 'RS-pdf',
        storagePath: obj.key,
        fileUrl: obj.url,
        fileSize: obj.size,
        mimeType:
          obj.fileType === 'pdf'
            ? 'application/pdf'
            : obj.fileType === 'excel'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'image/jpeg',
        uploadedBy: 'Cloudflare_R2',
        uploadedAt: obj.lastModified || now,
        updatedAt: obj.lastModified || now,
        version: 1,
      }));

      onUpdateFiles([...mapped, ...files]);
      showTempMessage('success', `RS-pdf 폴더에서 ${mapped.length}개 파일을 불러왔습니다.`);
    } catch {
      showTempMessage('error', 'RS-pdf 폴더 동기화에 실패했습니다.');
    } finally {
      setIsSyncingR2(false);
    }
  };

  // Upload modal handlers
  const resetUploadModal = () => {
    setStagedFiles([]);
    setUploadError('');
    setUploadProgressText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const closeUploadModal = () => {
    if (isUploading) return;
    resetUploadModal();
    setIsUploadOpen(false);
  };

  const handleStageFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploadError('');

    const added: StagedRsFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const { fileType } = detectFileTypeAndFolder(f);
      const willOverwrite = files.some(
        (existing) => existing.fileName.toLowerCase() === f.name.toLowerCase()
      );
      added.push({ file: f, fileType, willOverwrite });
    }

    setStagedFiles((prev) => {
      const combined = [...prev];
      for (const item of added) {
        const dupIdx = combined.findIndex(
          (s) => s.file.name.toLowerCase() === item.file.name.toLowerCase()
        );
        if (dupIdx !== -1) {
          combined[dupIdx] = item;
        } else {
          combined.push(item);
        }
      }
      return combined;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveStaged = (idx: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUploadSubmit = async () => {
    if (!canManage) {
      setUploadError('업로드 권한이 없습니다.');
      return;
    }
    if (stagedFiles.length === 0) {
      setUploadError('업로드할 파일을 선택해 주세요.');
      return;
    }

    setIsUploading(true);
    setUploadError('');

    try {
      let updatedList = [...files];
      let overwrittenCount = 0;
      let createdCount = 0;

      for (let i = 0; i < stagedFiles.length; i++) {
        const { file } = stagedFiles[i];
        setUploadProgressText(`(${i + 1}/${stagedFiles.length}) ${file.name} 업로드 중...`);

        const uploadedRecord = await uploadRsPartFile(file, currentUserInitials);
        const existingIndex = updatedList.findIndex(
          (existing) => existing.fileName.toLowerCase() === file.name.toLowerCase()
        );

        if (existingIndex !== -1) {
          const oldRecord = updatedList[existingIndex];
          // Remove old R2 object cleanly so only latest version stays
          if (oldRecord.storagePath && oldRecord.storagePath !== uploadedRecord.storagePath) {
            await deleteFileFromServer(oldRecord.folder, oldRecord.fileName, oldRecord.storagePath).catch(() => {});
          }
          const nextVersion = (oldRecord.version || 1) + 1;
          const mergedRecord: RsPartFile = {
            ...uploadedRecord,
            id: oldRecord.id,
            uploadedAt: oldRecord.uploadedAt || uploadedRecord.uploadedAt,
            version: nextVersion,
          };
          updatedList.splice(existingIndex, 1);
          updatedList.unshift(mergedRecord);
          overwrittenCount++;
        } else {
          updatedList.unshift(uploadedRecord);
          createdCount++;
        }
      }

      onUpdateFiles(updatedList);
      resetUploadModal();
      setIsUploadOpen(false);

      if (overwrittenCount > 0 && createdCount > 0) {
        showTempMessage(
          'success',
          `신규 ${createdCount}건 등록, 동일 파일명 ${overwrittenCount}건 최신 파일로 덮어쓰기 완료`
        );
      } else if (overwrittenCount > 0) {
        showTempMessage('success', `동일 파일명 ${overwrittenCount}건을 최신 파일로 덮어썼습니다.`);
      } else {
        showTempMessage('success', `${createdCount}개 파일을 RS-pdf 폴더에 업로드했습니다.`);
      }
    } catch (err: any) {
      console.error('RS Parts upload error:', err);
      setUploadError(err?.message || '파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setIsUploading(false);
      setUploadProgressText('');
    }
  };

  // Delete confirmation handler
  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canManage || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteFileFromServer(
        deleteTarget.folder,
        deleteTarget.fileName,
        deleteTarget.storagePath
      ).catch(() => {});
      const nextList = files.filter((f) => f.id !== deleteTarget.id);
      onUpdateFiles(nextList);
      showTempMessage('success', `"${deleteTarget.fileName}" 파일이 삭제되었습니다.`);
      setDeleteTarget(null);
    } catch {
      showTempMessage('error', '파일 삭제 중 오류가 발생했습니다.');
    } finally {
      setIsDeleting(false);
    }
  };

  const renderFileIcon = (fileType: RsPartFile['fileType']) => {
    if (fileType === 'pdf') return <FileText className="w-5 h-5 text-red-400 shrink-0" />;
    if (fileType === 'excel') return <FileSpreadsheet className="w-5 h-5 text-emerald-400 shrink-0" />;
    if (fileType === 'image') return <ImageIcon className="w-5 h-5 text-sky-400 shrink-0" />;
    return <FileText className="w-5 h-5 text-slate-400 shrink-0" />;
  };

  const renderFileRow = (file: RsPartFile, allowDelete: boolean) => {
    const viewerHref = getNewWindowUrl(file.id);
    const formattedDate = file.updatedAt
      ? format(parseISO(file.updatedAt), 'yyyy-MM-dd HH:mm')
      : file.uploadedAt
      ? format(parseISO(file.uploadedAt), 'yyyy-MM-dd HH:mm')
      : '-';

    return (
      <div
        key={file.id}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-slate-900 hover:bg-slate-800/80 border border-slate-800 rounded-xl transition-colors"
      >
        <a
          href={viewerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 min-w-0 flex-1 group"
          title="새 창에서 열람 (인쇄 및 다운로드 가능)"
        >
          <div className="p-2 rounded-lg bg-slate-800 border border-slate-700/80 group-hover:border-sky-500/50 transition-colors shrink-0">
            {renderFileIcon(file.fileType)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-100 group-hover:text-sky-400 transition-colors truncate">
                {file.fileName}
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0" />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-0.5 tabular-nums">
              <span>{formatFileSize(file.fileSize)}</span>
              <span aria-hidden="true">·</span>
              <span>{formattedDate}</span>
              <span aria-hidden="true">·</span>
              <span>등록: {file.uploadedBy}</span>
              {file.version && file.version > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-400 font-medium">V{file.version} 최신본</span>
                </>
              )}
            </div>
          </div>
        </a>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <a
            href={viewerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>새 창 열람</span>
          </a>

          {allowDelete && canManage && (
            <button
              type="button"
              onClick={() => setDeleteTarget(file)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/20 text-slate-300 hover:text-rose-400 border border-slate-700 hover:border-rose-500/40 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              title="파일 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>삭제</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Main Header & Controls Card */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-100">
              RS Parts 도면 · 부품 자료실
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 tabular-nums">
              등록 파일 {files.length}건 · 선택 시 새 창 열람 및 인쇄·다운로드 지원
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  resetUploadModal();
                  setIsUploadOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-4 h-4" />
                <span>파일 업로드</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowAllFiles((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                showAllFiles
                  ? 'bg-sky-600 text-white border-sky-500'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              <FolderOpen className="w-4 h-4" />
              <span>전체파일 ({files.length})</span>
            </button>

            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>새로고침</span>
            </button>
          </div>
        </div>

        {/* Status Banner */}
        {statusMessage && (
          <div
            className={`mt-4 px-4 py-2.5 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : statusMessage.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-sky-500/10 border-sky-500/30 text-sky-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Search Bar */}
        <div className="mt-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="찾으실 부품/파일명을 입력하세요 (예: HO-26)"
                className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-slate-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  title="검색어 지우기"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setExactMatchOnly(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  exactMatchOnly
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                파일명 일치만
              </button>
              <button
                type="button"
                onClick={() => setExactMatchOnly(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  !exactMatchOnly
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                포함 검색
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            예: <strong className="text-slate-200 font-mono">HO-26</strong> 입력 시 파일명이 정확히{' '}
            <strong className="text-slate-200 font-mono">HO-26</strong>인 파일만 불러옵니다. 같은 이름이 여러 개면 모두 표시됩니다.
          </p>
        </div>
      </section>

      {/* Search Results Section */}
      {searchQuery.trim() && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-100 tabular-nums">
              검색 결과 ({displayedSearchFiles.length}건)
            </h2>
            {exactMatchOnly && searchResults.partial.length > 0 && (
              <button
                type="button"
                onClick={() => setExactMatchOnly(false)}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium"
              >
                "{searchQuery.trim()}" 포함 파일 {searchResults.partial.length}건 함께 보기
              </button>
            )}
          </div>

          {displayedSearchFiles.length > 0 ? (
            <div className="space-y-2">
              {displayedSearchFiles.map((file) => renderFileRow(file, false))}
            </div>
          ) : (
            <div className="py-10 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
              <p className="text-sm text-slate-300 font-medium">
                "{searchQuery.trim()}"와 일치하는 파일이 없습니다.
              </p>
              {exactMatchOnly && searchResults.partial.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExactMatchOnly(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-semibold transition-colors"
                >
                  유사 파일명 {searchResults.partial.length}건 보기
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* All Files Section (Toggled by 전체파일 button) */}
      {showAllFiles && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-100 tabular-nums">
                전체파일 목록 ({sortedAllFiles.length}건)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Cloudflare R2 <span className="font-mono text-slate-300">RS-pdf</span> 폴더에 저장된 전체 파일입니다.
              </p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={handleSyncR2Folder}
                disabled={isSyncingR2}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition-colors disabled:opacity-60"
              >
                <Cloud className={`w-3.5 h-3.5 text-sky-400 ${isSyncingR2 ? 'animate-pulse' : ''}`} />
                <span>{isSyncingR2 ? '동기화 중...' : 'RS-pdf 폴더 동기화'}</span>
              </button>
            )}
          </div>

          {sortedAllFiles.length > 0 ? (
            <div className="space-y-2">
              {sortedAllFiles.map((file) => renderFileRow(file, true))}
            </div>
          ) : (
            <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl space-y-3">
              <p className="text-sm text-slate-400">등록된 RS Parts 파일이 아직 없습니다.</p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    resetUploadModal();
                    setIsUploadOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  <span>첫 파일 업로드</span>
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-800/50 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100">RS Parts 파일 업로드</h3>
                  <p className="text-xs text-slate-400">
                    Cloudflare <span className="font-mono text-slate-300">RS-pdf</span> 폴더에 저장 · 동일 파일명 자동 덮어쓰기
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeUploadModal}
                disabled={isUploading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {uploadError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {uploadError}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif"
                onChange={(e) => handleStageFiles(e.target.files)}
                className="hidden"
              />

              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!isUploading) handleStageFiles(e.dataTransfer.files);
                }}
                className="border-2 border-dashed border-slate-700 hover:border-blue-500 bg-slate-800/40 hover:bg-slate-800/70 rounded-2xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center gap-2"
              >
                <Upload className="w-7 h-7 text-slate-400" />
                <p className="text-sm font-medium text-slate-200">
                  클릭하여 파일 선택 또는 여기로 드래그
                </p>
                <p className="text-xs text-slate-400">
                  PDF, 엑셀, 사진 등 다중 선택 가능 · 같은 파일명은 최신 파일로 덮어씁니다
                </p>
              </div>

              {stagedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-400 tabular-nums">
                    선택된 파일 ({stagedFiles.length}개)
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    {stagedFiles.map((sf, idx) => (
                      <div
                        key={sf.file.name + idx}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {renderFileIcon(sf.fileType)}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-100 truncate">{sf.file.name}</p>
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 tabular-nums">
                              <span>{formatFileSize(sf.file.size)}</span>
                              {sf.willOverwrite && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-400 font-semibold">
                                    동일 파일명 존재 (최신으로 덮어쓰기)
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveStaged(idx)}
                          disabled={isUploading}
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-700 transition-colors"
                          title="제거"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isUploading && uploadProgressText && (
                <div className="text-xs text-sky-400 font-medium text-center">
                  {uploadProgressText}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-800/50 shrink-0">
              <button
                type="button"
                onClick={closeUploadModal}
                disabled={isUploading}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleUploadSubmit}
                disabled={isUploading || stagedFiles.length === 0}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {isUploading ? '업로드 중...' : `${stagedFiles.length}개 파일 업로드`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Warning Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-rose-500/40 rounded-2xl shadow-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-100">파일 영구 삭제 확인</h3>
              <p className="text-xs text-slate-300 leading-relaxed break-all">
                <strong className="text-rose-300">"{deleteTarget.fileName}"</strong> 파일을 정말 삭제하시겠습니까?
              </p>
              <p className="text-xs text-rose-400/90 font-medium">
                주의: 삭제하면 서버와 클라우드(RS-pdf)에서 영구 삭제되며 복구할 수 없습니다.
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {isDeleting ? '삭제 중...' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
