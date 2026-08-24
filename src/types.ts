export type TaskStatus = 'pending' | 'in-progress' | 'completed';

export interface UserConfig {
  id: string;
  initials: string;
  password: string;
  name?: string;
  isAuthorized?: boolean;
  canAccessFlow?: boolean;
  canAccessInfo?: boolean;
  canManageInfo?: boolean; // Can upload, edit, delete info and complete projects
}

export interface User {
  id: string;
  initials: string;
  name: string;
}

export type InfoFolderType = 'info-pdf' | 'info-excel' | 'info-image';
export type InfoFileType = 'pdf' | 'excel' | 'image' | 'other';
export type InfoProjectStatus = 'active' | 'completed' | 'trash';

export interface InfoProject {
  id: string;
  model: string;          // 모델명 (e.g. AJ-2026, Alpha-Pro)
  machineType: string;    // 기종 / 설비 (e.g. CNC-5200, 사출 1호기)
  shipmentDate: string;   // 선적날짜 (YYYY-MM-DD)
  previousShipmentDates?: string[]; // 이전 선적날짜 기록
  productionQty: string | number; // 생산수량 (e.g. 5000 or "5,000 EA")
  notes?: string;         // 비고/메모
  status: InfoProjectStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedBy?: string;
  deletedAt?: string;
  order?: number;
}

export interface InfoFile {
  id: string;
  projectId: string;      // 소속 프로젝트 ID
  fileName: string;       // 원본 파일명 (e.g. "상판_도면_A1.pdf")
  fileType: InfoFileType; // 'pdf' | 'excel' | 'image' | 'other'
  folder: InfoFolderType; // 'info-pdf' | 'info-excel' | 'info-image'
  storagePath: string;    // R2 키 (e.g. "info-pdf/172400000_dwg.pdf")
  fileUrl: string;        // 다운로드/열람 URL 또는 data URL
  fileSize: number;       // byte size
  mimeType: string;
  uploadedBy: string;     // 업로더 (e.g. "5200", "MASTER")
  uploadedAt: string;
  updatedAt: string;
  status: 'active' | 'trash';
  deletedAt?: string;
  version?: number;
  description?: string;
  originalSize?: number;  // 압축 전 원본 크기 (이미지 최적화 표시용)
  compressedSize?: number;// 압축 후 크기
  previewData?: {
    excelSheets?: string[];
    thumbnailUrl?: string;
  };
}

export interface InfoDataState {
  projects: InfoProject[];
  files: InfoFile[];
}

export interface Project {
  id: string;
  name: string;
  model: string;
  targetQuantity: number;
  foDate: string; // ISO string
  foDateHistory?: string[]; // History of FO dates
  createdAt: string;
  sortOrder: number;
  status?: 'active' | 'completed';
  completedAt?: string;
}

export interface Process {
  id: string;
  projectId: string;
  name: string;
  targetDate: string; // ISO string
  targetDateHistory?: string[]; // History of target dates
  progress: number; // 0-100
  headers?: string[]; // Dynamic Excel headers
  excelTitle?: string | null; // Title from Excel file
}

export interface Task {
  id: string;
  projectId: string;
  processName: string;
  type: string;
  description: string;
  status: TaskStatus;
  completedAt?: string;
  initials?: string;
  delayReason?: string;
  delayType?: string;
}

export interface ProcessPart {
  id: string;
  projectId: string;
  processName: string;
  moldNo: string;
  drwNo: string;
  s: string;
  partsName: string;
  productionLocation?: string;
  plannedAt?: string | null;
  completedAt: string | null;
  initials?: string;
  delayReason: string;
  delayType: string;
  order: number;
  rawData?: any[]; // Raw row data from Excel
}

export const PROCESS_LIST = [
  '사출',
  '인쇄',
  '메탈',
  'PAINT',
  'PRINT',
  '가공',
  '조립',
  '포장'
] as const;

export type ProcessName = typeof PROCESS_LIST[number];
