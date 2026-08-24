import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Loader2,
  AlertCircle,
  Layers,
  FileText,
  Printer,
  Maximize2,
} from 'lucide-react';

// Configure PDF.js worker reliably
try {
  if (typeof window !== 'undefined') {
    // Use worker from CDN matching the pdfjs-dist version or standard bundle
    const PDF_VERSION = pdfjsLib.version || '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDF_VERSION}/pdf.worker.min.mjs`;
  }
} catch (e) {
  console.warn('PDF.js worker setup fallback:', e);
}

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
}

interface PageRenderItem {
  pageNumber: number;
  canvas: HTMLCanvasElement | null;
  rendered: boolean;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ fileUrl, fileName }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [isContinuousScroll, setIsContinuousScroll] = useState<boolean>(true);
  const [renderProgress, setRenderProgress] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<{ [key: number]: HTMLCanvasElement | null }>({});
  const renderTasksRef = useRef<{ [key: number]: any }>({});

  // 1. Load PDF Document safely
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError('');
    setCurrentPage(1);

    const loadDoc = async () => {
      try {
        let docSource: any = fileUrl;

        // A. Handle Base64 Data URLs
        if (fileUrl.startsWith('data:application/pdf;base64,') || fileUrl.startsWith('data:application/octet-stream;base64,')) {
          const base64Data = fileUrl.split(',')[1];
          const binaryString = atob(base64Data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          docSource = {
            data: bytes,
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
            cMapPacked: true,
          };
        } else if (fileUrl.startsWith('blob:')) {
          // B. Handle Blob URL
          const resp = await fetch(fileUrl);
          const arrayBuf = await resp.arrayBuffer();
          docSource = {
            data: new Uint8Array(arrayBuf),
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
            cMapPacked: true,
          };
        } else {
          // C. Handle Remote URLs (fetch as binary arrayBuffer to avoid CORS/iframe issues)
          try {
            const resp = await fetch(fileUrl, { mode: 'cors' });
            if (resp.ok) {
              const arrayBuf = await resp.arrayBuffer();
              docSource = {
                data: new Uint8Array(arrayBuf),
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
                cMapPacked: true,
              };
            } else {
              docSource = {
                url: fileUrl,
                withCredentials: false,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
                cMapPacked: true,
              };
            }
          } catch (fetchErr) {
            console.warn('Fetch fallback to direct URL:', fetchErr);
            docSource = {
              url: fileUrl,
              withCredentials: false,
              cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
              cMapPacked: true,
            };
          }
        }

        const loadingTask = pdfjsLib.getDocument(docSource);
        const doc = await loadingTask.promise;

        if (isCancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err: any) {
        console.error('PDF load error:', err);
        if (!isCancelled) {
          setError('PDF 도면을 렌더링하는 중 오류가 발생했습니다: ' + (err?.message || ''));
          setLoading(false);
        }
      }
    };

    loadDoc();

    return () => {
      isCancelled = true;
    };
  }, [fileUrl]);

  // 2. Render Page onto Canvas
  const renderSinglePage = useCallback(
    async (pageNumber: number) => {
      if (!pdfDoc) return;
      const canvas = canvasRefs.current[pageNumber];
      if (!canvas) return;

      // Cancel previous task for this page if running
      if (renderTasksRef.current[pageNumber]) {
        try {
          renderTasksRef.current[pageNumber].cancel();
        } catch {}
      }

      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: zoom, rotation });
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        const outputScale = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

        // White background for blueprints/specifications
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const renderContext: any = {
          canvasContext: context,
          viewport,
          transform,
        };

        const task = page.render(renderContext);
        renderTasksRef.current[pageNumber] = task;
        await task.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn(`Render page ${pageNumber} warning:`, err);
        }
      }
    },
    [pdfDoc, zoom, rotation]
  );

  // 3. Trigger rendering when doc/zoom/rotation/mode changes
  useEffect(() => {
    if (!pdfDoc) return;

    if (isContinuousScroll) {
      // Render all pages
      for (let p = 1; p <= numPages; p++) {
        renderSinglePage(p);
      }
    } else {
      // Render only current page
      renderSinglePage(currentPage);
    }

    return () => {
      Object.values(renderTasksRef.current).forEach((task: any) => {
        try {
          task?.cancel?.();
        } catch {}
      });
    };
  }, [pdfDoc, currentPage, zoom, rotation, isContinuousScroll, numPages, renderSinglePage]);

  const handlePrevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(p + 1, numPages));
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 3.5));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.4));
  const handleResetZoom = () => setZoom(1.0);
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-300">
        <Loader2 className="w-10 h-10 animate-spin text-sky-400 mb-3" />
        <p className="text-sm font-semibold text-slate-200">PDF 도면을 고해상도로 렌더링 중입니다...</p>
        <p className="text-xs text-slate-400 mt-1">별도의 열기 버튼 없이 앱 화면에서 바로 열람됩니다.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-300">
        <AlertCircle className="w-12 h-12 text-rose-400 mb-3" />
        <p className="text-sm font-semibold text-rose-300 mb-1">도면을 불러오지 못했습니다.</p>
        <p className="text-xs text-slate-400 max-w-md mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
        >
          새로고침
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center select-none overflow-hidden bg-slate-950">
      {/* Top Floating Controls Bar */}
      <div className="w-full px-3 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 z-20 shadow-md">
        {/* Left: View Mode Toggle & Page Indicators */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/60">
            <button
              onClick={() => setIsContinuousScroll(true)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                isContinuousScroll
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              연속 스크롤
            </button>
            <button
              onClick={() => setIsContinuousScroll(false)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                !isContinuousScroll
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              페이지별 보기
            </button>
          </div>

          {!isContinuousScroll && (
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevPage}
                disabled={currentPage <= 1}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs"
                title="이전 페이지"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold text-slate-300 min-w-[3.5rem] text-center font-mono">
                {currentPage} / {numPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={currentPage >= numPages}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs"
                title="다음 페이지"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {isContinuousScroll && (
            <span className="text-xs text-slate-400 font-mono hidden sm:inline-block">
              총 {numPages}페이지 전체 표시
            </span>
          )}
        </div>

        {/* Right: Zoom & Rotation */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700/60">
            <button
              onClick={handleZoomOut}
              className="p-1 text-slate-300 hover:text-white rounded transition-colors"
              title="축소"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-1.5 text-[11px] font-mono text-slate-300 hover:text-white"
              title="100% 맞춤"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 text-slate-300 hover:text-white rounded transition-colors"
              title="확대"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={handleRotate}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
            title="90° 회전"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Canvas Scroll Area (Multi-page Continuous or Single Page) */}
      <div
        ref={containerRef}
        className="flex-1 w-full overflow-auto p-2 sm:p-6 flex flex-col items-center bg-slate-950/90 touch-pan-x touch-pan-y"
      >
        <div className="w-full flex flex-col items-center gap-6 pb-24">
          {isContinuousScroll ? (
            // Render all pages in vertical continuous scroll
            Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                className="flex flex-col items-center bg-white shadow-2xl rounded-sm border border-slate-700/80 overflow-hidden relative"
              >
                <div className="w-full bg-slate-100 border-b border-slate-200 px-3 py-1 text-[11px] font-mono text-slate-600 flex justify-between items-center select-none">
                  <span>페이지 {pageNum}</span>
                  <span>{pageNum} / {numPages}</span>
                </div>
                <canvas
                  ref={(el) => {
                    canvasRefs.current[pageNum] = el;
                  }}
                  className="block"
                />
              </div>
            ))
          ) : (
            // Render only current page
            <div className="flex flex-col items-center bg-white shadow-2xl rounded-sm border border-slate-700/80 overflow-hidden relative my-auto">
              <canvas
                ref={(el) => {
                  canvasRefs.current[currentPage] = el;
                }}
                className="block"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
