'use client';

import React, { useState } from 'react';
import { Card, Input, Button, Typography, Space, Timeline, Select } from 'antd';
import { SearchOutlined, CheckCircleOutlined, SyncOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { MarkdownMsg } from '@/components/chat/MarkdownMsg';

const { Title } = Typography;

const RESOURCE_TYPE_OPTIONS = [
  { label: '全部类型', value: '' },
  { label: '科研仪器', value: '科研仪器' },
  { label: '科研耗材', value: '科研耗材' },
  { label: '科研试剂', value: '科研试剂' },
];

export function ResourceDeepSearchTest() {
  const [query, setQuery] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [brand, setBrand] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ step: string; message: string; status?: 'loading' | 'success' | 'error' }[]>([]);
  const [report, setReport] = useState('');

  const handleSearch = async () => {
    if (!query) return;
    setLoading(true);
    setLogs([]);
    setReport('');

    try {
      const res = await fetch('/api/resource-deep-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, resourceType: resourceType || undefined, brand: brand || undefined }),
      });

      if (!res.body) throw new Error('No readable stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let aiText = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                if (data.type === 'log') {
                  setLogs(prev => [...prev, {
                    step: data.data.step,
                    message: data.data.message,
                    status: data.data.message.includes('✅') ? 'success'
                      : data.data.message.includes('❌') || data.data.message.includes('⚠️') ? 'error'
                      : 'loading',
                  }]);
                } else if (data.type === 'ai_chunk') {
                  aiText += data.data;
                  setReport(aiText);
                } else if (data.type === 'error') {
                  setLogs(prev => [...prev, { step: 'error', message: `错误: ${data.data.message}`, status: 'error' }]);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
      setLogs(prev => [...prev, { step: 'error', message: `请求失败: ${String(e)}`, status: 'error' }]);
    }
    setLoading(false);
  };

  return (
    <Card title="[Admin] Resource Deep Search 测试台 (科研物资检索与汇报)" style={{ marginBottom: 24, borderColor: '#6055f5' }}>
      <Space style={{ marginBottom: 24 }} wrap>
        <Input
          placeholder="输入资源名称（如：低温冰箱、PCR仪）"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: 280 }}
          onPressEnter={handleSearch}
        />
        <Select
          placeholder="资源类型"
          value={resourceType}
          onChange={setResourceType}
          options={RESOURCE_TYPE_OPTIONS}
          style={{ width: 140 }}
        />
        <Input
          placeholder="品牌名（选填）"
          value={brand}
          onChange={e => setBrand(e.target.value)}
          style={{ width: 180 }}
          onPressEnter={handleSearch}
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading} style={{ background: '#6055f5' }}>
          开始资源检索
        </Button>
      </Space>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Logs Panel */}
        <div style={{ flex: '1 1 300px', background: '#f8f9fa', padding: 16, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16 }}>检索进度日志</Title>
          <Timeline
            items={logs.map((log) => ({
              color: log.status === 'success' ? 'green' : log.status === 'error' ? 'red' : 'blue',
              dot: log.status === 'loading' ? <SyncOutlined spin /> : log.status === 'success' ? <CheckCircleOutlined /> : log.status === 'error' ? <CloseCircleOutlined /> : undefined,
              children: <span style={{ fontSize: 13 }}>{log.message}</span>,
            }))}
          />
          {logs.length === 0 && !loading && <div style={{ color: '#999', fontSize: 13 }}>点击搜索开始...</div>}
        </div>

        {/* Report Panel */}
        <div style={{ flex: '2 1 400px', background: '#fff', border: '1px solid #e8e8e8', padding: 24, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 8 }}>
            大模型资源汇报 (AI Assemble)
          </Title>
          {report ? (
            <MarkdownMsg content={report} />
          ) : (
            <div style={{ color: '#999', fontSize: 13, marginTop: 20 }}>
              {loading ? '等待检索完成并生成汇报...' : '暂无内容'}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
