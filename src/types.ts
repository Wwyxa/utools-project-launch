export enum ProjectStatus {
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

export interface ProjectScript {
  id: string;
  name: string;
  command: string;
  status: 'IDLE' | 'RUNNING' | 'ERROR';
}

export interface Project {
  id: string;
  name: string;
  path: string;
  type: string;
  status: ProjectStatus;
  lastUpdated?: string;
  scripts: ProjectScript[];
  env: Record<string, string>;
  branch?: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
}

export interface StagedFile {
  path: string;
  additions: number;
  deletions: number;
  status: 'MODIFIED' | 'ADDED' | 'DELETED';
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}
