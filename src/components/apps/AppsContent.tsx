'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import React from 'react';
import { Modal, Input, message, Spin, Empty } from 'antd';
import Image from 'next/image';
import { RocketOutlined } from '@ant-design/icons';
import { useIsMobile } from '@/hooks/useIsMobile';

// ----- Types -----

interface BannerItem {
  name: string;
  description: string;
  'image_id.download_url': string;
  jump_type: string;
  mini_app_id?: string;
  mini_app_path?: string;
  'mini_app_qrcode_id.download_url'?: string;
  toast?: string;
  flora_external_id?: string;
  'service_id.flora_external_id'?: string;
  'service_id.amount'?: string;
  'service_id.points'?: string;
  'service_id.slug'?: string;
  'service_id.unit'?: string;
  'service_id.payment_method'?: string;
  'service_id.type'?: string;
  sort: number;
  url?: string;
  id?: number;
}

interface JumpParams {
  toast?: string;
  mini_app_id?: string;
  mini_app_path?: string;
  mini_app_qrcode?: string;
  amount?: string;
  points?: string;
  title?: string;
  service_type?: string;
  slug?: string;
  jump_type?: string;
  flora_external_id?: string;
  unit?: string;
  payment_method?: string;
  banner_flora_external_id?: string;
  url?: string;
  service_id?: string;
}

interface AppCenterAppRaw {
  name: string;
  description: string;
  'category_id.name': string;
  'category_id.description': string;
  'category_id.sort': number;
  'image_id.download_url': string;
  jump_type: string;
  mini_app_id?: string;
  mini_app_path?: string;
  'mini_app_qrcode_id.download_url'?: string;
  toast?: string;
  flora_external_id?: string;
  'service_id.flora_external_id'?: string;
  'service_id.amount'?: string;
  'service_id.points'?: string;
  'service_id.slug'?: string;
  'service_id.unit'?: string;
  'service_id.payment_method'?: string;
  'service_id.type'?: string;
  sort: number;
  url?: string;
  id?: number;
}

interface AppServiceId {
  id?: string;
  amount?: string;
  points?: string;
  slug?: string;
  unit?: string;
  payment_method?: string;
  type?: string;
}

interface AppJump {
  jump_type?: string;
  toast?: string;
  mini_app_id?: string;
  mini_app_path?: string;
  mini_app_qrcode?: string;
  flora_external_id?: string;
}

interface AppItem {
  title: string;
  subTitle: string;
  icon: string;
  sort: number;
  jump: AppJump;
  service_id: AppServiceId;
}

interface CategoryGroup {
  title: string;
  subTitle: string;
  sort: number;
  appList: AppItem[];
}

interface ServiceInfoResult {
  available_times?: number;
  end_time?: string;
}

// ----- Helpers -----

function normalizeUrl(url?: string): string {
  if (!url) return '/assets/default-ai-robot.png';
  if (url.startsWith('http')) return url;
  return url;
}

function cleanExternalUrl(url?: string): string {
  if (!url) return '';
  return url.trim().replace(/^`|`$/g, '');
}

// ----- Ceping helpers -----

const cepingKindByType: Record<string, string> = {
  shijian_ceping: 'time_management',
  holland: 'holland_career_interest',
  mbti: 'mbti_personality',
  xuexi_yali_ceping: 'study_pressure',
  qingxu_ceping: 'emotional_intelligence',
  zizhu_xuexi_ceping: 'active_learning',
  chuangxin_suzhi_ceping: 'creativity',
  xuanke_ceping: 'course_planning',
  gaokao_zhuanye_ceping: 'fos',
  '高考职业测评': 'career_gaokao',
  career_orientation: 'career_orientation',
  professional_inclination: 'professional_inclination',
};

function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
}

function isWechatMiniProgram(): boolean {
  if (typeof window === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

function getCepingLink(kind: string, id: string | number): string {
  // 这个地方使用 NEXT_PUBLIC_ZHIJI_HOST 而不是 window.location.origin
  const baseUrl = process.env.NEXT_PUBLIC_ZHIJI_HOST;
  switch (kind) {
    case 'fos':
      return `${baseUrl}/data_aggregation/ceping/gk_speciality_ss?id=${id}&source=ss`;
    case 'career_gaokao':
      return `${baseUrl}/data_aggregation/ceping/gk_career_ss?id=${id}&source=ss`;
    case 'course_planning':
      return `${baseUrl}/data_aggregation/ceping/xkgh-ceping?id=${id}&source=ss`;
    case 'career_orientation':
      return `${baseUrl}/data_aggregation/ceping/career_ceping?id=${id}&source=ss`;
    case 'professional_inclination':
      return `${baseUrl}/data_aggregation/ceping/professional-trend?id=${id}&source=ss`;
    case 'holland_career_interest':
      return `${baseUrl}/data_aggregation/ceping/holland-career-interest?id=${id}&source=ss`;
    case 'mbti_personality':
      return `${baseUrl}/data_aggregation/ceping/mbti-personality?id=${id}&source=ss`;
    default:
      return '';
  }
}

// ----- Apps Banner Carousel（与首页 BannerCarousel 同款）-----

function AppBannerCarousel({ banners, onBannerClick }: {
  banners: BannerItem[];
  onClick?: never;
  onBannerClick: (b: BannerItem) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [mobile, setMobile] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (banners.length <= 1) return;
    timerRef.current = setInterval(() => setIdx(i => (i + 1) % banners.length), 4000);
  }, [banners.length]);

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [startTimer]);

  if (!banners.length) return null;

  const goTo = (next: number) => {
    setIdx((next + banners.length) % banners.length);
    startTimer();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 45) return;
    goTo(delta < 0 ? idx + 1 : idx - 1);
  };

  const cur = banners[idx];
  const imgUrl = normalizeUrl(cur['image_id.download_url']);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: mobile ? 14 : 20,
        overflow: 'hidden',
        marginBottom: mobile ? 20 : 40,
        boxShadow: '0 8px 32px rgba(96,85,245,0.20)',
        cursor: 'pointer',
        height: mobile ? 160 : 280,
      }}
      onClick={() => onBannerClick(cur)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <img key={idx} src={imgUrl} alt={cur.name}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          animation: 'appBannerFadeIn 0.35s ease' }} />
      {/* 圆点指示器 */}
      {banners.length > 1 && (
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 5, alignItems: 'center' }}>
          {banners.map((_, i) => (
            <div key={i} onClick={e => { e.stopPropagation(); goTo(i); }}
              style={{ width: i===idx ? 18 : 6, height: 6, borderRadius: 3,
                background: i===idx ? '#fff' : 'rgba(255,255,255,0.5)', transition: 'all 0.3s', cursor: 'pointer' }} />
          ))}
        </div>
      )}
      <style>{`@keyframes appBannerFadeIn { from { opacity: 0.4; } to { opacity: 1; } }`}</style>
    </div>
  );
}

// ----- Component -----

export const AppsContent = () => {
  const isMobile = useIsMobile();
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [appCenterList, setAppCenterList] = useState<CategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Preview / QR
  const [previewImage, setPreviewImage] = useState<string | undefined>();

  // Payment modals
  const [showPayModal, setShowPayModal] = useState(false);
  const [showCheckPayModal, setShowCheckPayModal] = useState(false);
  const [showInvitation, setShowInvitation] = useState(false);
  const [currentService, setCurrentService] = useState<{
    amount?: string;
    points?: string;
    slug?: string;
    originalParams: JumpParams;
  } | null>(null);
  const [codeValue, setCodeValue] = useState('');

  // ----- Data Fetching -----

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [bRes, aRes] = await Promise.all([
          fetch(`/api/app-center/banners?platform=${isMobile ? 'h5' : 'web'}`).then(r => r.json()),
          fetch('/api/app-center/apps').then(r => r.json()),
        ]);

        setBanners(Array.isArray(bRes) ? bRes : []);

        if (Array.isArray(aRes)) {
          const grouped: CategoryGroup[] = [];
          const catMap = new Map<string, CategoryGroup>();

          aRes.forEach((item: AppCenterAppRaw) => {
            const catName = item['category_id.name'] || '其他';
            let cat = catMap.get(catName);
            if (!cat) {
              cat = {
                title: catName,
                subTitle: item['category_id.description'] || '',
                sort: Number(item['category_id.sort']) || 99,
                appList: [],
              };
              catMap.set(catName, cat);
              grouped.push(cat);
            }
            cat.appList.push({
              title: item.name || '',
              subTitle: item.description || '',
              icon: normalizeUrl(item['image_id.download_url']),
              sort: Number(item.sort) || 0,
              jump: {
                jump_type: item.jump_type,
                toast: item.toast,
                mini_app_id: item.mini_app_id,
                mini_app_path: item.mini_app_path,
                mini_app_qrcode: normalizeUrl(item['mini_app_qrcode_id.download_url']),
                flora_external_id: item.flora_external_id,
              },
              service_id: {
                id: item['service_id.flora_external_id'],
                amount: item['service_id.amount'],
                points: item['service_id.points'],
                slug: item['service_id.slug'],
                unit: item['service_id.unit'],
                payment_method: item['service_id.payment_method'],
                type: item['service_id.type'],
              },
            });
          });

          grouped.sort((a, b) => a.sort - b.sort);
          grouped.forEach(cat => cat.appList.sort((a, b) => a.sort - b.sort));
          setAppCenterList(grouped);
        }
      } catch (err) {
        console.error('加载应用中心数据失败:', err);
        message.error('加载数据失败');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // ----- Permission Check -----

  const checkPermission = useCallback(async (service_id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/app-center/service-info?service_id=${service_id}`);
      const data = await res.json();
      console.log('检查权限:', service_id, data);
      
      if (data?.status === 200 || data?.result) {
        const result: ServiceInfoResult = data.result || data;
        const now = Date.now();
        console.log('当前时间:', now);
        console.log('服务结束时间:', result.end_time);
        console.log('可用次数:', result.available_times);
        
        if (
          (result.available_times && result.available_times > 0) ||
          (result.end_time && new Date(result.end_time).getTime() > now)
        ) {
          return true;
        }
      }
    } catch (e) {
      console.error('权限检查失败:', e);
    }
    return false;
  }, []);

  // ----- Ceping Logic -----

  const createCepingAndOpen = useCallback(async (kind: string) => {
    try {
      const res = await fetch('/api/app-center/ceping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json();

      if (data.status === 'error' || data.error) {
        message.error(data.error || '启动测评失败');
        return;
      }

      const cepingId = data.ceping_id;
      if (!cepingId) {
        message.error('创建测评失败');
        return;
      }

      const link = getCepingLink(kind, cepingId);
      if (link) {
        window.open(link, '_blank');
      } else {
        message.info('测评已创建，请稍后查看');
      }
    } catch (e) {
      console.error('createCepingAndOpen failed:', e);
      message.error('启动测评失败');
    }
  }, []);

  // ----- Jump Logic -----

  const jump = useCallback(
    async (params: JumpParams, skipCheck = false) => {
      console.log(params);
      
      const service_id = params.service_id;

      if (service_id && !skipCheck) {
        const hasRight = await checkPermission(service_id);
        if (!hasRight) {
          if (params.payment_method === 'free') {
            // free service, proceed
          } else {
            setCurrentService({
              amount: params.amount,
              points: params.points,
              slug: params.slug,
              originalParams: params,
            });
            setShowPayModal(true);
            return;
          }
        }
      }

      const finalCepingKind = params.service_type ? cepingKindByType[params.service_type] : undefined;
      const preferLegacyCepingJump = isMobile || isWechatMiniProgram();
      if (finalCepingKind && !preferLegacyCepingJump) {
        await createCepingAndOpen(finalCepingKind);
        return;
      }
      if (finalCepingKind && preferLegacyCepingJump && !params.jump_type) {
        await createCepingAndOpen(finalCepingKind);
        return;
      }

      if (params.jump_type === 'toast') {
        message.info(params.toast);
        return;
      }

      if (params.jump_type === 'mini_app') {
        if (params.mini_app_qrcode) {
          setPreviewImage(params.mini_app_qrcode);
          return;
        }
        message.info('扫码使用小程序');
        return;
      }

      if (params.jump_type === 'url' && params.flora_external_id) {
        try {
          const res = await fetch(`/api/app-center/apps?flora_external_id=${params.flora_external_id}`);
          const data = await res.json();
          if (data?.after_jump_url) {
            window.open(data.after_jump_url, '_blank');
            return;
          }
        } catch (e) {
          console.error('获取跳转URL失败:', e);
        }
      }

      if (params.url) {
        const cleanedUrl = cleanExternalUrl(params.url);
        window.open(cleanedUrl, '_blank');
        return;
      }

      if (params.toast) {
        message.info(params.toast);
        return;
      }

      message.warning('该功能正在开发中，敬请期待！');
    },
    [checkPermission, createCepingAndOpen]
  );

  // ----- Banner Jump -----

  const handleBannerClick = useCallback(
    (banner: BannerItem) => {
      jump({
        toast: banner.toast,
        banner_flora_external_id: banner.flora_external_id,
        mini_app_id: banner.mini_app_id,
        mini_app_path: banner.mini_app_path,
        mini_app_qrcode: banner['mini_app_qrcode_id.download_url']
          ? normalizeUrl(banner['mini_app_qrcode_id.download_url']!)
          : undefined,
        jump_type: banner.jump_type,
        amount: banner['service_id.amount'],
        points: banner['service_id.points'],
        slug: banner['service_id.slug'],
        unit: banner['service_id.unit'],
        payment_method: banner['service_id.payment_method'],
        title: banner.name,
        service_type: banner['service_id.type'],
        flora_external_id: banner.flora_external_id,
        url: banner.url,
        service_id: banner['service_id.flora_external_id'],
      });
    },
    [jump]
  );

  // ----- Invite Code -----

  const handleInviteCode = async () => {
    if (!codeValue.trim()) {
      message.warning('请输入邀请码');
      return;
    }
    try {
      const res = await fetch('/api/app-center/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeValue }),
      });
      const data = await res.json();
      if (data.status === 'error') {
        message.info('激活码无效');
        return;
      }
      const currentService_id = currentService?.originalParams?.service_id;
      if (currentService_id) {
        const hasRight = await checkPermission(currentService_id);
        if (hasRight) {
          message.success('恭喜解锁功能！', 3);
          setShowInvitation(false);
          setShowPayModal(false);
        } else {
          message.info('此激活码无法解锁当前功能', 3);
        }
      }
    } catch {
      message.error('激活失败');
    }
  };

  // ----- Payment Confirm -----

  const handlePayConfirm = async () => {
    if (currentService?.originalParams?.service_id) {
      const hasRight = await checkPermission(currentService.originalParams.service_id);
      if (hasRight) {
        setShowCheckPayModal(false);
        jump(currentService.originalParams, true);
        return;
      }
    }
    message.error('系统检测到您暂未支付');
  };

  // ----- Render -----

  const PRIMARY = '#6055f5';

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: '#f8f9fc' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 48px' }}>

        {/* ── Banner ── */}
        {banners.length > 0 && !loading && (
          <div style={{ padding: '0 0' }}>
            <AppBannerCarousel banners={banners} onBannerClick={handleBannerClick} />
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 320 }}>
            <Spin size="large" />
          </div>
        ) : (
          <>
            {/* ── Category Sections ── */}
            {appCenterList.length > 0 ? (
              appCenterList.map((cat, ci) => (
                <div key={ci} style={{ padding: '28px 32px 0' }}>
                  {/* Section header */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#14151f' }}>{cat.title}</span>
                    {cat.subTitle && (
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>{cat.subTitle}</span>
                    )}
                  </div>

                  {/* 横向滚动区域 (App Store 风格一行3列) */}
                  <div style={{
                    display: 'flex',
                    overflowX: 'auto',
                    gap: 16,
                    paddingBottom: 12,
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                  }} className="hide-scrollbar">
                    {Array.from({ length: Math.ceil(cat.appList.length / 3) }, (_, i) => cat.appList.slice(i * 3, i * 3 + 3)).map((group, gi) => (
                      <div key={gi} style={{ display: 'flex', flexDirection: 'column', width: isMobile ? '88vw' : 380, flexShrink: 0 }}>
                        {group.map((app, ai) => (
                          <AppStoreCard
                            key={ai}
                            app={app}
                            primary={PRIMARY}
                            isLast={ai === group.length - 1}
                            onClick={() => jump({
                              toast: app.jump.toast,
                              mini_app_id: app.jump.mini_app_id,
                              mini_app_path: app.jump.mini_app_path,
                              mini_app_qrcode: app.jump.mini_app_qrcode,
                              amount: app.service_id.amount,
                              points: app.service_id.points,
                              title: app.title,
                              service_type: app.service_id.type,
                              slug: app.service_id.slug,
                              jump_type: app.jump.jump_type,
                              flora_external_id: app.jump.flora_external_id,
                              unit: app.service_id.unit,
                              payment_method: app.service_id.payment_method,
                              service_id: app.service_id.id,
                            })}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '32px 32px 0' }}>
                <Empty description="暂无应用信息" style={{ padding: '60px 0' }} />
              </div>
            )}
          </>
        )}

        {/* ===== Modals ===== */}

        {/* QR Code Preview */}
        <Modal title="" open={!!previewImage} onCancel={() => setPreviewImage(undefined)} footer={null} width={300} centered>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {previewImage && (
              <Image src={previewImage} alt="QR Code" width={230} height={230} style={{ objectFit: 'contain' }} />
            )}
            <div style={{ fontSize: 18, marginTop: 20, color: 'rgba(0,0,0,0.65)' }}>打开微信扫一扫</div>
          </div>
        </Modal>

        {/* Payment Modal */}
        <Modal title="" open={showPayModal} onCancel={() => setShowPayModal(false)} footer={null} width={360} centered closable={false} styles={{ body: { padding: 0 } }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', borderRadius: 16, padding: '32px 24px', background: '#fff' }}>
            <div onClick={() => setShowPayModal(false)} style={{ position: 'absolute', top: 16, right: 16, cursor: 'pointer', color: '#999', fontSize: 20, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: '#333', marginBottom: 32, marginTop: 10 }}>请开通权益后使用</div>
            <div
              onClick={async () => {
                if (currentService?.originalParams?.service_id) {
                  showAnnualCard(currentService.originalParams.service_id);
                  setShowPayModal(false);
                  setShowCheckPayModal(true);
                } else { message.error('未找到对应权益'); }
              }}
              style={{ width: '100%', maxWidth: 320, height: 44, background: 'linear-gradient(90deg,#FF7A45,#FF5242)', borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer', marginBottom: 16, boxShadow: '0 4px 10px rgba(255,82,66,0.2)' }}
            >
              {currentService?.originalParams?.unit
                ? `开通权益 ¥${currentService?.amount || '0'}/${currentService?.originalParams?.unit === 'character' ? '字符' : '千字符'}`
                : `开通权益 ¥${currentService?.amount || '0'} 购买 / ${currentService?.points || '0'} 积分兑换`}
            </div>
            <div onClick={() => setShowInvitation(true)} style={{ fontSize: 13, color: '#999', cursor: 'pointer' }}>邀请码解锁</div>
          </div>
        </Modal>

        {/* Payment Confirmation Modal */}
        <Modal mask={{ closable: false }} open={showCheckPayModal} closable={false} cancelText="未支付" okText="已支付" onOk={handlePayConfirm} onCancel={() => setShowCheckPayModal(false)} centered>
          <div style={{ textAlign: 'center', padding: '12px 0' }}>是否已完成支付</div>
        </Modal>

        {/* Invite Code Modal */}
        <Modal open={showInvitation} footer={null} onCancel={() => setShowInvitation(false)} closable={false} centered width={360}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ textAlign: 'right', cursor: 'pointer', marginBottom: 16 }} onClick={() => setShowInvitation(false)}>
              <span style={{ fontSize: 20, color: '#999' }}>×</span>
            </div>
            <div style={{ background: 'linear-gradient(135deg,#667eea,#764ba2)', borderRadius: 12, padding: '32px 24px', marginBottom: 24 }}>
              <div style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>邀请码解锁</div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>输入邀请码即可解锁当前功能</div>
            </div>
            <Input placeholder="请输入邀请码" value={codeValue} onChange={e => setCodeValue(e.target.value)} style={{ borderRadius: 8, height: 40, marginBottom: 16 }} onPressEnter={handleInviteCode} />
            <button onClick={handleInviteCode} style={{ width: '100%', height: 40, borderRadius: 8, background: 'linear-gradient(90deg,#667eea,#764ba2)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer' }}>
              立即解锁
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
};

// ── App Card 子组件 (App Store style) ──
function AppStoreCard({ app, primary, onClick, isLast }: { app: AppItem; primary: string; onClick: () => void; isLast?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        background: hovered ? 'rgba(0,0,0,0.02)' : 'transparent',
        borderRadius: 12,
        transition: 'background 0.2s',
      }}
    >
      <div style={{ padding: '8px 12px 8px 0' }}>
         <div style={{ width: 64, height: 64, borderRadius: 16, background: '#f3f4f6', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
           {app.icon ? (
             <img src={app.icon} alt={app.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
           ) : (
             <RocketOutlined style={{ fontSize: 24, color: primary }} />
           )}
         </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', borderBottom: isLast ? 'none' : '1px solid rgba(0,0,0,0.06)', padding: '16px 16px 16px 0' }}>
         <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <div style={{ fontSize: 16, color: '#1a1a2e', fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.title}</div>
            <div style={{ fontSize: 13, color: '#8e8e93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.subTitle || '暂无详细介绍'}</div>
         </div>
         <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button style={{ background: '#f3f4f6', color: primary, fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 16, padding: '5px 22px', cursor: 'pointer' }}>
               获取
            </button>
            <div style={{ fontSize: 9, color: '#8e8e93', marginTop: 4, transform: 'scale(0.9)' }}>应用详情</div>
         </div>
      </div>
    </div>
  );
}

export function showAnnualCard(service_id: string) {
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
  const proxyWin = isWeChat ? null : window.open('about:blank', '_blank');

  fetch('/api/auth/login-token-v2')
    .then(r => r.json())
    .then(data => {
      if (!data.ok) {
        if (proxyWin) proxyWin.close();
        if (data.isLocal) { alert('本地账号无法跳转'); return; }
        alert('获取跳转token失败: ' + (data.error || '未知错误'));
        return;
      }
      const { account, tempToken } = data;
      const host = process.env.NEXT_PUBLIC_ZHIJI_HOST;
      const targetUrl = host + '/annual_card?account=' + encodeURIComponent(account) + '&token=' + encodeURIComponent(tempToken) + '&service_id=' + service_id + '&kind=application';
      if (isWeChat) {
        location.href = targetUrl;
      } else if (proxyWin) {
        proxyWin.location.href = targetUrl;
      } else {
        window.open(targetUrl, '_blank');
      }
    })
    .catch(err => {
      if (proxyWin) proxyWin.close();
      alert('跳转失败: ' + err.message);
    });
}