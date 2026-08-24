import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

// Configure PDF.js worker with robust version matching
if (typeof window !== 'undefined') {
  try {
    const version = pdfjsLib.version || '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  } catch (err) {
    console.warn('Worker initialization error:', err);
  }
}

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ fileUrl, fileName }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  const loadPdf = useCallback(async () => {
    setLoading(true);
    setError('');
    setCurrentPage(1);

    try {
      const version = pdfjsLib.version || '4.10.38';
      const cMapUrl = `https://unpkg.com/pdfjs-dist@${version}/cmaps/`;
      const standardFontDataUrl = `https://unpkg.com/pdfjs-dist@${version}/standard_fonts/`;

      let docInitParams: any = {
        cMapUrl,
        cMapPacked: true,
        standardFontDataUrl,
      };

      if (fileUrl.startsWith('data:application/pdf;base64,')) {
        const base64Data = fileUrl.replace('data:application/pdf;base64,', '');
        const binaryString = window.atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        docInitParams.data = bytes;
      } else {
        // Direct fetch for PDF binary data
        try {
          const response = await fetch(fileUrl);
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error('404');
            }
            throw new Error(`HTTP error ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          docInitParams.data = new Uint8Array(arrayBuffer);
        } catch (fetchErr: any) {
          if (fetchErr?.message === '404') {
            throw new Error('서버 또는 클라우드 스토리지에 해당 PDF 파일이 존재하지 않습니다. 상단의 [클라우드 동기화]를 누르거나 파일을 다시 업로드해 주세요.');
          }
          console.warn('Direct fetch failed, falling back to direct URL:', fetchErr);
          docInitParams.url = fileUrl;
          docInitParams.withCredentials = false;
        }
      }

      const loadingTask = pdfjsLib.getDocument(docInitParams);
      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setLoading(false);
    } catch (err: any) {
      console.error('PDF Document load error:', err);
      setError(err?.message || 'PDF 도면을 불러오는 중 문제가 발생했습니다. 다시 시도해 주세요.');
      setLoading(false);
    }
  }, [fileUrl]);

  useEffect(() => {
    loadPdf();
  }, [loadPdf]);

  // Render current page onto canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let isCancelled = false;

    const renderPage = async () => {
      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const page = await pdfDoc.getPage(currentPage);
        if (isCancelled || !canvasRef.current) return;

        const viewport = page.getViewport({ scale: zoom, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        // Support high-DPI retina screens while keeping sharp lines for CAD/PDF drawings
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

        const renderContext: any = {
          canvasContext: context,
          viewport,
          transform,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;
        await task.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('Page render error:', err);
        }
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [pdfDoc, currentPage, zoom, rotation]);

  const handlePrevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(p + 1, numPages));
  const handleZoomIn = () => setZoom((z) => Math.min(Number((z + 0.25).toFixed(2)), 4.0));
  const handleZoomOut = () => setZoom((z) => Math.max(Number((z - 0.25).toFixed(2)), 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleFitWidth = () => {
    if (containerRef.current && pdfDoc) {
      pdfDoc.getPage(currentPage).then((page) => {
        const unscaledViewport = page.getViewport({ scale: 1.0, rotation });
        const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
        const targetScale = Math.max(0.5, Math.min(3.0, (containerWidth - 32) / unscaledViewport.width));
        setZoom(Number(targetScale.toFixed(2)));
      });
    }
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-300">
        <Loader2 className="w-9 h-9 animate-spin text-sky-400 mb-3" />
        <p className="text-sm font-medium text-slate-200">PDF 도면을 바로 엽니다...</p>
        <span className="text-xs text-slate-400 mt-1">{fileName}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-300">
        <div className="flex flex-col items-center max-w-sm text-center bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
          <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
          <h3 className="text-sm font-semibold text-slate-100 mb-1">도면 불러오기 실패</h3>
          <p className="text-xs text-slate-400 mb-4">{error}</p>
          <button
            onClick={loadPdf}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center select-none overflow-hidden bg-slate-950">
      {/* Floating/Top Controls Bar */}
      <div className="w-full px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 z-10">
        {/* Page Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition-colors"
            title="이전 페이지"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-300 min-w-[4rem] text-center font-mono">
            {currentPage} / {numPages || 1}
          </span>
          <button
            onClick={handleNextPage}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition-colors"
            title="다음 페이지"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Zoom & Rotation Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleFitWidth}
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors hidden sm:inline-flex"
            title="너비 맞춤"
          >
            맞춤
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            title="축소"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-300 px-1 min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            title="확대"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleRotate}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors ml-0.5"
            title="90도 회전"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas Rendering Area */}
      <div
        ref={containerRef}
        className="flex-1 w-full overflow-auto p-2 sm:p-4 flex items-start justify-center bg-slate-950 touch-pan-x touch-pan-y"
      >
        <div className="inline-block shadow-2xl rounded-lg overflow-hidden bg-white border border-slate-700 my-auto">
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>
    </div>
  );
};

