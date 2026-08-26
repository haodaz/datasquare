import { mcpTools } from '@/lib/mcp/generated-tools';
import { upsertDialogue } from '@/lib/mcp/utils';
import { cacheGetOrSet, hashToken } from '@/lib/redis';
import { randomUUID } from 'crypto';
import type { AssistAIDialogueItem } from './types';
import { characterManager } from '@/lib/ai/characters';
import { checkIsAdmin } from '@/lib/auth';

export interface A2ARecord {
  /** 对话存储的数据库 ID（AssistAIDialogues.id） */
  id?: string;
  /** UUID，唯一标识一条 A2A 记录 */
  record_id: string;
  mode: 'chat' | 'packet';
  caller: { id: string; name: string };
  callee: { id: string; name: string };
  topic: string;
  transcript: { role: 'caller' | 'callee'; name: string; content: string }[];
  conclusion: string;
  turns: number;
  created_at: string;
  uid?: number;
  /** 被问询方人工确认 */
  callee_confirm?: { message: string; confirmed_at: string } | null;
  /** 问询方人工答复（仅在 callee_confirm 存在后可填） */
  caller_confirm?: { message: string; confirmed_at: string } | null;
  /** 体验标记：是否为普通用户利用官方分身体验发起 */
  is_experience?: boolean;
  /** 发起体验的真实账号/名称 */
  initiator_account?: string;
}

/** additional_information 中存储的 A2A 元数据 */
interface A2AInfo {
  type: 'a2a';
  record_id: string;
  mode: 'chat' | 'packet';
  caller: { id: string; name: string };
  callee: { id: string; name: string };
  topic: string;
  transcript: { role: 'caller' | 'callee'; name: string; content: string }[];
  conclusion: string;
  turns: number;
  created_at: string;
  callee_confirm?: { message: string; confirmed_at: string } | null;
  caller_confirm?: { message: string; confirmed_at: string } | null;
  is_experience?: boolean;
  initiator_account?: string;
}

/** 获取当前用户 uid（带缓存） */
async function getUid(token: string): Promise<number> {
  const me = await cacheGetOrSet(
    `user:me:${hashToken(token)}`,
    () => mcpTools.userMe(token),
    60,
  );
  return (me as any).me?.uid ?? 0;
}

function parseInfo(raw: unknown): A2AInfo | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if ((obj as any)?.type !== 'a2a') return null;
    return obj as A2AInfo;
  } catch {
    return null;
  }
}

/** 存储一条 A2A 对接记录（使用 AssistAIDialogues + AssistAIChats 对话存储） */
export async function saveA2ARecord(
  record: Omit<A2ARecord, 'record_id' | 'uid' | 'id'>,
  token: string,
): Promise<string> {
  const uid = await getUid(token);
  if (!uid) throw new Error('无法获取用户 ID，请检查登录状态');

  const record_id = randomUUID();

  // 构建 additional_information：完整存储 A2A 元数据 + transcript
  const infoObj: A2AInfo = {
    type: 'a2a',
    record_id,
    mode: record.mode,
    caller: record.caller,
    callee: record.callee,
    topic: record.topic,
    transcript: record.transcript,
    conclusion: record.conclusion,
    turns: record.turns,
    created_at: record.created_at,
    is_experience: record.is_experience,
    initiator_account: record.initiator_account,
  };

  // 1. 创建/更新对话记录（AssistAIDialogues）
  const result = await upsertDialogue({
    name: `${record.caller.name} ↔ ${record.callee.name} [${record.topic}]`,
    type: 'a2a',
    additional_information: JSON.stringify(infoObj),
  }, token);

  const dialogueId = result?.id;
  if (!dialogueId || result.status !== 200) {
    throw new Error(result.error || `upsertDialogue failed (status=${result.status})`);
  }

  // 2. 为每条 transcript 创建聊天消息（AssistAIChats），对齐 roundtables.pushMessage 写法
  for (const msg of record.transcript) {
    const isCaller = msg.role === 'caller';
    try {
      await mcpTools.assistchatUpsert({
        assist_ai_dialogues_id: dialogueId,
        ask: isCaller ? msg.content : '',
        ai_data: JSON.stringify({
          role: msg.role,
          name: msg.name,
          content: msg.content,
        }),
      }, token);
    } catch (e) {
      // 单条消息写入失败不阻断整体流程
      console.warn('[A2A/SAVE] assistchatUpsert failed for a transcript entry:', (e as Error).message);
    }
  }

  console.log(`[A2A/SAVE] OK record_id=${record_id} dialogue_id=${dialogueId} uid=${uid}`);
  return record_id;
}

/** 获取当前用户的 A2A 历史（按时间倒序） */
export async function getMyA2ARecords(token: string): Promise<A2ARecord[]> {
  const uid = await getUid(token);
  if (!uid) return [];

  const condition = JSON.stringify({
    logic_operator: '&',
    children: [
      {
        logic_operator: '|',
        children: [
          { leaf: { field: 'scene', comparator: '=', value: '一答虚拟人' } },
          { leaf: { field: 'scene', comparator: '=', value: '知己虚拟人' } },
        ],
      },
      { leaf: { field: 'deleted', comparator: '!=', value: true } },
      {
        logic_operator: '|',
        children: [
          { leaf: { field: 'type', comparator: '=', value: 'a2a' } },
          { leaf: { field: 'additional_information', comparator: 'ilike', value: '%"type":"a2a"%' } },
        ],
      },
      { leaf: { field: 'asker_id.id', comparator: '=', value: uid } },
    ],
  });

  const result = await mcpTools.dashGenericSearch<AssistAIDialogueItem>({
    model: 'AssistAIDialogues',
    fields: ['id', 'additional_information', 'create_date'],
    condition,
    limit: 100,
    offset: 0,
    sort: '[{"field":"id","order":"DESC"}]',
  }, token);

  return (result?.items || [])
    .map((item) => {
      const info = parseInfo(item.additional_information);
      if (!info) return null;
      return {
        id: String(item.id),
        record_id: info.record_id,
        mode: info.mode,
        caller: info.caller,
        callee: info.callee,
        topic: info.topic,
        transcript: info.transcript,
        conclusion: info.conclusion,
        turns: info.turns,
        created_at: item.create_date || info.created_at,
        uid,
        callee_confirm: info.callee_confirm ?? null,
        caller_confirm: info.caller_confirm ?? null,
      } satisfies A2ARecord;
    })
    .filter(Boolean) as A2ARecord[];
}

/** 获取所有用户的 A2A 记录（管理员用），不限制 asker_id */
export async function getAllA2ARecords(
  token: string,
  limit = 50,
  offset = 0,
): Promise<{ records: A2ARecord[]; total: number }> {
  const condition = JSON.stringify({
    logic_operator: '&',
    children: [
      {
        logic_operator: '|',
        children: [
          { leaf: { field: 'scene', comparator: '=', value: '一答虚拟人' } },
          { leaf: { field: 'scene', comparator: '=', value: '知己虚拟人' } },
        ],
      },
      { leaf: { field: 'deleted', comparator: '!=', value: true } },
      {
        logic_operator: '|',
        children: [
          { leaf: { field: 'type', comparator: '=', value: 'a2a' } },
          { leaf: { field: 'additional_information', comparator: 'ilike', value: '%"type":"a2a"%' } },
        ],
      },
    ],
  });

  const result = await mcpTools.dashGenericSearch<AssistAIDialogueItem>({
    model: 'AssistAIDialogues',
    fields: ['id', 'additional_information', 'create_date', 'asker_id'],
    condition,
    limit,
    offset,
    sort: '[{"field":"id","order":"DESC"}]',
  }, token);
  const records = (result?.items || [])
    .map((item) => {
      const info = parseInfo(item.additional_information);
      if (!info) return null;
      // 问询方（发起人）的 uid，记录到 A2ARecord.uid 中供前端判断归属
      const askerUid = (item as any).asker_id?.id ?? (item as any).asker_id ?? null;
      return {
        id: String(item.id),
        record_id: info.record_id,
        mode: info.mode,
        caller: info.caller,
        callee: info.callee,
        topic: info.topic,
        transcript: info.transcript,
        conclusion: info.conclusion,
        turns: info.turns,
        created_at: item.create_date || info.created_at,
        uid: typeof askerUid === 'number' ? askerUid : undefined,
        callee_confirm: info.callee_confirm ?? null,
        caller_confirm: info.caller_confirm ?? null,
      } satisfies A2ARecord;
    })
    .filter(Boolean) as A2ARecord[];

  return { records, total: records.length };
}

/**
 * 获取当前用户「被问询」的 A2A 历史
 * —— 查找 callee.id 属于当前用户旗下角色的所有记录
 */
export async function getMyCalleeA2ARecords(token: string): Promise<A2ARecord[]> {
  const uid = await getUid(token);
  if (!uid) return [];

  const isAdmin = await checkIsAdmin(token);
  // 目前普通用户并不拥有自己创建的开放问询AI角色，只有 admin 才拥有官方角色的权限
  // 因此，如果是非 admin 用户，直接返回空数组，避免普通用户看到全局的被问询记录
  if (!isAdmin) {
    return [];
  }

  // 拿当前用户自己的角色列表
  const myChars = await characterManager.getAllCharacters(token);
  if (!myChars.length) return [];
  const myCharIds = new Set(myChars.map((c) => c.id));

  // 拉取所有带 a2a 标记的对话（不限 asker_id）
  const condition = JSON.stringify({
    logic_operator: '&',
    children: [
      {
        logic_operator: '|',
        children: [
          { leaf: { field: 'scene', comparator: '=', value: '一答虚拟人' } },
          { leaf: { field: 'scene', comparator: '=', value: '知己虚拟人' } },
        ],
      },
      { leaf: { field: 'deleted', comparator: '!=', value: true } },
      {
        logic_operator: '|',
        children: [
          { leaf: { field: 'type', comparator: '=', value: 'a2a' } },
          { leaf: { field: 'additional_information', comparator: 'ilike', value: '%"type":"a2a"%' } },
        ],
      },
    ],
  });

  const result = await mcpTools.dashGenericSearch<AssistAIDialogueItem>({
    model: 'AssistAIDialogues',
    fields: ['id', 'additional_information', 'create_date', 'asker_id'],
    condition,
    limit: 200,
    offset: 0,
    sort: '[{"field":"id","order":"DESC"}]',
  }, token);

  return (result?.items || [])
    .map((item) => {
      const info = parseInfo(item.additional_information);
      if (!info) return null;
      // 只保留 callee.id 属于我的角色的记录
      if (!myCharIds.has(info.callee.id)) return null;
      const askerUid = (item as any).asker_id?.id ?? (item as any).asker_id ?? null;
      return {
        id: String(item.id),
        record_id: info.record_id,
        mode: info.mode,
        caller: info.caller,
        callee: info.callee,
        topic: info.topic,
        transcript: info.transcript,
        conclusion: info.conclusion,
        turns: info.turns,
        created_at: item.create_date || info.created_at,
        // 这里 uid 记录的是「问询方（asker）」的 uid，区别于当前用户（被问询方）的 uid。
        // 前端用它来判断「这条记录的发起人是不是我」。
        uid: typeof askerUid === 'number' ? askerUid : undefined,
        callee_confirm: info.callee_confirm ?? null,
        caller_confirm: info.caller_confirm ?? null,
      } satisfies A2ARecord;
    })
    .filter(Boolean) as A2ARecord[];
}

/**
 * 被问询方或问询方提交人工确认
 * role='callee' —— 被问询方第一步确认
 * role='caller' —— 问询方答复（仅 callee_confirm 已存在时可用）
 */
export async function confirmA2ARecord(
  dialogue_id: string,
  role: 'callee' | 'caller',
  message: string,
  token: string,
): Promise<void> {
  // 获取当前记录
  const getResult = await mcpTools.dashGenericGet<{ additional_information?: string }>({
    model: 'AssistAIDialogues',
    id: Number(dialogue_id),
    fields: ['id', 'additional_information'],
  }, token) as any;

  const raw = getResult?.item?.additional_information;
  const info = parseInfo(raw);
  if (!info) throw new Error('无法解析记录内容');

  // 状态验证
  if (role === 'caller' && !info.callee_confirm) {
    throw new Error('被问询方尚未确认，问询方暂时无法答复');
  }
  if (role === 'callee' && info.callee_confirm) {
    throw new Error('被问询方已经确认过');
  }
  if (role === 'caller' && info.caller_confirm) {
    throw new Error('问询方已经答复过');
  }

  const confirm = { message: message.trim(), confirmed_at: new Date().toISOString() };
  if (role === 'callee') {
    info.callee_confirm = confirm;
  } else {
    info.caller_confirm = confirm;
  }

  // 写回 AssistAIDialogues
  // 关键：必须保留原始 asker_id（问询方的 uid），否则被问询方（管理员）用自己 token 调用 upsertDialogue
  // 会导致原 asker_id 被覆盖为管理员的 uid，从而问询方在自己的"我发起的"记录里查不到这条记录。
  // 同时通过 cacheGetOrSet 读取原记录里的 asker_id 字段（如果存在）。
  const originalRecord = await mcpTools.dashGenericGet<{ asker_id?: number }>({
    model: 'AssistAIDialogues',
    id: Number(dialogue_id),
    fields: ['id', 'asker_id'],
  }, token) as any;
  // MCP 关系字段可能返回 { id: number } 对象或纯数字，统一提取为数字
  const rawAskerId = originalRecord?.item?.asker_id;
  const originalAskerId: number | undefined =
    typeof rawAskerId === 'number' ? rawAskerId : rawAskerId?.id;

  const upsertValues: any = {
    id: Number(dialogue_id),
    type: 'a2a',
    additional_information: JSON.stringify(info),
    preserveAskerId: true, // 不要用当前 token 的 uid 覆盖 asker_id
  };
  if (originalAskerId) {
    // 显式传回原 asker_id，确保即使 MCP 默认会按 token 注入 uid 也不会被覆盖
    upsertValues.asker_id = originalAskerId;
  }

  const saveResult = await upsertDialogue(upsertValues, token) as any;

  if (!saveResult || saveResult.status !== 200) {
    throw new Error(saveResult?.error || '写入失败');
  }
}
