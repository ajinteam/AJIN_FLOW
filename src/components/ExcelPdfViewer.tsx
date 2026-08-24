import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Search,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Printer,
  FileText,
  Maximize2,
  Minimize2,
  Layers,
  ArrowUpDown,
} from 'lucide-react';

interface ParsedSheet {
  name: string;
  rows: any[][];
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  cols: Array<{ wch?: number; width?: number }>;
  maxCols: number;
}

interface ExcelPdfViewerProps {
  fileUrl: string;
  fileName: string;
}

export const ExcelPdfViewer: React.FC<ExcelPdfViewerProps> = ({ fileUrl, fileName }) => {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState<number>(0);
  const [viewAllSheets, setViewAllSheets] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [zoom, setZoom] = useState<number>(100);
  const [viewMode, setViewMode] = useState<'pdf-doc' | 'table'>('pdf-doc');

  const containerRef = useRef<HTMLDivElement>(null);

  // Load and parse Excel workbook with SheetJS
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError('');

    const loadWorkbook = async () => {
      try {
        let arrayBuffer: ArrayBuffer;

        if (fileUrl.startsWith('data:')) {
          const base64 = fileUrl.split(',')[1];
          const binaryString = window.atob(base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          arrayBuffer = bytes.buffer;
        } else if (fileUrl.startsWith('blob:')) {
          const res = await fetch(fileUrl);
          arrayBuffer = await res.arrayBuffer();
        } else {
          const res = await fetch(fileUrl);
          if (!res.ok) throw new Error('파일 데이터를 불러오지 못했습니다.');
          arrayBuffer = await res.arrayBuffer();
        }

        const workbook = XLSX.read(arrayBuffer, {
          type: 'array',
          cellStyles: true,
          cellDates: true,
          cellNF: true,
        });

        if (isCancelled) return;

        const parsed: ParsedSheet[] = workbook.SheetNames.map((name) => {
          const ws = workbook.Sheets[name];
          const rawRows = XLSX.utils.sheet_to_json<any[]>(ws, {
            header: 1,
            defval: '',
            blankrows: false,
          });

          // Trim empty trailing rows & cols
          let maxCols = 0;
          const cleanRows = rawRows.map((row) => {
            if (row.length > maxCols) maxCols = row.length;
            return row;
          });

          const merges = ws['!merges'] || [];
          const cols = ws['!cols'] || [];

          return {
            name,
            rows: cleanRows,
            merges,
            cols,
            maxCols: Math.max(maxCols, 1),
          };
        });

        setSheets(parsed);
        setLoading(false);
      } catch (err: any) {
        console.error('Excel parse error:', err);
        if (!isCancelled) {
          setError('엑셀 파일을 문서 형식으로 변환하는 중 오류가 발생했습니다: ' + (err?.message || '알 수 없는 오류'));
          setLoading(false);
        }
      }
    };

    loadWorkbook();

    return () => {
      isCancelled = true;
    };
  }, [fileUrl]);

  const activeSheet = sheets[activeSheetIdx] || null;

  // Build a lookup map of merged cells for the active sheet
  const mergeLookup = useMemo(() => {
    if (!activeSheet) return { skipMap: new Set<string>(), spanMap: new Map<string, { rowSpan: number; colSpan: number }>() };

    const skipMap = new Set<string>();
    const spanMap = new Map<string, { rowSpan: number; colSpan: number }>();

    activeSheet.merges.forEach((m) => {
      const { s, e } = m;
      const key = `${s.r},${s.c}`;
      spanMap.set(key, {
        rowSpan: e.r - s.r + 1,
        colSpan: e.c - s.c + 1,
      });

      for (let r = s.r; r <= e.r; r++) {
        for (let c = s.c; c <= e.c; c++) {
          if (r !== s.r || c !== s.c) {
            skipMap.add(`${r},${c}`);
          }
        }
      }
    });

    return { skipMap, spanMap };
  }, [activeSheet]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 15, 250));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 15, 50));
  const handleResetZoom = () => setZoom(100);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-slate-300">
        <div className="w-10 h-10 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold text-slate-200">엑셀 사양서를 PDF 문서로 변환 중...</p>
        <p className="text-xs text-slate-400 mt-1">도면 규격 및 표 서식을 최적화하고 있습니다.</p>
      </div>
    );
  }

  if (error || sheets.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-300">
        <FileSpreadsheet className="w-12 h-12 text-rose-400 mb-3" />
        <p className="text-sm font-semibold text-rose-300 mb-1">{error || '엑셀 데이터가 비어 있습니다.'}</p>
        <p className="text-xs text-slate-400 max-w-md">파일이 손상되었거나 암호가 설정되어 있을 수 있습니다.</p>
      </div>
    );
  }

  // Helper to determine cell styling heuristics (Headers, highlights, alignments)
  const getCellClasses = (val: any, rowIndex: number, colIndex: number) => {
    const str = String(val ?? '').trim();
    const isHeaderRow = rowIndex === 0 || rowIndex === 1;
    const isTotalRow = /^(total|합계|소계|합|총계)/i.test(str);
    const isHighlight = /^(sobu|musashino|ho-|cph-|rp반영|remark|truck|안내|주의|특기사항)/i.test(str);
    const isNumber = !isNaN(Number(str.replace(/[,%\s]/g, ''))) && str.length > 0 && !/^0\d+/.test(str);

    let classes = 'border border-slate-700/60 px-2 py-1.5 text-xs text-slate-900 leading-tight transition-colors ';

    if (isHeaderRow) {
      classes += 'bg-slate-100 font-bold text-slate-900 text-center ';
    } else if (isTotalRow) {
      classes += 'bg-amber-50 font-bold text-slate-900 ';
    } else if (isHighlight && str.length < 30) {
      classes += 'font-semibold text-slate-900 ';
    }

    if (isNumber) {
      classes += 'text-right font-mono ';
    } else if (str.length <= 10 && !/\s/.test(str)) {
      classes += 'text-center ';
    } else {
      classes += 'text-left ';
    }

    return classes;
  };

  const sheetsToRender = viewAllSheets ? sheets : [activeSheet!];

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 select-none overflow-hidden">
      {/* Top Controls Toolbar */}
      <div className="w-full px-3 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 z-20 shadow-md">
        {/* Left: Sheet Tabs & View Mode */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full py-0.5">
          <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700/60 mr-1">
            <button
              onClick={() => {
                setViewAllSheets(false);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                !viewAllSheets
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              시트별 보기
            </button>
            <button
              onClick={() => {
                setViewAllSheets(true);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                viewAllSheets
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              전체 시트 연속보기
            </button>
          </div>

          {!viewAllSheets && (
            <div className="flex items-center gap-1">
              {sheets.map((s, idx) => (
                <button
                  key={s.name}
                  onClick={() => setActiveSheetIdx(idx)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${
                    activeSheetIdx === idx
                      ? 'bg-slate-100 text-slate-950 border-slate-300 font-semibold shadow-sm'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Search, Zoom, Print */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Search Filter */}
          <div className="relative w-36 sm:w-52">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="내용 / 품번 검색..."
              className="w-full pl-8 pr-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
              >
                ×
              </button>
            )}
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700/60">
            <button
              onClick={handleZoomOut}
              className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
              title="축소"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-1.5 text-[11px] font-mono text-slate-300 hover:text-white"
              title="100% 맞춤"
            >
              {zoom}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
              title="확대"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Print button */}
          <button
            onClick={handlePrint}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 hidden sm:flex items-center gap-1 text-xs"
            title="문서 인쇄"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Continuous Document Scroll View Area */}
      <div
        ref={containerRef}
        className="flex-1 w-full overflow-auto p-2 sm:p-6 flex flex-col items-center bg-slate-950/90 touch-pan-x touch-pan-y"
      >
        <div
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top center',
            transition: 'transform 0.1s ease-out',
          }}
          className="w-full max-w-6xl flex flex-col items-center gap-6 pb-20 select-text"
        >
          {sheetsToRender.map((sheet, sIdx) => {
            const isMatch = (text: any) => {
              if (!searchQuery.trim()) return true;
              return String(text || '').toLowerCase().includes(searchQuery.toLowerCase());
            };

            const sheetMerges = sheet.merges || [];
            const skipMap = new Set<string>();
            const spanMap = new Map<string, { rowSpan: number; colSpan: number }>();

            sheetMerges.forEach((m) => {
              const { s, e } = m;
              spanMap.set(`${s.r},${s.c}`, {
                rowSpan: e.r - s.r + 1,
                colSpan: e.c - s.c + 1,
              });

              for (let r = s.r; r <= e.r; r++) {
                for (let c = s.c; c <= e.c; c++) {
                  if (r !== s.r || c !== s.c) {
                    skipMap.add(`${r},${c}`);
                  }
                }
              }
            });

            // Filter rows based on search
            const rowsToDisplay = sheet.rows.filter((row, rIdx) => {
              if (!searchQuery.trim()) return true;
              if (rIdx === 0 || rIdx === 1) return true; // Keep headers
              return row.some((cell) => isMatch(cell));
            });

            return (
              <div
                key={sheet.name}
                className="w-full bg-white text-slate-900 rounded-sm shadow-2xl border border-slate-300 p-4 sm:p-8 flex flex-col font-sans overflow-x-auto print:shadow-none print:border-none print:m-0 print:p-0"
              >
                {/* PDF Spec Sheet Top Document Header */}
                <div className="border-b-2 border-slate-800 pb-3 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                      DOC
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-base sm:text-lg text-slate-900 tracking-tight leading-none">
                          {fileName.replace(/\.(xlsx|xls|csv)$/i, '')}
                        </h3>
                        <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 rounded">
                          시트: {sheet.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        도면 및 생산 사양서 규격 뷰어 • 총 {sheet.rows.length}행 / {sheet.maxCols}열
                      </p>
                    </div>
                  </div>

                  {/* Page indicator tag */}
                  <div className="text-right text-[11px] text-slate-400 font-mono self-end sm:self-center">
                    PAGE {sIdx + 1} / {sheetsToRender.length}
                  </div>
                </div>

                {/* Table Layout */}
                <div className="w-full overflow-x-auto">
                  <table className="w-full border-collapse border border-slate-800 text-xs min-w-full">
                    <tbody>
                      {rowsToDisplay.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          className={`${
                            rIdx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'
                          } hover:bg-sky-50/60 transition-colors`}
                        >
                          {row.map((cellVal, cIdx) => {
                            const coordKey = `${rIdx},${cIdx}`;
                            if (skipMap.has(coordKey)) {
                              return null;
                            }

                            const span = spanMap.get(coordKey);
                            const rowSpan = span?.rowSpan || 1;
                            const colSpan = span?.colSpan || 1;

                            const cellStr = String(cellVal ?? '').trim();
                            const isSearchMatch =
                              searchQuery.trim().length > 0 &&
                              cellStr.toLowerCase().includes(searchQuery.toLowerCase());

                            return (
                              <td
                                key={cIdx}
                                rowSpan={rowSpan}
                                colSpan={colSpan}
                                className={`${getCellClasses(
                                  cellVal,
                                  rIdx,
                                  cIdx
                                )} ${
                                  isSearchMatch
                                    ? 'bg-yellow-200 font-bold text-slate-950 ring-2 ring-amber-400 ring-inset'
                                    : ''
                                }`}
                              >
                                {cellStr || <span className="text-transparent">.</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Document Footer */}
                <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>아진정밀 생산 관리 시스템 • 사양서 뷰어</span>
                  <span>- {sIdx + 1} -</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
