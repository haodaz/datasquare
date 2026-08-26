'use client';

import React, { useState } from 'react';
import { Card, Input, Button, Typography, Space, Timeline } from 'antd';
import { SearchOutlined, CheckCircleOutlined, SyncOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { MarkdownMsg } from '@/components/chat/MarkdownMsg';

const { Title, Text } = Typography;

export function TalentTopicSearchTest() {
  const [topic, setTopic] = useState('');
  const [expandedTopics, setExpandedTopics] = useState('');
  const [institution, setInstitution] = useState('');
  const [honors, setHonors] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ step: string; message: string; status?: 'loading'|'success'|'error' }[]>([]);
  const [report, setReport] = useState('');

  const handleSearch = async () => {
    if (!topic && !institution && !honors) return;
    setLoading(true);
    setLogs([]);
    setReport('');

    try {
      const res = await fetch('/api/talent-topic-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, expandedTopics, institution, honors }),
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
                  setLogs(prev => [...prev, { step: data.data.step, message: data.data.message, status: data.data.message.includes('✅') ? 'success' : data.data.message.includes('❌') || data.data.message.includes('⚠️') ? 'error' : 'loading' }]);
                } else if (data.type === 'ai_chunk') {
                  aiText += data.data;
                  setReport(aiText);
                } else if (data.type === 'error') {
                  setLogs(prev => [...prev, { step: 'error', message: `错误: ${data.data.message}`, status: 'error' }]);
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (e: any) {
      setLogs(prev => [...prev, { step: 'Request Failed', message: e.message, status: 'error' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Find Talents 测试台 (多条件检索与推荐报告)" style={{ marginBottom: 24, borderColor: '#667eea' }}>
      <Space style={{ marginBottom: 24 }} wrap>
        <Input 
          placeholder="核心领域/意图 (如: 具身智能)" 
          value={topic}
          onChange={e => setTopic(e.target.value)}
          style={{ width: 220 }}
          onPressEnter={handleSearch}
        />
        <Input 
          placeholder="扩展词 (如: 机器人视觉)" 
          value={expandedTopics}
          onChange={e => setExpandedTopics(e.target.value)}
          style={{ width: 180 }}
          onPressEnter={handleSearch}
        />
        <Input 
          placeholder="限定机构 (如: 清华大学)" 
          value={institution}
          onChange={e => setInstitution(e.target.value)}
          style={{ width: 180 }}
          onPressEnter={handleSearch}
        />
        <Input 
          placeholder="限定荣誉 (如: 杰青)" 
          value={honors}
          onChange={e => setHonors(e.target.value)}
          style={{ width: 140 }}
          onPressEnter={handleSearch}
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading} style={{ background: '#667eea' }}>
          开始智能检索
        </Button>
      </Space>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Logs Panel */}
        <div style={{ flex: '1 1 300px', background: '#f8f9fa', padding: 16, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16 }}>检索进度日志</Title>
          <Timeline
            items={logs.map((log, i) => ({
              color: log.status === 'success' ? 'green' : log.status === 'error' ? 'red' : 'blue',
              dot: log.status === 'loading' ? <SyncOutlined spin /> : log.status === 'success' ? <CheckCircleOutlined /> : log.status === 'error' ? <CloseCircleOutlined /> : undefined,
              children: (
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{log.step}</div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{log.message}</div>
                </div>
              )
            }))}
          />
          {logs.length === 0 && !loading && <div style={{ color: '#999', fontSize: 13 }}>点击搜索开始...</div>}
        </div>

        {/* Report Panel */}
        <div style={{ flex: '2 1 400px', background: '#fff', border: '1px solid #e8e8e8', padding: 24, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 8 }}>
            大模型智能组装报告 (AI Assemble)
          </Title>
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
