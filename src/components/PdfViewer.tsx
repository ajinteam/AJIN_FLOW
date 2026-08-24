import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Loader2,
  RefreshCw,
  Maximize,
  AlertCircle
} from 'lucide-react';

// Configure PDF.js worker via CDN matching pdfjs-dist
try {
  if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
  }
} catch {
  // Ignore fallback error
}

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
}

// Single Page Canvas Component for Continuous Scroll
const PdfContinuousPage: React.FC<{
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
}> = ({ pdfDoc, pageNumber, scale, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageRendering, setPageRendering] = useState<boolean>(true);

  useEffect(() => {
    let isCancelled = false;
    let renderTask: any = null;

    const render = async () => {
      try {
        setPageRendering(true);
        const page = await pdfDoc.getPage(pageNumber);
        if (isCancelled || !canvasRef.current) return;

        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        const pixelRatio = Math.max(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const transform = pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined;

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform,
          background: '#ffffff',
        });

        await renderTask.promise;
        if (!isCancelled) {
          setPageRendering(false);
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn(`Render page ${pageNumber} error:`, err);
        }
      }
    };

    render();

    return () => {
      isCancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {}
      }
    };
  }, [pdfDoc, pageNumber, scale, rotation]);

  return (
    <div className="relative mb-6 shadow-2xl bg-white rounded-sm border border-slate-700/80 overflow-hidden flex flex-col items-center">
      {pageRendering && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center text-xs text-slate-300 gap-2 z-10">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          <span>{pageNumber}페이지 로딩 중...</span>
        </div>
      )}
      <canvas ref={canvasRef} className="block" />
      <div className="w-full bg-slate-100 border-t border-slate-300 py-1 text-center text-[11px] font-mono text-slate-500 select-none">
        {pageNumber} / {pdfDoc.numPages}
      </div>
    </div>
  );
};

export const PdfViewer: React.FC<PdfViewerProps> = ({ fileUrl, fileName }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Helper to fetch buffer (direct with proxy fallback)
  const fetchPdfBuffer = async (url: string): Promise<Uint8Array> => {
    if (url.startsWith('data:')) {
      const base64 = url.split(',')[1];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }

    try {
      const res = await fetch(url);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        return new Uint8Array(ab);
      }
    } catch (e) {
      console.warn('Direct fetch failed, attempting proxy fetch:', e);
    }

    const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl);
    if (!proxyRes.ok) {
      throw new Error(`파일을 불러오지 못했습니다 (${proxyRes.status})`);
    }
    const ab = await proxyRes.arrayBuffer();
    return new Uint8Array(ab);
  };

  const loadPdf = async () => {
    setLoading(true);
    setError('');

    try {
      const bytes = await fetchPdfBuffer(fileUrl);

      const loadingTask = pdfjsLib.getDocument({
        data: bytes,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/',
      });

      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setLoading(false);

      // Auto fit initial scale to container width
      if (containerRef.current) {
        try {
          const firstPage = await doc.getPage(1);
          const initialViewport = firstPage.getViewport({ scale: 1.0 });
          const containerWidth = containerRef.current.clientWidth - 32;
          if (containerWidth > 0 && initialViewport.width > 0) {
            const fitScale = Math.min(Math.max(containerWidth / initialViewport.width, 0.5), 2.2);
            setScale(fitScale);
          }
        } catch {}
      }
    } catch (err: any) {
      console.error('PDF load error:', err);
      setError(err?.message || 'PDF 도면을 로딩하지 못했습니다.');
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPdf();
  }, [fileUrl]);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 4.0));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.4));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const handleFitWidth = async () => {
    if (!pdfDoc || !containerRef.current) return;
    try {
      const page = await pdfDoc.getPage(1);
      const defaultViewport = page.getViewport({ scale: 1.0, rotation });
      const containerWidth = containerRef.current.clientWidth - 32;
      if (containerWidth > 0 && defaultViewport.width > 0) {
        setScale(containerWidth / defaultViewport.width);
      }
    } catch {}
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-300 gap-3">
        <Loader2 className="w-9 h-9 animate-spin text-sky-400" />
        <p className="text-sm font-semibold text-slate-200">PDF 도면을 연속 로딩하고 있습니다...</p>
        <p className="text-xs text-slate-400">모든 페이지를 고화질로 불러오는 중</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-300 gap-4">
        <div className="p-3 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertCircle className="w-8 h-8" />
        </div>
        <div className="max-w-md space-y-1">
          <p className="font-semibold text-slate-100 text-sm">{fileName}</p>
          <p className="text-xs text-red-400">{error}</p>
        </div>
        <button
          onClick={loadPdf}
          className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col select-none overflow-hidden bg-slate-950">
      {/* Top Floating Controls Bar */}
      <div className="w-full px-3 py-2 bg-slate-900/95 backdrop-blur border-b border-slate-800 flex items-center justify-between gap-1 sm:gap-2 shrink-0 z-10">
        {/* Continuous Page Indicator */}
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono text-[11px] border border-sky-500/30">
            연속 보기
          </span>
          <span className="text-slate-400 font-mono text-xs">
            총 {numPages}페이지
          </span>
        </div>

        {/* Zoom & Screen Fit & Rotate Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            title="축소"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <span className="text-xs font-mono text-slate-300 px-1 min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>

          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            title="확대"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            onClick={handleFitWidth}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors ml-0.5"
            title="화면 너비 맞춤"
          >
            <Maximize className="w-4 h-4" />
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

      {/* Continuous Vertical Scroll Area */}
      <div
        ref={containerRef}
        className="flex-1 w-full overflow-y-auto overflow-x-auto p-3 sm:p-6 flex flex-col items-center bg-slate-950 touch-pan-x touch-pan-y"
      >
        {pdfDoc &&
          Array.from({ length: numPages }, (_, index) => (
            <PdfContinuousPage
              key={index + 1}
              pdfDoc={pdfDoc}
              pageNumber={index + 1}
              scale={scale}
              rotation={rotation}
            />
          ))}
      </div>
    </div>
  );
};
