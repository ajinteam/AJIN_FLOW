import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Loader2, AlertCircle } from 'lucide-react';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      pdfjsWorker ||
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version || '6.2.108'}/build/pdf.worker.min.mjs`;
  } catch (err) {
    console.warn('PDF.js worker setup:', err);
  }
}

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ fileUrl, fileName }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  // Load PDF Document
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);
    setCurrentPage(1);

    const loadDoc = async () => {
      try {
        let docSource: any = null;

        // Base64 data URL
        if (fileUrl.startsWith('data:application/pdf;base64,')) {
          const base64Data = fileUrl.split(',')[1];
          const binaryString = window.atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          docSource = { data: bytes };
        } else {
          // Fetch as ArrayBuffer for relative paths and URLs
          try {
            const resp = await fetch(fileUrl);
            if (resp.ok) {
              const arrayBuf = await resp.arrayBuffer();
              docSource = { data: new Uint8Array(arrayBuf) };
            } else {
              docSource = { url: fileUrl };
            }
          } catch (fetchErr) {
            console.warn('Direct fetch error, passing url:', fetchErr);
            docSource = { url: fileUrl };
          }
        }

        const cMapVer = pdfjsLib.version || '6.2.108';
        const loadingTask = pdfjsLib.getDocument({
          ...docSource,
          cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${cMapVer}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${cMapVer}/standard_fonts/`,
        });

        const doc = await loadingTask.promise;

        if (isCancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err: any) {
        console.error('PDF load error:', err);
        if (!isCancelled) {
          setError('PDF 문서를 불러오는 중 오류가 발생했습니다.');
          setLoading(false);
        }
      }
    };

    loadDoc();

    return () => {
      isCancelled = true;
    };
  }, [fileUrl]);

  // Render Page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let isCancelled = false;

    const renderPage = async () => {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const page = await pdfDoc.getPage(currentPage);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale: scale, rotation: rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // High DPI support
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
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('Page render error:', err);
        }
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, currentPage, scale, rotation]);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage((prev) => prev - 1);
  };

  const handleNextPage = () => {
    if (currentPage < numPages) setCurrentPage((prev) => prev + 1);
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3.0));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400 mb-3" />
        <p className="text-sm font-medium">PDF 문서를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-slate-400">
        <AlertCircle className="w-8 h-8 text-rose-400 mb-3" />
        <p className="text-sm font-medium text-slate-300 mb-1">{fileName}</p>
        <p className="text-xs text-slate-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center select-none overflow-hidden">
      {/* Floating/Top Controls Bar */}
      <div className="w-full px-3 py-2 bg-slate-900/90 backdrop-blur border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 z-10">
        {/* Page Nav */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs transition-colors"
            title="이전 페이지"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-300 min-w-[4.5rem] text-center font-mono">
            {currentPage} / {numPages || 1}
          </span>
          <button
            onClick={handleNextPage}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs transition-colors"
            title="다음 페이지"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Zoom & Rotation Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            title="축소"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-slate-400 px-1 hidden sm:inline-block">
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
            onClick={handleRotate}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors ml-1"
            title="회전"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas Rendering Area */}
      <div className="flex-1 w-full overflow-auto p-2 sm:p-4 flex items-start justify-center bg-slate-950/90 touch-pan-x touch-pan-y">
        <div className="inline-block shadow-2xl rounded-lg overflow-hidden bg-white border border-slate-700 my-auto">
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>
    </div>
  );
};
