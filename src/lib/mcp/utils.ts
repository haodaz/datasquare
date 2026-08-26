import path from 'path';
import fs from 'fs';
import { mcpTools } from './generated-tools';
import { cacheGetOrSet, hashToken } from '@/lib/redis';

export function pickDashMcpBinary(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  const candidates: string[] = [];
  if (platform === 'darwin') {
    if (arch === 'x64') candidates.push('dash-mcp-darwin-amd64');
    if (arch === 'arm64') candidates.push('dash-mcp-darwin-arm64');
  } else if (platform === 'linux') {
    if (arch === 'x64') candidates.push('dash-mcp-linux-amd64');
    if (arch === 'arm64') candidates.push('dash-mcp-linux-arm64');
  } else if (platform === 'win32') {
    candidates.push('dash-mcp-windows-amd64.exe');
  }

  // Path relative to the project root in development
  const binDir = path.join(process.cwd(), 'src/lib/mcp/bin');
  
  for (const name of candidates) {
    const p = path.join(binDir, name);
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/** AssistAIDialogues upsert 的可写字段 */
export interface DialogueUpsertValues {
  id?: number;
  name?: string;
  type?: string;
  is_broadcast?: boolean;
  deleted?: boolean;
  additional_information?: string;
  /**
   * 显式指定 asker_id；用于「被问询方/管理员代为更新」的场景，
   * 避免 upsertDialogue 用当前 token 的 uid 覆盖原始发起人。
   * 不传时仍走「自动注入当前用户 UID」的兼容行为。
   */
  asker_id?: number;
  /** 显式跳过 asker_id 自动注入（用于已有记录且不希望被覆盖的场景） */
  preserveAskerId?: boolean;
}

/**
 * 自定义 AssistAIDialogues upsert，通过 dashGenericSave 接口写入。
 * 复刻 Go handler assistAIDialoguesUpsert 的逻辑：
 *   - 自动注入 asker_id（当前用户 UID）和 scene（"一答虚拟人"）
 *   - name 映射为 title
 * 解决 generated-tools.ts 中 AssistaidialoguesUpsertInput 不支持新增的 type/is_broadcast 字段的问题。
 */
export async function upsertDialogue(
  values: DialogueUpsertValues,
  token?: string,
): Promise<{ status: number; id?: number; error?: string }> {
  const saveValues: Record<string, unknown> = {
    scene: '一答虚拟人',
  };

  // 注入当前用户 UID 作为 asker_id（仅在调用方未显式指定且未要求保留时才注入）
  if (values.asker_id !== undefined && values.asker_id !== null) {
    saveValues.asker_id = values.asker_id;
  } else if (!values.preserveAskerId) {
    if (token) {
      try {
        const me = await cacheGetOrSet(
          `user:me:${hashToken(token)}`,
          () => mcpTools.userMe(token),
          60,
        );
        const uid = me.me?.uid ?? 0;
        if (uid) saveValues.asker_id = uid;
      } catch {
        // 降级：无 uid 时不写 asker_id
      }
    }
  }

  // name → title 映射（Go handler: payload["title"] = name）
  if (values.name !== undefined && values.name !== null) {
    saveValues.title = values.name;
  }
  if (values.id !== undefined && values.id !== null) {
    saveValues.id = values.id;
  }
  if (values.type !== undefined && values.type !== null) {
    saveValues.type = values.type;
  }
  if (values.is_broadcast !== undefined && values.is_broadcast !== null) {
    saveValues.is_broadcast = values.is_broadcast;
  }
  if (values.deleted !== undefined && values.deleted !== null) {
    saveValues.deleted = values.deleted;
  }
  if (values.additional_information !== undefined && values.additional_information !== null) {
    saveValues.additional_information = values.additional_information;
  }

  return mcpTools.dashGenericSave({
    model: 'AssistAIDialogues',
    values: JSON.stringify(saveValues),
  }, token);
}
