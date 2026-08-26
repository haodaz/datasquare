/**
 * 工具使用日志 — 记录每次工具执行的完整过程到 Supabase
 * 
 * 用法：在每个 tool route 中：
 *   const logger = new ToolUsageLogger('pingfang-search', queryName);
 *   logger.addLog(step, message);   // 记录流式阶段日志
 *   logger.setResult(data);          // 记录最终结果
 *   await logger.save();             // 工具执行结束时保存
 */

import { supabase } from '@/lib/supabase/client';

export class ToolUsageLogger {
  private toolName: string;
  private query: string;
  private logs: { step: string; message: string; timestamp: string }[] = [];
  private rawResult: any = null;
  private aiRenderedResult: string = '';
  private startTime: number;
  private success: boolean = true;
  private errorMessage: string = '';
  private userId: string | null = null;

  constructor(toolName: string, query: string, userId?: string) {
    this.toolName = toolName;
    this.query = query;
    this.startTime = Date.now();
    this.userId = userId || null;
  }

  /** 记录一条流式日志 */
  addLog(step: string, message: string) {
    this.logs.push({ step, message, timestamp: new Date().toISOString() });
  }

  /** 设置工具返回的原始数据 */
  setResult(data: any) {
    this.rawResult = data;
  }

  /** 设置 AI 渲染的最终报告文本 */
  setAiRenderedResult(text: string) {
    this.aiRenderedResult = text;
  }

  /** 标记执行失败 */
  setError(message: string) {
    this.success = false;
    this.errorMessage = message;
  }

  /** 保存到 Supabase（fire-and-forget，不阻塞主流程） */
  async save(): Promise<number | null> {
    try {
      const durationMs = Date.now() - this.startTime;

      const { data, error } = await supabase
        .from('tool_usage_logs')
        .insert({
          tool_name: this.toolName,
          query: this.query,
          stream_log: this.logs,
          ai_rendered_result: this.aiRenderedResult,
          raw_result: this.rawResult,
          duration_ms: durationMs,
          success: this.success,
          error_message: this.errorMessage || null,
          created_by: this.userId,
        })
        .select('id')
        .single();

      if (error) {
        console.error(`[ToolUsageLogger] save error for ${this.toolName}:`, error.message);
        return null;
      }

      console.log(`[ToolUsageLogger] Saved: ${this.toolName} "${this.query}" (${durationMs}ms, id=${data?.id})`);
      return data?.id || null;
    } catch (e: any) {
      console.error(`[ToolUsageLogger] save exception:`, e.message);
      return null;
    }
  }
}
