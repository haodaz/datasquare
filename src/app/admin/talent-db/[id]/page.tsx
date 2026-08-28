'use client';

import React, { useEffect, useState, use } from 'react';
import { 
  Form, Input, Button, Card, Space, Typography, message, 
  Row, Col 
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

        <Card title="教育背景" bordered={false} style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col span={8}><Form.Item label="本科阶段时间" name="bachelor_duration"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="本科院校" name="bachelor_school"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="本科专业" name="bachelor_major"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="硕士阶段时间" name="master_duration"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="硕士院校" name="master_school"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="硕士专业" name="master_major"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="博士阶段时间" name="phd_duration"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="博士院校" name="phd_school"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item label="博士专业" name="phd_major"><Input /></Form.Item></Col>
          </Row>
        </Card>

        <Card title="工作经历与获奖" bordered={false} style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col span={24}><Form.Item label="当前工作经历" name="work_current"><Input.TextArea rows={2} placeholder="开始时间，单位名称，任职岗位" /></Form.Item></Col>
            <Col span={24}><Form.Item label="过往工作经历" name="work_experiences"><Input.TextArea rows={4} placeholder="每段返回：开始时间-结束时间，单位名称，任职岗位，工作内容。多段用;分隔" /></Form.Item></Col>
            <Col span={24}><Form.Item label="获奖经历" name="award_experiences"><Input.TextArea rows={3} placeholder="时间，奖项名称。多段用;分隔" /></Form.Item></Col>
          </Row>
        </Card>
      </Form>
    </div>
  );
}
