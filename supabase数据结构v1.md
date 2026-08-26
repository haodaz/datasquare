# Supabase 数据库方案（修订版 v2）

## 设计原则

1. **Raw data 完整保留** → `talent_source_data` 原样存
2. **AI 转译后的结构化字段** → `talent_profiles` 独立存（对应你截图里的那个 JSON）
3. **字段级溯源** → 每个结构化字段可追溯到来源信源
4. **工具日志完整保存** → 流式 log + AI 渲染结果 + 原始数据

---

## 表结构

### 1. `profiles` — 用户账号

```sql
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

### 2. `talent_entries` — 人才主记录（索引 + 管理）

```sql
CREATE TABLE talent_entries (
  id SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  talent_name TEXT NOT NULL,
  talent_name_en TEXT,
  institution TEXT,
  
  -- AI 综合报告
  ai_report TEXT,
  
  -- 管理元数据
  search_count INTEGER DEFAULT 1,
  data_sources TEXT[] DEFAULT '{}',
  trigger_tools TEXT[] DEFAULT '{}',
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  
  -- 归属
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  first_searched_at TIMESTAMPTZ DEFAULT now(),
  last_searched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

### 3. `talent_profiles` — AI 转译后的结构化字段

对应 Excel 人才库的字段体系 + AI 转译结果。
**这些字段来自 AI 解析，不是直接从 raw data 拆出来的。**

```sql
CREATE TABLE talent_profiles (
  id SERIAL PRIMARY KEY,
  talent_entry_id INTEGER REFERENCES talent_entries(id) ON DELETE CASCADE UNIQUE,
  
  -- ── 基本信息 ──
  name_cn TEXT,                    -- 姓名-中文
  name_en TEXT,                    -- 姓名-英文
  gender TEXT,                     -- 性别
  email TEXT,                      -- 电子邮箱
  birth_date TEXT,                 -- 出生日期
  nationality TEXT,                -- 国籍/籍贯
  
  -- ── 教育背景 ──
  undergrad_school TEXT,           -- 本科院校
  undergrad_major TEXT,            -- 本科专业
  undergrad_start TEXT,            -- 进入本科时间
  masters_school TEXT,             -- 硕士院校
  masters_major TEXT,              -- 硕士专业
  phd_school TEXT,                 -- 博士院校
  phd_major TEXT,                  -- 博士专业
  education_raw TEXT,              -- 教育背景（AI 原文）
  
  -- ── 现职信息 ──
  current_employer TEXT,           -- 现工作单位
  department TEXT,                 -- 所在院系
  country TEXT,                    -- 所在国家
  position TEXT,                   -- 现任职务
  title TEXT,                      -- 职称
  employer_start_date TEXT,        -- 现工作单位入职时间
  
  -- ── 履历 ──
  work_history TEXT,               -- 过往工作单位与职务
  awards TEXT,                     -- 所获奖项
  
  -- ── 学术指标 ──
  research_fields TEXT[],          -- 研究领域
  h_index INTEGER,
  cited_by_count INTEGER,
  works_count INTEGER,
  orcid_id TEXT,                   -- ORCID ID
  
  -- ── 人才分类（对应 Excel 来源体系）──
  talent_source_category TEXT,     -- 人才来源分类
  talent_source_name TEXT,         -- 人才来源（具体奖项/称号）
  talent_source_year TEXT,         -- 年份
  age_tier TEXT,                   -- 年龄层次
  priority_field TEXT,             -- 优先领域名称
  
  -- ── 其他 ──
  homepage_url TEXT,               -- 人才主页链接
  bio_snippet TEXT,                -- 简介摘要
  other_info TEXT,                 -- 其他（AI 补充的信息）
  
  -- ── 字段溯源（核心！）──
  -- key = 字段名, value = 贡献该字段的信源列表
  -- 例如: {"h_index": ["google_scholar","orcid"], "current_employer": ["pingfang","orcid"]}
  field_provenance JSONB DEFAULT '{}',
  
  -- 时间
  parsed_at TIMESTAMPTZ DEFAULT now(),
  parsed_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

> [!NOTE]
> `field_provenance` 是字段级溯源的关键。查询示例：
> ```sql
> -- "李飞飞的 h_index 来自哪些信源？"
> SELECT field_provenance->'h_index' FROM talent_profiles WHERE talent_entry_id = 123;
> -- 返回: ["google_scholar", "orcid"]
> ```

---

### 4. `talent_source_data` — 信源原始数据

```sql
CREATE TABLE talent_source_data (
  id SERIAL PRIMARY KEY,
  talent_entry_id INTEGER REFERENCES talent_entries(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  raw_data JSONB NOT NULL,
  fields_contributed TEXT[] DEFAULT '{}',
  collected_at TIMESTAMPTZ DEFAULT now(),
  collected_by UUID REFERENCES profiles(id),
  tool_usage_log_id INTEGER,
  UNIQUE(talent_entry_id, source_key)
);
```

---

### 5. `search_logs` — 检索日志

```sql
CREATE TABLE search_logs (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  talent_entry_id INTEGER REFERENCES talent_entries(id),
  result_count INTEGER,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

### 6. `tool_usage_logs` — 工具使用完整记录

```sql
CREATE TABLE tool_usage_logs (
  id SERIAL PRIMARY KEY,
  tool_name TEXT NOT NULL,
  query TEXT,
  
  -- 完整执行记录（未来检索历史可视化用）
  stream_log JSONB,                -- 流式日志（每个阶段的中间输出）
  ai_rendered_result TEXT,         -- AI 最终渲染的完整报告
  raw_result JSONB,                -- 工具返回的原始数据
  
  -- 状态
  duration_ms INTEGER,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 数据流

```
用户搜索 "李飞飞"
  │
  ├─→ tool_usage_logs（存流式 log + AI 渲染结果）
  │
  ├─→ 各信源返回 raw data
  │     ├─ pingfang: {id, name_en, workplace_current, ...}
  │     ├─ scholar: {h_index, cited_by_count, ...}
  │     ├─ orcid: {employments, works, ...}
  │     └─ wikipedia: {biography, ...}
  │
  ├─→ talent_source_data（每个信源存一行，标记 fields_contributed）
  │
  ├─→ talent_entries（更新 search_count, data_sources）
  │
  ├─→ AI 转译 → talent_profiles（结构化字段 + field_provenance 溯源）
  │
  └─→ search_logs（记录这次检索）
```

## 改动范围

| 类型 | 说明 |
|------|------|
| 新增 | 6 张 Supabase 表 |
| 新增 | `src/lib/supabase/client.ts` |
| 新增 | `src/lib/supabase/talent-journal.ts`（替代 MCP 版） |
| 修改 | API 路由指向 Supabase |
| 不改 | 前端组件、检索工具逻辑 |
