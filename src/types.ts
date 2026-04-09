export type TaskStatus = 'pending' | 'in-progress' | 'completed';

export interface UserConfig {
  id: string;
  initials: string;
  password: string;
  isAuthorized?: boolean;
}

export interface User {
  id: string;
  initials: string;
  name: string;
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
  plannedAt?: string | null;
  completedAt: string | null;
  initials?: string;
  delayReason: string;
  delayType: string;
  order: number;
  rawData?: any[]; // Raw row data from Excel
}

export interface InjectionPart extends ProcessPart {}
export interface PrintingPart extends ProcessPart {}
export interface MetalPart extends ProcessPart {}
export interface PaintPart extends ProcessPart {}
export interface PrintPart extends ProcessPart {}
export interface MachiningPart extends ProcessPart {}
export interface AssemblyPart extends ProcessPart {}
export interface PackagingPart extends ProcessPart {}

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
