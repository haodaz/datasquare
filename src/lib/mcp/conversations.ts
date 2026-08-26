import { mcpTools, UserMeOutput } from './generated-tools';
import { upsertDialogue } from './utils';
import { Conversation } from '@/lib/conversations';
import { cacheGetOrSet, cacheDel, hashToken } from '@/lib/redis';
import type { Message } from '@/lib/ai/types';
import type {
  AssistAIDialogueItem,
  AssistAIChatItem,
} from './types';

export const mcpConversations = {
  extractUid(me: UserMeOutput): number {
    return me.me?.uid ?? 0;
  },

  async getConversations(token?: string): Promise<Conversation[]> {
    if (!token) return [];

    try {
      const me = await cacheGetOrSet(
        `user:me:${hashToken(token)}`,
        () => mcpTools.userMe(token),
        60,
      );
      const uid = this.extractUid(me);
      if (!uid) return [];

      return cacheGetOrSet(
        `conversations:${uid}`,
        async () => {
          const condition = JSON.stringify({
            logic_operator: '&',
            children: [
              { leaf: { field: 'scene', comparator: '=', value: '一答虚拟人' } },
              { leaf: { field: 'deleted', comparator: '!=', value: true } },
              { leaf: { field: 'asker_id.id', comparator: '=', value: uid } },
              { leaf: { field: 'type', comparator: '!=', value: 'roundtable' } },
              { leaf: { field: 'type', comparator: '!=', value: 'a2a' } },
            ],
          });

          const d = await mcpTools.dashGenericSearch<AssistAIDialogueItem>({
            model: 'AssistAIDialogues',
            fields: ['id', 'title', 'scene', 'additional_information', 'create_date', 'write_date'],
            limit: 100,
            offset: 0,
            condition,
            sort: '[{"field":"id","order":"DESC"}]',
          }, token);

          const items = d?.items  ?? [];
          const result: Conversation[] = [];

          for (const row of items) {
            const did = row.id ? Number(row.id) : 0;
            const info = typeof row.additional_information === 'string'
              ? JSON.parse(row.additional_information)
              : (row.additional_information || {});
            const rowType = row?.type || info?.type;
            if (rowType === 'roundtable') continue;
            let charId = (info.scene || info.character_id || '') as string;
            const charName = (info.character_name || '') as string;

            // 从 additional_information 直接读取最后一次对话内容，避免 N+1 查询
            const lastChat = info?.last_chat;
            const history: AssistAIChatItem[] = [];
            if (lastChat) {
              history.push({
                id: 0,
                ask: lastChat.ask || '',
                ai_data: lastChat.ai_data || '',
                create_date: lastChat.create_date || '',
              });
              if (!charId) {
                const ai = typeof lastChat.ai_data === 'string' ? JSON.parse(lastChat.ai_data) : (lastChat.ai_data || {});
                if (ai?.character_id) {
                  charId = ai.character_id;
                }
              }
            }

            const conv = mcpConversations._extractConversation({
              id: did,
              charId: charId as string,
              charName,
              history,
              uid: 0,
              title: String(row?.title || ''),
            });
            result.push(conv);
          }

          return result;
        },
        30,
      );
    } catch (e) {
      return [];
    }
  },

  async getConversation(convId: string, token?: string): Promise<Conversation | undefined> {
    try {
      const did = Number(convId);
      if (!Number.isInteger(did)) return undefined;

      const d = await mcpTools.dashGenericSearch<AssistAIDialogueItem>({
        model: 'AssistAIDialogues',
        fields: ['id', 'title', 'scene', 'additional_information', 'create_date', 'write_date'],
        limit: 1,
        offset: 0,
        condition: JSON.stringify({
          logic_operator: '&',
          children: [{ leaf: { field: 'id', comparator: '=', value: did } }],
        }),
      }, token);

      const items = d?.items ?? [];
      if (!items || items.length === 0) return undefined;
      const row = items[0];

      const info = typeof row.additional_information === 'string'
        ? JSON.parse(row.additional_information)
        : (row.additional_information || {});
      const rowType = row?.type || info?.type;
      if (rowType === 'roundtable') return undefined;

      let charId: string = (info.scene || info.character_id || '') as string;
      let charName: string = (info.character_name || '') as string;

      const chats = await mcpTools.dashGenericRelationModelSearch<AssistAIChatItem>({
        currentModel: 'AssistAIDialogues',
        currentID: did,
        currentRelationField: 'assist_chats_ids',
        fields: ['id', 'ask', 'ai_data', 'create_date'],
        limit: 100,
        offset: 0,
        sort: '[{"field":"id","order":"asc"}]',
      }, token);

      const chatItems = chats?.items ?? [];
      const history: AssistAIChatItem[] = [];
      let lastAsst = '';
      let lastAt = '';

      for (const ci of chatItems) {
        history.push(ci);
        const ai = typeof ci.ai_data === 'string' ? JSON.parse(ci.ai_data) : (ci.ai_data || {});
        const role = ai?.role === 'ai' ? 'ai' : 'user';
        if (role === 'user') {
          lastAt = (ci.create_date || '') as string;
        } else {
          lastAsst = (ai?.content || ai?.answer || '') as string;
          lastAt = (ci.create_date || '') as string;
        }
        if (!charId && ai?.character_id) {
          charId = ai.character_id;
          charName = charName || ai.character_name || '';
        }
      }

      return mcpConversations._extractConversation({
        id: did,
        charId: charId as string,
        charName,
        title: String(row?.title || ''),
        history,
        uid: 0,
      });
    } catch (e) {
      return undefined;
    }
  },

  _extractConversation({ id, charId, charName, history, uid, title }: {
    id: number;
    charId: string;
    charName: string;
    history: AssistAIChatItem[];
    uid: number;
    title?: string;
  }): Conversation {
    const messages: Message[] = [];

    for (const ci of history) {
      const ai = typeof ci.ai_data === 'string' ? JSON.parse(ci.ai_data) : (ci.ai_data || {});

      messages.push({
        id: String(ci.id) + '_user',
        role: 'user',
        content: (ci.ask || '') as string,
        timestamp: (ci.create_date || '') as string,
      });

      messages.push({
        id: String(ci.id) + '_assistant',
        ...ai, // Spread extra fields like yidaAuditOverview
        role: 'assistant',
        content: (ai?.content || ai?.answer || '') as string,
        timestamp: (ai?.created_at || ci.create_date || '') as string,
      });
    }

    let preview = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].content) {
        preview = messages[i].content;
        break;
      }
    }

    return {
      id: String(id),
      charId,
      charName,
      title: title || '',
      lastMsg: preview,
      updatedAt: messages.length > 0 ? (messages[messages.length - 1].timestamp || '') : '',
      history: messages,
    };
  },

  async saveConversationMetadata(conv: Conversation, token?: string) {
    try {
      const did = Number(conv.id);
      if (!Number.isInteger(did)) return false;

      // 读取现有 additional_information 再合并，避免覆盖 last_chat 等已有字段
      const dialogue = await mcpTools.dashGenericGet<AssistAIDialogueItem>({
        model: 'AssistAIDialogues',
        id: did,
        fields: ['additional_information'],
      }, token);

      const item = dialogue?.item;
      const existingInfo = typeof item?.additional_information === 'string'
        ? JSON.parse(item.additional_information)
        : (item?.additional_information || {});

      const infoObj: Record<string, unknown> = {
        ...existingInfo,
        scene: conv.charId || '',
        type: 'conversation',
      };

      const result = await upsertDialogue({
        id: did,
        name: conv.title, // map to title in db
        type: 'conversation',
        additional_information: JSON.stringify(infoObj),
      }, token);

      const extractedId = result?.id;
      if (result?.status === 200 && Number.isInteger(extractedId)) {
        return {
          ...conv,
          id: String(extractedId),
        };
      }
      return conv;
    } catch (e) {
      return conv;
    }
  },

  async deleteConversation(convId: string, token?: string) {
    try {
      const did = Number(convId);
      if (!Number.isInteger(did)) return false;

      const result = await upsertDialogue({
        id: did,
        deleted: true,
      }, token);

      await this.invalidateConversationListCache(token);
      return result?.status === 200;
    } catch (e) {
      return false;
    }
  },

  /** 失效对话列表缓存，供创建/删除/发消息后调用 */
  async invalidateConversationListCache(token?: string) {
    if (!token) return;
    try {
      const me = await cacheGetOrSet(
        `user:me:${hashToken(token)}`,
        () => mcpTools.userMe(token),
        60,
      );
      const uid = this.extractUid(me);
      if (uid) await cacheDel(`conversations:${uid}`);
    } catch { /* 静默忽略 */ }
  },

  /** 将最后一次对话内容存到 AssistAIDialogues.additional_information.last_chat，加速列表读取 */
  async saveLastChatToDialogue(dialogueId: number, ask: string, aiData: string, token?: string) {
    if (!token || !dialogueId) return;
    try {
      const dialogue = await mcpTools.dashGenericGet<AssistAIDialogueItem>({
        model: 'AssistAIDialogues',
        id: dialogueId,
        fields: ['additional_information'],
      }, token);

      const item = dialogue?.item;
      const currentInfo = typeof item?.additional_information === 'string'
        ? JSON.parse(item.additional_information)
        : (item?.additional_information || {});

      currentInfo.last_chat = {
        ask,
        ai_data: aiData,
        create_date: new Date().toISOString(),
      };

      await upsertDialogue({
        id: dialogueId,
        additional_information: JSON.stringify(currentInfo),
      }, token);
    } catch (e) {
      console.error('[MCP] Failed to save last_chat to dialogue:', e);
    }
  },
};

export type MCPConversations = typeof mcpConversations;
