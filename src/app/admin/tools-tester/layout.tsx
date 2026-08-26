import React from 'react';
import { ToolsTesterSidebar } from '@/components/admin/ToolsTesterSidebar';

export default function ToolsTesterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      <ToolsTesterSidebar />
      <div style={{ flex: 1, padding: 32, overflowY: 'auto', backgroundColor: '#fff' }}>
        {children}
      </div>
    </div>
  );
}
