'use client';

import React, { useState } from 'react';
import { Button, Input, Card, Alert, Typography, Timeline } from 'antd';
import { Search } from 'lucide-react';
import { SyncOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { TextArea } = Input;
const { Title } = Typography;

export function ToolTargetedInternetSearchTest() {
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState({
    name_cn: '江秉华',
    name_en: 'Binghua Jiang',
    target_claim: '担任 Nature 杂志客座主编'
  });
  const [logs, setLogs] = useState<{ step: string; message: string; status?: 'loading'|'success'|'error'|'info'|'warn' }[]>([]);
  const [result, setResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTest = async () => {
    setLoading(true);
    setLogs([]);
    setResult(null);
    setErrorMsg('');
    try {
      const res = await fetch('/api/tools-tester/targeted-internet-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      if (!res.body) throw new Error('No readable stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

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
                  setLogs(prev => [...prev, { step: data.data.step, message: data.data.message, status: data.data.step }]);
                } else if (data.type === 'result') {
                  setResult(data.data);
                } else if (data.type === 'error') {
                  setErrorMsg(data.data.message);
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card 
      title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Search size={18} /> 互联网定点突破检索子 AI (Targeted OSINT Sub-Agent)</span>}
      style={{ borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
    >
      <div style={{ marginBottom: 16 }}>
        <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
          此沙盒用于测试 <strong>tool_targeted_internet_search</strong>。用于验证简历中那些无法通过常规论文库、百科库查到的“独特孤证”（如社会职务、某次获奖）。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>中文名 (name_cn)</label>
          <Input 
            value={params.name_cn} 
            onChange={e => setParams({...params, name_cn: e.target.value})} 
            placeholder="如: 江秉华"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>英文名 (name_en)</label>
          <Input 
            value={params.name_en} 
            onChange={e => setParams({...params, name_en: e.target.value})} 
            placeholder="如: Binghua Jiang"
          />
        </div>
        <div style={{ gridColumn: '1 / span 2' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>必须核查的孤证 (target_claim)</label>
          <TextArea 
            rows={3} 
            value={params.target_claim} 
            onChange={e => setParams({...params, target_claim: e.target.value})} 
            placeholder="如: 2018年获得XXX终身成就奖 (大模型提炼的短句)"
          />
        </div>
      </div>

      <Button type="primary" onClick={handleTest} loading={loading} style={{ background: '#6055f5', marginBottom: 24 }}>
        Run Sub-Agent Task
      </Button>

      {errorMsg && <Alert type="error" message={errorMsg} style={{ marginBottom: 24 }} />}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', background: '#f8f9fa', padding: 16, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16 }}>执行进度日志 (Logs)</Title>
          <Timeline
            items={logs.map((log, i) => ({
              color: log.status === 'success' ? 'green' : log.status === 'error' ? 'red' : log.status === 'warn' ? 'orange' : 'blue',
              dot: log.status === 'loading' ? <SyncOutlined spin /> : log.status === 'success' ? <CheckCircleOutlined /> : log.status === 'error' ? <CloseCircleOutlined /> : undefined,
              children: <span style={{ fontSize: 13 }}>{log.message}</span>
            }))}
          />
          {logs.length === 0 && !loading && <div style={{ color: '#999', fontSize: 13 }}>点击执行任务...</div>}
        </div>

        <div style={{ flex: '2 1 400px', background: '#fff', border: '1px solid #e8e8e8', padding: 24, borderRadius: 8, maxHeight: 600, overflowY: 'auto' }}>
          <Title level={5} style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 8 }}>
            子工具执行结果 (Sub-Agent Result)
          </Title>
          {result ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <strong>注入全景档案的比对结论 (FactItems):</strong>
                <pre style={{ fontSize: 12, background: '#fff', color: '#0f172a', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(result.factItems, null, 2)}
                </pre>
              </div>
              <div>
                <strong>全网抓取摘要数据 (Raw Data Sample):</strong>
                <pre style={{ fontSize: 12, background: '#fff', color: '#64748b', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>
                  {JSON.stringify(result.rawData, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <div style={{ color: '#999', fontSize: 13, marginTop: 20 }}>
              {loading ? '等待任务完成并返回结果...' : '暂无内容'}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
