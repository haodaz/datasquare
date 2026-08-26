'use client';

import React from 'react';
import { LinkOutlined } from '@ant-design/icons';

/**
 * 提取文本中的 URL 链接
 */
function extractLinks(text: string): string[] {
  const urlRe = /(?:https?:\/\/|www\.)[^\s<>"'）】\u3001\u3002\uff01\uff1f]+/g;
  return Array.from(new Set(text.match(urlRe) || []));
}

/**
 * 过滤 AI 消息中的 XML 工具调用标签，提取平方数据来源信息
 */
function filterAITags(raw: string): { cleanText: string; hasDashSource: boolean; entities: string[] } {
  let text = raw;
  let hasDashSource = false;
  let entities: string[] = [];

  // 隐藏 <call function="..."> 工具调用标记
  text = text.replace(/<call\s+function="[^"]*"\s*\/>/gi, '');
  text = text.replace(/<call\b[^>]*>[\s\S]*?<\/call>/gi, '');

  // 隐藏 <zj_report> XML
  text = text.replace(/<zj_report[^>]*>[\s\S]*?<\/zj_report>/gi, '');

  // 隐藏 <student_profile ...> 档案操作 XML（所有变体）
  text = text.replace(/<student_profile[^>]*>[\s\S]*?<\/student_profile[^>]*>/gi, '');
  text = text.replace(/<student_profile[^>]*\/>/gi, '');
  text = text.replace(/<student_profile[^>]*>/gi, '');

  // 隐藏 dash_search 和 query_institute_relations 工具调用
  text = text.replace(/<dash_search[^>]*>[\s\S]*?<\/dash_search>/gi, '');
  text = text.replace(/<dash_search[^>]*>/gi, '');
  text = text.replace(/<query_institute_relations[^>]*>[\s\S]*?<\/query_institute_relations>/gi, '');
  text = text.replace(/<query_institute_relations[^>]*\/>/gi, '');

  // 匹配 <dash_source> 并标记来源
  if (/<dash_source/i.test(text)) {
    hasDashSource = true;
    text = text.replace(/<dash_source[\s\S]*?<\/dash_source>/gi, '');
    text = text.replace(/<dash_source[^>]*>/gi, '');
  }

  // 提取 <dash_entities>
  const entMatch = /<dash_entities>([\s\S]*?)<\/dash_entities>/i.exec(text);
  if (entMatch) {
    entities = [...new Set(entMatch[1].split(',').map(e => e.trim()).filter(Boolean))];
    text = text.replace(/<dash_entities>[\s\S]*?<\/dash_entities>/gi, '');
  }

  return { cleanText: text.replace(/\n{3,}/g, '\n\n').trim(), hasDashSource, entities };
}

function markdownToHtml(text: string, isUserBubble = false): string {
  const headingColor = isUserBubble ? '#fff' : '#6055f5';
  const boldColor = isUserBubble ? 'inherit' : 'rgba(0,0,0,0.85)';

  // 先把表格整体提出来，避免被 \n → <br> 替换破坏
  // 收集连续的 | 行（含分隔行）构成完整表格块
  let result = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, `<strong style="color:${boldColor}">$1</strong>`)
    .replace(/`([^`]+)`/g, `<code style="font-size:12.5px;background:#f1f3f4;padding:1px 6px;border-radius:4px;font-family:'SF Mono','Fira Code',monospace">$1</code>`)
    .replace(/^### (.+)$/gm, `<h3 style="font-size:14px;font-weight:700;color:${headingColor};margin:12px 0 6px">$1</h3>`)
    .replace(/^## (.+)$/gm, `<h2 style="font-size:16px;font-weight:700;color:${headingColor};margin:14px 0 6px">$1</h2>`)
    .replace(/^# (.+)$/gm, `<h1 style="font-size:18px;font-weight:700;color:${headingColor};margin:16px 0 8px">$1</h1>`)
    .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:2px solid #6055f5;padding-left:12px;color:rgba(128,128,128,1);font-style:italic;margin:8px 0">$1</blockquote>');

  // 表格：把连续的 | 行组成一个 <table>
  // 此时 < > 已被转义，所以 AI 输出的 <br> 已变成 &lt;br&gt;，需要在单元格内还原
  result = result.replace(/((?:^\|.+\|\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n');
    let hasHeader = false;
    let thead = '';
    let tbody = '';

    rows.forEach((row, idx) => {
      const rawCells = row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      // 分隔行（如 |---|:---:|---| ）
      if (rawCells.every(c => /^[-: ]+$/.test(c))) {
        hasHeader = true;
        return;
      }
      // 单元格内容处理：还原 &lt;br&gt; → <br>，支持换行
      const cells = rawCells.map(c => c.replace(/&lt;br\s*\/?&gt;/gi, '<br/>'));

      if (!hasHeader && idx === 0) {
        // 第一行且没遇到分隔行 → 当普通数据行
        tbody += `<tr>${cells.map(c =>
          `<td style="padding:6px 12px;border:1px solid rgba(0,0,0,0.08);font-size:13px;line-height:1.5;vertical-align:top">${c}</td>`
        ).join('')}</tr>`;
      } else if (!hasHeader) {
        tbody += `<tr>${cells.map(c =>
          `<td style="padding:6px 12px;border:1px solid rgba(0,0,0,0.08);font-size:13px;line-height:1.5;vertical-align:top">${c}</td>`
        ).join('')}</tr>`;
      } else if (idx === 0) {
        // 紧接分隔行之前的是表头（第一行）
        thead = `<thead><tr>${cells.map(c =>
          `<th style="padding:7px 12px;border:1px solid rgba(0,0,0,0.08);background:rgba(96,85,245,0.07);font-size:12.5px;font-weight:700;text-align:left;white-space:nowrap">${c}</th>`
        ).join('')}</tr></thead>`;
      } else {
        tbody += `<tr>${cells.map(c =>
          `<td style="padding:6px 12px;border:1px solid rgba(0,0,0,0.08);font-size:13px;line-height:1.5;vertical-align:top">${c}</td>`
        ).join('')}</tr>`;
      }
    });

    return `<div style="overflow-x:auto;margin:8px 0"><table style="border-collapse:collapse;width:100%;font-size:13px">${thead}<tbody>${tbody}</tbody></table></div>`;
  });

  return result.replace(/\n{2,}/g, '<div style="height:8px"></div>').replace(/\n/g, '<br/>');
}


interface MarkdownMsgProps {
  /** AI 消息内容原文 */
  content: string;
  /** 是否是用户自己的消息（用户气泡不需要过滤 XML，也不显示来源标签） */
  isUser?: boolean;
  /** 用户气泡时字体颜色，默认白色 */
  userColor?: string;
}

/**
 * MarkdownMsg — 群聊 / 知识库聊天通用消息渲染组件
 *
 * 功能：
 * 1. 过滤 XML 工具调用标签（dash_source / student_profile / zj_report 等）
 * 2. 渲染 Markdown（**粗体**、# 标题、> 引用、`代码`、表格）
 * 3. 提取并显示 URL 链接
 * 4. 显示 🛡️ 平方数据来源角标
 */
export function MarkdownMsg({ content, isUser = false, userColor }: MarkdownMsgProps) {
  const { cleanText, hasDashSource, entities } = !isUser
    ? filterAITags(content)
    : { cleanText: content, hasDashSource: false, entities: [] };

  const links = !isUser ? extractLinks(cleanText) : [];
  const html = markdownToHtml(cleanText, isUser);

  return (
    <>
      <span
        style={{ color: userColor || 'inherit' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* 链接卡片 */}
      {links.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {links.map((url, i) => {
            const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
            let host = '';
            try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { host = url.replace(/^www\./, '').split('/')[0]; }
            return (
              <a key={i} href={href} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                  background: 'rgba(96,85,245,0.06)', borderRadius: 10, textDecoration: 'none',
                  border: '1px solid rgba(96,85,245,0.15)', maxWidth: '100%', overflow: 'hidden' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,85,245,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(96,85,245,0.06)')}>
                <LinkOutlined style={{ fontSize: 11, color: '#6055f5', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#6055f5', fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {host || url}
                </span>
              </a>
            );
          })}
        </div>
      )}

      {/* 🛡️ 平方数据来源角标 */}
      {hasDashSource && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 20,
            background: 'rgba(96,85,245,0.07)',
            border: '1px solid rgba(96,85,245,0.18)',
            fontSize: 11, color: '#6055f5', fontWeight: 500, flexShrink: 0,
          }}>
            🛡️ 来源·平方数据
          </div>
          {entities.map((ent, i) => (
            <span key={i} style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 20,
              background: 'rgba(96,85,245,0.04)',
              border: '1px solid rgba(96,85,245,0.12)',
              fontSize: 11, color: 'rgba(0,0,0,0.50)',
            }}>
              {ent}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
