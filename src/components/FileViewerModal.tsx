import React, { useState, useEffect } from 'react';
import { InfoFile } from '../types';
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Clock,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { formatFileSize } from '../lib/imageCompressor';
import { PdfViewer } from './PdfViewer';
import { ExcelPdfViewer } from './ExcelPdfViewer';
import { format, parseISO } from 'date-fns';

interface FileViewerModalProps {
  file: InfoFile | null;
  onClose: () => void;
  canDownload?: boolean; // 읽기전용 사용자는 다운로드 버튼 비활성화/숨김
}

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  file,
  onClose,
  canDownload = true,
}) => {
  const [imageZoom, setImageZoom] = useState<number>(100);
  const [imageRotation, setImageRotation] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(true);

  // Mobile Back Button support
  useEffect(() => {
    if (!file) return;

    window.history.pushState({ modal: 'file-viewer', fileId: file.id }, '');

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [file, onClose]);

  useEffect(() => {
    setImageZoom(100);
    setImageRotation(0);
  }, [file]);

  if (!file) return null;

  const handleDownload = () => {
    if (!canDownload) return;
    const link = document.createElement('a');
    link.href = file.fileUrl;
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImageZoomIn = () => setImageZoom((prev) => Math.min(prev + 25, 300));
  const handleImageZoomOut = () => setImageZoom((prev) => Math.max(prev - 25, 50));
  const handleImageRotate = () => setImageRotation((prev) => (prev + 90) % 360);

  // Format date helper
  const formattedUpdateDate = (() => {
    try {
      const rawDate = file.updatedAt || file.uploadedAt;
      if (!rawDate) return '';
      const d = typeof rawDate === 'string' ? parseISO(rawDate) : new Date(rawDate);
      return format(d, 'yyyy-MM-dd HH:mm');
    } catch {
      return '';
    }
  })();

  const isRevised = (file.version && file.version > 1) || (file.updatedAt && file.uploadedAt && file.updatedAt !== file.uploadedAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-0 md:p-3">
      <div
        className={`flex flex-col bg-slate-900 text-slate-100 border border-slate-700 shadow-2xl overflow-hidden transition-all duration-150 ${
          isFullscreen
            ? 'fixed inset-0 w-full h-full rounded-none'
            : 'w-full h-full md:h-[94vh] md:max-w-7xl md:rounded-2xl'
        }`}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 bg-slate-850 border-b border-slate-800 select-none shrink-0 z-30">
          {/* File Meta Info */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 pr-2">
            <div className="p-2 rounded-xl bg-slate-800 text-slate-200 shrink-0 border border-slate-700/60">
              {file.fileType === 'pdf' && <FileText className="w-5 h-5 text-red-400" />}
              {file.fileType === 'excel' && <FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
              {file.fileType === 'image' && <ImageIcon className="w-5 h-5 text-sky-400" />}
              {file.fileType === 'other' && <FileText className="w-5 h-5 text-slate-400" />}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h2 className="font-bold text-sm sm:text-base text-slate-100 truncate">
                  {file.fileName}
                </h2>
                {isRevised && (
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] sm:text-xs font-bold whitespace-nowrap">
                    v{file.version || 2} 수정본
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-slate-400 mt-0.5">
                <span className="font-mono">{formatFileSize(file.fileSize)}</span>
                <span>•</span>
                <span>업로더: <strong className="text-slate-300">{file.uploadedBy}</strong></span>
                {formattedUpdateDate && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {isRevised ? `최종 수정: ${formattedUpdateDate}` : `등록: ${formattedUpdateDate}`}
                    </span>
                  </>
                )}
                {file.fileType === 'excel' && (
                  <>
                    <span className="hidden sm:inline">•</span>
                    <span className="hidden sm:inline-flex items-center gap-0.5 text-emerald-400 font-semibold">
                      PDF 규격 문서 변환 뷰
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons (Right) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Image zoom controls */}
            {file.fileType === 'image' && (
              <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700/60 mr-1">
                <button
                  onClick={handleImageZoomOut}
                  className="p-1.5 text-slate-300 hover:text-white rounded transition-colors"
                  title="축소"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-slate-300 font-mono px-1 min-w-[2.5rem] text-center hidden sm:inline-block">
                  {imageZoom}%
                </span>
                <button
                  onClick={handleImageZoomIn}
                  className="p-1.5 text-slate-300 hover:text-white rounded transition-colors"
                  title="확대"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleImageRotate}
                  className="p-1.5 text-slate-300 hover:text-white rounded transition-colors"
                  title="회전"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Requirement #4: 읽기 전용 사용자는 다운로드 버튼 숨김 */}
            {canDownload && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-semibold transition-all shadow-sm active:scale-95"
                title="원본 다운로드"
              >
                <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">다운로드</span>
              </button>
            )}

            {/* Fullscreen toggle (Desktop) */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-colors hidden md:block"
              title={isFullscreen ? '창 모드' : '전체화면'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Close modal */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-300 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Viewer Body */}
        <div className="flex-1 overflow-hidden bg-slate-950 flex flex-col relative">
          {/* 1. PDF Viewer with Pure Canvas (Immediate Mobile Rendering without External '열기' button) */}
          {file.fileType === 'pdf' && (
            <PdfViewer fileUrl={file.fileUrl} fileName={file.fileName} />
          )}

          {/* 2. Excel Viewer: High-Fidelity PDF Document Style with Continuous Multi-Page Scroll */}
          {file.fileType === 'excel' && (
            <ExcelPdfViewer fileUrl={file.fileUrl} fileName={file.fileName} />
          )}

          {/* 3. Image Viewer with Pan & Zoom */}
          {file.fileType === 'image' && (
            <div className="w-full h-full flex items-center justify-center overflow-auto p-4 select-none touch-pan-x touch-pan-y">
              <div
                style={{
                  transform: `scale(${imageZoom / 100}) rotate(${imageRotation}deg)`,
                  transition: 'transform 0.1s ease-out',
                }}
                className="flex items-center justify-center max-w-full max-h-full"
              >
                <img
                  src={file.fileUrl}
                  alt={file.fileName}
                  className="max-w-full max-h-[82vh] object-contain rounded-lg shadow-2xl border border-slate-800"
                />
              </div>
            </div>
          )}

          {/* 4. Other File types */}
          {file.fileType === 'other' && (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-300">
              <FileText className="w-16 h-16 text-slate-500 mb-4" />
              <h3 className="text-base font-semibold text-slate-200 mb-1">{file.fileName}</h3>
              <p className="text-xs text-slate-400 mb-4">
                미리보기를 지원하지 않는 형식입니다. 원본 파일을 확인해 주세요.
              </p>
              {canDownload ? (
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>다운로드하여 확인</span>
                </button>
              ) : (
                <span className="text-xs text-slate-500 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
                  읽기 전용 계정은 다운로드가 제한되어 있습니다.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
