'use client';

import React, { useState } from 'react';
import { Card, Input, Button, Typography, Space, Timeline, Select } from 'antd';
import { SearchOutlined, CheckCircleOutlined, SyncOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { MarkdownMsg } from '@/components/chat/MarkdownMsg';

const { Title } = Typography;

const POLICY_LEVEL_OPTIONS = [
  { label: '全部', value: '' },
  { label: '国家级', value: 'country' },
  { label: '地方级', value: 'region' },
];

const POLICY_TYPE_OPTIONS = [
  { label: '全部', value: '' },
  { label: '政策解读', value: 'policy_interpretation' },
  { label: '管理规定', value: 'management_regulation' },
  { label: '规划文件', value: 'planning_document' },
  { label: '通知', value: 'notice' },
];

export function PolicySearchTest() {
  const [topic, setTopic] = useState('');
  const [region, setRegion] = useState('');
  const [policyLevel, setPolicyLevel] = useState('');
  const [policyType, setPolicyType] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ message: string; status?: 'loading'|'success'|'error' }[]>([]);
  const [report, setReport] = useState('');

  const handleSearch = async () => {
    if (!topic && !region) return;
    setLoading(true);
    setLogs([]);
    setReport('');

    try {
      const res = await fetch('/api/policy-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, region, policyLevel, policyType }),
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
                  const msg = `${data.data.step} ${data.data.message}`;
                  setLogs(prev => [...prev, { message: msg, status: msg.includes('✅') ? 'success' : msg.includes('❌') || msg.includes('⚠️') ? 'error' : 'loading' }]);
                } else if (data.type === 'ai_chunk') {
                  aiText += data.data;
                  setReport(aiText);
                } else if (data.type === 'error') {
                  setLogs(prev => [...prev, { message: `错误: ${data.data.message}`, status: 'error' }]);
                }
              } catch (e) { /* ignore */ }
            }
          }
        }
      }
    } catch (e: any) {
      setLogs(prev => [...prev, { message: e.message, status: 'error' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Policy Search 测试台 (政策检索与深度解读)" style={{ marginBottom: 24, borderColor: '#10b981' }}>
      <Space style={{ marginBottom: 24 }} wrap>
        <Input placeholder="政策主题 (如: 人工智能, 低空经济)" value={topic} onChange={e => setTopic(e.target.value)} style={{ width: 240 }} onPressEnter={handleSearch} />
        <Input placeholder="地区 (选填, 如: 上海)" value={region} onChange={e => setRegion(e.target.value)} style={{ width: 160 }} onPressEnter={handleSearch} />
        <Select placeholder="政策级别" value={policyLevel} onChange={v => setPolicyLevel(v)} options={POLICY_LEVEL_OPTIONS} style={{ width: 120 }} allowClear />
        <Select placeholder="政策类型" value={policyType} onChange={v => setPolicyType(v)} options={POLICY_TYPE_OPTIONS} style={{ width: 130 }} allowClear />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading} style={{ background: '#10b981' }}>检索</Button>
      </Space>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* 左列：进度日志 */}
        <div style={{ flex: '1 1 300px', background: '#f8f9fa', padding: 16, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16 }}>检索进度日志</Title>
          <Timeline
            items={logs.map(l => ({
              color: l.status === 'success' ? 'green' : l.status === 'error' ? 'red' : 'blue',
              dot: l.status === 'loading' ? <SyncOutlined spin /> : l.status === 'success' ? <CheckCircleOutlined /> : l.status === 'error' ? <CloseCircleOutlined /> : undefined,
              children: <span style={{ fontSize: 13 }}>{l.message}</span>
            }))}
          />
          {logs.length === 0 && !loading && <div style={{ color: '#999', fontSize: 13 }}>点击检索开始...</div>}
        </div>

        {/* 右列：AI 报告 */}
        <div style={{ flex: '2 1 400px', background: '#fff', border: '1px solid #e8e8e8', padding: 24, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 8 }}>📋 政策分析报告</Title>
          {report ? (
            <MarkdownMsg content={report} />
          ) : (
            <div style={{ color: '#999', fontSize: 13, marginTop: 20 }}>
              {loading ? '等待检索完成并生成报告...' : '暂无内容'}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
