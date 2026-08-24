import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCw,
  Search,
  FileSpreadsheet,
  FileText,
  Table as TableIcon,
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
  merges?: XLSX.Range[];
  colWidths?: number[];
}

export const ExcelViewer: React.FC<ExcelViewerProps> = ({ fileUrl, fileName }) => {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'document' | 'grid'>('document'); // Default: Method B (Document / A4 view)
  const [zoom, setZoom] = useState<number>(100);
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fetch arrayBuffer with proxy fallback
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
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

      const parsed: ParsedSheet[] = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name];
        // Read raw data as 2D array
        const rawData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          blankrows: false,
        }) as any[][];

        // Read merge cells
        const merges = worksheet['!merges'] || [];

        // Estimate col widths
        const cols = worksheet['!cols'] || [];
        const colWidths = cols.map((c) => (c?.wpx ? c.wpx : c?.wch ? c.wch * 9 : undefined)).filter(Boolean) as number[];

        return {
          name,
          data: rawData,
          merges,
          colWidths,
        };
      });

      setSheets(parsed);
      setActiveSheetIndex(0);

      // Mobile initial zoom calculation
      if (window.innerWidth < 640) {
        setZoom(85);
      } else {
        setZoom(100);
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

  const handleZoomIn = () => setZoom((z) => Math.min(z + 20, 250));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 20, 40));
  const handleFitWidth = () => {
    if (window.innerWidth < 640) {
      setZoom(80);
    } else {
      setZoom(100);
    }
  };

  const currentSheet = sheets[activeSheetIndex];

  // Helper to build merged matrix for Document View
  const renderDocumentTable = () => {
    if (!currentSheet || !currentSheet.data.length) {
      return (
        <div className="p-12 text-center text-slate-400 text-sm">
          시트에 표시할 데이터가 없습니다.
        </div>
      );
    }

    const data = currentSheet.data;
    const merges = currentSheet.merges || [];

    // Filter by search
    const filteredRowIndices: number[] = [];
    data.forEach((row, idx) => {
      if (!search.trim()) {
        filteredRowIndices.push(idx);
        return;
      }
      const match = row.some((cell) =>
        String(cell || '').toLowerCase().includes(search.toLowerCase())
      );
      if (match) {
        filteredRowIndices.push(idx);
      }
    });

    // Check if cell is covered by merge
    const isMergedHidden = (r: number, c: number) => {
      for (const m of merges) {
        if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
          if (r !== m.s.r || c !== m.s.c) {
            return true;
          }
        }
      }
      return false;
    };

    const getMergeSpan = (r: number, c: number) => {
      for (const m of merges) {
        if (r === m.s.r && c === m.s.c) {
          return {
            rowSpan: m.e.r - m.s.r + 1,
            colSpan: m.e.c - m.s.c + 1,
          };
        }
      }
      return { rowSpan: 1, colSpan: 1 };
    };

    // Calculate max columns
    let maxCols = 0;
    data.forEach((r) => {
      if (r.length > maxCols) maxCols = r.length;
    });

    return (
      <div
        style={{
          transform: `scale(${zoom / 100})`,
          transformOrigin: 'top center',
          transition: 'transform 0.1s ease-out',
        }}
        className="inline-block my-4"
      >
        {/* A4 / Printable Document Paper Card */}
        <div className="bg-white text-slate-900 rounded-sm shadow-2xl border border-slate-300 p-6 sm:p-10 min-w-[720px] max-w-[1200px]">
          {/* Header Title inside Document */}
          <div className="border-b-2 border-slate-900 pb-3 mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                {currentSheet.name}
              </h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{fileName}</p>
            </div>
            <div className="text-right text-[11px] text-slate-500 font-mono">
              <span>{data.length} 행 × {maxCols} 열</span>
            </div>
          </div>

          {/* Clean High-Contrast Document Table */}
          <table className="w-full border-collapse border border-slate-700 text-xs font-sans">
            <tbody>
              {filteredRowIndices.map((rIdx) => {
                const row = data[rIdx] || [];
                const isHeader = rIdx === 0;

                return (
                  <tr
                    key={rIdx}
                    className={
                      isHeader
                        ? 'bg-slate-100 font-semibold border-b-2 border-slate-700'
                        : rIdx % 2 === 1
                        ? 'bg-slate-50/60'
                        : 'bg-white'
                    }
                  >
                    {/* Row Number gutter in doc */}
                    <td className="border border-slate-300 px-2 py-1 text-[10px] text-slate-400 font-mono text-center w-8 select-none bg-slate-50">
                      {rIdx + 1}
                    </td>

                    {Array.from({ length: maxCols }).map((_, cIdx) => {
                      if (!search.trim() && isMergedHidden(rIdx, cIdx)) {
                        return null;
                      }

                      const span = !search.trim() ? getMergeSpan(rIdx, cIdx) : { rowSpan: 1, colSpan: 1 };
                      const val = row[cIdx];
                      const valStr = val !== undefined && val !== null ? String(val) : '';

                      // Auto format alignment (numbers right-aligned, text left-aligned)
                      const isNumber = !isNaN(Number(valStr)) && valStr.trim() !== '';

                      return (
                        <td
                          key={cIdx}
                          rowSpan={span.rowSpan > 1 ? span.rowSpan : undefined}
                          colSpan={span.colSpan > 1 ? span.colSpan : undefined}
                          className={`border border-slate-300 px-3 py-1.5 leading-relaxed text-slate-900 break-words ${
                            isHeader
                              ? 'text-center font-bold bg-slate-100 text-slate-900 border-slate-400'
                              : isNumber
                              ? 'text-right font-mono'
                              : 'text-left'
                          }`}
                        >
                          {search.trim() && valStr.toLowerCase().includes(search.toLowerCase()) ? (
                            <mark className="bg-yellow-200 text-slate-900 px-1 rounded font-bold">
                              {valStr}
                            </mark>
                          ) : (
                            valStr || (isHeader ? '' : '-')
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Document Footer */}
          <div className="mt-6 pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-400">
            <span>아진정밀 문서 관리 시스템 (INFO VIEW)</span>
            <span>인쇄 및 검토용 A4 스타일 뷰</span>
          </div>
        </div>
      </div>
    );
  };

  // Helper to render Raw Grid Table
  const renderGridTable = () => {
    if (!currentSheet || !currentSheet.data.length) return null;
    const data = currentSheet.data;

    let maxCols = 0;
    data.forEach((r) => {
      if (r.length > maxCols) maxCols = r.length;
    });

    const getColumnLetter = (colIdx: number) => {
      let letter = '';
      let temp = colIdx;
      while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
      }
      return letter;
    };

    return (
      <div className="flex-1 overflow-auto p-3">
        <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900 shadow-xl">
          <div className="overflow-x-auto max-h-[calc(90vh-160px)]">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="bg-slate-800/95 sticky top-0 z-10 border-b border-slate-700">
                  <th className="py-2.5 px-3 font-bold text-slate-400 border-r border-slate-700/60 w-12 text-center select-none bg-slate-800">
                    #
                  </th>
                  {Array.from({ length: maxCols }).map((_, cIdx) => (
                    <th
                      key={cIdx}
                      className="py-2 px-3 font-semibold text-emerald-400 border-r border-slate-700/60 whitespace-nowrap min-w-[90px] text-center"
                    >
                      {getColumnLetter(cIdx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.map((row, rIdx) => {
                  if (
                    search.trim() &&
                    !row.some((c) => String(c || '').toLowerCase().includes(search.toLowerCase()))
                  ) {
                    return null;
                  }

                  return (
                    <tr
                      key={rIdx}
                      className="hover:bg-slate-800/60 transition-colors odd:bg-slate-900/40 even:bg-slate-900/90"
                    >
                      <td className="py-2 px-3 text-slate-500 border-r border-slate-800 text-center font-bold select-none bg-slate-900/80">
                        {rIdx + 1}
                      </td>
                      {Array.from({ length: maxCols }).map((_, cIdx) => {
                        const val = row[cIdx];
                        const valStr = val !== undefined && val !== null ? String(val) : '';
                        return (
                          <td
                            key={cIdx}
                            className="py-2 px-3 text-slate-200 border-r border-slate-800/80 whitespace-nowrap"
                          >
                            {search.trim() && valStr.toLowerCase().includes(search.toLowerCase()) ? (
                              <mark className="bg-emerald-500/30 text-emerald-300 px-1 rounded">
                                {valStr}
                              </mark>
                            ) : (
                              valStr || '-'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-slate-300 gap-3">
        <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
        <p className="text-sm font-semibold text-slate-200">엑셀 문서를 고화질로 변환하고 있습니다...</p>
        <p className="text-xs text-slate-400">A4 문서/도면 스타일 생성 중</p>
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
        <div className="flex items-center gap-2">
          <button
            onClick={loadExcel}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            다시 시도
          </button>
          <a
            href={fileUrl}
            download={fileName}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            엑셀 다운로드
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col select-none overflow-hidden bg-slate-950">
      {/* Top Toolbar */}
      <div className="w-full px-3 py-2 bg-slate-900/95 backdrop-blur border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0 z-10">
        {/* Left: Sheets tabs */}
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

        {/* Right: Mode Toggle + Zoom Controls + Search */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
            <button
              onClick={() => setViewMode('document')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
                viewMode === 'document'
                  ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="A4 / 도면 스타일 고화질 뷰 (방식 B)"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>문서 뷰 (A4)</span>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="원본 스프레드시트 그리드 표"
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>그리드 표</span>
            </button>
          </div>

          {/* Zoom controls for Document Mode */}
          {viewMode === 'document' && (
            <div className="flex items-center gap-1 bg-slate-800/80 px-1 py-0.5 rounded-lg border border-slate-700/60">
              <button
                onClick={handleZoomOut}
                className="p-1 rounded text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                title="축소"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono text-slate-300 px-1 min-w-[2.8rem] text-center">
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
                className="p-1 rounded text-slate-300 hover:bg-slate-700 hover:text-white transition-colors hidden sm:inline-flex"
                title="화면 맞춤"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Search input */}
          <div className="relative w-36 sm:w-44">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="내용 검색..."
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

      {/* Main Content Area */}
      <div
        ref={containerRef}
        className="flex-1 w-full overflow-auto bg-slate-950 flex flex-col items-center touch-pan-x touch-pan-y"
      >
        {viewMode === 'document' ? renderDocumentTable() : renderGridTable()}
      </div>
    </div>
  );
};
