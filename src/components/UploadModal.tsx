import React, { useState, useRef } from 'react';
import { InfoProject, InfoFile } from '../types';
import {
  Upload,
  X,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Folder,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  Layers,
  RefreshCw,
} from 'lucide-react';
import { compressImage, formatFileSize } from '../lib/imageCompressor';
import { detectFileTypeAndFolder } from '../lib/api';
import { mergePdfFiles } from '../lib/pdfMerger';

interface UploadModalProps {
  isOpen: boolean;
  projects: InfoProject[];
  files?: InfoFile[];
  defaultProjectId?: string;
  onClose: () => void;
  onUploadComplete: (projectId: string, files: File[], isBundleAlbum?: boolean, albumTitle?: string) => Promise<void>;
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

  // Image album bundling state
  const [isBundleAlbum, setIsBundleAlbum] = useState<boolean>(true);
  const [albumTitle, setAlbumTitle] = useState<string>('');

  // PDF Merge state
  const [isMergePdf, setIsMergePdf] = useState<boolean>(true);
  const [mergedPdfTitle, setMergedPdfTitle] = useState<string>('');
  const [pdfOverwriteTarget, setPdfOverwriteTarget] = useState<string>('new'); // 'new' or existing fileName

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetAllFields = () => {
    setStagedFiles([]);
    setError('');
    setIsBundleAlbum(true);
    setAlbumTitle('');
    setIsMergePdf(true);
    setMergedPdfTitle('');
    setPdfOverwriteTarget('new');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleModalClose = () => {
    resetAllFields();
    onClose();
  };

  React.useEffect(() => {
    if (defaultProjectId) {
      setSelectedProjectId(defaultProjectId);
    } else if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [defaultProjectId, projects]);

  React.useEffect(() => {
    if (isOpen) {
      resetAllFields();
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ modal: 'upload' }, '');
    const handlePopState = () => {
      handleModalClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Existing PDF files in the selected project (for overwrite selector)
  const existingProjectPdfFiles = files.filter(
    (f) => f.projectId === selectedProjectId && f.fileType === 'pdf' && f.status !== 'trash'
  );

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

  const handleMoveFileOrder = (index: number, direction: 'up' | 'down') => {
    setStagedFiles((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
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
      const currentProject = projects.find((p) => p.id === selectedProjectId);
      const pdfStaged = stagedFiles.filter((s) => s.fileType === 'pdf');
      const nonPdfStaged = stagedFiles.filter((s) => s.fileType !== 'pdf');

      let finalFilesToUpload: File[] = [];

      // 1. Process PDF Files (Merge if requested and > 1)
      if (isMergePdf && pdfStaged.length > 1) {
        let finalPdfName = '';
        if (pdfOverwriteTarget !== 'new') {
          finalPdfName = pdfOverwriteTarget;
        } else if (mergedPdfTitle.trim()) {
          finalPdfName = mergedPdfTitle.trim();
        } else {
          const baseName = pdfStaged[0].file.name.replace(/\.[^/.]+$/, '');
          finalPdfName = `${baseName}_병합_${pdfStaged.length}P.pdf`;
        }

        const mergedFile = await mergePdfFiles(
          pdfStaged.map((s) => s.file),
          finalPdfName
        );
        finalFilesToUpload.push(mergedFile);
      } else if (pdfStaged.length === 1 && pdfOverwriteTarget !== 'new') {
        // Single PDF with explicit overwrite target name
        const singleFile = pdfStaged[0].file;
        const renamedFile = new File([singleFile], pdfOverwriteTarget, { type: singleFile.type });
        finalFilesToUpload.push(renamedFile);
      } else {
        finalFilesToUpload.push(...pdfStaged.map((s) => s.file));
      }

      // 2. Add non-PDF files
      finalFilesToUpload.push(...nonPdfStaged.map((s) => s.file));

      const shouldBundle = isBundleAlbum && stagedImageCount > 1;
      await onUploadComplete(selectedProjectId, finalFilesToUpload, shouldBundle, albumTitle);

      // Reset state
      setStagedFiles([]);
      setAlbumTitle('');
      setMergedPdfTitle('');
      setPdfOverwriteTarget('new');
      onClose();
    } catch (err: any) {
      console.error('Upload failed:', err);
      setError('파일 업로드 중 오류가 발생했습니다: ' + (err?.message || '다시 시도해 주세요.'));
    } finally {
      setIsUploading(false);
    }
  };

  const activeProjects = projects.filter((p) => p.status === 'active');
  const stagedPdfFiles = stagedFiles.filter((f) => f.fileType === 'pdf');
  const stagedPdfCount = stagedPdfFiles.length;
  const stagedImageCount = stagedFiles.filter((f) => f.fileType === 'image').length;
  const stagedNonImageCount = stagedFiles.length - stagedImageCount;
  const totalOriginalSize = stagedFiles.reduce((acc, f) => acc + f.originalSize, 0);
  const totalCompressedSize = stagedFiles.reduce((acc, f) => acc + f.compressedSize, 0);
  const totalSavedPercent = totalOriginalSize > 0 
    ? Math.max(0, Math.round(((totalOriginalSize - totalCompressedSize) / totalOriginalSize) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-100 text-base">파일 업로드 및 병합</h2>
              <p className="text-xs text-slate-400">PDF 다중 병합, 엑셀, 사진을 등록합니다.</p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
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
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setPdfOverwriteTarget('new');
                }}
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
              className="border-2 border-dashed border-slate-700 hover:border-sky-500/70 bg-slate-800/40 hover:bg-slate-800/70 rounded-2xl p-5 sm:p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
            >
              <div className="p-3 rounded-full bg-slate-800 text-slate-400 group-hover:text-sky-400 group-hover:scale-110 transition-all">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  클릭하여 파일 선택 또는 여기로 드래그
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  다중 PDF 일괄 병합 지원 • 엑셀 • 사진
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/20">
                  <Layers className="w-3 h-3" />
                  여러 PDF 원클릭 병합 & 이름지정
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                  <Sparkles className="w-3 h-3" />
                  사진 초고속 자동 압축
                </span>
              </div>
            </div>
          </div>

          {/* 3. Staged Files & Settings */}
          {stagedFiles.length > 0 && (
            <div className="space-y-3">
              {/* PDF MERGE BANNER (If 2+ PDFs) */}
              {stagedPdfCount > 1 && (
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-red-950/60 via-slate-900 to-red-950/40 border border-red-500/40 space-y-3">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isMergePdf}
                      onChange={(e) => setIsMergePdf(e.target.checked)}
                      className="w-4 h-4 rounded border-red-500 text-red-600 focus:ring-red-500 focus:ring-offset-slate-900"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm text-red-200">
                        <Layers className="w-4 h-4 text-red-400" />
                        <span>PDF {stagedPdfCount}개를 1개 파일로 자동 병합 (Merge)</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        여러 도면/지시서 PDF를 순서대로 합쳐 1개의 다중 페이지 문서로 등록합니다.
                      </p>
                    </div>
                  </label>

                  {isMergePdf && (
                    <div className="pt-1 space-y-2.5 border-t border-red-500/20">
                      {/* Overwrite or New Selection */}
                      {existingProjectPdfFiles.length > 0 && (
                        <div>
                          <label className="block text-[11px] font-medium text-red-300 mb-1 flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" />
                            등록 방식 선택 (신규 등록 or 기존 파일 덮어쓰기)
                          </label>
                          <select
                            value={pdfOverwriteTarget}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPdfOverwriteTarget(val);
                              if (val !== 'new') {
                                setMergedPdfTitle(val);
                              }
                            }}
                            className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-red-500/40 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-red-400 [color-scheme:dark]"
                          >
                            <option value="new">✨ [새 파일로 등록] 새로운 파일명으로 생성</option>
                            {existingProjectPdfFiles.map((ep) => (
                              <option key={ep.id} value={ep.fileName}>
                                🔄 [기존 파일 덮어쓰기] {ep.fileName} (현재 V{ep.version || 1} → V{(ep.version || 1) + 1}로 갱신)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Merged File Name Input */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-300 mb-1">
                          {pdfOverwriteTarget === 'new' ? '병합될 대표 파일명 지정 (선택)' : '덮어쓸 파일명'}
                        </label>
                        <input
                          type="text"
                          value={mergedPdfTitle}
                          onChange={(e) => setMergedPdfTitle(e.target.value)}
                          disabled={pdfOverwriteTarget !== 'new'}
                          placeholder={`예: ${activeProjects.find((p) => p.id === selectedProjectId)?.model || '도면'}_종합_${stagedPdfCount}P.pdf`}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-red-500/30 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-red-400 placeholder-slate-500 font-medium disabled:opacity-75"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Continuous Photo Album Mode Toggle if 2+ images */}
              {stagedImageCount > 1 && (
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-sky-950/70 to-indigo-950/70 border border-sky-500/40 space-y-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isBundleAlbum}
                      onChange={(e) => setIsBundleAlbum(e.target.checked)}
                      className="w-4 h-4 rounded border-sky-500 text-sky-600 focus:ring-sky-500 focus:ring-offset-slate-900"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 font-semibold text-xs sm:text-sm text-sky-200">
                        <Sparkles className="w-4 h-4 text-sky-400" />
                        <span>사진 {stagedImageCount}장을 1개로 묶기 (연속사진)</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        목록이 깔끔해지고, 클릭 시 위아래로 길게 이어지는 스크롤로 연속 열람합니다.
                      </p>
                    </div>
                  </label>

                  {isBundleAlbum && (
                    <div className="pt-1">
                      <input
                        type="text"
                        value={albumTitle}
                        onChange={(e) => setAlbumTitle(e.target.value)}
                        placeholder={`사진 묶음 제목 입력 (예: ${activeProjects.find((p) => p.id === selectedProjectId)?.machineType || '조립'} 사진 묶음)`}
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-900/90 border border-sky-500/30 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400 placeholder-slate-500 font-medium"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Files Count & Summary */}
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>선택된 파일 ({stagedFiles.length}개)</span>
                {totalSavedPercent > 0 && (
                  <span className="text-emerald-400 font-medium">
                    사진 압축: {formatFileSize(totalOriginalSize)} → {formatFileSize(totalCompressedSize)} (-{totalSavedPercent}%)
                  </span>
                )}
              </div>

              {/* List of staged files with order buttons */}
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {stagedFiles.map((sf, idx) => {
                  const isPdf = sf.fileType === 'pdf';
                  const pdfIndex = isPdf
                    ? stagedFiles.slice(0, idx + 1).filter((f) => f.fileType === 'pdf').length
                    : 0;

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
                      className={`flex items-center justify-between p-2.5 rounded-xl bg-slate-800/80 border text-xs transition-colors ${
                        isPdf && isMergePdf && stagedPdfCount > 1
                          ? 'border-red-500/30 bg-red-950/10'
                          : 'border-slate-700/70'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2 flex-1">
                        {/* Order & Icon */}
                        <div className="flex items-center gap-1 shrink-0">
                          {isPdf && isMergePdf && stagedPdfCount > 1 ? (
                            <span className="w-5 h-5 rounded-md bg-red-500/20 text-red-300 font-bold font-mono text-[11px] flex items-center justify-center border border-red-500/30">
                              #{pdfIndex}
                            </span>
                          ) : (
                            <div className="p-1.5 rounded-lg bg-slate-700/80 shrink-0">
                              {sf.fileType === 'pdf' && <FileText className="w-4 h-4 text-red-400" />}
                              {sf.fileType === 'excel' && <FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
                              {sf.fileType === 'image' && <ImageIcon className="w-4 h-4 text-sky-400" />}
                              {sf.fileType === 'other' && <FileText className="w-4 h-4 text-slate-400" />}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-slate-200 break-all leading-snug">{sf.file.name}</p>
                            {isPdf && isMergePdf && stagedPdfCount > 1 ? (
                              <span className="px-1.5 py-0.2 rounded bg-red-500/20 text-red-300 font-bold font-mono text-[10px] border border-red-500/30 shrink-0">
                                {pdfIndex}번째 페이지로 병합
                              </span>
                            ) : existingFile ? (
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

                      {/* Order and Remove Controls */}
                      <div className="flex items-center gap-1 shrink-0">
                        {stagedFiles.length > 1 && (
                          <div className="flex flex-col gap-0.5 mr-1">
                            <button
                              type="button"
                              onClick={() => handleMoveFileOrder(idx, 'up')}
                              disabled={idx === 0 || isUploading}
                              className="p-1 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:hover:bg-slate-700/60 transition-colors"
                              title="위로 이동"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveFileOrder(idx, 'down')}
                              disabled={idx === stagedFiles.length - 1 || isUploading}
                              className="p-1 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:hover:bg-slate-700/60 transition-colors"
                              title="아래로 이동"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => handleRemoveFile(idx)}
                          disabled={isUploading}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                          title="목록에서 제거"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
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
            {stagedPdfCount > 1 && isMergePdf ? (
              <span className="text-red-300 font-medium">PDF {stagedPdfCount}장 ➜ 1개 문서로 병합 등록</span>
            ) : (
              <span>Cloudflare R2에 안전하게 저장</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleModalClose}
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
                  <span>{stagedPdfCount > 1 && isMergePdf ? 'PDF 병합 및 업로드 중...' : '업로드 중...'}</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>
                    {stagedPdfCount > 1 && isMergePdf
                      ? `PDF ${stagedPdfCount}개 병합 업로드`
                      : `${stagedFiles.length}개 파일 업로드 완료`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

