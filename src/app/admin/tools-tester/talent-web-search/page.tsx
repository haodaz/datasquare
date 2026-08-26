'use client';

import React from 'react';
import { TalentDeepSearchTest } from '@/components/apps/TalentDeepSearchTest';

export default function TalentWebSearchPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <TalentDeepSearchTest
        apiEndpoint="/api/talent-web-search"
        title="🌐 人才网络搜索 (跳过平方，直接互联网检索)"
        buttonText="开始网络检索"
        buttonColor="#00b96b"
        borderColor="#00b96b"
      />
    </div>
  );
}
