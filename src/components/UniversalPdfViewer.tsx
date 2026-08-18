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
  Move, 
  Loader2, 
  AlertCircle,
  FileText,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  RefreshCw
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// Configure pdfjs worker with multiple reliable fallback CDNs
try {
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    const version = pdfjsLib.version || '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  }
} catch (e) {
  console.warn('PDF Worker config notice:', e);
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
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [useIframeFallback, setUseIframeFallback] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'single' | 'continuous'>('continuous');

  // Search in Document state
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(!!initialSearchQuery);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [searchResults, setSearchResults] = useState<{ page: number; count: number; snippet: string }[]>([]);
  const [selectedResultIdx, setSelectedResultIdx] = useState<number>(0);
  const [searching, setSearching] = useState<boolean>(false);

  // Drag / Pan & Touch Pinch State
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0
  });

  // Touch gesture tracking for mobile pinch-to-zoom and pan
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartScaleRef = useRef<number>(scale);
  const lastTapRef = useRef<number>(0);

  // Load PDF Document
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setUseIframeFallback(false);
    setCurrentPage(initialPage || 1);

    if (!url) {
      setError('문서 URL이 유효하지 않습니다.');
      setLoading(false);
      return;
    }

    const loadPdf = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({
          url,
          cMapUrl: 'https://unpkg.com/pdfjs-dist/cmaps/',
          cMapPacked: true,
          enableXfa: true,
        });

        const doc = await loadingTask.promise;
        if (isMounted) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setLoading(false);
        }
      } catch (err: any) {
        console.warn('PDF.js standard load failed, enabling direct inline viewer fallback:', err);
        if (isMounted) {
          setUseIframeFallback(true);
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      isMounted = false;
    };
  }, [url, initialPage]);

  // Adjust default scale based on container width
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      if (containerWidth < 640) {
        setScale(0.95);
      } else if (containerWidth > 1200) {
        setScale(1.25);
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
          let count = 0;
          let pos = lowerText.indexOf(lowerQuery);
          while (pos !== -1) {
            count++;
            pos = lowerText.indexOf(lowerQuery, pos + lowerQuery.length);
          }

          const matchIdx = lowerText.indexOf(lowerQuery);
          const start = Math.max(0, matchIdx - 25);
          const end = Math.min(fullText.length, matchIdx + lowerQuery.length + 35);
          const snippet = (start > 0 ? '...' : '') + fullText.slice(start, end).trim() + (end < fullText.length ? '...' : '');

          results.push({ page: p, count, snippet });
        }
      }
      setSearchResults(results);
      setSelectedResultIdx(0);
      if (results.length > 0) {
        goToPage(results[0].page);
      }
    } catch (err) {
      console.error('PDF Search error:', err);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (pdfDoc && searchQuery.trim()) {
      performSearch(searchQuery, pdfDoc);
    }
  }, [pdfDoc, searchQuery, performSearch]);

  const goToPage = (pageNum: number) => {
    const clamped = Math.max(1, Math.min(pageNum, numPages || 1));
    setCurrentPage(clamped);
    if (viewMode === 'continuous') {
      const el = pageRefs.current.get(clamped);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const handleNextSearch = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (selectedResultIdx + 1) % searchResults.length;
    setSelectedResultIdx(nextIdx);
    goToPage(searchResults[nextIdx].page);
  };

  const handlePrevSearch = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (selectedResultIdx - 1 + searchResults.length) % searchResults.length;
    setSelectedResultIdx(prevIdx);
    goToPage(searchResults[prevIdx].page);
  };

  // Mouse pan handling
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
    containerRef.current.scrollTop = dragStart.scrollTop - dy;
  };

  const handleMouseUp = () => setIsDragging(false);

  // Mobile Touch Gestures: Pinch to Zoom & Double Tap
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      touchStartScaleRef.current = scale;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        setScale((prev) => (prev > 1.2 ? 0.95 : 2.0));
      }
      lastTapRef.current = now;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / touchStartDistRef.current;
      const newScale = Math.min(Math.max(0.6, touchStartScaleRef.current * ratio), 4.0);
      setScale(Number(newScale.toFixed(2)));
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
  };

  const handleZoomIn = () => setScale((s) => Math.min(Number((s + 0.25).toFixed(2)), 4.0));
  const handleZoomOut = () => setScale((s) => Math.max(Number((s - 0.25).toFixed(2)), 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleFitWidth = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const targetScale = containerWidth < 640 ? 0.95 : 1.2;
      setScale(targetScale);
    }
  };

  // If Iframe Fallback is triggered (e.g. mobile PDF viewer)
  if (useIframeFallback) {
    return (
      <div className="w-full h-full flex flex-col bg-slate-950 overflow-hidden">
        <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-2 truncate">
            <span className="font-bold text-white truncate">{fileName}</span>
            <span className="bg-emerald-800/80 text-emerald-200 px-2 py-0.5 rounded text-[11px] font-bold">인라인 PDF 뷰어</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={url}
              download={fileName}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"
            >
              <Download size={13} />
              <span>다운로드</span>
            </a>
          </div>
        </div>
        <div className="flex-1 w-full h-full bg-white">
          <iframe
            src={`${url}#toolbar=1&navpanes=0`}
            className="w-full h-full border-0"
            title={fileName}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* 1. Main PDF Control Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-2.5 md:px-4 py-2 flex items-center justify-between gap-1.5 md:gap-3 flex-wrap shrink-0">
        {/* Left: Document Info & Page Navigator */}
        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          <div className="flex items-center gap-1 bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-700 text-xs font-mono font-bold">
            <span className="text-emerald-400">{currentPage}</span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-400">{numPages || 1}</span>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              className="p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
              title="이전 페이지"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= numPages || loading}
              className="p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
              title="다음 페이지"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="hidden sm:flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
            <button
              onClick={() => setViewMode('continuous')}
              className={cn(
                'px-2 py-0.5 rounded-md font-bold transition-all',
                viewMode === 'continuous' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              전체 연속
            </button>
            <button
              onClick={() => setViewMode('single')}
              className={cn(
                'px-2 py-0.5 rounded-md font-bold transition-all',
                viewMode === 'single' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              1쪽씩
            </button>
          </div>
        </div>

        {/* Center: In-Document Search Toggle */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer',
              isSearchOpen || searchQuery
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
            )}
            title="문서 내 본문 검색"
          >
            <Search size={14} />
            <span className="hidden sm:inline">문서 내 검색</span>
            {searchResults.length > 0 && (
              <span className="bg-amber-500 text-slate-950 px-1.5 py-0.2 rounded-full font-black text-[10px]">
                {searchResults.length}
              </span>
            )}
          </button>
        </div>

        {/* Right: Zoom & Rotate & Download Controls */}
        <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
          <div className="flex items-center bg-slate-800 rounded-xl p-0.5 border border-slate-700">
            <button
              onClick={handleZoomOut}
              className="p-1.5 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="축소 (-)"
            >
              <ZoomOut size={15} />
            </button>
            <span className="text-[11px] font-mono font-bold px-1.5 min-w-[42px] text-center text-emerald-400">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1.5 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
              title="확대 (+)"
            >
              <ZoomIn size={15} />
            </button>
          </div>

          <button
            onClick={handleFitWidth}
            className="p-1.5 text-slate-300 hover:bg-slate-800 rounded-xl border border-slate-700 transition-colors cursor-pointer hidden md:flex"
            title="화면 너비 맞춤"
          >
            <Maximize2 size={15} />
          </button>

          <button
            onClick={handleRotate}
            className="p-1.5 text-slate-300 hover:bg-slate-800 rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="90도 회전"
          >
            <RotateCw size={15} />
          </button>

          <a
            href={url}
            download={fileName}
            className="p-1.5 text-slate-300 hover:bg-slate-800 rounded-xl border border-slate-700 transition-colors cursor-pointer flex items-center gap-1"
            title="PDF 다운로드"
          >
            <Download size={15} />
          </a>
        </div>
      </div>

      {/* 2. In-Document Search Bar */}
      {isSearchOpen && (
        <div className="bg-slate-900/95 border-b border-slate-800 px-3 md:px-4 py-2 flex items-center gap-2 shrink-0 animate-in slide-in-from-top-2 duration-150">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="도면/문서 내 단어 검색 (품번, 치수, 텍스트)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold"
              autoFocus
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

          {searching ? (
            <div className="flex items-center gap-1.5 text-xs text-amber-400 font-bold px-2">
              <Loader2 size={13} className="animate-spin" />
              <span>검색 중...</span>
            </div>
          ) : searchResults.length > 0 ? (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-amber-400 font-bold font-mono">
                {selectedResultIdx + 1} / {searchResults.length}건
              </span>
              <button
                onClick={handlePrevSearch}
                className="p-1 hover:bg-slate-800 rounded text-slate-300 cursor-pointer"
                title="이전 결과"
              >
                <ArrowUp size={14} />
              </button>
              <button
                onClick={handleNextSearch}
                className="p-1 hover:bg-slate-800 rounded text-slate-300 cursor-pointer"
                title="다음 결과"
              >
                <ArrowDown size={14} />
              </button>
            </div>
          ) : searchQuery.trim() ? (
            <span className="text-xs text-slate-500">일치하는 텍스트 없음</span>
          ) : null}

          <button
            onClick={() => {
              setIsSearchOpen(false);
              setSearchQuery('');
            }}
            className="p-1 text-slate-400 hover:text-white ml-auto"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 3. Document Canvas Area with Touch Gestures */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "flex-1 overflow-auto bg-slate-950 relative p-1 md:p-6 flex flex-col",
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
            <button
              onClick={() => setUseIframeFallback(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 cursor-pointer mb-2"
            >
              <RefreshCw size={14} />
              <span>직접 뷰어로 열기</span>
            </button>
          </div>
        )}

        {/* Render PDF Pages with `m-auto` so zoom-in will NOT cut left edge */}
        {!loading && !error && pdfDoc && (
          <div className="m-auto inline-flex flex-col items-center gap-4 md:gap-8 min-w-fit min-h-fit py-1">
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

        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
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
    <div className="relative shadow-2xl rounded-sm overflow-hidden bg-white border border-slate-700/80 max-w-full">
      <canvas ref={canvasRef} className="block pointer-events-none max-w-none" />
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
