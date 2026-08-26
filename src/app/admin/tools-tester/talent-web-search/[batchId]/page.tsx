'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Tag, Progress, Button, Typography, Collapse, Space, Timeline } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, CheckCircleOutlined, SyncOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useParams, useRouter } from 'next/navigation';
import { MarkdownMsg } from '@/components/chat/MarkdownMsg';

const { Title, Text } = Typography;

interface BatchTask {
  id: number;
  seq: number;
  talent_name: string;
  institution: string;
  status: string;
  logs: string | { step: string; message: string }[];
  ai_report: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

interface BatchJob {
  id: number;
  status: string;
  total_count: number;
  completed_count: number;
  created_at: string;
  completed_at?: string;
}

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.batchId as string;

  const [job, setJob] = useState<BatchJob | null>(null);
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/batch-web-search?id=${batchId}`);
      const data = await res.json();
      if (data.ok) {
        setJob(data.job);
        setTasks(data.tasks || []);
      }
    } catch { /* ignore */ }
  }, [batchId]);

  useEffect(() => {
    fetchDetail().finally(() => setLoading(false));
  }, [fetchDetail]);

  // 轮询
  useEffect(() => {
    const isRunning = job?.status === 'running' || job?.status === 'pending';
    if (isRunning) {
      pollingRef.current = setInterval(fetchDetail, 4000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [job?.status, fetchDetail]);

  const statusTag = (status: string) => {
    switch (status) {
      case 'done': return <Tag color="green">✅ 完成</Tag>;
      case 'partial': return <Tag color="orange">⚠️ 部分失败</Tag>;
      case 'running': return <Tag color="blue">🔄 进行中</Tag>;
      case 'pending': return <Tag color="default">⏳ 等待</Tag>;
      case 'failed': return <Tag color="red">❌ 失败</Tag>;
      default: return <Tag>{status}</Tag>;
    }
  };

  const parseLogs = (logs: string | { step: string; message: string }[]): { step: string; message: string }[] => {
    if (Array.isArray(logs)) return logs;
    try { return JSON.parse(logs); } catch { return []; }
  };

  const percent = job && job.total_count > 0
    ? Math.round((job.completed_count / job.total_count) * 100) : 0;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* 顶部导航 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/admin/tools-tester/talent-web-search')}>
          返回批次列表
        </Button>
        <Title level={4} style={{ margin: 0 }}>批次 #{batchId} 详情</Title>
        <Button icon={<ReloadOutlined />} size="small" onClick={fetchDetail} loading={loading}>刷新</Button>
      </div>

      {/* 总体进度 */}
      {job && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {statusTag(job.status)}
            <Progress
              percent={percent}
              status={job.status === 'running' ? 'active' : job.status === 'done' ? 'success' : 'normal'}
              style={{ flex: 1 }}
            />
            <Text type="secondary">
              {job.completed_count} / {job.total_count} 已完成
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              创建于 {new Date(job.created_at).toLocaleString('zh-CN')}
            </Text>
          </div>
        </Card>
      )}

      {/* 任务列表 */}
      <Card>
        <Table
          dataSource={tasks}
          rowKey="id"
          size="small"
          pagination={false}
          loading={loading}
          onRow={(record) => ({
            onClick: () => setExpandedTask(expandedTask === record.id ? null : record.id),
            style: { cursor: 'pointer' },
          })}
          expandable={{
            expandedRowKeys: expandedTask !== null ? [expandedTask] : [],
            onExpand: (expanded, record) => setExpandedTask(expanded ? record.id : null),
            expandedRowRender: (record) => {
              const logs = parseLogs(record.logs);
              return (
                <div style={{ display: 'flex', gap: 24, padding: '8px 0' }}>
                  {/* 日志面板 */}
                  <div style={{ flex: 1, background: '#f8f9fa', padding: 16, borderRadius: 8, maxHeight: 500, overflowY: 'auto' }}>
                    <Title level={5} style={{ marginBottom: 12, fontSize: 14 }}>检索日志</Title>
                    {logs.length > 0 ? (
                      <Timeline
                        items={logs.map((log, i) => ({
                          color: log.message.includes('✅') ? 'green' : log.message.includes('❌') || log.message.includes('⚠️') ? 'red' : 'blue',
                          dot: log.message.includes('✅') ? <CheckCircleOutlined /> : log.message.includes('❌') ? <CloseCircleOutlined /> : record.status === 'running' && i === logs.length - 1 ? <SyncOutlined spin /> : undefined,
                          children: <span style={{ fontSize: 12 }}>{log.message}</span>,
                        }))}
                      />
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {record.status === 'pending' ? '等待中...' : record.status === 'running' ? '检索中...' : '无日志'}
                      </Text>
                    )}
                    {record.error_message && (
                      <div style={{ marginTop: 8, padding: 8, background: '#fff1f0', borderRadius: 4, fontSize: 12, color: '#cf1322' }}>
                        ❌ 错误: {record.error_message}
                      </div>
                    )}
                  </div>

                  {/* 报告面板 */}
                  <div style={{ flex: 2, background: '#fff', border: '1px solid #e8e8e8', padding: 16, borderRadius: 8, maxHeight: 500, overflowY: 'auto' }}>
                    <Title level={5} style={{ marginBottom: 12, fontSize: 14 }}>AI 组装报告</Title>
                    {record.ai_report ? (
                      <MarkdownMsg content={record.ai_report} />
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {record.status === 'done' ? '无报告内容' : '等待生成...'}
                      </Text>
                    )}
                  </div>
                </div>
              );
            },
          }}
          columns={[
            {
              title: '#',
              dataIndex: 'seq',
              width: 50,
            },
            {
              title: '姓名',
              dataIndex: 'talent_name',
              render: (name: string) => <Text strong>{name}</Text>,
            },
            {
              title: '机构',
              dataIndex: 'institution',
              render: (inst: string) => inst || <Text type="secondary">-</Text>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s: string) => statusTag(s),
            },
            {
              title: '耗时',
              key: 'duration',
              width: 100,
              render: (_: any, r: BatchTask) => {
                if (!r.started_at) return '-';
                const end = r.completed_at ? new Date(r.completed_at) : new Date();
                const secs = Math.round((end.getTime() - new Date(r.started_at).getTime()) / 1000);
                return <Text type="secondary">{secs}s</Text>;
              },
            },
          ]}
        />
      </Card>
    </div>
  );
}
