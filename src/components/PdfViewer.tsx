import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, Loader2, AlertCircle } from 'lucide-react';

// Configure PDF.js worker with bundled vite URL and robust cdn fallbacks
try {
  if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      pdfjsWorker ||
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
  }
} catch {
  // Ignore fallback error
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  // Load PDF Document
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError('');
    setCurrentPage(1);

    const loadDoc = async () => {
      try {
        let docSource: any = fileUrl;

        // Base64 data URL
        if (fileUrl.startsWith('data:application/pdf;base64,')) {
          const base64Data = fileUrl.replace('data:application/pdf;base64,', '');
          const binaryString = atob(base64Data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          docSource = { data: bytes };
        } else if (fileUrl.startsWith('http')) {
          // Fetch as arrayBuffer to bypass CORS restrictions
          try {
            const resp = await fetch(fileUrl);
            if (resp.ok) {
              const arrayBuf = await resp.arrayBuffer();
              docSource = { data: new Uint8Array(arrayBuf) };
            }
          } catch (fetchErr) {
            console.warn('Direct fetch failed, falling back to URL parameter:', fetchErr);
            docSource = { url: fileUrl, withCredentials: false };
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
        const context = canvas.getContext('2d');
        if (!context) return;

        // Support high-DPI retina screens
        const outputScale = window.devicePixelRatio || 1;
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
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3.5));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-300">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400 mb-3" />
        <p className="text-sm font-medium">PDF 도면을 로딩하는 중입니다...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-4 text-slate-300">
        <div className="w-full h-full flex flex-col bg-slate-900 rounded-xl overflow-hidden">
          <div className="p-3 bg-slate-800 flex items-center justify-between text-xs border-b border-slate-700">
            <span className="text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> 내장 뷰어로 표시합니다
            </span>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium"
            >
              새 창으로 열기
            </a>
          </div>
          <iframe
            src={`${fileUrl}#toolbar=1&navpanes=0`}
            className="w-full flex-1 border-0"
            title={fileName}
          />
        </div>
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
