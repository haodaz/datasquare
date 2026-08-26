'use client';

import React, { useState } from 'react';
import { Card, Input, Button, Typography, Space, Timeline } from 'antd';
import { SearchOutlined, CheckCircleOutlined, SyncOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { MarkdownMsg } from '@/components/chat/MarkdownMsg';

const { TextArea } = Input;
const { Title, Text } = Typography;

export function TalentPolicyMatchTest() {
  const [userProfile, setUserProfile] = useState('');
  const [topic, setTopic] = useState('');
  const [region, setRegion] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ message: string; status?: 'loading'|'success'|'error' }[]>([]);
  const [report, setReport] = useState('');

  const handleSearch = async () => {
    if (!userProfile && !topic) return;
    setLoading(true);
    setLogs([]);
    setReport('');

    const effectiveTopic = topic || '人才引进 补贴 落户';

    try {
      const res = await fetch('/api/policy-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: effectiveTopic, region, userProfile }),
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
    <Card title="人才政策匹配 测试台 (个人背景 → 政策资格匹配)" style={{ marginBottom: 24, borderColor: '#8b5cf6' }}>
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          输入您的个人背景信息（学历、年龄、海外经历、论文成果等），系统将自动匹配符合条件的人才引进政策，并给出资格分析和补贴明细。
        </Text>
        <TextArea
          placeholder="例: UCLA博士毕业，普林斯顿博后2年，32岁，5篇一作，回国符合哪些城市的人才补贴政策，帮我比较和推荐一下"
          value={userProfile}
          onChange={e => setUserProfile(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 6 }}
          style={{ width: '100%' }}
        />
      </div>
      <Space style={{ marginBottom: 24 }} wrap>
        <Input placeholder="政策方向 (选填, 如: 人才引进, 创业补贴)" value={topic} onChange={e => setTopic(e.target.value)} style={{ width: 260 }} onPressEnter={handleSearch} />
        <Input placeholder="限定地区 (选填, 如: 上海, 广东)" value={region} onChange={e => setRegion(e.target.value)} style={{ width: 200 }} onPressEnter={handleSearch} />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading} style={{ background: '#8b5cf6' }}>匹配分析</Button>
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
          {logs.length === 0 && !loading && <div style={{ color: '#999', fontSize: 13 }}>点击匹配分析开始...</div>}
        </div>

        {/* 右列：AI 匹配报告 */}
        <div style={{ flex: '2 1 400px', background: '#fff', border: '1px solid #e8e8e8', padding: 24, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 8 }}>📋 人才政策匹配报告</Title>
          {report ? (
            <MarkdownMsg content={report} />
          ) : (
            <div style={{ color: '#999', fontSize: 13, marginTop: 20 }}>
              {loading ? '等待检索完成并生成匹配报告...' : '暂无内容'}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
