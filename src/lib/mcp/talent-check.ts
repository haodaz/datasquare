import { mcpTools } from '@/lib/mcp/generated-tools';
import { cacheGetOrSet } from '@/lib/redis';
import { hashToken } from '@/lib/redis';
import type { ReportRecord } from '@/lib/mcp/crm';

class TalentCheckManager {
  private async getUid(token: string): Promise<number> {
    const me = await cacheGetOrSet(
      `user:me:${hashToken(token)}`,
      () => mcpTools.userMe(token),
      60
    );
    return me.me?.uid ?? 0;
  }

  async saveReport(report: ReportRecord, token?: string): Promise<ReportRecord | null> {
    if (!token) return null;
    const uid = await this.getUid(token);
    if (!uid) throw new Error('User not found');

    const idToUse = report.id || Date.now().toString();
    const floraExternalId = `${uid}_talentCheck_${idToUse}`;

    // First try to find if it exists
    const existing = await mcpTools.dashGenericGetByFloraExternalId({
      model: 'ZhiJiCompanionConfig',
      floraExternalID: floraExternalId,
      fields: ['id']
    }, token) as unknown as { item?: { id: number } };

    const valuesObj: any = {
      name: report.title || 'Untitled Report',
      flora_external_id: floraExternalId,
      data: JSON.stringify(report),
    };

    if (existing?.item?.id) {
      valuesObj.id = existing.item.id;
    }

    const result = await mcpTools.dashGenericSave({
      model: 'ZhiJiCompanionConfig',
      values: JSON.stringify(valuesObj)
    }, token) as unknown as { status: number; error?: string; id?: number };

    if (result.status !== 200 || result.error) {
      throw new Error(result.error || 'Failed to save talentCheck report');
    }

    // Set the saved ID back to the report object
    report.id = idToUse;
    return report;
  }

  async getReports(token?: string): Promise<ReportRecord[]> {
    if (!token) return [];
    const uid = await this.getUid(token);
    if (!uid) return [];

    const condition = JSON.stringify({
      logic_operator: '&',
      children: [
        { leaf: { field: 'flora_external_id', comparator: 'ilike', value: `${uid}_talentCheck_%` } },
      ]
    });

    const searchResult = await mcpTools.dashGenericSearch({
      model: 'ZhiJiCompanionConfig',
      fields: ['id', 'name', 'flora_external_id', 'data'],
      condition,
      limit: 100,
      offset: 0,
      sort: '[{"field":"id","order":"DESC"}]'
    }, token) as unknown as { items?: any[] };

    const items = (searchResult.items || []).filter((i: any) => i.name !== '__DELETED__');
    return items.map(item => {
      try {
        const dataStr = item.data;
        return JSON.parse(dataStr);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  }

  async getReportById(id: string, token?: string): Promise<ReportRecord | null> {
    if (!token || !id) return null;
    const uid = await this.getUid(token);
    if (!uid) return null;

    const floraExternalId = `${uid}_talentCheck_${id}`;
    const existing = await mcpTools.dashGenericGetByFloraExternalId({
      model: 'ZhiJiCompanionConfig',
      floraExternalID: floraExternalId,
      fields: ['id', 'data', 'name']
    }, token) as unknown as { item?: any };

    if (!existing?.item || existing.item.name === '__DELETED__') return null;

    try {
      return JSON.parse(existing.item.data);
    } catch {
      return null;
    }
  }

  async deleteReport(id: string, token?: string): Promise<boolean> {
    if (!token || !id) return false;
    const uid = await this.getUid(token);
    if (!uid) return false;

    const floraExternalId = `${uid}_talentCheck_${id}`;
    const existing = await mcpTools.dashGenericGetByFloraExternalId({
      model: 'ZhiJiCompanionConfig',
      floraExternalID: floraExternalId,
      fields: ['id']
    }, token) as unknown as { item?: { id: number } };

    if (!existing?.item?.id) return false;

    const valuesObj = {
      id: existing.item.id,
      name: '__DELETED__'
    };

    const result = await mcpTools.dashGenericSave({
      model: 'ZhiJiCompanionConfig',
      values: JSON.stringify(valuesObj)
    }, token) as unknown as { status: number };

    return result.status === 200;
  }
}

export const talentCheckManager = new TalentCheckManager();
