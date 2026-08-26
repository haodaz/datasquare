'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Table, Input, Button, Tag, Space, Modal, Drawer, Checkbox, message, Tooltip, Select, Dropdown } from 'antd';
import {
  SearchOutlined, DownloadOutlined, ReloadOutlined, CheckCircleOutlined,
  DeleteOutlined, EyeOutlined, EditOutlined, DatabaseOutlined, NodeIndexOutlined,
} from '@ant-design/icons';
import type { TalentJournalEntry } from '@/lib/mcp/talent-journal-shared';
import { DATA_SOURCE_LABEL, DATA_SOURCE_COLORS, TRIGGER_TOOL_LABEL, TRIGGER_TOOL_COLORS, formatDataSources } from '@/lib/mcp/talent-journal-shared';
import { fetchWithAuth } from '@/lib/fetchWithAuth';

const PRIMARY = '#6055f5';

type SortKey = 'search_count' | 'last_searched' | 'name' | 'institution';
type SortOrder = 'ascend' | 'descend' | null;

type GlobalStats = {
  total: number;
  highFreqCount: number;
  verifiedCount: number;
  pingfangPendingCount: number;
};

export default function TalentJournalPage() {
  const [data, setData] = useState<TalentJournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<GlobalStats>({ total: 0, highFreqCount: 0, verifiedCount: 0, pingfangPendingCount: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('search_count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('descend');
  const [drawerEntry, setDrawerEntry] = useState<TalentJournalEntry | null>(null);
  const [translateDrawerEntry, setTranslateDrawerEntry] = useState<TalentJournalEntry | null>(null);
  const [translating, setTranslating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mergePreviewOpen, setMergePreviewOpen] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [notesModalEntry, setNotesModalEntry] = useState<TalentJournalEntry | null>(null);
  // 批量导出：记录当前页勾选的 mcp id
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedRowMap, setSelectedRowMap] = useState<Record<string, TalentJournalEntry>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        offset: String((page - 1) * pageSize),
        limit: String(pageSize),
        includeStats: '1',
      });
      if (search) params.set('search', search);
      if (sortKey) params.set('sort', sortKey);
      if (sortOrder) params.set('sortOrder', sortOrder);
      const res = await fetchWithAuth(`/api/admin/talent-journal?${params}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.items || []);
        setTotal(json.total || 0);
        if (json.stats) setStats(json.stats);
      }
    } catch (e) {
      message.error('加载失败');
    }
    setLoading(false);
  }, [page, pageSize, search, sortKey, sortOrder]);

  const handleTranslate = async (mcpId: number) => {
    setTranslating(true);
    try {
      const res = await fetchWithAuth('/api/admin/talent-journal/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpId })
      });
      const json = await res.json();
      if (json.ok) {
        message.success('转译成功');
        setTranslateDrawerEntry(prev => prev ? { ...prev, structured_data: json.structured_data } : prev);
        setData(prev => prev.map(item => item._mcp_id === mcpId ? { ...item, structured_data: json.structured_data } : item));
      } else {
        message.error(json.error || '转译失败');
      }
    } catch (e) {
      message.error('转译接口出错');
    } finally {
      setTranslating(false);
    }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleVerify = async (entry: TalentJournalEntry, verified: boolean) => {
    try {
      await fetchWithAuth('/api/admin/talent-journal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpId: entry._mcp_id, verified }),
      });
      message.success(verified ? '已标记为已验证' : '已取消验证');
      fetchData();
    } catch { message.error('操作失败'); }
  };

  const handleDelete = (entry: TalentJournalEntry) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除「${entry.talent_name}」的日志记录吗？`,
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        await fetchWithAuth(`/api/admin/talent-journal?id=${entry._mcp_id}`, { method: 'DELETE' });
        message.success('已删除');
        fetchData();
      },
    });
  };

  const handleSaveNotes = async () => {
    if (!notesModalEntry) return;
    await fetchWithAuth('/api/admin/talent-journal', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpId: notesModalEntry._mcp_id, notes: editNotes }),
    });
    message.success('备注已保存');
    setNotesModalEntry(null);
    fetchData();
  };

  const getMergedPreview = (): TalentJournalEntry | null => {
    if (selectedRowKeys.length < 2) return null;
    const primary = JSON.parse(JSON.stringify(selectedRowMap[selectedRowKeys[0]]));
    const others = selectedRowKeys.slice(1).map(k => selectedRowMap[k as string]);
    
    // 取并集
    const dsSet = new Set<string>(primary.data_sources || []);
    const ttSet = new Set<string>(primary.trigger_tools || []);
    primary.search_count = primary.search_count || 1;

    others.forEach(incoming => {
      if (incoming.ai_report) primary.ai_report = (primary.ai_report ? primary.ai_report + '\n\n---\n\n' : '') + incoming.ai_report;
      if (incoming.bio_snippet && !primary.bio_snippet) primary.bio_snippet = incoming.bio_snippet;
      if (incoming.structured_data && !primary.structured_data) primary.structured_data = incoming.structured_data;
      if (incoming.data_sources) {
        incoming.data_sources.forEach((s: string) => dsSet.add(s));
      }
      if (incoming.trigger_tools) {
        incoming.trigger_tools.forEach((t: string) => ttSet.add(t));
      }
      primary.search_count += (incoming.search_count || 1);
    });

    primary.data_sources = Array.from(dsSet);
    primary.trigger_tools = Array.from(ttSet);
    primary.talent_name = `${primary.talent_name} (合并)`;
    primary.merged = true;
    return primary;
  };

  const handleSaveMerged = async () => {
    const m = getMergedPreview();
    if (!m) {
      console.warn('[TalentJournal] handleSaveMerged: getMergedPreview returned null');
      return;
    }
    console.log('[TalentJournal] handleSaveMerged: sending entry', { talent_name: m.talent_name, id: m.id, hasMcpId: !!m._mcp_id });
    try {
      const res = await fetchWithAuth('/api/admin/talent-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: m }),
      });
      console.log('[TalentJournal] handleSaveMerged: response status', res.status);
      const json = await res.json();
      console.log('[TalentJournal] handleSaveMerged: response json', json);
      if (json.ok) {
        message.success('创建成功，请手动删除旧数据');
        setMergePreviewOpen(false);
        fetchData();
        setSelectedRowKeys([]);
        setSelectedRowMap({});
      } else {
        message.error(json.error || '保存失败');
      }
    } catch (e: any) {
      message.error('保存出错');
    }
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 条记录？`,
      content: '删除后无法恢复，确定要继续吗？',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true);
        try {
          const promises = selectedRowKeys.map(id =>
            fetchWithAuth(`/api/admin/talent-journal?id=${id}`, { method: 'DELETE' }).then(res => res.json())
          );
          await Promise.all(promises);
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          setSelectedRowMap({});
          fetchData();
        } catch (e) {
          message.error('删除过程中出现错误');
        } finally {
          setDeleting(false);
        }
      }
    });
  };

  const handleExport = (mode: 'all' | 'selected' = 'all') => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (mode === 'selected') {
      if (selectedRowKeys.length === 0) {
        message.warning('请先勾选要导出的条目');
        return;
      }
      params.set('ids', selectedRowKeys.map(String).join(','));
    }
    const qs = params.toString();
    window.open(`/api/admin/talent-journal/export${qs ? `?${qs}` : ''}`, '_blank');
  };

  const handleSubmitSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'talent_name',
      key: 'name',
      width: 220,
      render: (name: string, record: TalentJournalEntry) => {
        const pingfangMissing = !Array.isArray(record.data_sources) || !record.data_sources.includes('pingfang');
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600, color: 'rgba(0,0,0,0.85)' }}>{name}</div>
              {record.merged && <Tag color="purple" style={{ fontSize: 11, margin: 0, padding: '0 4px', height: 18, lineHeight: '16px' }}>合并</Tag>}
              {pingfangMissing && (
                <Tag color="orange" style={{
                  fontSize: 11, margin: 0, padding: '0 6px', height: 18, lineHeight: '16px',
                  border: 'none',
                }}>
                  平方待新增
                </Tag>
              )}
            </div>
            {record.talent_name_en && (
              <div style={{ fontSize: 11, color: 'rgba(128,128,128,1)' }}>{record.talent_name_en}</div>
            )}
          </div>
        );
      },
    },
    {
      title: '机构',
      dataIndex: 'institution',
      key: 'institution',
      width: 160,
      ellipsis: true,
      sorter: true,
      render: (v: string) => v || <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: '查询次数',
      dataIndex: 'search_count',
      key: 'search_count',
      width: 90,
      sorter: true,
      defaultSortOrder: 'descend',
      render: (v: number) => (
        <span style={{
          background: v >= 5 ? 'rgba(239,68,68,0.1)' : v >= 2 ? 'rgba(245,158,11,0.1)' : 'rgba(0,0,0,0.04)',
          color: v >= 5 ? '#dc2626' : v >= 2 ? '#d97706' : 'rgba(0,0,0,0.65)',
          padding: '2px 8px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
        }}>{v}</span>
      ),
    },
    {
      title: 'H-Index',
      dataIndex: 'h_index',
      key: 'h_index',
      width: 80,
      render: (v: number | undefined) => v ?? <span style={{ color: '#ccc' }}>—</span>,
    },
    {
      title: '数据来源',
      dataIndex: 'data_sources',
      key: 'data_sources',
      width: 280,
      render: (sources: string[]) => (
        <Space size={2} wrap>
          {(sources || []).map(s => (
            <Tag key={s} color={DATA_SOURCE_COLORS[s] || '#999'} style={{ fontSize: 11, margin: 0 }}>
              {DATA_SOURCE_LABEL[s] || s}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '触发工具',
      dataIndex: 'trigger_tools',
      key: 'trigger_tools',
      width: 160,
      filters: Object.entries(TRIGGER_TOOL_LABEL).map(([key, label]) => ({
        text: label,
        value: key,
      })),
      filterMultiple: true,
      onFilter: (value, record) => {
        const tools = record.trigger_tools || [];
        return tools.includes(value);
      },
      render: (tools: string[] | undefined) => (
        <Space size={2} wrap>
          {(tools || []).map(t => (
            <Tag key={t} color={TRIGGER_TOOL_COLORS[t] || '#999'} style={{ fontSize: 11, margin: 0 }}>
              {TRIGGER_TOOL_LABEL[t] || t}
            </Tag>
          ))}
          {(!tools || tools.length === 0) && <span style={{ color: '#ccc' }}>—</span>}
        </Space>
      ),
    },
    {
      title: '最近查询',
      dataIndex: 'last_searched_at',
      key: 'last_searched',
      width: 110,
      sorter: true,
      render: (v: string) => v ? new Date(v).toLocaleDateString('zh-CN') : '—',
    },
    {
      title: '状态',
      dataIndex: 'verified',
      key: 'verified',
      width: 80,
      filters: [
        { text: '已验证', value: true },
        { text: '待验证', value: false },
      ],
      onFilter: (value, record) => record.verified === value,
      render: (v: boolean) => v
        ? <Tag color="success" icon={<CheckCircleOutlined />}>已验证</Tag>
        : <Tag color="default">待验证</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: any, record: TalentJournalEntry) => (
        <Space size={4}>
          <Tooltip title="查看详情">
            <Button type="text" size="small" icon={<EyeOutlined />}
              onClick={() => setDrawerEntry(record)} />
          </Tooltip>
          <Tooltip title="结构化转译">
            <Button type="text" size="small" icon={<NodeIndexOutlined />}
              onClick={() => setTranslateDrawerEntry(record)} />
          </Tooltip>
          <Tooltip title={record.verified ? '取消验证' : '标记已验证'}>
            <Button type="text" size="small"
              icon={<CheckCircleOutlined style={{ color: record.verified ? '#10b981' : '#ccc' }} />}
              onClick={() => handleVerify(record, !record.verified)} />
          </Tooltip>
          <Tooltip title="备注">
            <Button type="text" size="small" icon={<EditOutlined />}
              onClick={() => { setNotesModalEntry(record); setEditNotes(record.notes || ''); }} />
          </Tooltip>
          <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const statCards = [
    {
      label: '总查询人才数',
      value: stats.total,
      hint: '被搜索过并成功记录的人才条目总数（含重复被查，但每人只计 1 条）',
      color: PRIMARY,
    },
    {
      label: '高频查询人数',
      value: stats.highFreqCount,
      hint: '被查询次数 ≥ 5 次的人才条数（≥5 视为高频关注）',
      color: '#dc2626',
    },
    {
      label: '已验证人数',
      value: stats.verifiedCount,
      hint: '管理员手动标记为「已验证」的人才条数',
      color: '#10b981',
    },
    {
      label: '平方待新增',
      value: stats.pingfangPendingCount,
      hint: '数据来源中缺少「平方 (pingfang)」的人才条数（需补录平方档案）',
      color: '#d97706',
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined style={{ color: PRIMARY }} />
            人才日志 (Talent Journal)
          </h2>
          <div style={{ fontSize: 13, color: 'rgba(128,128,128,1)', marginTop: 4 }}>
            由用户搜索意图 + AI 自动采集形成的人才数据池 · 共 {total} 条记录
          </div>
        </div>
        <Space>
          <Input
            placeholder="搜索姓名/机构..."
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onPressEnter={handleSubmitSearch}
            style={{ width: 200 }}
            allowClear
            onClear={() => { setSearch(''); setSearchInput(''); setPage(1); }}
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            style={{ background: PRIMARY, borderColor: PRIMARY }}
            onClick={handleSubmitSearch}
          >
            搜索
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'all',
                  label: '导出全部',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('all'),
                },
                {
                  key: 'selected',
                  label: selectedRowKeys.length > 0
                    ? `导出选中 (${selectedRowKeys.length})`
                    : '导出选中（请先勾选）',
                  icon: <DownloadOutlined />,
                  disabled: selectedRowKeys.length === 0,
                  onClick: () => handleExport('selected'),
                },
              ],
            }}
            placement="bottomRight"
          >
            <Button type="primary" icon={<DownloadOutlined />} style={{ background: PRIMARY }}>
              导出 CSV
            </Button>
          </Dropdown>
        </Space>
      </div>

      {/* 统计卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {statCards.map(stat => (
          <div key={stat.label} style={{
            background: '#fff', borderRadius: 8, padding: '14px 16px',
            border: '1px solid rgba(223,227,245,1)', display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            <div style={{ fontSize: 12, color: 'rgba(128,128,128,1)', fontWeight: 500 }}>{stat.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: stat.color, lineHeight: 1.2, marginTop: 2 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.9)', marginTop: 6, lineHeight: 1.5, minHeight: 32 }}>
              {stat.hint}
            </div>
          </div>
        ))}
      </div>

      {/* 复选操作行 */}
      {selectedRowKeys.length > 0 && (
        <div style={{
          marginBottom: 16, padding: '10px 16px', background: 'rgba(96,85,245,0.04)',
          border: '1px solid rgba(96,85,245,0.15)', borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ fontSize: 13, marginRight: 16 }}>
              已选择 <span style={{ color: PRIMARY, fontWeight: 700, fontSize: 14 }}>{selectedRowKeys.length}</span> 项数据
            </span>
            <Button type="link" size="small" onClick={() => { setSelectedRowKeys([]); setSelectedRowMap({}); }} style={{ padding: 0 }}>
              取消选择
            </Button>
          </div>
          <Space>
            <Button
              type="primary"
              size="small"
              onClick={() => setMergePreviewOpen(true)}
              disabled={selectedRowKeys.length < 2}
              style={{ background: selectedRowKeys.length >= 2 ? '#10b981' : undefined }}
            >
              合并所选数据
            </Button>
            <Button
              size="small"
              danger
              loading={deleting}
              icon={<DeleteOutlined />}
              onClick={handleBatchDelete}
            >
              批量删除
            </Button>
          </Space>
        </div>
      )}

      {/* 表格 + 自定义底部分页 */}
      <div style={{
        background: '#fff', borderRadius: 8,
        border: '1px solid rgba(223,227,245,1)',
      }}>
        <Table
          dataSource={data}
          columns={columns}
          rowKey={(r) => r._mcp_id ? String(r._mcp_id) : r.talent_name}
          loading={loading}
          size="small"
          pagination={false}
          scroll={{ x: 1100 }}
          onChange={(_pagination, _filters, sorter: any) => {
            if (sorter && sorter.field) {
              const keyMap: Record<string, SortKey> = {
                talent_name: 'name',
                institution: 'institution',
                search_count: 'search_count',
                last_searched_at: 'last_searched',
              };
              const newKey = keyMap[sorter.field] || sorter.field as SortKey;
              setSortKey(newKey);
              setSortOrder(sorter.order);
            } else if (sorter && !sorter.field) {
              setSortKey('search_count');
              setSortOrder('descend');
            }
          }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys, rows) => {
              setSelectedRowKeys(keys);
              setSelectedRowMap(prev => ({
                ...prev,
                ...rows.reduce((acc, row) => ({ ...acc, [row._mcp_id as any]: row }), {})
              }));
            },
            preserveSelectedRowKeys: true,
          }}
        />

        {/* 底部分页条 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderTop: '1px solid rgba(223,227,245,1)',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div style={{ fontSize: 12, color: 'rgba(128,128,128,1)' }}>
            共 <b style={{ color: 'rgba(0,0,0,0.75)' }}>{total}</b> 条记录
            {total > 0 && <> · 第 <b style={{ color: PRIMARY }}>{page}</b> / {Math.max(1, Math.ceil(total / pageSize))} 页</>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* 每页条数选择 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(128,128,128,1)' }}>
              每页
              <Select
                size="small"
                value={pageSize}
                style={{ width: 100 }}
                options={[
                  { value: 20, label: '20 条 / 页' },
                  { value: 50, label: '50 条 / 页' },
                  { value: 100, label: '100 条 / 页' },
                ]}
                onChange={(val) => { setPageSize(val); setPage(1); }}
              />
            </div>

            {/* 翻页按钮组 */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Button
                size="small"
                disabled={page <= 1}
                onClick={() => setPage(1)}
              >
                首页
              </Button>
              <Button
                size="small"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                上一页
              </Button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'rgba(128,128,128,1)' }}>跳至</span>
                <Input
                  size="small"
                  style={{ width: 56, textAlign: 'center' }}
                  value={String(page)}
                  onChange={(e) => {
                    const v = parseInt(e.target.value || '1', 10);
                    if (!isNaN(v)) setPage(Math.max(1, v));
                  }}
                  onBlur={() => {
                    const maxP = Math.max(1, Math.ceil(total / pageSize));
                    setPage(p => Math.max(1, Math.min(maxP, p)));
                  }}
                  onPressEnter={() => {
                    const maxP = Math.max(1, Math.ceil(total / pageSize));
                    setPage(p => Math.max(1, Math.min(maxP, p)));
                  }}
                />
                <span style={{ color: 'rgba(128,128,128,1)' }}>页</span>
              </div>

              <Button
                size="small"
                disabled={page >= Math.ceil(total / pageSize)}
                onClick={() => setPage(p => p + 1)}
              >
                下一页
              </Button>
              <Button
                size="small"
                disabled={page >= Math.ceil(total / pageSize)}
                onClick={() => setPage(Math.max(1, Math.ceil(total / pageSize)))}
              >
                末页
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 详情抽屉 */}
      <Drawer
        title={drawerEntry ? `${drawerEntry.talent_name} 详情` : ''}
        open={!!drawerEntry}
        onClose={() => setDrawerEntry(null)}
        width={520}
      >
        {drawerEntry && (
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <Section title="基本信息">
              <Field label="中文名" value={drawerEntry.talent_name} />
              <Field label="英文名" value={drawerEntry.talent_name_en} />
              <Field label="机构" value={drawerEntry.institution} />
              <Field label="工作单位" value={drawerEntry.workplace} />
              <Field label="平方 ID" value={drawerEntry.pingfang_id} />
              <Field
                label="平方档案"
                value={
                  Array.isArray(drawerEntry.data_sources) && drawerEntry.data_sources.includes('pingfang')
                    ? '✅ 已收录'
                    : '⚠️ 平方待新增（数据来源中缺少平方）'
                }
              />
              <Field
                label="百科档案"
                value={(() => {
                  if (!Array.isArray(drawerEntry.data_sources)) return '⚠️ 未收录';
                  const hasWiki = drawerEntry.data_sources.includes('wikipedia');
                  const hasBaike = drawerEntry.data_sources.includes('baike');
                  if (hasWiki && hasBaike) return '✅ 已收录（维基百科 + 百度百科）';
                  if (hasWiki) return '✅ 已收录（维基百科）';
                  if (hasBaike) return '✅ 已收录（百度百科）';
                  return '⚠️ 百科待补全（维基百科和百度百科均未收录）';
                })()}
              />
            </Section>

            <Section title="学术指标">
              <Field label="H-Index" value={drawerEntry.h_index} />
              <Field label="引用数" value={drawerEntry.cited_by_count} />
              <Field label="论文数" value={drawerEntry.works_count} />
              <Field label="研究领域" value={(drawerEntry.research_fields || []).join('、')} />
            </Section>

            <Section title="简介">
              <div style={{ color: 'rgba(0,0,0,0.65)', whiteSpace: 'pre-wrap' }}>
                {drawerEntry.bio_snippet || '暂无'}
              </div>
            </Section>

            <Section title="元数据">
              <Field label="查询次数" value={drawerEntry.search_count} />
              <Field label="首次查询" value={drawerEntry.first_searched_at ? new Date(drawerEntry.first_searched_at).toLocaleString('zh-CN') : '—'} />
              <Field label="最近查询" value={drawerEntry.last_searched_at ? new Date(drawerEntry.last_searched_at).toLocaleString('zh-CN') : '—'} />
              <Field label="数据来源" value={formatDataSources(drawerEntry.data_sources)} />
              <Field label="验证状态" value={drawerEntry.verified ? '✅ 已验证' : '待验证'} />
              {drawerEntry.notes && (
                <Field
                  label="备注"
                  value={drawerEntry.notes}
                  multiline
                />
              )}
            </Section>

            <Section title="ORCID 档案">
              {drawerEntry.orcid_data ? (
                <>
                  <Field label="ORCID ID" value={drawerEntry.orcid_data.orcid_id} />
                  <Field label="主页链接" value={
                    <a href={drawerEntry.orcid_data.url} target="_blank" rel="noreferrer" style={{ color: PRIMARY }}>
                      {drawerEntry.orcid_data.url}
                    </a>
                  } />
                  {drawerEntry.orcid_data.employments?.length > 0 && (
                    <Field label="就职经历" value={drawerEntry.orcid_data.employments.map((e: any) => e.org).join('、')} />
                  )}
                  {drawerEntry.orcid_data.educations?.length > 0 && (
                    <Field label="教育背景" value={drawerEntry.orcid_data.educations.map((e: any) => e.org).join('、')} />
                  )}
                  <Field label="学术著作" value={`${drawerEntry.orcid_data.works?.length || 0} 篇被收录`} />
                </>
              ) : (
                <div style={{ color: 'rgba(128,128,128,1)' }}>未收录 ORCID 数据</div>
              )}
            </Section>

            {drawerEntry.ai_report && (
              <Section title="AI 生成报告">
                <div style={{
                  maxHeight: 400, overflow: 'auto', background: '#fafafa',
                  padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap',
                  border: '1px solid rgba(0,0,0,0.06)',
                }}>
                  {drawerEntry.ai_report}
                </div>
              </Section>
            )}
          </div>
        )}
      </Drawer>

      {/* 备注编辑 Modal */}
      <Modal
        title={`编辑备注 — ${notesModalEntry?.talent_name || ''}`}
        open={!!notesModalEntry}
        onOk={handleSaveNotes}
        onCancel={() => setNotesModalEntry(null)}
        okText="保存"
        cancelText="取消"
      >
        <Input.TextArea
          rows={4}
          value={editNotes}
          onChange={e => setEditNotes(e.target.value)}
          placeholder="添加管理员备注..."
        />
      </Modal>

      {/* 转译 Drawer */}
      <Drawer
        title={translateDrawerEntry ? `${translateDrawerEntry.talent_name} 转译结果` : ''}
        placement="right"
        width={720}
        onClose={() => setTranslateDrawerEntry(null)}
        open={!!translateDrawerEntry}
      >
        {translateDrawerEntry && (
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <Section title="结构化数据视图 (Structured Data)">
              <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, fontSize: 12, border: '1px solid rgba(0,0,0,0.06)', overflowX: 'hidden' }}>
                {translateDrawerEntry.structured_data ? (
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'anywhere', margin: 0, fontFamily: 'monospace' }}>
                    {JSON.stringify(translateDrawerEntry.structured_data, null, 2)}
                  </pre>
                ) : (
                  <div style={{ color: 'rgba(0,0,0,0.45)', textAlign: 'center', padding: '20px 0' }}>尚未转译为结构化数据</div>
                )}
              </div>
              <Button
                type="primary"
                loading={translating}
                onClick={() => translateDrawerEntry._mcp_id && handleTranslate(translateDrawerEntry._mcp_id as number)}
                style={{ marginTop: 16, width: '100%', background: PRIMARY }}
              >
                {translateDrawerEntry.structured_data ? '重新转译' : '立即转译 (调用 Deepseek)'}
              </Button>
            </Section>

            {/* 为方便比对，展示部分原始信息 */}
            <div style={{ marginTop: 24, borderTop: '1px dashed #dfe3f5', paddingTop: 16 }}>
              <div style={{ fontSize: 12, color: 'rgba(128,128,128,1)', marginBottom: 12 }}>参考源信息（只读）</div>
              
              {translateDrawerEntry.ai_report && (
                <Section title="AI 生成报告">
                  <div style={{
                    maxHeight: 200, overflow: 'auto', background: '#fafafa',
                    padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap',
                    border: '1px solid rgba(0,0,0,0.06)', color: 'rgba(0,0,0,0.65)'
                  }}>
                    {translateDrawerEntry.ai_report}
                  </div>
                </Section>
              )}

              {translateDrawerEntry.bio_snippet && (
                <Section title="简介">
                  <div style={{ color: 'rgba(0,0,0,0.65)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontSize: 12 }}>
                    {translateDrawerEntry.bio_snippet}
                  </div>
                </Section>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* 合并预览 Modal */}
      <Modal
        title="合并数据预览"
        open={mergePreviewOpen}
        onCancel={() => setMergePreviewOpen(false)}
        width={700}
        footer={[
          <Button key="cancel" onClick={() => setMergePreviewOpen(false)}>取消</Button>,
          <Button key="submit" type="primary" style={{ background: '#10b981' }} onClick={handleSaveMerged}>确认并创建新数据</Button>
        ]}
      >
        {mergePreviewOpen && getMergedPreview() && (() => {
          const m = getMergedPreview()!;
          return (
            <div style={{ fontSize: 13, lineHeight: 1.8, maxHeight: 600, overflow: 'auto', paddingRight: 12 }}>
              <div style={{ marginBottom: 16, color: 'rgba(0,0,0,0.65)', padding: '10px 14px', background: 'rgba(16, 185, 129, 0.08)', borderRadius: 6, border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                以下是将要生成的合并后数据（包含了勾选的 <b>{selectedRowKeys.length}</b> 条记录的所有汇总信息）。<br />
                点击保存后，请记得手动删除原来的旧数据。
              </div>

              <Section title="基本信息 (合并后)">
                <Field label="中文名" value={m.talent_name} />
                <Field label="英文名" value={m.talent_name_en} />
                <Field label="机构" value={m.institution} />
                <Field label="工作单位" value={m.workplace} />
              </Section>
              
              <Section title="学术指标 (合并后)">
                <Field label="H-Index" value={m.h_index} />
                <Field label="引用数" value={m.cited_by_count} />
                <Field label="论文数" value={m.works_count} />
                <Field label="研究领域" value={(m.research_fields || []).join('、')} />
              </Section>
              
              <Section title="元数据汇总">
                <Field label="查询总计" value={m.search_count} />
                <Field label="数据来源" value={formatDataSources(m.data_sources)} />
                <Field label="触发工具" value={(m.trigger_tools || []).map(t => TRIGGER_TOOL_LABEL[t] || t).join('、')} />
              </Section>

              {m.bio_snippet && (
                <Section title="简介 (合并后)">
                  <div style={{ color: 'rgba(0,0,0,0.65)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                    {m.bio_snippet}
                  </div>
                </Section>
              )}

              {m.ai_report && (
                <Section title="AI 生成报告 (文本拼接)">
                  <div style={{
                    maxHeight: 400, overflow: 'auto', background: '#fafafa',
                    padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    border: '1px solid rgba(0,0,0,0.06)', color: 'rgba(0,0,0,0.65)'
                  }}>
                    {m.ai_report}
                  </div>
                </Section>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

// ── 辅助组件 ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontSize: 14, fontWeight: 700, color: PRIMARY,
        borderBottom: `1px solid rgba(96,85,245,0.15)`, paddingBottom: 4, marginBottom: 8,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, multiline = false }: { label: string; value: any; multiline?: boolean }) {
  return (
    <div style={{ display: 'flex', marginBottom: 4, alignItems: multiline ? 'flex-start' : 'center' }}>
      <span style={{ width: 80, flexShrink: 0, color: 'rgba(128,128,128,1)', paddingTop: multiline ? 2 : 0 }}>{label}</span>
      <span
        style={{
          color: 'rgba(0,0,0,0.75)',
          flex: 1,
          // 长文本（备注）自动换行；单词/标点不强制断行
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          wordBreak: multiline ? 'break-word' : 'normal',
          overflowWrap: 'anywhere',
        }}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}
