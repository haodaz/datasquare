'use client';

import React, { useEffect, useState, use } from 'react';
import { 
  Form, Input, Button, Card, Space, Typography, message, 
  Row, Col, Table
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { getTalentDetail, updateTalentProfile } from '../actions';
import type { TalentDBEntity } from '@/types/talent';

const { Title } = Typography;

export default function TalentDatabaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entity, setEntity] = useState<TalentDBEntity | null>(null);

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const data = await getTalentDetail(Number(id));
      setEntity(data);
      form.setFieldsValue(data);
    } catch (error: any) {
      message.error(error.message || '获取详情失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAll = async () => {
    if (!entity?.id) return;
    setSaving(true);
    try {
      const values = await form.validateFields();
      await updateTalentProfile(entity.id, values);
      message.success('保存成功');
      fetchDetail();
    } catch (e: any) {
      message.error(e.message || '保存失败，请检查表单');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !entity) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!entity) return <div style={{ padding: 24 }}>记录不存在</div>;

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/admin/talent-db')}>返回列表</Button>
          <Title level={4} style={{ margin: 0 }}>人才档案 - {entity.name || entity.name_en}</Title>
        </Space>
        <Button type="primary" onClick={handleSaveAll} loading={saving}>保存更改</Button>
      </div>

      <Form form={form} layout="vertical">
        <Card title="基本信息" bordered={false} style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col span={6}><Form.Item label="First Name" name="first_name"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="Last Name" name="last_name"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="中文名" name="name"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="英文名" name="name_en"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="性别" name="gender"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="国籍" name="nationality"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="是否华裔" name="is_chinese"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="籍贯" name="province"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="出生日期" name="birth_date"><Input placeholder="YYYY-MM-DD" /></Form.Item></Col>
            <Col span={6}><Form.Item label="电子邮箱" name="email"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="BRID" name="brid"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="ORCID" name="orcid"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="Researcher ID" name="researcher_id"><Input /></Form.Item></Col>
            <Col span={6}><Form.Item label="人才主页" name="profile_link"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}><Form.Item label="简介" name="introduction"><Input.TextArea rows={3} /></Form.Item></Col>
            <Col span={24}><Form.Item label="研究领域 / 突出贡献" name="research_field"><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>
        </Card>

        <Card title="当前工作经历" bordered={false} style={{ marginBottom: 24 }}>
          <Form.Item name="work_current"><Input.TextArea rows={2} placeholder="开始时间，单位名称，任职岗位" /></Form.Item>
        </Card>

        <Card title="教育背景" bordered={false} style={{ marginBottom: 24 }}>
          <Form.List name="educations">
            {(fields, { add, remove }) => (
              <>
                <Table
                  dataSource={fields}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  columns={[
                    { title: '学位', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'degree']} noStyle><Input /></Form.Item> },
                    { title: '学校名称', dataIndex: 'name', width: 200, render: (name) => <Form.Item name={[name, 'school']} noStyle><Input /></Form.Item> },
                    { title: '专业', dataIndex: 'name', width: 200, render: (name) => <Form.Item name={[name, 'major']} noStyle><Input /></Form.Item> },
                    { title: '开始时间', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'start_time']} noStyle><Input /></Form.Item> },
                    { title: '结束时间', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'end_time']} noStyle><Input /></Form.Item> },
                    { title: '操作', width: 80, render: (_, field) => <Button type="link" danger onClick={() => remove(field.name)}>删除</Button> }
                  ]}
                />
                <Button type="dashed" onClick={() => add()} block style={{ marginTop: 16 }}>+ 添加教育背景</Button>
              </>
            )}
          </Form.List>
        </Card>

        <Card title="工作经历" bordered={false} style={{ marginBottom: 24 }}>
          <Form.List name="work_experiences">
            {(fields, { add, remove }) => (
              <>
                <Table
                  dataSource={fields}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  columns={[
                    { title: '工作单位', dataIndex: 'name', width: 200, render: (name) => <Form.Item name={[name, 'company']} noStyle><Input /></Form.Item> },
                    { title: '二级工作单位', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'department']} noStyle><Input /></Form.Item> },
                    { title: '职务', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'position']} noStyle><Input /></Form.Item> },
                    { title: '开始时间', dataIndex: 'name', width: 120, render: (name) => <Form.Item name={[name, 'start_time']} noStyle><Input /></Form.Item> },
                    { title: '结束时间', dataIndex: 'name', width: 120, render: (name) => <Form.Item name={[name, 'end_time']} noStyle><Input /></Form.Item> },
                    { title: '工作内容', dataIndex: 'name', render: (name) => <Form.Item name={[name, 'description']} noStyle><Input.TextArea rows={1} /></Form.Item> },
                    { title: '操作', width: 80, render: (_, field) => <Button type="link" danger onClick={() => remove(field.name)}>删除</Button> }
                  ]}
                />
                <Button type="dashed" onClick={() => add()} block style={{ marginTop: 16 }}>+ 添加工作经历</Button>
              </>
            )}
          </Form.List>
        </Card>

        <Card title="获奖经历" bordered={false} style={{ marginBottom: 24 }}>
          <Form.List name="awards">
            {(fields, { add, remove }) => (
              <>
                <Table
                  dataSource={fields}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  columns={[
                    { title: '获奖时间', dataIndex: 'name', width: 120, render: (name) => <Form.Item name={[name, 'time']} noStyle><Input /></Form.Item> },
                    { title: '级别', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'level']} noStyle><Input /></Form.Item> },
                    { title: '奖项名称', dataIndex: 'name', width: 300, render: (name) => <Form.Item name={[name, 'name']} noStyle><Input /></Form.Item> },
                    { title: '获奖理由', dataIndex: 'name', render: (name) => <Form.Item name={[name, 'description']} noStyle><Input.TextArea rows={1} /></Form.Item> },
                    { title: '操作', width: 80, render: (_, field) => <Button type="link" danger onClick={() => remove(field.name)}>删除</Button> }
                  ]}
                />
                <Button type="dashed" onClick={() => add()} block style={{ marginTop: 16 }}>+ 添加获奖经历</Button>
              </>
            )}
          </Form.List>
        </Card>

        <Card title="专利" bordered={false} style={{ marginBottom: 24 }}>
          <Form.List name="patents">
            {(fields, { add, remove }) => (
              <>
                <Table
                  dataSource={fields}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  columns={[
                    { title: '时间', dataIndex: 'name', width: 120, render: (name) => <Form.Item name={[name, 'time']} noStyle><Input /></Form.Item> },
                    { title: '类型', dataIndex: 'name', width: 100, render: (name) => <Form.Item name={[name, 'patent_type']} noStyle><Input /></Form.Item> },
                    { title: '申请/公开号', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'application_number']} noStyle><Input /></Form.Item> },
                    { title: '专利名称', dataIndex: 'name', width: 250, render: (name) => <Form.Item name={[name, 'name']} noStyle><Input /></Form.Item> },
                    { title: '所有发明人', dataIndex: 'name', width: 150, render: (name) => <Form.Item name={[name, 'inventors']} noStyle><Input /></Form.Item> },
                    { title: '本人角色', dataIndex: 'name', width: 100, render: (name) => <Form.Item name={[name, 'role']} noStyle><Input /></Form.Item> },
                    { title: '摘要', dataIndex: 'name', render: (name) => <Form.Item name={[name, 'abstract']} noStyle><Input.TextArea rows={1} /></Form.Item> },
                    { title: '操作', width: 80, render: (_, field) => <Button type="link" danger onClick={() => remove(field.name)}>删除</Button> }
                  ]}
                />
                <Button type="dashed" onClick={() => add()} block style={{ marginTop: 16 }}>+ 添加专利</Button>
              </>
            )}
          </Form.List>
        </Card>

        <Card title="论文" bordered={false} style={{ marginBottom: 24 }}>
          <Form.List name="papers">
            {(fields, { add, remove }) => (
              <>
                <Table
                  dataSource={fields}
                  pagination={false}
                  rowKey="key"
                  size="small"
                  columns={[
                    { title: '发表时间', dataIndex: 'name', width: 120, render: (name) => <Form.Item name={[name, 'time']} noStyle><Input /></Form.Item> },
                    { title: '作者', dataIndex: 'name', width: 180, render: (name) => <Form.Item name={[name, 'authors']} noStyle><Input /></Form.Item> },
                    { title: '论文标题', dataIndex: 'name', width: 300, render: (name) => <Form.Item name={[name, 'title']} noStyle><Input.TextArea rows={1} /></Form.Item> },
                    { title: '期刊/会议', dataIndex: 'name', width: 200, render: (name) => <Form.Item name={[name, 'journal']} noStyle><Input /></Form.Item> },
                    { title: '收录情况', dataIndex: 'name', width: 120, render: (name) => <Form.Item name={[name, 'indexed_by']} noStyle><Input /></Form.Item> },
                    { title: '影响因子', dataIndex: 'name', width: 100, render: (name) => <Form.Item name={[name, 'impact_factor']} noStyle><Input /></Form.Item> },
                    { title: '操作', width: 80, render: (_, field) => <Button type="link" danger onClick={() => remove(field.name)}>删除</Button> }
                  ]}
                />
                <Button type="dashed" onClick={() => add()} block style={{ marginTop: 16 }}>+ 添加论文</Button>
              </>
            )}
          </Form.List>
        </Card>
      </Form>
    </div>
  );
}

