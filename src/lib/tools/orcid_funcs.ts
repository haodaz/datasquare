let _orcidTokenCache: { token: string; expiresAt: number } | null = null;

export async function getOrcidToken(): Promise<string | null> {
  if (_orcidTokenCache && Date.now() < _orcidTokenCache.expiresAt) {
    return _orcidTokenCache.token;
  }

  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch('https://orcid.org/oauth/token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials&scope=/read-public`,
    });
    if (!res.ok) return null;
    const data = await res.json();
    _orcidTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 600000) * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

/** 三级降级搜索: 精准(正+反+机构) → 去机构(正+反) → 全文 text */
export async function orcidSearch(
  token: string,
  givenNames: string,
  familyName: string,
  institution?: string
): Promise<Array<{ path: string }>> {
  const BASE = 'https://pub.orcid.org/v3.0/search/';
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

  const doSearch = async (q: string): Promise<Array<{ path: string }>> => {
    try {
      const res = await fetch(`${BASE}?q=${encodeURIComponent(q)}&rows=5`, { headers });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.result || []).map((r: any) => ({ path: r['orcid-identifier']?.path })).filter((r: any) => r.path);
    } catch { return []; }
  };

  const dedupe = (arr: Array<{ path: string }>): Array<{ path: string }> => {
    const seen = new Set<string>();
    return arr.filter(r => { if (seen.has(r.path)) return false; seen.add(r.path); return true; });
  };

  if (institution) {
    const q1 = `given-names:${givenNames} AND family-name:${familyName} AND affiliation-org-name:${institution}`;
    const q2 = `given-names:${familyName} AND family-name:${givenNames} AND affiliation-org-name:${institution}`;
    const [r1, r2] = await Promise.all([doSearch(q1), doSearch(q2)]);
    const results = dedupe([...r1, ...r2]);
    if (results.length > 0) return results;
  }

  const q3 = `given-names:${givenNames} AND family-name:${familyName}`;
  const q4 = `given-names:${familyName} AND family-name:${givenNames}`;
  const [r3, r4] = await Promise.all([doSearch(q3), doSearch(q4)]);
  const step2 = dedupe([...r3, ...r4]);
  if (step2.length > 0 && step2.length <= 20) return step2.slice(0, 5);

  const fullName = `${givenNames} ${familyName}`;
  const q5 = institution
    ? `text:"${fullName}" AND text:${institution}`
    : `text:"${fullName}"`;
  const r5 = await doSearch(q5);
  if (r5.length > 0) return r5;

  return step2.slice(0, 5);
}

/** 解析 ORCID 的日期对象 → YYYY-MM-DD 或 YYYY */
function parseOrcidDate(d: any): string {
  if (!d || typeof d !== 'object') return '';
  const year = d.year?.value || '';
  const month = d.month?.value || '';
  const day = d.day?.value || '';
  if (year && month && day) return `${year}-${month}-${day}`;
  if (year && month) return `${year}-${month}`;
  if (year) return year;
  return '';
}

/** 从 ORCID 的 external-ids 数组里提取 DOI */
function extractDoi(summary: any): string {
  const extIds = summary?.['external-ids']?.['external-id'] || [];
  for (const eid of extIds) {
    if (eid?.['external-id-type'] === 'doi') {
      return eid?.['external-id-value'] || '';
    }
  }
  return '';
}

export interface OrcidAffiliation {
  org: string;
  role: string;
  dept: string;
  startDate: string;
  endDate: string;
}

export interface OrcidWork {
  title: string;
  type: string;
  journal: string;
  year: string;
  doi: string;
}

export async function orcidGetEmployments(token: string, orcidId: string): Promise<OrcidAffiliation[]> {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/employments`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data['affiliation-group'] || []).map((g: any) => {
      const s = g.summaries?.[0]?.['employment-summary'] || {};
      return {
        org: s.organization?.name || '',
        role: s['role-title'] || '',
        dept: s['department-name'] || '',
        startDate: parseOrcidDate(s['start-date']),
        endDate: parseOrcidDate(s['end-date']),
      };
    });
  } catch { return []; }
}

export async function orcidGetEducations(token: string, orcidId: string): Promise<OrcidAffiliation[]> {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/educations`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data['affiliation-group'] || []).map((g: any) => {
      const s = g.summaries?.[0]?.['education-summary'] || {};
      return {
        org: s.organization?.name || '',
        role: s['role-title'] || '',
        dept: s['department-name'] || '',
        startDate: parseOrcidDate(s['start-date']),
        endDate: parseOrcidDate(s['end-date']),
      };
    });
  } catch { return []; }
}

export interface OrcidProfileName {
  given: string;
  family: string;
  full: string;
}

export async function orcidGetProfileName(token: string, orcidId: string): Promise<OrcidProfileName> {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return { given: '', family: '', full: '' };
    const data = await res.json();
    const name = data?.person?.name || {};
    const given = name['given-names']?.value || '';
    const family = name['family-name']?.value || '';
    return { given, family, full: `${given} ${family}`.trim() };
  } catch { return { given: '', family: '', full: '' }; }
}

export async function orcidGetWorks(token: string, orcidId: string, limit = 10): Promise<OrcidWork[]> {
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${orcidId}/works`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.group || []).slice(0, limit).map((g: any) => {
      const s = g['work-summary']?.[0] || {};
      const pubDate = s['publication-date'] || {};
      const year = pubDate.year?.value || '';
      return {
        title: s.title?.title?.value || 'N/A',
        type: s.type || '',
        journal: s['journal-title']?.value || '',
        year,
        doi: extractDoi(s),
      };
    });
  } catch { return []; }
}
