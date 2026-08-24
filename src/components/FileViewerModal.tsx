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
} from 'lucide-react';
import { formatFileSize } from '../lib/imageCompressor';
import { PdfViewer } from './PdfViewer';
import { ExcelViewer } from './ExcelViewer';

interface FileViewerModalProps {
  file: InfoFile | null;
  canDownload?: boolean;
  onClose: () => void;
}

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  file,
  canDownload = true,
  onClose,
}) => {
  const [imgZoom, setImgZoom] = useState<number>(100);
  const [imgRotation, setImgRotation] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(true);

  // Mobile Back Button Support
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
    setImgZoom(100);
    setImgRotation(0);
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

  const handleImgZoomIn = () => setImgZoom((prev) => Math.min(prev + 25, 300));
  const handleImgZoomOut = () => setImgZoom((prev) => Math.max(prev - 25, 50));
  const handleImgRotate = () => setImgRotation((prev) => (prev + 90) % 360);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-0 md:p-4">
      <div
        className={`flex flex-col bg-slate-900 text-slate-100 border border-slate-700 shadow-2xl overflow-hidden transition-all duration-200 ${
          isFullscreen
            ? 'fixed inset-0 w-full h-full rounded-none'
            : 'w-full h-full md:h-[92vh] md:max-w-6xl md:rounded-2xl'
        }`}
      >
        {/* Top bar Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 bg-slate-800/95 border-b border-slate-700 select-none shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="p-1.5 rounded-lg bg-slate-700 text-slate-200 shrink-0">
              {file.fileType === 'pdf' && <FileText className="w-5 h-5 text-red-400" />}
              {file.fileType === 'excel' && <FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
              {file.fileType === 'image' && <ImageIcon className="w-5 h-5 text-sky-400" />}
              {file.fileType === 'other' && <FileText className="w-5 h-5 text-slate-400" />}
            </div>
            <div className="min-w-0">
              <h2
                className="font-semibold text-xs sm:text-sm md:text-base text-slate-100 truncate"
                title={file.fileName}
              >
                {file.fileName}
              </h2>
              <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-slate-400 whitespace-nowrap">
                <span>{formatFileSize(file.fileSize)}</span>
                <span>•</span>
                <span>업로더: {file.uploadedBy}</span>
                {file.version && file.version > 1 && (
                  <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-mono text-[10px]">
                    v{file.version}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Image zoom controls */}
            {file.fileType === 'image' && (
              <>
                <button
                  onClick={handleImgZoomOut}
                  className="p-1.5 sm:p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  title="축소"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-400 font-mono px-1 min-w-[2.8rem] text-center hidden sm:inline-block">
                  {imgZoom}%
                </span>
                <button
                  onClick={handleImgZoomIn}
                  className="p-1.5 sm:p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  title="확대"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={handleImgRotate}
                  className="p-1.5 sm:p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  title="회전"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Requirement #4: 읽기 전용 사용자는 다운로드 버튼 숨김 */}
            {canDownload && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs sm:text-sm font-semibold transition-colors shadow-sm"
                title="다운로드"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">다운로드</span>
              </button>
            )}

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 sm:p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors hidden md:block"
              title={isFullscreen ? '창 모드' : '전체화면'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-lg text-slate-300 hover:bg-red-500/20 hover:text-red-400 transition-colors ml-0.5"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-auto bg-slate-950 flex flex-col relative">
          {/* 1. PDF Continuous Scroll Viewer */}
          {file.fileType === 'pdf' && (
            <PdfViewer fileUrl={file.fileUrl} fileName={file.fileName} />
          )}

          {/* 2. Image Viewer */}
          {file.fileType === 'image' && (
            <div className="w-full h-full flex items-center justify-center overflow-auto p-4 select-none touch-pan-x touch-pan-y">
              <div
                style={{
                  transform: `scale(${imgZoom / 100}) rotate(${imgRotation}deg)`,
                  transition: 'transform 0.15s ease-out',
                }}
                className="flex items-center justify-center max-w-full max-h-full"
              >
                <img
                  src={file.fileUrl}
                  alt={file.fileName}
                  className="max-w-full max-h-[80vh] object-contain rounded shadow-2xl border border-slate-800"
                />
              </div>
            </div>
          )}

          {/* 3. Excel High-Resolution Drawing Sheet Viewer */}
          {file.fileType === 'excel' && (
            <ExcelViewer fileUrl={file.fileUrl} fileName={file.fileName} />
          )}

          {/* 4. Other File types */}
          {file.fileType === 'other' && (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-4">
              <FileText className="w-16 h-16 text-slate-500" />
              <div className="max-w-md">
                <h3 className="text-base font-medium text-slate-200 mb-1">{file.fileName}</h3>
                <p className="text-xs text-slate-400 mb-4">
                  미리보기를 지원하지 않는 파일 형식입니다.
                </p>
                {canDownload && (
                  <button
                    onClick={handleDownload}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors inline-flex items-center gap-2 shadow-md"
                  >
                    <Download className="w-4 h-4" />
                    파일 다운로드
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
