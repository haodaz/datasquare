'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, Database, Globe, User, BookOpen, Layers } from 'lucide-react';

const MENU_ITEMS = [
  { group: '全景检索', items: [
    { title: 'Talent Deep Search (4+1)', href: '/admin/tools-tester/talent-deep-search', icon: <Layers size={16} /> },
    { title: '🌐 人才网络搜索 (批量)', href: '/admin/tools-tester/talent-web-search', icon: <Globe size={16} /> },
    { title: 'Find Talents (条件找人)', href: '/admin/tools-tester/talent-topic-search', icon: <Layers size={16} /> },
    { title: 'Policy Search (政策检索)', href: '/admin/tools-tester/policy-search', icon: <Globe size={16} /> },
    { title: 'Talent Policy Match (人才政策匹配)', href: '/admin/tools-tester/talent-policy-match', icon: <User size={16} /> },
    { title: 'Resource Deep Search', href: '/admin/tools-tester/resource-deep-search', icon: <Database size={16} /> },
  ]},
  { group: '验真子工具 (Sub-Agents)', items: [
    { title: '平方人才检索 (Talent)', href: '/admin/tools-tester/tool-pingfang-search', icon: <User size={16} /> },
    { title: '平方论文检索 (Paper)', href: '/admin/tools-tester/tool-pingfang-paper-search', icon: <BookOpen size={16} /> },
    { title: 'ORCID 检索 (ORCID)', href: '/admin/tools-tester/tool-orcid-search', icon: <User size={16} /> },
    { title: '学术数据检索 (Scholar)', href: '/admin/tools-tester/tool-scholar-search', icon: <Search size={16} /> },
    { title: '百科查询 (Wiki/Baike)', href: '/admin/tools-tester/tool-wiki-baike-search', icon: <Globe size={16} /> },
    { title: '定向突破 (Internet)', href: '/admin/tools-tester/tool-targeted-internet-search', icon: <Search size={16} /> },
  ]}
];

export function ToolsTesterSidebar() {
  const pathname = usePathname();

  return (
    <div style={{
      width: 280,
      backgroundColor: '#f8fafc',
      borderRight: '1px solid #e2e8f0',
      height: 'calc(100vh - 64px)',
      overflowY: 'auto',
      padding: '24px 16px',
      flexShrink: 0
    }}>
      <div style={{ marginBottom: 24, paddingLeft: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>应用测试台</h2>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>AI 底层数据与工具逻辑沙盒</p>
      </div>

      <nav>
        {MENU_ITEMS.map((group, i) => (
          <div key={i} style={{ marginBottom: 24 }}>
            <div style={{ 
              fontSize: 12, 
              fontWeight: 600, 
              color: '#94a3b8', 
              textTransform: 'uppercase', 
              letterSpacing: '0.05em',
              marginBottom: 8,
              paddingLeft: 8
            }}>
              {group.group}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {group.items.map(item => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link 
                      href={item.href}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: 8,
                        textDecoration: 'none',
                        color: isActive ? '#6055f5' : '#475569',
                        backgroundColor: isActive ? 'rgba(96,85,245,0.1)' : 'transparent',
                        fontWeight: isActive ? 600 : 400,
                        transition: 'all 0.2s'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', color: isActive ? '#6055f5' : '#94a3b8' }}>
                        {item.icon}
                      </span>
                      <span style={{ fontSize: 14 }}>{item.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
