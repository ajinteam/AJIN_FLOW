import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCw,
  Search,
  FileSpreadsheet,
  Download,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface ExcelViewerProps {
  fileUrl: string;
  fileName: string;
}

interface ParsedSheet {
  name: string;
  data: any[][];
  merges: XLSX.Range[];
  colCount: number;
  rowCount: number;
}

export const ExcelViewer: React.FC<ExcelViewerProps> = ({ fileUrl, fileName }) => {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const containerRef = useRef<HTMLDivElement | null>(null);

  const fetchExcelBuffer = async (url: string): Promise<ArrayBuffer> => {
    if (url.startsWith('data:')) {
      const base64 = url.split(',')[1];
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.arrayBuffer();
      }
    } catch (e) {
      console.warn('Direct fetch failed, trying proxy fetch:', e);
    }

    const proxyUrl = `/api/proxy-file?url=${encodeURIComponent(url)}`;
    const proxyRes = await fetch(proxyUrl);
    if (!proxyRes.ok) {
      throw new Error(`엑셀 파일을 불러올 수 없습니다 (${proxyRes.status})`);
    }
    return await proxyRes.arrayBuffer();
  };

  const loadExcel = async () => {
    setLoading(true);
    setError('');
    try {
      const arrayBuffer = await fetchExcelBuffer(fileUrl);
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellStyles: true });

      const parsed: ParsedSheet[] = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name];
        const rawData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          blankrows: false,
        }) as any[][];

        const merges = worksheet['!merges'] || [];

        let maxCols = 0;
        rawData.forEach((r) => {
          if (r.length > maxCols) maxCols = r.length;
        });

        return {
          name,
          data: rawData,
          merges,
          colCount: maxCols || 1,
          rowCount: rawData.length || 1,
        };
      });

      setSheets(parsed);
      setActiveSheetIndex(0);

      // Auto fit initial zoom for mobile
      if (typeof window !== 'undefined') {
        const screenW = window.innerWidth;
        if (screenW < 640) {
          setZoom(65);
        } else if (screenW < 1024) {
          setZoom(85);
        } else {
          setZoom(100);
        }
      }
    } catch (err: any) {
      console.error('Excel parse error:', err);
      setError(err?.message || '엑셀 문서를 파싱하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExcel();
  }, [fileUrl]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 350));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 30));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleFitWidth = () => {
    if (typeof window !== 'undefined') {
      const screenW = window.innerWidth;
      if (screenW < 640) setZoom(60);
      else setZoom(100);
    }
  };

  const currentSheet = sheets[activeSheetIndex];

  // Helper for merge cells
  const isMergedHidden = (r: number, c: number) => {
    if (!currentSheet) return false;
    for (const m of currentSheet.merges) {
      if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
        if (r !== m.s.r || c !== m.s.c) {
          return true;
        }
      }
    }
    return false;
  };

  const getMergeSpan = (r: number, c: number) => {
    if (!currentSheet) return { rowSpan: 1, colSpan: 1 };
    for (const m of currentSheet.merges) {
      if (r === m.s.r && c === m.s.c) {
        return {
          rowSpan: m.e.r - m.s.r + 1,
          colSpan: m.e.c - m.s.c + 1,
        };
      }
    }
    return { rowSpan: 1, colSpan: 1 };
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-300 gap-3">
        <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
        <p className="text-sm font-semibold text-slate-200">엑셀 도면을 고화질로 렌더링하고 있습니다...</p>
        <p className="text-xs text-slate-400">사진/도면 뷰 생성 중</p>
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
          onClick={loadExcel}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col select-none overflow-hidden bg-slate-950">
      {/* Top Toolbar */}
      <div className="w-full px-3 py-2 bg-slate-900/95 backdrop-blur border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 z-10">
        {/* Sheets tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full py-0.5">
          {sheets.map((sheet, sIdx) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheetIndex(sIdx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeSheetIndex === sIdx
                  ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/40'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{sheet.name}</span>
            </button>
          ))}
        </div>

        {/* Zoom & Screen Fit & Search */}
        <div className="flex items-center gap-1.5">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-slate-800/90 px-1 py-0.5 rounded-lg border border-slate-700">
            <button
              onClick={handleZoomOut}
              className="p-1 rounded text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="축소"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono text-slate-200 px-1 min-w-[2.8rem] text-center font-semibold">
              {zoom}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="확대"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleFitWidth}
              className="p-1 rounded text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="화면 맞춤"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRotate}
              className="p-1 rounded text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="90도 회전"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Search */}
          <div className="relative w-32 sm:w-40">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="품명/도번 검색"
              className="w-full pl-7 pr-5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Drawing / Photo Sheet Area */}
      <div
        ref={containerRef}
        className="flex-1 w-full overflow-auto bg-slate-950 p-2 sm:p-6 flex items-start justify-center touch-pan-x touch-pan-y"
      >
        {currentSheet && currentSheet.data.length > 0 ? (
          <div
            style={{
              transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
              transformOrigin: 'top center',
              transition: 'transform 0.12s ease-out',
            }}
            className="inline-block my-auto select-text"
          >
            {/* Pure Clean White Drawing Sheet Surface */}
            <div className="bg-white text-black p-4 sm:p-8 shadow-2xl rounded-sm border border-slate-400 min-w-[760px] max-w-full">
              {/* Sheet Title Bar */}
              <div className="mb-3 pb-2 border-b-2 border-black flex items-center justify-between">
                <span className="font-bold text-sm text-black tracking-wider">
                  {currentSheet.name}
                </span>
                <span className="text-[11px] font-mono text-slate-600">
                  {fileName}
                </span>
              </div>

              {/* Exact Drawing Table Grid */}
              <table className="border-collapse border-2 border-black text-[11px] font-sans leading-tight bg-white">
                <tbody>
                  {currentSheet.data.map((row, rIdx) => {
                    const isFirstRow = rIdx === 0;

                    return (
                      <tr
                        key={rIdx}
                        className={isFirstRow ? 'bg-slate-200 font-bold' : 'bg-white'}
                      >
                        {Array.from({ length: currentSheet.colCount }).map((_, cIdx) => {
                          if (!search.trim() && isMergedHidden(rIdx, cIdx)) {
                            return null;
                          }

                          const span = !search.trim() ? getMergeSpan(rIdx, cIdx) : { rowSpan: 1, colSpan: 1 };
                          const val = row[cIdx];
                          const valStr = val !== undefined && val !== null ? String(val) : '';

                          const isMatched =
                            search.trim() &&
                            valStr.toLowerCase().includes(search.toLowerCase());

                          return (
                            <td
                              key={cIdx}
                              rowSpan={span.rowSpan > 1 ? span.rowSpan : undefined}
                              colSpan={span.colSpan > 1 ? span.colSpan : undefined}
                              className={`border border-black px-2 py-1.5 text-black whitespace-pre-wrap ${
                                isFirstRow ? 'text-center font-bold bg-slate-200' : ''
                              } ${isMatched ? 'bg-yellow-200 font-bold' : ''}`}
                            >
                              {valStr}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Bottom Sheet Notes */}
              <div className="mt-4 pt-2 border-t border-slate-300 flex justify-between text-[10px] text-slate-500 font-mono">
                <span>AJIN PRECISION - SPECIFICATION SHEET</span>
                <span>{currentSheet.rowCount} ROWS × {currentSheet.colCount} COLS</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-12 text-slate-400 text-sm text-center">
            표시할 데이터가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
};
