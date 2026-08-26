/**
 * 人才分级参考库
 * 
 * 5 级人才池分类标准：
 * - 潜力人才：本硕博在读，无全职工作经验
 * - 青年人才：博士后/青年基金/青年奖项获得者
 * - 优秀人才：省部级奖项、海外高层次青年人才
 * - 杰出人才：国家级基金/奖项、顶级学会奖获得者
 * - 领军人才：两院院士、长江学者、国家顶级科技奖、学会会士、诺奖/图灵奖/IEEE/ACM Fellow 等顶层荣誉
 */

export type TalentPool = '潜力人才' | '青年人才' | '优秀人才' | '杰出人才' | '领军人才';

export interface TalentClassificationEntry {
  tier: TalentPool | string; // 可能多标签如 "杰出人才,青年人才"
  source: string;            // 奖项/称号/机构名称
  category: string;          // 来源分类
}

export const TALENT_CLASSIFICATION_DB: TalentClassificationEntry[] = [
  // ═══ 国内院士 ═══
  { tier: '领军人才', source: '中国科学院院士', category: '国内院士' },
  { tier: '领军人才', source: '中国工程院院士', category: '国内院士' },

  // ═══ 国家顶级奖项 ═══
  { tier: '杰出人才', source: '国家"万人计划"杰出人才', category: '国家顶级奖项' },
  { tier: '领军人才', source: '长江学者', category: '国家顶级奖项' },
  { tier: '领军人才', source: '国家"万人计划"科技创新领军人才', category: '国家顶级奖项' },
  { tier: '领军人才', source: '国家"万人计划"哲学社会科学领军人才', category: '国家顶级奖项' },
  { tier: '领军人才', source: '国家"万人计划"百千万工程领军人才', category: '国家顶级奖项' },
  { tier: '领军人才', source: '"新世纪百千万人才工程"国家级人选', category: '国家顶级奖项' },
  { tier: '杰出人才', source: '国务院特殊津贴获得者', category: '国家顶级奖项' },
  { tier: '杰出人才,青年人才', source: '国家杰出青年科学基金获得者', category: '国家顶级奖项' },
  { tier: '杰出人才,青年人才', source: '国家优秀青年科学基金获得者', category: '国家顶级奖项' },
  { tier: '优秀人才,青年人才', source: '海外高层次青年人才', category: '国家顶级奖项' },
  { tier: '优秀人才,青年人才', source: '国家"万人计划"青年拔尖人才', category: '国家顶级奖项' },
  { tier: '优秀人才,青年人才', source: '青年长江学者', category: '国家顶级奖项' },
  { tier: '领军人才', source: '国家最高科学技术奖', category: '国家顶级奖项' },
  { tier: '领军人才', source: '国家自然科学奖', category: '国家顶级奖项' },
  { tier: '领军人才', source: '国家技术发明奖', category: '国家顶级奖项' },
  { tier: '领军人才', source: '国家科学技术进步奖', category: '国家顶级奖项' },
  { tier: '杰出人才', source: '中国科学院杰出科技成就奖', category: '国家顶级奖项' },
  { tier: '杰出人才', source: '中国科学院国际科技合作奖', category: '国家顶级奖项' },
  { tier: '杰出人才', source: '中国科学院科技促进发展奖', category: '国家顶级奖项' },

  // ═══ 省部级奖项 ═══
  { tier: '青年人才', source: '博士后创新人才支持计划获得者', category: '省部级奖项' },
  { tier: '青年人才', source: '中国科协青年人才托举工程项目获得者', category: '省部级奖项' },
  { tier: '青年人才', source: '中国青年科技奖', category: '省部级奖项' },
  { tier: '杰出人才', source: '中国专利奖', category: '省部级奖项' },
  { tier: '杰出人才', source: '教育部高等学校科学研究优秀成果奖', category: '省部级奖项' },
  { tier: '杰出人才', source: '神农中华农业科技奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '北京市科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '上海市科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '广东省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '江苏省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '浙江省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '山东省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '湖北省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '四川省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '陕西省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '湖南省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '河南省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '福建省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '安徽省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '辽宁省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '吉林省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '黑龙江省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '河北省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '山西省科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才,优秀人才,青年人才', source: '江西省科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '广西壮族自治区科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '云南省科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '贵州省科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '甘肃省科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '青海省科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '宁夏回族自治区科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '新疆维吾尔自治区科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '内蒙古自治区科学技术奖', category: '省部级奖项' },
  { tier: '优秀人才,青年人才', source: '西藏自治区科学技术奖', category: '省部级奖项' },
  { tier: '杰出人才', source: '2025年首批地方科技专家库拟入库名单', category: '省部级奖项' },

  // ═══ 企业发起奖项 ═══
  { tier: '杰出人才', source: '科学探索奖', category: '企业发起奖项' },
  { tier: '杰出人才', source: '青山科技奖', category: '企业发起奖项' },

  // ═══ 学会奖项 ═══
  { tier: '优秀人才,青年人才', source: '中国青年科技创新奖', category: '学会奖项' },
  { tier: '优秀人才,青年人才', source: '中国科协求是杰出青年奖', category: '学会奖项' },
  { tier: '优秀人才,青年人才', source: '中国青年女科学家奖', category: '学会奖项' },
  { tier: '杰出人才', source: '陈嘉庚科学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '陈嘉庚青年科学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '孙冶方经济科学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '何梁何利基金科学与技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国数学会华罗庚数学奖、陈省身奖、钟家庆奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国物理学会胡刚复、饶毓泰、叶企孙、吴有训、王淦昌物理奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国化学会青年化学奖、生命化学奖等', category: '学会奖项' },
  { tier: '杰出人才', source: '中国天文学会张钰哲奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国地质学会李四光地质科学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国气象学会涂长望气象科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国生态学会马世骏生态学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国海洋学会曾呈奎海洋科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国地理学会中国地理科学成就奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国细胞生物学学会杰出成就奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国遗传学会谈家桢遗传学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国植物学会吴征镒植物学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国生物物理学会贝时璋奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国环境科学学会环境保护科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国地震学会李善邦地震科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国矿物岩石地球化学学会侯德封奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国力学学会钱学森力学奖、周培源力学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国光学学会王大珩光学奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国声学学会马大猷声学奖、魏荣爵奖', category: '学会奖项' },
  { tier: '杰出人才', source: '钱三强科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国空间科学学会科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国计算机学会CCF最高科学技术奖、王选奖等', category: '学会奖项' },
  { tier: '杰出人才', source: '中国电子学会电子信息科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国机械工程学会科技成就奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国土木工程学会詹天佑奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国航空学会冯如航空科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国造船工程学会船舶设计大师奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国通信学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国建筑学会梁思成建筑奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国水利学会大禹水利科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国公路学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国铁道学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国仪器仪表学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国纺织工程学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国石油学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国金属学会冶金科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国化工学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国环境科学学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国电机工程学会电力科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国自动化学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国材料研究学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国可再生能源学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '吴文俊人工智能科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国农学会青年科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国林学会梁希林业科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国水产学会范蠡科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国农业工程学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国农业机械学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中华医学科技奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国药学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '黄家驷生物医学工程奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国免疫学会学术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国营养学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国康复医学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '世界杰出华人医师霍英东奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国预防医学会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国医药教育协会科学技术奖', category: '学会奖项' },
  { tier: '杰出人才', source: '中国医院协会医院科技创新奖', category: '学会奖项' },
  { tier: '杰出人才', source: '全国杰出青年法学家', category: '学会奖项' },
  { tier: '杰出人才', source: '王选新闻科学技术奖', category: '学会奖项' },

  // ═══ 国内会士 ═══
  { tier: '领军人才', source: '中国工业与应用数学学会会士', category: '国内会士' },
  { tier: '领军人才', source: '中国化学会会士（CCS Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国力学学会会士', category: '国内会士' },
  { tier: '领军人才', source: '中国气象学会会士（CMS Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国地理学会会士（GSC Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国光学学会会士（COS Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国声学学会会士（CAS Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国计算机学会会士（CCF Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国电子学会会士（CIE Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国机械工程学会会士（CMES Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国水利学会会士（CHES Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国环境科学学会会士（CSES Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国自动化学会会士（CAA Fellow）', category: '国内会士' },
  { tier: '领军人才', source: '中国人工智能学会会士（CAAI Fellow）', category: '国内会士' },

  // ═══ 其他 ═══
  { tier: '优秀人才', source: '北京学者', category: '其他（如本领域内顶尖实验室/研究所等）' },
];
