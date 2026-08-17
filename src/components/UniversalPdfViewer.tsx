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
  Layers,
  Search,
  X,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// Configure pdfjs worker
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version || '4.10.38'}/build/pdf.worker.min.mjs`;
} catch {
  // Fallback
}

interface UniversalPdfViewerProps {
  url: string;
  fileName: string;
  initialSearchQuery?: string;
  initialPage?: number;
}

export const UniversalPdfViewer: React.FC<UniversalPdfViewerProps> = ({ 
  url, 
  fileName,
  initialSearchQuery = '',
  initialPage = 1
}) => {
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'continuous'>('continuous');

  // Search in Document state
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(!!initialSearchQuery);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [searchResults, setSearchResults] = useState<{ page: number; count: number; snippet: string }[]>([]);
  const [selectedResultIdx, setSelectedResultIdx] = useState<number>(0);
  const [searching, setSearching] = useState<boolean>(false);

  // Drag / Pan state
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
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
    setCurrentPage(initialPage || 1);

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
        setScale(0.85);
      } else if (containerWidth > 1200) {
        setScale(1.35);
      }
    }
  }, [loading]);

  // Search inside PDF Document across all pages
  const performSearch = useCallback(async (query: string, doc: any) => {
    if (!query.trim() || !doc) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const results: { page: number; count: number; snippet: string }[] = [];
    const lowerQuery = query.toLowerCase().trim();

    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const textContent = await page.getTextContent();
        const fullText = textContent.items.map((item: any) => item.str).join(' ');
        const lowerText = fullText.toLowerCase();

        if (lowerText.includes(lowerQuery)) {
          // Count occurrences
          let count = 0;
          let pos = lowerText.indexOf(lowerQuery);
          while (pos !== -1) {
            count++;
            pos = lowerText.indexOf(lowerQuery, pos + lowerQuery.length);
          }

          // Extract snippet
          const matchIndex = lowerText.indexOf(lowerQuery);
          const start = Math.max(0, matchIndex - 30);
          const end = Math.min(fullText.length, matchIndex + lowerQuery.length + 30);
          const snippet = (start > 0 ? '...' : '') + fullText.substring(start, end).trim() + (end < fullText.length ? '...' : '');

          results.push({ page: p, count, snippet });
        }
      }
      setSearchResults(results);
      setSelectedResultIdx(0);
      if (results.length > 0) {
        jumpToPage(results[0].page);
      }
    } catch (err) {
      console.warn('PDF search error:', err);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (pdfDoc && searchQuery.trim()) {
      const timer = setTimeout(() => {
        performSearch(searchQuery, pdfDoc);
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, pdfDoc, performSearch]);

  const jumpToPage = (pageNum: number) => {
    setCurrentPage(pageNum);
    if (viewMode === 'continuous') {
      const el = pageRefs.current.get(pageNum);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const handleNextResult = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (selectedResultIdx + 1) % searchResults.length;
    setSelectedResultIdx(nextIdx);
    jumpToPage(searchResults[nextIdx].page);
  };

  const handlePrevResult = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (selectedResultIdx - 1 + searchResults.length) % searchResults.length;
    setSelectedResultIdx(prevIdx);
    jumpToPage(searchResults[prevIdx].page);
  };

  // Mouse Drag to Pan Handlers (Full 360 degree pan with no cut-off)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    if (e.button !== 0) return; // Left mouse button only
    // Don't drag if clicking buttons or inputs
    if ((e.target as HTMLElement).closest('button, input, select, a')) return;

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

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => setIsDragging(false);

  // Zoom Controls
  const handleZoomIn = () => setScale((s) => Math.min(4.0, Number((s + 0.25).toFixed(2))));
  const handleZoomOut = () => setScale((s) => Math.max(0.3, Number((s - 0.25).toFixed(2))));
  const handleFitWidth = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth - 48;
      const targetScale = Math.max(0.4, Math.min(2.5, containerWidth / 880));
      setScale(Number(targetScale.toFixed(2)));
    }
  };
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  // Print Handler
  const handlePrint = () => {
    const printWindow = window.open(url, '_blank');
    if (printWindow) printWindow.focus();
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-white select-none overflow-hidden relative">
      {/* Top Main Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-2 sm:px-4 py-2 flex items-center justify-between gap-1.5 shrink-0 z-20 shadow-md">
        {/* Left: View Mode & Page Selector */}
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setViewMode((m) => (m === 'continuous' ? 'single' : 'continuous'))}
            className={cn(
              "px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer",
              viewMode === 'continuous' ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            )}
            title="전체 연속 / 단일 페이지 전환"
          >
            <Layers size={13} />
            <span className="hidden sm:inline">{viewMode === 'continuous' ? '연속 스크롤' : '페이지별'}</span>
          </button>

          {viewMode === 'single' ? (
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
          ) : (
            numPages > 0 && (
              <span className="text-xs text-slate-400 bg-slate-800/90 px-2.5 py-1 rounded-lg font-mono font-bold">
                총 {numPages}P
              </span>
            )
          )}

          {/* Search Toggle Button */}
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className={cn(
              "p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer ml-1",
              isSearchOpen ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            )}
            title="문서 내 텍스트 검색"
          >
            <Search size={14} />
            <span className="hidden md:inline">문서 검색</span>
          </button>
        </div>

        {/* Center: Mouse Pan Guide */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 font-medium">
          <Move size={13} className="text-emerald-400 animate-pulse" />
          <span>좌클릭 드래그로 사방 이동 (확대 시 짤림 없음)</span>
        </div>

        {/* Right: Zoom & Orientation Controls */}
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

      {/* Expandable Document Search Bar */}
      {isSearchOpen && (
        <div className="bg-slate-900/95 border-b border-amber-500/30 px-3 py-2 flex items-center justify-between gap-2 z-20 backdrop-blur-md">
          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="도면/문서 내 단어 검색 (예: FRAME, SKIRT, 10-HOLES, SWITCH...)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {searching && (
              <div className="flex items-center gap-1 text-xs text-amber-400 shrink-0">
                <Loader2 size={13} className="animate-spin" />
                <span>검색 중...</span>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0 text-xs">
                <span className="text-amber-400 font-mono font-bold">
                  {selectedResultIdx + 1}/{searchResults.length}건
                </span>
                <button
                  onClick={handlePrevResult}
                  className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                  title="이전 일치 항목"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={handleNextResult}
                  className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                  title="다음 일치 항목"
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            )}

            {!searching && searchQuery.trim() && searchResults.length === 0 && (
              <span className="text-xs text-slate-500 shrink-0">일치 내용 없음</span>
            )}
          </div>

          {/* Quick Result Jump Pills */}
          {searchResults.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-sm">
              {searchResults.slice(0, 6).map((res, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setSelectedResultIdx(idx);
                    jumpToPage(res.page);
                  }}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-bold font-mono transition-all shrink-0 cursor-pointer",
                    selectedResultIdx === idx ? "bg-amber-500 text-slate-950 shadow-sm" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  )}
                >
                  P.{res.page} ({res.count})
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setIsSearchOpen(false)}
            className="p-1 text-slate-400 hover:text-white rounded-lg"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Canvas Scroll Container (Left Content Overflow & Cut-Off Fixed) */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "flex-1 overflow-auto bg-slate-950 relative p-4 md:p-8 flex flex-col",
          isDragging ? "cursor-grabbing select-none" : "cursor-grab"
        )}
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      >
        {/* Loading Spinner */}
        {loading && (
          <div className="m-auto flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <Loader2 size={36} className="animate-spin text-emerald-400 mb-3" />
            <p className="text-sm font-bold text-slate-200">고해상도 도면 렌더링 중...</p>
            <p className="text-xs text-slate-500 mt-1">모바일 및 PC 고화질 최적화</p>
          </div>
        )}

        {/* Error Fallback */}
        {error && (
          <div className="m-auto flex flex-col items-center justify-center p-8 text-center max-w-md bg-slate-900/80 rounded-2xl border border-slate-800">
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

        {/* Render PDF Pages with `m-auto` so zoom-in will NOT cut left edge */}
        {!loading && !error && pdfDoc && (
          <div className="m-auto inline-flex flex-col items-center gap-8 min-w-fit min-h-fit py-2">
            {viewMode === 'continuous' ? (
              Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
                const isMatched = searchResults.some((r) => r.page === pageNum);
                const isCurrentMatched = searchResults[selectedResultIdx]?.page === pageNum;

                return (
                  <div
                    key={pageNum}
                    ref={(el) => {
                      if (el) pageRefs.current.set(pageNum, el);
                      else pageRefs.current.delete(pageNum);
                    }}
                    className={cn(
                      "transition-all duration-200 rounded-sm",
                      isCurrentMatched && "ring-4 ring-amber-400 shadow-2xl scale-[1.01]"
                    )}
                  >
                    <PdfPageCanvas
                      pdfDoc={pdfDoc}
                      pageNum={pageNum}
                      scale={scale}
                      rotation={rotation}
                    />
                  </div>
                );
              })
            ) : (
              <div
                ref={(el) => {
                  if (el) pageRefs.current.set(currentPage, el);
                }}
              >
                <PdfPageCanvas
                  pdfDoc={pdfDoc}
                  pageNum={currentPage}
                  scale={scale}
                  rotation={rotation}
                />
              </div>
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
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {}
        }

        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        const totalRotation = (page.rotate + rotation) % 360;
        const viewport = page.getViewport({ scale, rotation: totalRotation });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

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
    <div className="relative shadow-2xl rounded-sm overflow-hidden bg-white border border-slate-700/80">
      <canvas ref={canvasRef} className="block pointer-events-none" />
      {rendering && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-emerald-400" />
        </div>
      )}
      <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-xs text-[10px] text-white font-mono px-2 py-0.5 rounded pointer-events-none border border-white/10">
        P.{pageNum}
      </div>
    </div>
  );
};
