/**
 * 统一搜索工具
 * 
 * 策略：优先使用阿里云大模型搜索，失败或未配置时降级到 Bocha API，最后使用 DuckDuckGo。
 * 返回结构兼容 DuckDuckGo Instant Answer API，方便调用方统一处理结果。
 */

export interface SearchResult {
  AbstractText: string;
  AbstractURL: string;
  Heading: string;
  RelatedTopics: Array<{ Text?: string; FirstURL?: string }>;
  /** 实际使用的搜索来源 */
  source: 'aliyun' | 'bocha' | 'duckduckgo';
}

/**
 * 调用阿里云大模型搜索（DashScope API）
 */
async function fetchAliyun(query: string): Promise<SearchResult> {
  const dashscopeKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  
  if (!dashscopeKey || dashscopeKey === 'sk-your-dashscope-key-here') {
    throw new Error('未配置 DASHSCOPE_API_KEY，无法执行搜索。');
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dashscopeKey}`,
      },
      body: JSON.stringify({
        model: 'qwen-turbo', // 改为 qwen-turbo 提速，防止 30s 超时
        messages: [
          {
            role: 'system',
            content: '你是一个专业的搜索助手。请搜索相关信息，并以简明扼要的方式提取关键事实、人物和数据。',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        enable_search: true,
      }),
      signal: AbortSignal.timeout(60000), // 延长超时时间到 60s
    });

    if (!res.ok) {
      throw new Error(`阿里云 API 返回错误状态码：${res.status}`);
    }

    const data = await res.json();
    console.log('[Aliyun] 搜索原始响应:', data);
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      return { AbstractText: '', AbstractURL: '', Heading: '', RelatedTopics: [], source: 'aliyun' };
    }

    return {
      AbstractText: content,
      AbstractURL: '',
      Heading: '阿里云大模型搜索结果',
      RelatedTopics: [],
      source: 'aliyun',
    };
  } catch (err: any) {
    console.error('[Aliyun] 搜索失败:', err.message);
    throw new Error(`阿里云搜索失败: ${err.message}`);
  }
}

/**
 * 调用 Bocha API 并转换为兼容结构
 */
async function fetchBocha(query: string, count = 10): Promise<SearchResult> {
  const bochaKey = process.env.BOCHA_API_KEY;
  if (!bochaKey || bochaKey === 'your-bocha-key-here') {
    throw new Error('未配置 BOCHA_API_KEY，无法执行搜索。');
  }

  try {
    const res = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bochaKey}`,
      },
      body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`Bocha API 返回错误状态码：${res.status}`);
    }

    const data = await res.json();
    const results: Array<{ name?: string; url?: string; snippet?: string }> =
      data.data?.webPages?.value ?? [];

    if (results.length === 0) {
      return { AbstractText: '', AbstractURL: '', Heading: '', RelatedTopics: [], source: 'bocha' };
    }

    return {
      // 拼接所有结果摘要，方便后续全文检索匹配
      AbstractText: results.map((r) => r.snippet ?? '').filter(Boolean).join(' | '),
      AbstractURL: results[0]?.url ?? '',
      Heading: results[0]?.name ?? '',
      RelatedTopics: results.slice(1).map((r) => ({
        Text: r.snippet ?? '',
        FirstURL: r.url ?? '',
      })),
      source: 'bocha',
    };
  } catch (err: any) {
    console.error('[Bocha] 搜索失败:', err.message);
    throw new Error(`搜索失败: ${err.message}`);
  }
}

/**
 * 调用 DuckDuckGo Instant Answer API
 */
async function fetchDuckDuckGo(query: string): Promise<SearchResult> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TalentAudit/1.0 (yida-platform; fact-checking)' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return {
      AbstractText: data?.AbstractText || '',
      AbstractURL: data?.AbstractURL || '',
      Heading: data?.Heading || '',
      RelatedTopics: data?.RelatedTopics || [],
      source: 'duckduckgo',
    };
  } catch (err: any) {
    console.error('[DuckDuckGo] 搜索失败:', err.message);
    return { AbstractText: '', AbstractURL: '', Heading: '', RelatedTopics: [], source: 'duckduckgo' };
  }
}

/**
 * 统一搜索：优先使用阿里云大模型搜索，失败时降级到 Bocha，再失败降级到 DuckDuckGo
 */
export async function searchWeb(query: string): Promise<SearchResult> {
  try {
    return await fetchAliyun(query);
  } catch (err) {
    console.warn('[Search] 阿里云搜索失败，降级到 Bocha:', err);
    try {
      return await fetchBocha(query);
    } catch (bochaErr) {
      console.warn('[Search] Bocha搜索失败，降级到 DuckDuckGo:', bochaErr);
      return await fetchDuckDuckGo(query);
    }
  }
}
