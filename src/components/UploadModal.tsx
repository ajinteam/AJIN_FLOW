import React, { useState, useRef } from 'react';
import { InfoProject, InfoFile } from '../types';
import { Upload, X, FileText, FileSpreadsheet, Image as ImageIcon, CheckCircle, AlertCircle, Sparkles, Folder, ArrowRight } from 'lucide-react';
import { compressImage, formatFileSize } from '../lib/imageCompressor';
import { detectFileTypeAndFolder } from '../lib/api';

interface UploadModalProps {
  isOpen: boolean;
  projects: InfoProject[];
  files?: InfoFile[];
  defaultProjectId?: string;
  onClose: () => void;
  onUploadComplete: (projectId: string, files: File[]) => Promise<void>;
  onCreateNewProjectRequested: () => void;
}

interface StagedFile {
  file: File;
  originalSize: number;
  compressedSize: number;
  fileType: 'pdf' | 'excel' | 'image' | 'other';
  folder: 'info-pdf' | 'info-excel' | 'info-image';
  previewUrl?: string;
  isCompressing: boolean;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  projects,
  files = [],
  defaultProjectId,
  onClose,
  onUploadComplete,
  onCreateNewProjectRequested,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(defaultProjectId || '');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (defaultProjectId) {
      setSelectedProjectId(defaultProjectId);
    } else if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [defaultProjectId, projects]);

  React.useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ modal: 'upload' }, '');
    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFileSelection = async (selectedFileList: FileList | null) => {
    if (!selectedFileList || selectedFileList.length === 0) return;
    setError('');

    const newStaged: StagedFile[] = [];
    for (let i = 0; i < selectedFileList.length; i++) {
      const originalFile = selectedFileList[i];
      const { fileType, folder } = detectFileTypeAndFolder(originalFile);

      let processedFile = originalFile;
      let compressedSize = originalFile.size;
      let previewUrl = '';

      if (fileType === 'image') {
        try {
          const compResult = await compressImage(originalFile, 1920, 0.82);
          processedFile = compResult.file;
          compressedSize = compResult.compressedSize;
          previewUrl = compResult.dataUrl;
        } catch (e) {
          console.warn('Image compression fallback:', e);
        }
      }

      newStaged.push({
        file: processedFile,
        originalSize: originalFile.size,
        compressedSize,
        fileType,
        folder,
        previewUrl,
        isCompressing: false,
      });
    }

    setStagedFiles((prev) => [...prev, ...newStaged]);
  };

  const handleRemoveFile = (index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadSubmit = async () => {
    if (!selectedProjectId) {
      setError('업로드할 대상 프로젝트를 선택해 주세요.');
      return;
    }
    if (stagedFiles.length === 0) {
      setError('업로드할 파일을 선택해 주세요.');
      return;
    }

    setIsUploading(true);
    setError('');
    try {
      const filesToUpload = stagedFiles.map((s) => s.file);
      await onUploadComplete(selectedProjectId, filesToUpload);
      setStagedFiles([]);
      onClose();
    } catch (err: any) {
      console.error('Upload failed:', err);
      setError('파일 업로드 중 오류가 발생했습니다: ' + (err?.message || '다시 시도해 주세요.'));
    } finally {
      setIsUploading(false);
    }
  };

  const activeProjects = projects.filter((p) => p.status === 'active');
  const totalOriginalSize = stagedFiles.reduce((acc, f) => acc + f.originalSize, 0);
  const totalCompressedSize = stagedFiles.reduce((acc, f) => acc + f.compressedSize, 0);
  const totalSavedPercent = totalOriginalSize > 0 
    ? Math.max(0, Math.round(((totalOriginalSize - totalCompressedSize) / totalOriginalSize) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-100 text-base">파일 업로드</h2>
              <p className="text-xs text-slate-400">PDF, 엑셀, 사진을 등록합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Project Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-sky-400" />
                업로드 대상 프로젝트 <span className="text-rose-400">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCreateNewProjectRequested();
                }}
                className="text-xs text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-1"
              >
                + 새 프로젝트 등록
              </button>
            </div>

            {activeProjects.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 text-center">
                <p className="text-xs text-slate-400 mb-2">등록된 진행 중 프로젝트가 없습니다.</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onCreateNewProjectRequested();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                >
                  프로젝트 먼저 생성하기
                </button>
              </div>
            ) : (
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                disabled={isUploading}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 [color-scheme:dark]"
              >
                <option value="" disabled>
                  프로젝트를 선택해 주세요
                </option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.model}] {p.machineType} (선적: {p.shipmentDate || '미정'}, 수량: {p.productionQty || 0})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 2. Drag & Drop File Picker Zone */}
          <div>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.gif"
              className="hidden"
              onChange={(e) => handleFileSelection(e.target.files)}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-sky-500/70 bg-slate-800/40 hover:bg-slate-800/70 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
            >
              <div className="p-3 rounded-full bg-slate-800 text-slate-400 group-hover:text-sky-400 group-hover:scale-110 transition-all">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  클릭하여 파일 선택 또는 여기로 드래그
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  (.pdf) • (.xlsx, .xls) • (.jpg, .png)
                </p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                  <Sparkles className="w-3 h-3" />
                  사진 자동 용량 최적화 (초고속 업로드)
                </span>
                <span className="inline-flex items-center text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700">
                  동일 파일명 자동 덮어쓰기 지원
                </span>
              </div>
            </div>
          </div>

          {/* 3. Staged Files List */}
          {stagedFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>선택된 파일 ({stagedFiles.length}개)</span>
                {totalSavedPercent > 0 && (
                  <span className="text-emerald-400 font-medium">
                    사진 압축 절감: {formatFileSize(totalOriginalSize)} → {formatFileSize(totalCompressedSize)} (-{totalSavedPercent}%)
                  </span>
                )}
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {stagedFiles.map((sf, idx) => {
                  const existingFile = files.find(
                    (f) =>
                      f.projectId === selectedProjectId &&
                      f.fileName.toLowerCase() === sf.file.name.toLowerCase() &&
                      f.status !== 'trash'
                  );
                  const nextVersion = existingFile ? (existingFile.version || 1) + 1 : 1;

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/70 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div className="p-1.5 rounded-lg bg-slate-700/80 shrink-0">
                          {sf.fileType === 'pdf' && <FileText className="w-4 h-4 text-red-400" />}
                          {sf.fileType === 'excel' && <FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
                          {sf.fileType === 'image' && <ImageIcon className="w-4 h-4 text-sky-400" />}
                          {sf.fileType === 'other' && <FileText className="w-4 h-4 text-slate-400" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-slate-200 break-all leading-snug">{sf.file.name}</p>
                            {existingFile ? (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold font-mono text-[10px] border border-amber-500/30 shrink-0">
                                덮어쓰기 (V{nextVersion})
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-bold font-mono text-[10px] border border-sky-500/30 shrink-0">
                                신규 (V1)
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                            <span className="font-mono">{formatFileSize(sf.compressedSize)}</span>
                            <span>•</span>
                            <span className="text-slate-400">폴더: {sf.folder}</span>
                            {sf.originalSize > sf.compressedSize && (
                              <>
                                <span>•</span>
                                <span className="text-emerald-400 font-semibold">
                                  -{Math.round(((sf.originalSize - sf.compressedSize) / sf.originalSize) * 100)}% 압축
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveFile(idx)}
                        disabled={isUploading}
                        className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                        title="제거"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800 bg-slate-800/50 shrink-0">
          <div className="text-xs text-slate-400">
            Cloudflare R2 버킷 <code className="text-sky-400 font-mono">ajin-info-files</code>에 저장
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs md:text-sm font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleUploadSubmit}
              disabled={isUploading || stagedFiles.length === 0 || !selectedProjectId}
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs md:text-sm font-semibold transition-colors flex items-center gap-2 shadow-lg shadow-sky-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>업로드 중...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>{stagedFiles.length}개 파일 업로드 완료</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
