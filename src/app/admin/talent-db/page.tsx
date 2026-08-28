'use client';

import React, { useEffect, useState } from 'react';
import { Table, Input, Button, Space, Card, Tag, Typography, message, Popconfirm } from 'antd';
import { SearchOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { getTalentEntries, deleteTalentEntry } from './actions';
import type { TalentDBEntity } from '@/types/talent';

const { Title } = Typography;

export default function TalentDatabaseList() {
  const router = useRouter();
  const [data, setData] = useState<TalentDBEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchText, setSearchText] = useState('');

  const fetchData = async (page = 1, size = 20, search = '') => {
    setLoading(true);
    try {
      const result = await getTalentEntries(search, page, size);
      setData(result.data);
      setTotal(result.total);
    } catch (error: any) {
      message.error(error.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(currentPage, pageSize, searchText);
  }, [currentPage, pageSize]);

  const handleSearch = (value: string) => {
    setSearchText(value);
    setCurrentPage(1);
    fetchData(1, pageSize, value);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTalentEntry(id);
      message.success('删除成功');
      fetchData(currentPage, pageSize, searchText);
    } catch (e: any) {
      message.error(e.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '姓名',
      key: 'name',
      render: (_: any, record: TalentDBEntity) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }}>{record.name || record.name_en || '-'}</span>
          {record.name_en && record.name && <span style={{ fontSize: 12, color: '#888' }}>{record.name_en}</span>}
        </Space>
      ),
    },
    {
      title: '当前工作 / 单位',
      dataIndex: 'work_current',
      key: 'work_current',
      render: (text: string) => text || '-',
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (text: string) => text || '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: TalentDBEntity) => (
        <Space size="middle">
          <Button
            type="primary"
            icon={<EyeOutlined />}
            size="small"
            onClick={() => router.push(`/admin/talent-db/${record.id}`)}
          >
            档案
          </Button>
          <Popconfirm
            title="确定要删除吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="是"
            cancelText="否"
          >
            <Button danger icon={<DeleteOutlined />} size="small">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Card bordered={false}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>人才实体库</Title>
          <Space>
            <Input.Search
              placeholder="搜索姓名或机构"
              allowClear
              onSearch={handleSearch}
              style={{ width: 300 }}
              enterButton={<SearchOutlined />}
            />
            {/* 留给未来导出的占位符 */}
            <Button>导出</Button>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 项`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
            },
          }}
        />
      </Card>
    </div>
  );
}
