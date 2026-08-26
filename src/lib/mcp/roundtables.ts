import { mcpTools, UserMeOutput } from './generated-tools';
import { upsertDialogue } from './utils';
import type { DialogueUpsertValues } from './utils';
import { RoomMessage } from '@/lib/characters/types';
import { RoundtableRecord } from './crm';
import { cacheGetOrSet, cacheDel, hashToken, registerPrefetch } from '@/lib/redis';
import { mcpConversations } from './conversations';
import type { DashGenericSearchResponse } from './generated-tools';
import type {
  AssistAIDialogueItem,
  AssistAIChatItem,
} from './types';

const BROADCAST_ROOMS_KEY = 'roundtable:broadcast_rooms';
const BROADCAST_ROOMS_TTL = 60; // 60s

/** 原始回源函数：不依赖用户 token，供后台预刷新使用 */
async function rawFetchBroadcastRooms(): Promise<RoundtableRecord[]> {
  const token = process.env.FLORA_AUTH_BEARER || '';

  const condition = JSON.stringify({
    logic_operator: '&',
    children: [
      { leaf: { field: 'scene', comparator: '=', value: '一答虚拟人' } },
      { leaf: { field: 'deleted', comparator: '!=', value: true } },
      { leaf: { field: 'is_broadcast', comparator: '=', value: true } },
    ],
  });

  try {
    const d = await mcpTools.dashGenericSearch({
      model: 'AssistAIDialogues',
      fields: ['id', 'title', 'type', 'is_broadcast', 'additional_information', 'create_date', 'write_date'],
      limit: 100,
      offset: 0,
      condition,
      sort: '[{"field":"id","order":"desc"}]',
    }, token);

    const items = extractSearchItems(d);
    const result: RoundtableRecord[] = [];

    for (const it of items) {
      const row = it || ({} as AssistAIDialogueItem);
      if (row?.type && row.type !== 'roundtable') continue;
      const info = safeParse(row?.additional_information) as unknown as RoundtableInfo;
      if (!row?.type && info?.type !== 'roundtable') continue;
      const entryId = row?.id;
      if (!Number.isInteger(entryId)) continue;

      const characters = Array.isArray(info?.characters) ? info.characters : [];
      result.push({
        id: String(entryId),
        name: String(row?.title || ''),
        characters,
        speakingOrder: characters,
        replyLength: 'medium',
        created_at: row?.create_date || '',
        updatedAt: row?.write_date || row?.create_date || '',
        lastMsg: null,
        is_broadcast: row?.is_broadcast ?? true,
        creator_id: null,
        messages: [],
      });
    }
    return result;
  } catch {
    return [];
  }
}

// 模块加载时自动注册后台预刷新
registerPrefetch(BROADCAST_ROOMS_KEY, rawFetchBroadcastRooms, BROADCAST_ROOMS_TTL);

function deep(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

interface RoundtableInfo {
  type: string;
  name: string;
  characters: string[];
  speaking_order?: string[];
  speakingOrder?: string[];
  reply_length?: string;
  replyLength?: string;
  is_broadcast?: boolean;
  created_at?: string;
  creator_id?: string | null;
  last_chat?: {
    ask: string;
    ai_data: string;
    create_date: string;
  };
}

interface UpdatableRoundtable {
  id?: string;
  name: string;
  characters: string[];
  speakingOrder?: string[];
  replyLength?: string;
  messages?: RoomMessage[];
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  is_broadcast?: boolean;
  isBroadcast?: boolean;
  creator_id?: string | null;
}

type LastMsg = { role: string; charName: string | null; content: string } | null;

function safeParse(s: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!s) return fallback;
  if (typeof s !== 'string') return s as Record<string, unknown>;
  try { return JSON.parse(s); } catch { return fallback; }
}

async function fetchUid(token: string): Promise<number> {
  const key = `user:me:${hashToken(token)}`;
  try {
    const me = await cacheGetOrSet(key, () => mcpTools.userMe(token), 60);
    return me.me?.uid ?? 0;
  } catch {
    return 0;
  }
}

function extractSearchItems(d: unknown): AssistAIDialogueItem[] {
  const data = d as DashGenericSearchResponse<AssistAIDialogueItem> | null | undefined;
  return data?.items ?? [];
}

function extractRelationSearchItems(d: unknown): AssistAIChatItem[] {
  const data = d as DashGenericSearchResponse<AssistAIChatItem> | null | undefined;
  return data?.items ?? [];
}

function extractGetItem(d: unknown): AssistAIDialogueItem | undefined {
  const data = d as { item?: AssistAIDialogueItem; status: number } | null | undefined;
  return data?.item;
}

export const mcpRoundtables = {

  async getRoundtables(token?: string) {
    if (!token) return [];

    const uid = await fetchUid(token);
    if (!uid) return [];

    return cacheGetOrSet(
      `roundtables:${uid}`,
      async () => {

        // 直播间
        const condition = JSON.stringify({
          logic_operator: '&',
          children: [
            { leaf: { field: 'scene', comparator: '=', value: '一答虚拟人' } },
            { leaf: { field: 'deleted', comparator: '!=', value: true } },
            { leaf: { field: 'is_broadcast', comparator: '=', value: true } },
          ],
        });

        // 自己创建的聊天室
        const condition2 = JSON.stringify({
          logic_operator: '&',
          children: [
            { leaf: { field: 'scene', comparator: '=', value: '一答虚拟人' } },
            { leaf: { field: 'deleted', comparator: '!=', value: true } },
            { leaf: { field: 'type', comparator: '=', value: 'roundtable' } },
            { leaf: { field: 'asker_id.id', comparator: '=', value: uid } },
          ],
        });

        const [d1, d2] = await Promise.all([
          mcpTools.dashGenericSearch({
            model: 'AssistAIDialogues',
            fields: ['id', 'title', 'type', 'is_broadcast', 'additional_information', 'create_date', 'write_date'],
            limit: 100,
            offset: 0,
            condition,
            sort: '[{"field":"id","order":"desc"}]',
          }, token),
          mcpTools.dashGenericSearch({
            model: 'AssistAIDialogues',
            fields: ['id', 'title', 'type', 'is_broadcast', 'additional_information', 'create_date', 'write_date'],
            limit: 100,
            offset: 0,
            condition: condition2,
            sort: '[{"field":"id","order":"desc"}]',
          }, token),
        ]);

        // 合并两个查询结果，按 id 去重
        const seen = new Map<number, AssistAIDialogueItem>();
        for (const it of [...extractSearchItems(d1), ...extractSearchItems(d2)]) {
          const row = it || ({} as AssistAIDialogueItem);
          const entryId = row?.id;
          if (Number.isInteger(entryId) && !seen.has(entryId)) {
            seen.set(entryId, row);
          }
        }

        const result: RoundtableRecord[] = [];

        for (const row of seen.values()) {
          const info = safeParse(row?.additional_information) as unknown as RoundtableInfo;
          // 优先使用行级 type 字段，兼容旧数据的 JSON 内嵌 type
          const rowType = row?.type || info?.type;
          if (rowType !== 'roundtable') continue;

          const entryId = row?.id;
          if (!Number.isInteger(entryId)) continue;

          const characters = Array.isArray(info?.characters) ? info.characters : [];
          const speakingOrder = Array.isArray(info?.speaking_order)
            ? info.speaking_order
            : Array.isArray(info?.speakingOrder)
              ? info.speakingOrder
              : characters;
          const replyLength = typeof info?.reply_length === 'string'
            ? info.reply_length
            : typeof info?.replyLength === 'string'
              ? info.replyLength
              : 'medium';

          // 从 additional_information 直接读取最后一次对话内容，避免 N+1 查询
          const lastChat = info?.last_chat;
          let last: LastMsg = null;
          if (lastChat) {
            const ai = typeof lastChat.ai_data === 'string'
              ? JSON.parse(lastChat.ai_data)
              : (lastChat.ai_data || {});
            const role = ai?.role === 'ai' ? 'ai' : 'user';
            last = role === 'user'
              ? { role: 'user', charName: null, content: String(lastChat.ask || '').slice(0, 80) }
              : { role: 'ai', charName: String(ai?.char_name || ''), content: String(ai?.content || ai?.answer || '').slice(0, 80) };
          }

          result.push({
            id: String(entryId),
            name: String(row?.title || ''),
            characters,
            speakingOrder,
            replyLength,
            created_at: row?.create_date || '',
            updatedAt: row?.write_date || row?.create_date || '',
            lastMsg: last ? { role: last.role, charName: last.charName, content: last.content } : null,
            is_broadcast: row?.is_broadcast ?? info?.is_broadcast ?? false,
            creator_id: info?.creator_id || null,
            messages: [],
          });
        }

        // todo：这个排序不理解，之后需要跟郝壮确认下
        result.sort((a, b) => {
          if (a.is_broadcast && !b.is_broadcast) return -1;
          if (!a.is_broadcast && b.is_broadcast) return 1;
          return new Date(b.updatedAt || b.created_at || 0).getTime() - new Date(a.updatedAt || a.created_at || 0).getTime();
        });

        return result;
      },
      30,
    );
  },

  /**
   * 公开接口：只查 is_broadcast=true 的直播房间，无需 uid，游客可访问。
   * token 可以是任意登录用户的，也可以不传（此时尝试空字符串，MCP 会自行处理权限）。
   */
  async getBroadcastRooms(_token?: string): Promise<import('./crm').RoundtableRecord[]> {
    return cacheGetOrSet(BROADCAST_ROOMS_KEY, rawFetchBroadcastRooms, BROADCAST_ROOMS_TTL);
  },

  async getRoundtableById(id: string, token?: string) {
    if (!token) return undefined;
    const parsedId = Number.parseInt(String(id).replace(/\D/g, ''), 10);
    if (isNaN(parsedId)) return undefined;

    const d = await mcpTools.dashGenericGet({
      model: 'AssistAIDialogues',
      id: parsedId,
      fields: ['id', 'title', 'name', 'type', 'is_broadcast', 'additional_information', 'create_date', 'write_date'],
    }, token);

    const row = extractGetItem(d);
    if (!row || row.deleted === true) return undefined;

    const info = safeParse(row?.additional_information) || {};
    const rowType = row?.type || info?.type;
    if (rowType !== 'roundtable') return undefined;

    const characters = Array.isArray(info?.characters) ? info.characters : [];
    const speakingOrder = Array.isArray(info?.speaking_order)
      ? info.speaking_order
      : Array.isArray(info?.speakingOrder)
        ? info.speakingOrder
        : characters;
    const replyLength = typeof info?.reply_length === 'string'
      ? info.reply_length
      : typeof info?.replyLength === 'string'
        ? info.replyLength
        : 'medium';

    const chats = await mcpTools.dashGenericRelationModelSearch({
      currentModel: 'AssistAIDialogues',
      currentID: parsedId,
      currentRelationField: 'assist_chats_ids',
      fields: ['id', 'ask', 'ai_data', 'create_date'],
      limit: 100,
      offset: 0,
      sort: '[{"field":"id","order":"ASC"}]',
    }, token);

    const chatItems = extractRelationSearchItems(chats);
    const messages: RoomMessage[] = [];

    for (const c of chatItems) {
      const ai = safeParse(c?.ai_data) || {};
      const createdAt = c?.create_date || '';
      const ts = createdAt ? new Date(createdAt).getTime() : Date.now();

      if (ai?.role === 'ai') {
        messages.push({
          role: 'ai',
          charId: String(ai?.char_id || ''),
          charName: String(ai?.char_name || ''),
          content: String(ai?.content || ai?.answer || ''),
          timestamp: ts,
        });
      } else if (c?.ask) {
        messages.push({
          role: 'user',
          content: String(c.ask),
          timestamp: ts,
        });
      }
    }

    return {
      id: String(row.id || parsedId),
      name: row?.title || row?.name || info?.name || '座谈室',
      characters,
      speakingOrder,
      replyLength,
      created_at: row?.create_date || '',
      updatedAt: row?.write_date || row?.create_date || '',
      is_broadcast: row?.is_broadcast ?? info?.is_broadcast ?? false,
      creator_id: info?.creator_id || null,
      messages,
    };
  },

  async createRoundtable(room: UpdatableRoundtable, token?: string) {
    if (!token) return null;

    const infoObj: Record<string, unknown> = {
      type: 'roundtable',
      name: String(room.name || ''),
      characters: room.characters || [],
      speaking_order: room.speakingOrder || room.characters || [],
      reply_length: room.replyLength || 'medium',
      created_at: room.createdAt || room.created_at || new Date().toISOString(),
      creator_id: room.creator_id || null,
    };

    if (room.is_broadcast || room.isBroadcast) {
      infoObj.is_broadcast = true;
    }

    const mcpId = Number.parseInt(String(room.id || '').replace(/\D/g, ''), 10);
    const dialogueValues: DialogueUpsertValues = {
      name: String(room.name || ''),
      type: 'roundtable',
      is_broadcast: !!(room.is_broadcast || room.isBroadcast),
      additional_information: JSON.stringify(infoObj),
    };
    if (!isNaN(mcpId) && mcpId > 0) {
      dialogueValues.id = mcpId;
    }

    const out = await upsertDialogue(dialogueValues, token);
    const newId = out?.status === 200 && Number.isInteger(out?.id) && out.id > 0 ? out.id : null;
    await cacheDel(BROADCAST_ROOMS_KEY);
    const uid = await fetchUid(token);
    if (uid) await cacheDel(`roundtables:${uid}`);
    return {
      id: String(newId || room.id),
      name: room.name,
      characters: room.characters,
      speakingOrder: room.speakingOrder || room.characters,
      replyLength: room.replyLength || 'medium',
      messages: room.messages || [],
      updatedAt: new Date().toISOString(),
      created_at: room.created_at || new Date().toISOString(),
    };
  },

  async deleteRoundtable(id: string, token?: string) {
    if (!token) return false;
    const parsedId = Number.parseInt(String(id).replace(/\D/g, ''), 10);
    if (isNaN(parsedId)) return false;

    await upsertDialogue({
      id: parsedId,
      deleted: true,
    }, token);
    await cacheDel(BROADCAST_ROOMS_KEY);
    const uid = await fetchUid(token);
    if (uid) await cacheDel(`roundtables:${uid}`);
    return true;
  },

  async pushMessage(roomId: string, message: Record<string, unknown>, token?: string) {
    if (!token) return false;
    const parsedId = Number.parseInt(String(roomId).replace(/\D/g, ''), 10);
    if (isNaN(parsedId)) return false;

    const isAi = message.role === 'ai';
    const payload: Record<string, unknown> = {
      bearerToken: token,
      assist_ai_dialogues_id: parsedId,
    };

    if (isAi) {
      payload.ask = String(message.content || '').slice(0, 80);
      payload.ai_data = JSON.stringify({
        role: 'ai',
        char_id: message.charId || '',
        char_name: message.charName || '',
        content: message.content || '',
        created_at: new Date().toISOString(),
      });
    } else {
      payload.ask = String(message.content || '');
      payload.ai_data = JSON.stringify({
        role: 'user',
        type: 'roundtable_user',
        created_at: new Date().toISOString(),
      });
    }

    try {
      await mcpTools.assistchatUpsert(payload, token);
      // 将最后一次对话内容存入 additional_information，加速列表读取
      mcpConversations.saveLastChatToDialogue(
        parsedId,
        String(payload.ask || ''),
        String(payload.ai_data || ''),
        token,
      ).catch(() => {});
      const uid = await fetchUid(token);
      if (uid) await cacheDel(`roundtables:${uid}`);
    } catch (err) {
      console.error('[MCP pushMessage] Failed to save:', err);
      return false;
    }
    return true;
  },
};
