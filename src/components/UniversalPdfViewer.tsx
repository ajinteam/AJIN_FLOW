import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  Maximize2,
  List
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

// Convert Base64 data URL to Uint8Array safely for zero-overhead fast parsing
function base64ToUint8Array(dataUrl: string): Uint8Array | null {
  try {
    const base64Index = dataUrl.indexOf(';base64,');
    if (base64Index === -1) return null;
    const base64String = dataUrl.substring(base64Index + 8);
    const binaryString = window.atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.warn('Failed to parse base64 to binary:', err);
    return null;
  }
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
  const [currentPage, setCurrentPage] = useState<number>(initialPage || 1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState<boolean>(true);

  // Search in Document state
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(!!initialSearchQuery);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [searchResults, setSearchResults] = useState<{ page: number; count: number; snippet: string }[]>([]);
  const [selectedResultIdx, setSelectedResultIdx] = useState<number>(0);
  const [searching, setSearching] = useState<boolean>(false);

  // Main scroll container ref
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Drag / Pan State
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0
  });

  // Touch gesture tracking for mobile pinch-to-zoom
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartScaleRef = useRef<number>(scale);
  const lastTapRef = useRef<number>(0);

  // Load PDF Document safely without Web Worker (Zero worker network crashes)
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setCurrentPage(initialPage || 1);

    if (!url) {
      setError('문서 경로가 유효하지 않습니다.');
      setLoading(false);
      return;
    }

    const loadPdf = async () => {
      try {
        let loadingTask: any;

        // If URL is base64
        if (url.startsWith('data:')) {
          const binaryData = base64ToUint8Array(url);
          if (binaryData) {
            loadingTask = pdfjsLib.getDocument({
              data: binaryData,
              cMapPacked: true,
              enableXfa: false,
              disableWorker: true,
            });
          }
        }

        if (!loadingTask) {
          // If URL is local upload /uploads/... or http URL
          // Fetch arrayBuffer first for rock-solid stability across mobile & iOS
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const arrayBuffer = await res.arrayBuffer();
            loadingTask = pdfjsLib.getDocument({
              data: new Uint8Array(arrayBuffer),
              cMapPacked: true,
              enableXfa: false,
              disableWorker: true,
            });
          } catch (fetchErr) {
            // Fallback directly with url
            loadingTask = pdfjsLib.getDocument({
              url,
              cMapPacked: true,
              enableXfa: false,
              disableWorker: true,
            });
          }
        }

        const doc = await loadingTask.promise;
        if (isMounted) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('PDF.js loading failed:', err);
        if (isMounted) {
          setError(err?.message || 'PDF 파일을 불러올 수 없습니다.');
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      isMounted = false;
    };
  }, [url, initialPage]);

  // Adjust default scale and sidebar visibility on mobile
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setScale(1.0);
        setShowSidebar(false); // Mobile defaults to hidden sidebar for wider view
      } else {
        setScale(1.15);
        setShowSidebar(true);
      }
    }
  }, []);

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
        scrollToPage(results[0].page);
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

  // Smooth Scroll to page
  const scrollToPage = (pageNum: number) => {
    const clamped = Math.max(1, Math.min(pageNum, numPages || 1));
    setCurrentPage(clamped);

    const el = pageRefs.current.get(clamped);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Track active page while scrolling continuous feed
  const handleScroll = () => {
    if (!mainScrollRef.current) return;
    const containerTop = mainScrollRef.current.scrollTop;
    const containerHeight = mainScrollRef.current.clientHeight;

    for (let p = 1; p <= numPages; p++) {
      const el = pageRefs.current.get(p);
      if (el) {
        const offsetTop = el.offsetTop - 80;
        const offsetBottom = offsetTop + el.clientHeight;
        if (containerTop + containerHeight / 3 >= offsetTop && containerTop + containerHeight / 3 <= offsetBottom) {
          if (currentPage !== p) {
            setCurrentPage(p);
          }
          break;
        }
      }
    }
  };

  const handleNextSearch = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (selectedResultIdx + 1) % searchResults.length;
    setSelectedResultIdx(nextIdx);
    scrollToPage(searchResults[nextIdx].page);
  };

  const handlePrevSearch = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (selectedResultIdx - 1 + searchResults.length) % searchResults.length;
    setSelectedResultIdx(prevIdx);
    scrollToPage(searchResults[prevIdx].page);
  };

  // Mouse pan handling
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!mainScrollRef.current) return;
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: mainScrollRef.current.scrollLeft,
      scrollTop: mainScrollRef.current.scrollTop
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !mainScrollRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    mainScrollRef.current.scrollLeft = dragStart.scrollLeft - dx;
    mainScrollRef.current.scrollTop = dragStart.scrollTop - dy;
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
        setScale((prev) => (prev > 1.2 ? 1.0 : 1.8));
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
      const newScale = Math.min(Math.max(0.6, touchStartScaleRef.current * ratio), 3.5);
      setScale(Number(newScale.toFixed(2)));
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
  };

  const handleZoomIn = () => setScale((s) => Math.min(Number((s + 0.2).toFixed(2)), 3.5));
  const handleZoomOut = () => setScale((s) => Math.max(Number((s - 0.2).toFixed(2)), 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleFitWidth = () => {
    if (mainScrollRef.current) {
      const containerWidth = mainScrollRef.current.clientWidth - (showSidebar ? 180 : 20);
      const targetScale = containerWidth < 500 ? 0.95 : 1.2;
      setScale(targetScale);
    }
  };

  return (
    <div className="flex flex-col w-full h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* 1. Main PDF Control Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-2.5 md:px-4 py-2 flex items-center justify-between gap-1.5 md:gap-3 flex-wrap shrink-0">
        {/* Left: Sidebar Toggle & Page Indicator */}
        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all border cursor-pointer",
              showSidebar ? "bg-emerald-600 text-white border-emerald-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
            )}
            title="좌측 연속 페이지 목록 토글"
          >
            <List size={14} />
            <span className="hidden sm:inline">목록 ({numPages || 1})</span>
          </button>

          <div className="flex items-center gap-1 bg-slate-800 px-2.5 py-1 rounded-xl border border-slate-700 text-xs font-mono font-bold">
            <span className="text-emerald-400">{currentPage}</span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-400">{numPages || 1}쪽</span>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              onClick={() => scrollToPage(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              className="p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
              title="이전 페이지"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => scrollToPage(currentPage + 1)}
              disabled={currentPage >= numPages || loading}
              className="p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
              title="다음 페이지"
            >
              <ChevronRight size={16} />
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
          >
            <Search size={13} />
            <span className="hidden sm:inline">도면 내 단어 검색</span>
            <span className="sm:hidden">검색</span>
            {searchResults.length > 0 && (
              <span className="bg-amber-500 text-slate-950 px-1.5 py-0.2 rounded-full text-[10px] font-black">
                {searchResults.length}
              </span>
            )}
          </button>
        </div>

        {/* Right: Zoom & Rotate Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleZoomOut}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="축소"
          >
            <ZoomOut size={15} />
          </button>
          <span className="font-mono text-xs w-11 text-center text-slate-300 font-bold">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="확대"
          >
            <ZoomIn size={15} />
          </button>
          <button
            onClick={handleRotate}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white ml-0.5 transition-colors cursor-pointer"
            title="90도 회전"
          >
            <RotateCw size={15} />
          </button>
          <button
            onClick={handleFitWidth}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold text-slate-300 ml-0.5 transition-colors cursor-pointer hidden sm:inline-flex items-center gap-1"
            title="화면 너비 맞춤"
          >
            <Maximize2 size={12} />
            <span>맞춤</span>
          </button>
        </div>
      </div>

      {/* 2. In-Document Search Bar */}
      {isSearchOpen && (
        <div className="bg-slate-900/95 border-b border-amber-500/30 px-3 py-2 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="도면 내 품명, 규격, 치수 검색..."
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
              <span>도면 검색 중...</span>
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

      {/* 3. Main Viewer Layout (Sidebar Thumbnails + Continuous Continuous Feed) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Continuous Thumbnails Sidebar */}
        {showSidebar && pdfDoc && (
          <div className="w-28 sm:w-36 md:w-44 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 overflow-y-auto p-2 gap-2.5 select-none no-scrollbar">
            <div className="text-[11px] font-bold text-slate-400 px-1 flex items-center justify-between sticky top-0 bg-slate-900/90 py-1 z-10">
              <span>연속 페이지 ({numPages})</span>
              <button onClick={() => setShowSidebar(false)} className="text-slate-500 hover:text-white p-0.5">
                <X size={12} />
              </button>
            </div>

            {Array.from({ length: numPages }, (_, i) => i + 1).map((pNum) => {
              const isSelected = pNum === currentPage;
              const hasSearchMatch = searchResults.some((r) => r.page === pNum);

              return (
                <button
                  key={pNum}
                  onClick={() => scrollToPage(pNum)}
                  className={cn(
                    "flex flex-col items-center p-1.5 rounded-xl border transition-all cursor-pointer text-left w-full",
                    isSelected
                      ? "bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500 shadow-md"
                      : "bg-slate-950/60 border-slate-800 hover:bg-slate-800 hover:border-slate-700"
                  )}
                >
                  <div className="w-full aspect-[1/1.4] bg-white rounded flex items-center justify-center overflow-hidden relative mb-1 shadow-xs">
                    <PdfPageThumbnail
                      pdfDoc={pdfDoc}
                      pageNum={pNum}
                    />
                    {hasSearchMatch && (
                      <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-amber-400 rounded-full ring-2 ring-black" />
                    )}
                  </div>
                  <span className={cn(
                    "text-[10px] font-mono font-bold",
                    isSelected ? "text-emerald-300" : "text-slate-400"
                  )}>
                    {pNum} 쪽
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Right: Full Continuous Document Canvas Area */}
        <div
          ref={mainScrollRef}
          onScroll={handleScroll}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={cn(
            "flex-1 overflow-auto bg-slate-950 relative p-2 md:p-6",
            isDragging ? "cursor-grabbing select-none" : "cursor-grab"
          )}
          style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
        >
          {/* Loading Spinner */}
          {loading && (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <Loader2 size={36} className="animate-spin text-emerald-400 mb-3" />
              <p className="text-sm font-bold text-slate-200">PDF 도면 불러오는 중...</p>
              <p className="text-xs text-slate-500 mt-1">고속 연속 뷰어 렌더링</p>
            </div>
          )}

          {/* Error Fallback */}
          {error && (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto bg-slate-900/80 rounded-2xl border border-slate-800">
              <AlertCircle size={40} className="text-rose-400 mb-3" />
              <h4 className="text-base font-bold text-white mb-1">도면을 표시할 수 없습니다</h4>
              <p className="text-xs text-slate-400 mb-4">{error}</p>
            </div>
          )}

          {/* Continuous Document Pages (Render with immediate zero-blank loading) */}
          {!loading && !error && pdfDoc && (
            <div className="m-auto inline-flex flex-col items-center gap-6 md:gap-10 min-w-fit min-h-fit py-2">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Sub-Component: Page Canvas Renderer (Optimized & Reliable)
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

        // Cap pixel ratio to 1.25 for absolute mobile stability and crisp text
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
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
        <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-xs flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-emerald-400" />
        </div>
      )}
      <div className="absolute bottom-2 right-2 bg-black/75 backdrop-blur-xs text-[10px] text-white font-mono px-2 py-0.5 rounded pointer-events-none border border-white/10">
        P.{pageNum}
      </div>
    </div>
  );
};

// Sub-Component: Thumbnail for Left Continuous List
const PdfPageThumbnail: React.FC<{ pdfDoc: any; pageNum: number }> = ({ pdfDoc, pageNum }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const renderThumb = async () => {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageNum);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport }).promise;
        if (!isCancelled) setLoaded(true);
      } catch {
        // Thumbnail load fallback
      }
    };

    renderThumb();

    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, pageNum]);

  return (
    <>
      <canvas ref={canvasRef} className="w-full h-full object-contain pointer-events-none" />
      {!loaded && (
        <div className="absolute inset-0 bg-slate-800 flex items-center justify-center text-[10px] text-slate-500 font-mono">
          {pageNum}
        </div>
      )}
    </>
  );
};
