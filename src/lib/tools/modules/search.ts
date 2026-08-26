import { ToolModule } from '@/lib/tools/types';

export const searchModule: ToolModule = {
  definitions: [
    {
      name: 'search_internet',
      description: '搜索互联网，获取最新信息、新闻等。',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或问题' },
          num_results: { type: 'string', description: '返回结果数量（数字字符串，默认 "5"，最多 "10"）' },
        },
        required: ['query'],
      },
    },
  ],
  executors: {
    search_internet: async (inputs: { query: string; num_results?: string }) => {
      const n = Math.min(Math.max(1, parseInt(inputs.num_results || '5')), 10);
      const query = inputs.query;

      // ── 阿里云大模型搜索（优先）──
      const dashscopeKey = process.env.DASHSCOPE_API_KEY;
      const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      if (dashscopeKey && dashscopeKey !== 'sk-your-dashscope-key-here') {
        try {
          const res = await fetch(
            `${baseUrl}/chat/completions`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${dashscopeKey}`,
              },
              body: JSON.stringify({
                model: 'qwen-plus',
                messages: [
                  {
                    role: 'system',
                    content: '你是一个搜索助手，请根据用户的问题搜索相关信息并提供准确的答案。',
                  },
                  {
                    role: 'user',
                    content: query,
                  },
                ],
                enable_search: true,
              }),
              signal: AbortSignal.timeout(30000),
            }
          );
          if (res.ok) {
            const data = await res.json();
            console.log('[Aliyun] 搜索原始响应:', data);
            console.log('[Aliyun] 搜索原始响应:', JSON.stringify(data));
            const content = data.choices?.[0]?.message?.content || '';
            console.log('[Aliyun] 搜索结果:', content);
            if (content) {
              return `**阿里云大模型搜索结果**\n${content}`;
            }
          }
        } catch (err: any) {
          console.error('[Aliyun] 搜索失败:', err.message);
        }
      }

      // ── Bocha API ──────────────────────────────
      const bochaKey = process.env.BOCHA_API_KEY;
      if (bochaKey && bochaKey !== 'your-bocha-key-here') {
        try {
          const res = await fetch('https://api.bochaai.com/v1/web-search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${bochaKey}`,
            },
            body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count: n }),
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const data = await res.json();
            const results = data.data?.webPages?.value ?? [];
            if (results.length > 0) {
              return results.slice(0, n)
                .map((r: any, i: number) => {
                  let snippet = (r.snippet || '').trim();
                  if (snippet && !/[。！？.!?…]$/.test(snippet)) {
                    snippet += '...';
                  }
                  return `${i + 1}. **${r.name}**\n   ${r.url}\n   ${snippet}`;
                })
                .join('\n\n');
            }
          }
        } catch (err: any) {
          console.error('[Bocha] 搜索失败:', err.message);
        }
      }

      // ── DuckDuckGo API（无需 API Key，作为兜底）──
      try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const ddgRes = await fetch(ddgUrl, { signal: AbortSignal.timeout(5000) });
        const ddgData = await ddgRes.json();
        const abstractText: string = ddgData?.AbstractText || '';
        const abstractURL: string = ddgData?.AbstractURL || '';
        const heading: string = ddgData?.Heading || '';
        const relatedTopics: Array<{ Text?: string; FirstURL?: string }> = ddgData?.RelatedTopics || [];

        let output = '';
        if (heading || abstractText) {
          const truncated = abstractText.length > 300 ? abstractText.substring(0, 300) + '...' : abstractText;
          output += `**${heading || '搜索结果'}**\n   ${abstractURL}\n   ${truncated}\n`;
        }
        const topics = relatedTopics.filter(t => t.Text).slice(0, n);
        topics.forEach((t, i) => {
          output += `${i + 1}. ${t.Text}\n   ${t.FirstURL}\n`;
        });

        if (output.trim()) return output.trim();
      } catch (err: any) {
        console.error('[DuckDuckGo] 搜索失败:', err.message);
      }

      return `未能检索到 "${query}" 的结果。`;
    },
  },
};
