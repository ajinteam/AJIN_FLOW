import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import * as XLSX from 'xlsx';
import { format, parseISO } from 'date-fns';
import {
  Download,
  Printer,
  ZoomIn,
  ZoomOut,
  RotateCw,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
  X,
  Search,
} from 'lucide-react';
import { RsPartFile } from '../types';
import { formatFileSize } from '../lib/imageCompressor';

try {
  if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      pdfjsWorker ||
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '4.10.38'}/pdf.worker.min.mjs`;
  }
} catch {
  // Ignore worker init fallback
}

interface RsPartStandaloneViewerProps {
  file: RsPartFile | null;
  loading?: boolean;
  onBackToList: () => void;
}

export const RsPartStandaloneViewer: React.FC<RsPartStandaloneViewerProps> = ({
  file,
  loading = false,
  onBackToList,
}) => {
  const [zoom, setZoom] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [downloading, setDownloading] = useState<boolean>(false);

  // PDF multi-page rendering state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);
  const [pdfError, setPdfError] = useState<string>('');
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Excel state
  const [excelSheets, setExcelSheets] = useState<{ name: string; data: any[][] }[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const [excelSearch, setExcelSearch] = useState<string>('');
  const [excelLoading, setExcelLoading] = useState<boolean>(false);
  const [excelError, setExcelError] = useState<string>('');

  // Load PDF or Excel when file changes
  useEffect(() => {
    if (!file) return;
    document.title = `${file.fileName} - RS Parts 열람`;

    setPdfDoc(null);
    setNumPages(0);
    setPdfError('');
    setExcelSheets([]);
    setActiveSheetIndex(0);
    setExcelSearch('');
    setExcelError('');

    if (file.fileType === 'pdf') {
      let cancelled = false;
      setPdfLoading(true);
      (async () => {
        try {
          let docSource: any = file.fileUrl;
          if (file.fileUrl.startsWith('data:application/pdf;base64,')) {
            const base64Data = file.fileUrl.replace('data:application/pdf;base64,', '');
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            docSource = { data: bytes };
          } else if (file.fileUrl.startsWith('http') || file.fileUrl.startsWith('/')) {
            try {
              const resp = await fetch(file.fileUrl);
              if (resp.ok) {
                const buf = await resp.arrayBuffer();
                docSource = { data: new Uint8Array(buf) };
              }
            } catch {
              docSource = { url: file.fileUrl, withCredentials: false };
            }
          }

          const task = pdfjsLib.getDocument(docSource);
          const doc = await task.promise;
          if (cancelled) return;
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setPdfLoading(false);
        } catch (err) {
          console.error('RS Parts PDF load error:', err);
          if (!cancelled) {
            setPdfError('PDF 내장 뷰어 로딩에 실패했습니다.');
            setPdfLoading(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    if (file.fileType === 'excel') {
      let cancelled = false;
      setExcelLoading(true);
      (async () => {
        try {
          let arrayBuffer: ArrayBuffer;
          if (file.fileUrl.startsWith('data:')) {
            const base64 = file.fileUrl.split(',')[1];
            const binaryString = window.atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            arrayBuffer = bytes.buffer;
          } else {
            const resp = await fetch(file.fileUrl);
            if (!resp.ok) throw new Error('엑셀 파일을 불러올 수 없습니다.');
            arrayBuffer = await resp.arrayBuffer();
          }

          const wb = XLSX.read(arrayBuffer, { type: 'array' });
          const sheets = wb.SheetNames.map((name) => {
            const ws = wb.Sheets[name];
            const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
            return { name, data: raw };
          });
          if (!cancelled) {
            setExcelSheets(sheets);
          }
        } catch (err) {
          console.error('RS Parts Excel parse error:', err);
          if (!cancelled) {
            setExcelError('엑셀 파일을 불러오는 중 오류가 발생했습니다. 다운로드하여 확인해 주세요.');
          }
        } finally {
          if (!cancelled) setExcelLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [file]);

  // Render all PDF pages sequentially for crisp scrolling and multi-page printing
  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;

    let cancelled = false;
    const renderAllPages = async () => {
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        if (cancelled) return;
        const canvas = canvasRefs.current[pageNum - 1];
        if (!canvas) continue;

        try {
          const page = await pdfDoc.getPage(pageNum);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: zoom, rotation });
          const context = canvas.getContext('2d');
          if (!context) continue;

          const outputScale = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
          await page.render({ canvasContext: context, viewport, transform } as any).promise;
        } catch (err: any) {
          if (err?.name !== 'RenderingCancelledException') {
            console.warn(`PDF page ${pageNum} render warning:`, err);
          }
        }
      }
    };

    renderAllPages();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, numPages, zoom, rotation]);

  const handleDownload = async () => {
    if (!file || downloading) return;
    setDownloading(true);
    try {
      if (file.fileUrl.startsWith('data:')) {
        const link = document.createElement('a');
        link.href = file.fileUrl;
        link.download = file.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const res = await fetch(file.fileUrl);
        if (!res.ok) throw new Error('Download fetch failed');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = file.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      }
    } catch {
      const link = document.createElement('a');
      link.href = file.fileUrl;
      link.download = file.fileName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCloseWindow = () => {
    window.close();
    // If browser prevents window.close() on non-script-opened tabs, navigate back cleanly
    setTimeout(() => {
      if (!window.closed) {
        onBackToList();
      }
    }, 150);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
        <p className="text-sm text-slate-400">RS Parts 파일을 불러오는 중입니다...</p>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center gap-4">
        <AlertCircle className="w-12 h-12 text-amber-400" />
        <h2 className="text-lg font-bold">파일을 찾을 수 없습니다</h2>
        <p className="text-sm text-slate-400 max-w-md">
          요청하신 RS Parts 파일이 삭제되었거나 존재하지 않습니다.
        </p>
        <button
          onClick={handleCloseWindow}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
        >
          RS Parts 목록으로 이동
        </button>
      </div>
    );
  }

  const currentSheet = excelSheets[activeSheetIndex];
  const filteredRows = currentSheet
    ? currentSheet.data.filter((row, idx) => {
        if (idx === 0) return true;
        if (!excelSearch.trim()) return true;
        return row.some((cell) =>
          String(cell || '').toLowerCase().includes(excelSearch.toLowerCase())
        );
      })
    : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col print:bg-white print:text-black">
      {/* Top Toolbar (Hidden during Print) */}
      <header className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="p-2 rounded-lg bg-slate-800 border border-slate-700 shrink-0">
            {file.fileType === 'pdf' && <FileText className="w-5 h-5 text-red-400" />}
            {file.fileType === 'excel' && <FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
            {file.fileType === 'image' && <ImageIcon className="w-5 h-5 text-sky-400" />}
            {file.fileType === 'other' && <FileText className="w-5 h-5 text-slate-400" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-slate-100 truncate">
              {file.fileName}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 tabular-nums">
              <span>{formatFileSize(file.fileSize)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {file.updatedAt
                  ? format(parseISO(file.updatedAt), 'yyyy-MM-dd HH:mm')
                  : '-'}
              </span>
              <span aria-hidden="true">·</span>
              <span>등록: {file.uploadedBy}</span>
              {numPages > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-400 font-medium">{numPages}페이지</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Zoom / Rotate / Print / Download / Close */}
        <div className="flex items-center gap-1.5 shrink-0">
          {(file.fileType === 'pdf' || file.fileType === 'image') && (
            <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-xl p-1 mr-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.2).toFixed(2))))}
                className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                title="축소"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono text-slate-200 min-w-[3.2rem] text-center tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.2).toFixed(2))))}
                className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                title="확대"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                title="회전"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" />
            <span>인쇄</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>{downloading ? '준비 중...' : '다운로드'}</span>
          </button>

          <button
            type="button"
            onClick={handleCloseWindow}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            title="창 닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto p-3 sm:p-6 print:p-0 print:overflow-visible">
        {/* 1. PDF Multi-Page Canvas Viewer */}
        {file.fileType === 'pdf' && (
          <div className="w-full flex flex-col items-center gap-4 print:gap-0 print:block">
            {pdfLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3 print:hidden">
                <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
                <span className="text-sm">PDF 도면을 불러오는 중입니다...</span>
              </div>
            )}

            {pdfError && (
              <div className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-xl overflow-hidden print:border-0">
                <div className="p-3 bg-slate-800 flex items-center justify-between text-xs border-b border-slate-700 print:hidden">
                  <span className="text-amber-400 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    브라우저 내장 뷰어로 표시합니다
                  </span>
                  <a
                    href={file.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-medium"
                  >
                    원본 PDF 직접 열기
                  </a>
                </div>
                <iframe
                  src={`${file.fileUrl}#toolbar=1`}
                  className="w-full h-[82vh] border-0"
                  title={file.fileName}
                />
              </div>
            )}

            {!pdfLoading && !pdfError && numPages > 0 && (
              <div className="flex flex-col items-center gap-5 print:gap-0 print:block w-full">
                {Array.from({ length: numPages }, (_, idx) => (
                  <div
                    key={idx}
                    className="rs-print-page bg-white rounded-lg shadow-2xl border border-slate-700 overflow-hidden max-w-full"
                  >
                    <div className="px-3 py-1 bg-slate-800 text-[11px] font-mono text-slate-300 border-b border-slate-700 flex items-center justify-between print:hidden">
                      <span>페이지 {idx + 1} / {numPages}</span>
                      <span className="truncate max-w-[260px] text-slate-400">{file.fileName}</span>
                    </div>
                    <div className="overflow-auto max-w-full print:overflow-visible">
                      <canvas
                        ref={(el) => {
                          canvasRefs.current[idx] = el;
                        }}
                        className="block mx-auto"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. Image Viewer */}
        {file.fileType === 'image' && (
          <div className="w-full flex items-center justify-center min-h-[75vh] print:min-h-0">
            <img
              src={file.fileUrl}
              alt={file.fileName}
              style={{
                width: `${Math.round(zoom * 70)}%`,
                maxWidth: 'none',
                transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
              }}
              className="object-contain rounded-lg shadow-2xl border border-slate-800 print:w-full print:max-w-full print:shadow-none print:border-0"
            />
          </div>
        )}

        {/* 3. Excel Viewer */}
        {file.fileType === 'excel' && (
          <div className="max-w-6xl mx-auto flex flex-col gap-3">
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-2 print:hidden">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {excelSheets.map((sheet, idx) => (
                  <button
                    key={sheet.name}
                    onClick={() => setActiveSheetIndex(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      activeSheetIndex === idx
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {sheet.name}
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={excelSearch}
                  onChange={(e) => setExcelSearch(e.target.value)}
                  placeholder="표 내용 검색..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-500"
                />
              </div>
            </div>

            {excelLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                <span className="text-sm">엑셀 데이터를 불러오는 중입니다...</span>
              </div>
            )}

            {excelError && (
              <div className="p-8 text-center text-rose-400 bg-slate-900 border border-slate-800 rounded-xl">
                <p className="text-sm mb-3">{excelError}</p>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  원본 엑셀 다운로드
                </button>
              </div>
            )}

            {!excelLoading && !excelError && currentSheet && (
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-900 print:bg-white print:border-slate-300">
                <table className="w-full text-left border-collapse text-xs tabular-nums">
                  <thead>
                    {filteredRows[0] && (
                      <tr className="bg-slate-800 border-b border-slate-700 print:bg-slate-100 print:border-slate-300">
                        <th className="py-2.5 px-3 font-semibold text-slate-400 border-r border-slate-700 w-10 text-center print:text-black print:border-slate-300">
                          #
                        </th>
                        {filteredRows[0].map((h: any, cIdx: number) => (
                          <th
                            key={cIdx}
                            className="py-2.5 px-3 font-semibold text-emerald-400 border-r border-slate-700 whitespace-nowrap print:text-black print:border-slate-300"
                          >
                            {h !== '' && h !== null && h !== undefined ? String(h) : `열 ${cIdx + 1}`}
                          </th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-slate-800 print:divide-slate-300">
                    {filteredRows.slice(1).map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-800/50 print:hover:bg-transparent">
                        <td className="py-2 px-3 text-slate-500 border-r border-slate-800 text-center font-mono print:text-black print:border-slate-300">
                          {rIdx + 1}
                        </td>
                        {row.map((cell: any, cIdx: number) => (
                          <td
                            key={cIdx}
                            className="py-2 px-3 text-slate-200 border-r border-slate-800 whitespace-nowrap print:text-black print:border-slate-300"
                          >
                            {cell !== '' && cell !== null && cell !== undefined ? String(cell) : '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 4. Other Files */}
        {file.fileType === 'other' && (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center gap-4">
            <FileText className="w-16 h-16 text-slate-500" />
            <h2 className="text-base font-semibold">{file.fileName}</h2>
            <p className="text-xs text-slate-400">
              미리보기를 지원하지 않는 파일 형식입니다. 다운로드하여 확인해 주세요.
            </p>
            <button
              onClick={handleDownload}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              파일 다운로드
            </button>
          </div>
        )}
      </main>
    </div>
  );
};
