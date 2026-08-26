import { EventEmitter } from 'events';
import { storage } from '@/lib/storage';

export interface AuditTaskState {
  status: 'running' | 'completed' | 'failed';
  logs: string[];
  report?: any;
  error?: string;
}

// Ensure the map and emitter persist across hot reloads in dev mode
const globalAny: any = global;

if (!globalAny.auditTaskMap) {
  globalAny.auditTaskMap = new Map<string, AuditTaskState>();
}
if (!globalAny.auditTaskEmitter) {
  globalAny.auditTaskEmitter = new EventEmitter();
  // Prevent memory leak warnings if many tasks run
  globalAny.auditTaskEmitter.setMaxListeners(100);
}

export const auditTaskMap = globalAny.auditTaskMap as Map<string, AuditTaskState>;
export const auditTaskEmitter = globalAny.auditTaskEmitter as EventEmitter;

export function getTaskState(taskId: string): AuditTaskState | undefined {
  return auditTaskMap.get(taskId);
}

export function createTask(taskId: string) {
  auditTaskMap.set(taskId, {
    status: 'running',
    logs: []
  });
}

export function updateTaskLog(taskId: string, chunk: string) {
  const task = auditTaskMap.get(taskId);
  if (task && task.status === 'running') {
    task.logs.push(chunk);
    auditTaskEmitter.emit(`update:${taskId}`, chunk);
  }
}

export function emitTaskEvent(taskId: string, type: string, data: any) {
  auditTaskEmitter.emit(`event:${taskId}`, { type, data });
}

export function completeTask(taskId: string, report: any, reportId: string) {
  const task = auditTaskMap.get(taskId);
  if (task) {
    task.status = 'completed';
    task.report = report;
    auditTaskEmitter.emit(`complete:${taskId}`, report);
  }
}

export function failTask(taskId: string, error: string) {
  const task = auditTaskMap.get(taskId);
  if (task) {
    task.status = 'failed';
    task.error = error;
    auditTaskEmitter.emit(`error:${taskId}`, error);
  }
}
