'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Input, Button, Table, Tag, Progress, Upload, Space, Typography, message, Popconfirm } from 'antd';
import { PlusOutlined, UploadOutlined, PlayCircleOutlined, DeleteOutlined, EyeOutlined, ReloadOutlined, RedoOutlined, StopOutlined, CaretRightOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useModel } from '@/lib/model-context';

const { Title, Text } = Typography;

interface TaskInput {
  key: string;
  name: string;
  institution: string;
}

interface BatchJob {
  id: number;
  status: string;
  total_count: number;
  completed_count: number;
  created_at: string;
  completed_at?: string;
}

export function TalentBatchSearch() {
  const router = useRouter();
  const { currentModel } = useModel();
  // ── 输入区 ──
  const [inputs, setInputs] = useState<TaskInput[]>([
    { key: '1', name: '', institution: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // ── 批次列表 ──
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // ── 加载批次列表 ──
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/batch-web-search');
      const data = await res.json();
      if (data.ok) setJobs(data.jobs || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoadingJobs(true);
    fetchJobs().finally(() => setLoadingJobs(false));
  }, [fetchJobs]);

  // ── 轮询：有 running 批次时每 5 秒刷新 ──
  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'running' || j.status === 'pending');
    if (hasRunning) {
      pollingRef.current = setInterval(fetchJobs, 5000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [jobs, fetchJobs]);

  // ── 输入操作 ──
  const addRow = () => {
    setInputs(prev => [...prev, { key: String(Date.now()), name: '', institution: '' }]);
  };

  const removeRow = (key: string) => {
    setInputs(prev => prev.length > 1 ? prev.filter(r => r.key !== key) : prev);
  };

  const updateRow = (key: string, field: 'name' | 'institution', value: string) => {
    setInputs(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r));
  };

  // ── CSV 上传 ──
  const handleCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      const newInputs: TaskInput[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // 跳过标题行
        if (i === 0 && (line.includes('姓名') || line.toLowerCase().includes('name'))) continue;
        const parts = line.split(/[,，\t]/);
        const name = (parts[0] || '').trim();
        const inst = (parts[1] || '').trim();
        if (name) {
          newInputs.push({ key: String(Date.now() + i), name, institution: inst });
        }
      }
      if (newInputs.length > 0) {
        setInputs(newInputs);
        message.success(`已导入 ${newInputs.length} 条数据`);
      } else {
        message.warning('CSV 中没有有效数据');
      }
    };
    reader.readAsText(file);
    return false; // 阻止 antd 自动上传
  };

  // ── 提交批次 ──
  const handleSubmit = async () => {
    const validTasks = inputs.filter(r => r.name.trim());
    if (validTasks.length === 0) {
      message.warning('请至少填写一条姓名');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/batch-web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: currentModel,
          tasks: validTasks.map(t => ({ name: t.name, institution: t.institution })),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success(`批次 #${data.batch_id} 已创建，共 ${validTasks.length} 条任务，开始处理...`);
        setInputs([{ key: '1', name: '', institution: '' }]);
        fetchJobs(); // 刷新列表
      } else {
        message.error(data.error || '创建失败');
      }
    } catch (e) {
      message.error('请求失败');
    }
    setSubmitting(false);
  };

  // ── 批次操作：terminate / resume / retry ──
  const handleBatchAction = async (batchId: number, action: 'terminate' | 'resume' | 'retry') => {
    const labels = { terminate: '终止', resume: '恢复', retry: '重试' };
    try {
      const res = await fetch('/api/batch-web-search', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId, action }),
      });
      const data = await res.json();
      if (data.ok) {
        message.success(`批次 #${batchId} 已${labels[action]}`);
        fetchJobs();
      } else {
        message.error(data.error || `${labels[action]}失败`);
      }
    } catch { message.error('请求失败'); }
  };

  // ── 状态标签 ──
  const statusTag = (status: string) => {
    switch (status) {
      case 'done': return <Tag color="green">✅ 完成</Tag>;
      case 'partial': return <Tag color="orange">⚠️ 部分失败</Tag>;
      case 'running': return <Tag color="blue">🔄 进行中</Tag>;
      case 'pending': return <Tag color="default">⏳ 等待</Tag>;
      case 'failed': return <Tag color="red">❌ 全部失败</Tag>;
      default: return <Tag>{status}</Tag>;
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* ── 输入区 ── */}
      <Card
        title="🌐 人才网络搜索 — 批量检索"
        style={{ marginBottom: 24, borderColor: '#00b96b' }}
        extra={
          <Space>
            <Upload accept=".csv,.txt" showUploadList={false} beforeUpload={handleCSV}>
              <Button icon={<UploadOutlined />} size="small">上传 CSV</Button>
            </Upload>
            <Text type="secondary" style={{ fontSize: 12 }}>格式: 姓名,机构</Text>
          </Space>
        }
      >
        {/* 动态输入表格 */}
        <div style={{ marginBottom: 16 }}>
          {inputs.map((row, idx) => (
            <div key={row.key} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <Text type="secondary" style={{ width: 24, textAlign: 'right', fontSize: 13 }}>{idx + 1}</Text>
              <Input
                placeholder="姓名 (必填)"
                value={row.name}
                onChange={e => updateRow(row.key, 'name', e.target.value)}
                style={{ flex: 2 }}
                onPressEnter={addRow}
              />
              <Input
                placeholder="机构 (选填，用于消歧)"
                value={row.institution}
                onChange={e => updateRow(row.key, 'institution', e.target.value)}
                style={{ flex: 2 }}
                onPressEnter={addRow}
              />
              <Button
                icon={<DeleteOutlined />}
                size="small"
                type="text"
                danger
                onClick={() => removeRow(row.key)}
                disabled={inputs.length <= 1}
              />
            </div>
          ))}
        </div>

        <Space>
          <Button icon={<PlusOutlined />} onClick={addRow} size="small">添加一行</Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleSubmit}
            loading={submitting}
            style={{ background: '#00b96b' }}
          >
            开始批量检索 ({inputs.filter(r => r.name.trim()).length} 条)
          </Button>
        </Space>
      </Card>

      {/* ── 历史批次列表 ── */}
      <Card
        title="检索批次历史"
        extra={<Button icon={<ReloadOutlined />} size="small" onClick={fetchJobs} loading={loadingJobs}>刷新</Button>}
      >
        <Table
          dataSource={jobs}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: '暂无批次记录' }}
          columns={[
            {
              title: '批次 ID',
              dataIndex: 'id',
              width: 80,
              render: (id: number) => <Text strong>#{id}</Text>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s: string) => statusTag(s),
            },
            {
              title: '进度',
              key: 'progress',
              width: 200,
              render: (_: any, job: BatchJob) => (
                <div>
                  <Progress
                    percent={job.total_count > 0 ? Math.round((job.completed_count / job.total_count) * 100) : 0}
                    size="small"
                    status={job.status === 'running' ? 'active' : job.status === 'done' ? 'success' : 'normal'}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {job.completed_count} / {job.total_count}
                  </Text>
                </div>
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 160,
              render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-',
            },
            {
              title: '操作',
              key: 'actions',
              width: 240,
              render: (_: any, job: BatchJob) => (
                <Space size="small">
                  <Button
                    type="link"
                    icon={<EyeOutlined />}
                    onClick={() => router.push(`/admin/tools-tester/talent-web-search/${job.id}`)}
                  >
                    详情
                  </Button>
                  {(job.status === 'running' || job.status === 'pending') && (
                    <Button
                      type="link"
                      icon={<StopOutlined />}
                      onClick={() => handleBatchAction(job.id, 'terminate')}
                      style={{ color: '#f5222d' }}
                    >
                      终止
                    </Button>
                  )}
                  {(job.status === 'failed' || job.status === 'partial') && (
                    <Button
                      type="link"
                      icon={<CaretRightOutlined />}
                      onClick={() => handleBatchAction(job.id, 'resume')}
                      style={{ color: '#52c41a' }}
                    >
                      恢复
                    </Button>
                  )}
                  {(job.status === 'failed' || job.status === 'partial') && (
                    <Button
                      type="link"
                      icon={<RedoOutlined />}
                      onClick={() => handleBatchAction(job.id, 'retry')}
                      style={{ color: '#fa8c16' }}
                    >
                      重试
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
