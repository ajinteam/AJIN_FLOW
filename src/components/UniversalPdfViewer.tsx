import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Maximize2, 
  ChevronLeft, 
  ChevronRight, 
  Download, 
  Printer, 
  Move, 
  Loader2, 
  AlertCircle,
  FileText,
  Layers
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// Configure pdfjs worker (using official unpkg CDN or bundled worker)
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version || '4.10.38'}/build/pdf.worker.min.mjs`;
} catch {
  // Fallback
}

interface UniversalPdfViewerProps {
  url: string;
  fileName: string;
}

export const UniversalPdfViewer: React.FC<UniversalPdfViewerProps> = ({ url, fileName }) => {
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'continuous'>('continuous');

  // Drag / Pan state
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0
  });

  // Load PDF Document
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setCurrentPage(1);

    const loadPdf = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({
          url,
          cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist/cmaps/',
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isMounted) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('PDF load error:', err);
        if (isMounted) {
          setError(err.message || 'PDF 문서를 불러오는 중 오류가 발생했습니다.');
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      isMounted = false;
    };
  }, [url]);

  // Adjust default scale based on container width
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      if (containerWidth < 640) {
        // Mobile default scale
        setScale(0.85);
      } else if (containerWidth > 1200) {
        // Large desktop default scale
        setScale(1.35);
      }
    }
  }, [loading]);

  // Mouse Drag to Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    // Only drag with left mouse button (button 0)
    if (e.button !== 0) return;

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

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // Zoom Controls
  const handleZoomIn = () => setScale((s) => Math.min(3.5, Number((s + 0.2).toFixed(1))));
  const handleZoomOut = () => setScale((s) => Math.max(0.4, Number((s - 0.2).toFixed(1))));
  const handleFitWidth = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth - 40;
      // Rough approximation for standard A4 / landscape drawing width
      const targetScale = Math.max(0.5, Math.min(2.5, containerWidth / 850));
      setScale(Number(targetScale.toFixed(2)));
    }
  };
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  // Print Handler
  const handlePrint = () => {
    const printWindow = window.open(url, '_blank');
    if (printWindow) {
      printWindow.focus();
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-white select-none overflow-hidden">
      {/* Top Floating / Fixed Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center justify-between gap-2 shrink-0 z-20 shadow-md">
        {/* Left: Page Navigation */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setViewMode((m) => (m === 'continuous' ? 'single' : 'continuous'))}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer",
              viewMode === 'continuous' ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            )}
            title="연속 스크롤 / 단일 페이지 전환"
          >
            <Layers size={13} />
            <span className="hidden sm:inline">{viewMode === 'continuous' ? '전체 연속' : '페이지별'}</span>
          </button>

          {viewMode === 'single' && (
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1 hover:bg-slate-700 disabled:opacity-30 rounded text-slate-200 cursor-pointer"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="font-mono font-bold px-1.5">
                {currentPage} / {numPages || 1}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                disabled={currentPage >= numPages}
                className="p-1 hover:bg-slate-700 disabled:opacity-30 rounded text-slate-200 cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {viewMode === 'continuous' && numPages > 0 && (
            <span className="text-xs text-slate-400 bg-slate-800/80 px-2 py-1 rounded-lg font-mono">
              총 {numPages}페이지
            </span>
          )}
        </div>

        {/* Center: Drag Guide Prompt */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 font-medium">
          <Move size={13} className="text-emerald-400 animate-pulse" />
          <span>마우스 좌클릭 드래그로 화면 이동</span>
        </div>

        {/* Right: Zoom & Action Tools */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            onClick={handleZoomOut}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
            title="축소"
          >
            <ZoomOut size={15} />
          </button>
          
          <button
            onClick={handleFitWidth}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold rounded-lg transition-colors cursor-pointer"
            title="화면 너비 맞춤"
          >
            {Math.round(scale * 100)}%
          </button>

          <button
            onClick={handleZoomIn}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
            title="확대"
          >
            <ZoomIn size={15} />
          </button>

          <div className="h-4 w-[1px] bg-slate-700 mx-0.5" />

          <button
            onClick={handleRotate}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
            title="90도 회전"
          >
            <RotateCw size={15} />
          </button>

          <button
            onClick={handleFitWidth}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg transition-colors cursor-pointer hidden sm:block"
            title="화면 맞춤"
          >
            <Maximize2 size={15} />
          </button>

          <button
            onClick={handlePrint}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer hidden sm:block"
            title="인쇄"
          >
            <Printer size={15} />
          </button>
        </div>
      </div>

      {/* Main Canvas Scroll Area (Supports Left-Click Drag Pan) */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "flex-1 overflow-auto bg-slate-950 p-2 sm:p-6 flex flex-col items-center",
          isDragging ? "cursor-grabbing select-none" : "cursor-grab"
        )}
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      >
        {/* Loading Spinner */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <Loader2 size={36} className="animate-spin text-emerald-400 mb-3" />
            <p className="text-sm font-bold text-slate-200">고해상도 도면 렌더링 중...</p>
            <p className="text-xs text-slate-500 mt-1">모바일 및 PC 최적화 중입니다</p>
          </div>
        )}

        {/* Error Fallback */}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md">
            <AlertCircle size={40} className="text-rose-400 mb-3" />
            <h4 className="text-base font-bold text-white mb-1">도면을 표시할 수 없습니다</h4>
            <p className="text-xs text-slate-400 mb-4">{error}</p>
            <a
              href={url}
              download={fileName}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2"
            >
              <Download size={14} />
              <span>파일 직접 다운로드</span>
            </a>
          </div>
        )}

        {/* Render PDF Pages */}
        {!loading && !error && pdfDoc && (
          <div className="flex flex-col items-center gap-6 py-2">
            {viewMode === 'continuous' ? (
              Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                <PdfPageCanvas
                  key={pageNum}
                  pdfDoc={pdfDoc}
                  pageNum={pageNum}
                  scale={scale}
                  rotation={rotation}
                />
              ))
            ) : (
              <PdfPageCanvas
                pdfDoc={pdfDoc}
                pageNum={currentPage}
                scale={scale}
                rotation={rotation}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Sub-Component: Individual Page Canvas Renderer
interface PdfPageCanvasProps {
  pdfDoc: any;
  pageNum: number;
  scale: number;
  rotation: number;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({ pdfDoc, pageNum, scale, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const [rendering, setRendering] = useState<boolean>(true);

  useEffect(() => {
    let isCancelled = false;

    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) return;

      try {
        setRendering(true);
        // Cancel existing render task if any
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        // Apply page rotation + user rotation
        const totalRotation = (page.rotate + rotation) % 360;
        const viewport = page.getViewport({ scale, rotation: totalRotation });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        // Retina / High-DPI support for razor-sharp lines
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (!isCancelled) {
          setRendering(false);
        }
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Page ${pageNum} render error:`, err);
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
  }, [pdfDoc, pageNum, scale, rotation]);

  return (
    <div className="relative shadow-2xl rounded-sm overflow-hidden bg-white border border-slate-700/60">
      <canvas ref={canvasRef} className="block pointer-events-none" />
      {rendering && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-emerald-400" />
        </div>
      )}
      <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-xs text-[10px] text-white font-mono px-2 py-0.5 rounded pointer-events-none">
        P.{pageNum}
      </div>
    </div>
  );
};
