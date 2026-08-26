import { mcpTools } from './generated-tools';
import { RoomMessage } from '@/lib/characters/types';
import { getRedis, hashToken } from '@/lib/redis';

const CRM_PROFILE_ID_PREFIX = 'crm:profile_id:';
const CRM_PROFILE_ID_TTL = 3600; // 1 hour

export interface KbFileItem {
  name?: string;
  size: number;
  updatedAt: string;
  type: string;
  id: number;
}

export interface RoundtableRecord {
  id: string;
  name: string;
  characters: string[];
  speakingOrder?: string[];
  replyLength?: string;
  messages: RoomMessage[];
  updatedAt: string;
  created_at?: string;
  is_broadcast?: boolean;
  creator_id?: string | null;
  lastMsg?: { role: string; charName: string | null; content: string } | null;
}

export interface ConversationRecord {
  id: string;
  charId?: string;
  title?: string;
  updatedAt?: string;
}

export interface ReportRecord {
  id: string;
  type?: string;
  title?: string;
  summary?: string;
  content?: string;
  charId?: string;
  charName?: string;
  format?: string;
  convId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProfileFragment {
  id?: string;
  title?: string;
  category: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  source?: string;
  ai_name?: string;
  convId?: string;
}

export interface CRMProfileData {
  version: string;
  reports?: {
    count: number;
    reports: ReportRecord[];
  };
  profile?: {
    fragments?: ProfileFragment[];
    categories?: string[];
    totalFragments?: number;
    username?: string;
    email?: string;
    phone?: string;
    bio?: string;
    avatar?: string;
    updatedAt?: string;
  };
  roundtables?: RoundtableRecord[];
  conversations?: ConversationRecord[];
  metadata?: {
    source: string;
    exportDate: string;
    dataTypes: string[];
  };
  // 允许其他项目（如 DeepTalent）写入的未知字段透传保留
  [key: string]: unknown;
}

export const crmManager = {
  /**
   * 获取用户的客户档案ID
   */
  async getUserClientProfileId(token: string): Promise<{ success: boolean; profileId?: number; error?: string }> {
    const cacheKey = `${CRM_PROFILE_ID_PREFIX}${hashToken(token)}`;
    const client = getRedis();

    // 尝试从缓存读取（只缓存成功结果，所以命中即有效）
    if (client) {
      try {
        const cached = await client.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as { success: boolean; profileId: number };
        }
      } catch { /* 缓存读取失败，走回源 */ }
    }

    // ---- 回源 ----
    try {
      const result = await mcpTools.userClientProfileId(token) as unknown as Record<string, unknown>;
      const r = result as Record<string, unknown>;
      const rr = r.remoteResponse as Record<string, unknown> | undefined;
      const rrData = rr?.data as Record<string, unknown> | undefined;
      const rrDash = rrData?.dash as Record<string, unknown> | undefined;
      const rrProfile = rrDash?.user_client_profile_id as Record<string, unknown> | undefined;

      let profileId = r.client_id || 
                      (r.item as Record<string, unknown>)?.client_id ||
                      rr?.client_id || 
                      rrProfile?.client_id;
      
      if (!profileId) {
        const rawStr = (r.raw as string | undefined) || (rrProfile?.raw as string | undefined) ||
                       ((rrData?.dash as Record<string, unknown>)?.user_client_profile_id as Record<string, unknown>)?.raw;
        
        if (rawStr) {
          try {
            const parsedRaw = typeof rawStr === 'string' ? JSON.parse(rawStr) : rawStr;
            profileId = parsedRaw['client_id.id'] || parsedRaw.id || parsedRaw.client_id;
          } catch (e) {}
        }
      }

      if (profileId) {
        const successResult = { success: true, profileId: Number(profileId) };

        // 只缓存成功结果：profileId 一旦分配永不改变
        if (client) {
          try {
            await client.setex(cacheKey, CRM_PROFILE_ID_TTL, JSON.stringify(successResult));
          } catch { /* 写入失败不影响返回 */ }
        }

        return successResult;
      }

      return { success: false, error: '未找到关联的客户档案ID' };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  },

  /**
   * 获取云端客户档案数据
   */
  async getClientProfile(token: string, profileId?: number): Promise<{ success: boolean; data?: CRMProfileData; error?: string }> {
    try {
      let targetId = profileId;
      if (!targetId) {
        const res = await this.getUserClientProfileId(token);
        if (res.success) {
          targetId = res.profileId;
        }
      }

      if (!targetId) {
        return { success: false, error: '未找到用户档案' };
      }

      const result = await mcpTools.dashGenericGet({
        model: 'CRMClient',
        id: targetId,
        fields: ['gaokao_year', 'gaokao_province', 'zhi_ji_personal_resume']
      }, token) as unknown as Record<string, unknown>;

      const rr = (result as Record<string, unknown>).remoteResponse as Record<string, unknown> | undefined;
      const rrData = rr?.data as Record<string, unknown> | undefined;
      const rrDash = rrData?.dash as Record<string, unknown> | undefined;
      const rrGeneric = rrDash?.generic as Record<string, unknown> | undefined;
      const getObj = (result as Record<string, unknown>).item || rrGeneric?.get;
      if (getObj) {
        let finalData = getObj as Record<string, unknown>;
        if ((finalData as Record<string, unknown>).raw) {
          try {
            finalData = JSON.parse((finalData as Record<string, unknown>).raw as string);
          } catch (e) {}
        }

        let resumeData: CRMProfileData = { version: '1.0' };
        const resumeStr = (finalData as Record<string, unknown>).zhi_ji_personal_resume;
        
        if (resumeStr) {
          try {
            const parsed = typeof resumeStr === 'string' ? JSON.parse(resumeStr) : resumeStr;
            resumeData = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
          } catch (e) {}
        }

        return { success: true, data: resumeData };
      }

      return { success: false, error: '获取档案数据失败' };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  },

  /**
   * 更新云端客户档案数据
   */
  async updateClientProfile(token: string, resumeData: CRMProfileData): Promise<boolean> {
    try {
      const resId = await this.getUserClientProfileId(token);
      if (!resId.success || !resId.profileId) return false;

      // ── 防覆写安全阀 ────────────────────────────────────────────────────
      // 重新读取云端最新数据，将调用方未携带的顶层字段补回，
      // 防止 zhiji-yida 和 deepTalent 交叉写入时互相吞数据。
      try {
        const freshRes = await this.getClientProfile(token, resId.profileId);
        if (freshRes.success && freshRes.data) {
          const fresh = freshRes.data;
          // 将 fresh 中存在但 resumeData 中缺失的顶层 key 补回
          for (const key of Object.keys(fresh)) {
            if (key === 'version') continue; // version 由调用方管理
            if (!(key in resumeData) || resumeData[key] === undefined) {
              (resumeData as Record<string, unknown>)[key] = fresh[key];
            }
          }
        }
      } catch {
        // 安全阀读取失败不阻塞写入，仅记录告警
        console.warn('[CRM::SafetyValve] 读取最新数据失败，跳过安全合并');
      }

      // ── 平台标识 ──────────────────────────────────────────────────────────
      // 打上 yida 平台标记，让其他项目（如 DeepTalent）识别数据归属
      (resumeData as Record<string, unknown>)._platform = 'yida';
      (resumeData as Record<string, unknown>)._lastWrittenBy = 'zhiji-yida';
      (resumeData as Record<string, unknown>)._lastWrittenAt = new Date().toISOString();

      // 按照 MCP 要求进行双重序列化
      const resumeJson = JSON.stringify(resumeData);
      const payload = {
        bearerToken: token,
        key: 'zhi_ji_personal_resume',
        values: JSON.stringify({ zhi_ji_personal_resume: resumeJson })
      };
      
      const res = await mcpTools.crmclientUpdateProfile(payload, token) as unknown as Record<string, unknown>;
      const status = res?.status;
      return status === 200 || status === '200' || status === 'success' || res?.success === true;
    } catch (error) {
      return false;
    }
  }
};
