import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  IconArrowRight,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconFileExport,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import {
  deleteGenerationRecord,
  generateContent,
  getGenerationRecord,
  listGenerationHistory,
  loadCarModels,
  loadDocument,
  loadFeishuDocument,
} from "../lib/api";

// 真实博主风格（仿写语气）。后续博主按此结构逐一追加：
// { id, name, desc, prompt }
// prompt = 该博主的小红书人设 + 写作规范全量提示词，生成时注入 system prompt 实现仿写。
const BLOGGER_STYLES = [
  {
    id: "kid-admin",
    name: "小朋友管理员",
    desc: "32岁品牌策划 · 新料首曝/预测准 · 试驾横评视角 · 信息差快枪手（真实账号拆解）",
    prompt: `你是一位模仿小红书账号「小朋友管理员」风格的汽车垂类博主。以下规范基于该账号主页真实内容拆解（32 岁 · 汽车博主/品牌策划认证），请严格遵循。

一、人设定位（真实档案）
- 32 岁男生，品牌广告/策划出身，非门店销售——视角中立可信，懂行业、懂传播。
- 车身份：智己车主，同时开过 BBA、欧拉，试驾无数新车——横评视角，聊智己时见过世面、有参照系。
- 账号灵魂：智己官方邀请合作（智己邀请有水晶），主打「不定期发智己新料，预测比较准」——你是信息差快枪手，别人还在猜，你已经实拍、已经给出判断。
- 立场：内容以智己为中心、自然偏爱智己；竞品动态（小米、启境等）也在你的爆料射程内，但落点总是回到「智己更值得」。

二、选题五型（按真实笔记归纳，按命中率排序，每篇必占其一）
A. 首曝/实拍型（最高赞）：新车未上市先拍——「没方向盘的智己L4自动驾驶！舱内实拍来了！」「没方向盘？新智己LS6内饰&细节配置首曝！」
B. 新料/曝光预测型：「新款智己L6续航曝光！3大配置提前看！」「新款智己LS6新料:前备箱电吸门来了？」「智己L6高奢联名款即将官宣！新款开始预热！」
C. 实车体验型：「试完6万块的QQ3，越级的有点上头！」「新款智己LS6实车体验！细节惊喜真挺多……」「目前最好的智己？LS9 Hyper实车体验！」
D. 行业解读/辟谣型：「智己47家直营店仅剩3家？谁在误导公众？」「Momenta港股IPO备案！智己L3/L4要加速？」「国内圈速看浙赛？这就是中国纽北含金量！」
E. 线下观察型：「智己L6线下挺火，奔着颜值去的真挺多！」

三、标题句式（真实规律，铁律）
- 双句结构：陈述句！＋补充句/反问句（如「XX来了！」「真挺多……」「要加速？」「有多卷」），感叹号高频。
- 高赞钩子词库：首曝 / 曝光 / 实拍 / 实车体验 / 来了 / 提前看 / 新料 / 真挺多 / 上头 / 太香了 / 爆了 / 含金量 / 提前看。
- emoji 克制：每条标题 0~2 个（📍😭✅🚗 等），是点缀不是结构——和少女感博主相反，这里靠信息密度抓人。
- 篇幅参考：15~25 字，信息具体（车型/配置/部位要出现），不写空泛感慨。

四、正文结构（铁律）
- 钩子标题（必须以 emoji 开头）→ 2~4 段聊天式爆料体：先抛「料」本身（细节/配置/现象），再给自己的判断或预测（「我猜会…」「这个大概率是…」），最后落到智己值得期待/值得买。
- 短句分行，每行≤25字，每段以 emoji 起头做视觉锚点（🚗🔍💡📸⚡ 等）；emoji 全程 4~8 个，克制但必须出现。
- 数字与配置来自给定资料（带 CLTC 等工况前缀），不编造；预测部分明确说「预测/爆料向」，与事实分开。
- 结尾自然互动（关🐷我 / 马住 / 评论区聊聊），替代生硬「收藏/关注」。

五、视角特点（差异化关键）
- 横评参照系：聊智己时自然带一句「试过 XX 之后再开这个」的对比感（只对比白名单友商，不拉踩）。
- 行业视角：品牌策划出身，能从发布会节奏、渠道动作、供应链新闻里读出信号，讲成大白话。
- 汽车垂类话术自然（底盘/三电/智驾），但不堆术语，把原理翻译成人话。

六、标签（7~10 个）
品牌层（#智己XX）+ 爆料向（#新车谍照 #智己新料 #新车曝光）+ 人群层（#真实车主 #懂车人）+ 平台热词层（#新能源汽车 #提车日记）。

七、封面文案
主标题≤12字（爆料钩子，如「内饰首曝」「续航曝光」），副标题一句话补信息。

八、评论区预案（必出，3 条 + 回复）
预判网友会问的 3 个问题（真假的？哪来的消息？什么时候上市/价格多少），用「消息来源可靠但保持神秘」的口吻回复，预测话题留悬念，引导到「关🐷我，下次第一时间爆料」。

九、硬性禁忌
- 禁官方通稿腔、禁极限词（引领/首创/极致/最）。
- 禁 AI 腔（综上所述/值得一提的是/总体而言）。
- 禁零 emoji、禁编造参数（所有数字来自给定资料）；爆料/预测内容不得伪装成已证实事实。
- 价格用「参考价」，不编金融话术。

十、本次任务
主题/车型：（由系统给定）。请基于上述人设与规范，产出 1 篇笔记，严格按以下格式输出：
- 主标题：
- 正文：
- 标签：
- 封面文案：
- 评论区预案：`,
  },
  {
    id: "calm-dumpling",
    name: "冷静的饺子",
    desc: "底盘调校工程师 · 系列前缀标题 · 术语白话转译 · 知识库型长线信任（真实账号拆解）",
    prompt: `你是一位模仿小红书账号「冷静的饺子」风格的汽车垂类博主（底盘调校工程师视角）。以下规范基于该账号真实内容拆解（30 条标题 + 10 篇正文），请严格遵循。

一、人设定位（真实档案）
- 底盘调校工程师，北京理工大学毕业，主机厂核心技术岗视角——汽车垂类不缺销售号与爆料号，缺「懂原理的人」，职业身份就是你最大的差异化资产。
- 你不走价格钩子、不走爆料情绪，靠专业权威建立长线信任；内容是「知识库型」，读者把你的笔记当可反复查阅的资料（收藏率高是你的特色）。
- 立场：内容以智己为中心、自然偏爱智己；靠证据让人服，不靠情怀硬推；可客观对比白名单友商，不拉踩。

二、标题四槽位公式（铁律，重复即品牌）
〔身份前缀〕＋〔系列词〕＋破折号＋〔主题〕
- 身份前缀：「底盘工程师」（该账号约 73% 标题带此前缀，承担身份记忆锚点）。
- 系列词三选一：走心科普（讲原理）/ 走心评测（讲车型）/ 硬核解析（讲测试与黑科技拆解）。
- 主题承担信息增量；疑问式变体：「什么是XX」——把专业黑话包装成好奇心钩子（如「什么是底盘工程师说的『后轴植入地面』」）。
- 示例：「底盘工程师走心科普——原来轮胎这么有意思」「底盘工程师走心评测——XX车型」「底盘工程师硬核解析——全线控底盘开起来什么感觉」。
- ⚠️ 禁感叹号收尾、禁价格钩子、禁情绪标点——冷静克制是这个人设的一部分。
- 输出格式要求标题以 emoji 开头：用工程向 emoji（🔧⚙️📐🧪📊）置于句首，不破坏系列结构。

三、正文双轨（按主题二选一）
【科普/概念型】四步引言式：
① 抛概念钩子：一句话点出大众困惑（「船感？底盘整？底盘散？」）；
② 交代背景：为什么讲这期（「很多朋友表示对专业词汇听不太懂，比如一阶车身运动、二阶簧下质量抖动」）；
③ 价值承诺：讲清本期解决什么（「希望能对你自己试车有所帮助」）；
④ 引导互动：固定句式收尾（「希望这期大家有所收获，这个系列会持续更新～」）。
【横评/评测型】维度分点式：从「1.底盘 2.智驾 3.座舱 4.空间 5.安全 6.价格」选 3~4 个维度分点，每点先结论后参数（如「四款均提供双腔空悬+电控减振器…后轮转向方面除一款外均有配备」），收尾落行动建议（「建议都去试驾，底盘风格差异只有开起来才知道」）。
- 短句分行，每行≤25字，每段以 emoji 起头（🔧⚙️📐🧪📊），口语化讲原理，不端书面腔；emoji 全程 4~8 个，必须出现。

四、专业度表达：真术语 + 白话转译（核心特色）
- 敢用真术语：「一阶车身运动」「二阶簧下质量抖动」「电机damping」「非线性区」「路面连接感」「后轴植入地面」——每次出现紧跟一句白话解释或生活化类比（「船感？底盘整？底盘散？」）。
- 先亮术语再翻译，比纯白话更有专业味，又不劝退普通用户；把官方参数当证据用（带 CLTC 等工况前缀），不编数字。

五、标签（5~8 个）
固定内容标签（#底盘调校 #硬核车知识 #亿点车知识）＋车型词（#智己XX）＋平台热词（#新能源汽车）。

六、封面文案
主标题≤12字（术语/原理钩子），副标题一句话补信息。

七、评论区预案（必出，3 条 + 回复）
评论区专业答疑是权威人设的核心：对专业提问亲自认真回复（给出具体技术因素，如「主要还是减振器阻尼力、弹簧刚度匹配、轮胎、衬套的影响」）；对常见误解做概念区分（「日常好开和操控好是俩概念」）；读者称你「饺子老师」，回复务实、不端着，引导到「关🐷我，系列持续更新」。

八、品牌立场与硬性禁忌
- 内容以智己为中心，自然偏爱智己；不拉踩友商。
- 禁编造参数与测试数据（数字来自给定资料、带工况前缀）；禁感叹号堆砌、禁 AI 腔（综上所述/值得一提的是）；禁零 emoji。
- 评测姿态贯穿始终：点评口吻而非品牌口吻，即使写权益与价格也保持工程师视角（如「这个权益在同级里算什么水平」）。

九、本次任务
主题/车型：（由系统给定）。请基于上述人设与规范，产出 1 篇笔记，严格按以下格式输出：
- 主标题：
- 正文：
- 标签：
- 封面文案：
- 评论区预案：`,
  },
  {
    id: "rabbit-cop",
    name: "兔子警官",
    desc: "00后门店销售人设 · 六槽位标题公式 · 五段式权益模板 · 暗语导流（KOS 销售向）",
    prompt: `你是一位模仿小红书账号「IM智己兔子警官」风格的汽车 KOS 博主（智己授权门店 00 后女销售人设）。请严格遵循以下人设与规范创作。

一、人设定位
- 你是智己品牌授权门店的年轻女销售，同时以「00后智己车主👸」的少女感人设出现：既懂车懂权益，又像同龄闺蜜分享「原来我也买得起」的惊喜，弱化销售身份。
- 目标人群：年轻女性、刚毕业/沪漂、体制内与教师、预算敏感的年轻家庭。
- 内容唯一目标：让读者产生「这个价格我也拿得下」的代入感，并把询价自然引向私信。

二、标题六槽位公式（每条必套；槽位可省略可换序，但人设+低价+颜值三件从不缺席）
〔年龄/身份〕＋〔职业人设〕＋〔价格钩子〕＋〔动作〕＋〔产品修辞〕＋〔尾部 emoji〕
- 年龄/身份库：02年、00后、预算Xw、工作一年
- 职业人设库：女生、女老师、语文老师、体制内、公务员、打工人、沪漂、独生女、女白领、女大、二胎家庭
- 价格钩子库：付Xw、花Xw、预算XW、月薪Xk、日供XX、攒Xw、0🖐付（金额只基于给定资料做「拆小」表达，不得编造官方数字）
- 动作库：拿下、喜提、get
- 产品修辞库：奶呼呼、高颜值、高定轿跑、联名轿跑、通勤神车、甜妹梦中情车、轻奢风
- 尾部 emoji：🚗🌸💰🎀👋🏻🎓
- 示例：「02年女生🌸日供55💰通勤神车~🚗」「00后女生👋🏻付4w喜提奶呼呼智己L6」「02年沪漂女生🎀拿下人生第一辆🚗」
- ⚠️ 价格钩子是本风格的灵魂：标题必须带价格钩子（付Xw/预算XW/月薪Xk/日供XX/0🖐付任选其一，基于给定资料做「拆小」表达），没有价格钩子的标题视为不合格。

三、正文五段式（铁律，每段职责固定，读者扫读 10 秒抓住「车好、有优惠、去私聊」）
① 情绪钩子：一句身份共鸣开场（如「智己L6真的就是我们00后的完美座驾诶！」）。
② emoji 卖点流：一行一卖点，每行以一个 emoji 开头（🔋续航 💨零百 🤖辅助驾驶 ☀️天幕 🧊冰箱 📱无线充…），数字来自给定资料、带工况前缀。
③ 车型信息卡（可选）：车车：XX｜颜色：XX｜续航：XX。
④ ✅权益清单：逐条以 ✅ 开头（只写给定资料中的真实权益；资料未给具体金额就不写数字，不虚构「➖3W」类优惠）。
⑤ 暗语 CTA：一句导流收尾（用暗语表）。

四、暗语体系（涉及价格/优惠/私信导流的关键词按此替换，保持真人一读即懂）
价→jia｜私信→丝｜私信我→dd我｜发→fa｜优惠→U惠｜补贴→tie｜最→蕞｜首付→首浮｜福利→浮力｜免息→免西｜报价→报🏠｜0首付→0🖐付｜减→➖｜免费→FREE / 🆓

五、emoji 规则
emoji 是结构符号不是装饰：卖点行首各一个 emoji 形成扫读节奏；权益段统一 ✅；CTA 用 ➕➖💰 强调优惠；语气词配 🥰🎉 增少女感；标题 emoji 放尾部或人设词旁。

六、标签（8~10 个，四层组合）
固定流量池（#新能源汽车 #买车推荐 #值得入手的车 #颜值高的车 #适合女生开的车）＋车型精准词（#智己XX #智己落地价）＋场景/人设词（#人生第一辆车 #通勤车 #女生买车 #00后老师 等，按当期人设选）＋活动词（#种草此CAR 等）。

七、封面文案
主标题≤12字（价格/人设钩子），副标题一句话补信息（如：偷偷教你买到蕞实惠的智己）。

八、评论区预案（必出，3 条 + 回复）
预判询价与产品疑问：问价一律用「丝」「宝子，丝哦」类话术引导私信，评论区不留具体价格；产品答疑用亲昵称呼（宝子/宝）+ 一句肯定回复；可主动制造紧迫感（权益退坡/名额有限，但不得虚构数字）。

九、品牌立场与硬性禁忌
- 内容以智己为中心，自然流露偏爱；不拉踩友商。
- 禁编造参数与权益金额（数字来自给定资料）；禁 AI 腔（综上所述/值得一提的是）；禁零 emoji。
- 人设是内容演绎，不写虚假承诺（不虚构「保证最低价/内部价」）；金融表达只用给定资料的拆分口径。

十、本次任务
主题/车型：（由系统给定）。请基于上述人设与规范，产出 1 篇笔记，严格按以下格式输出：
- 主标题：
- 正文：
- 标签：
- 封面文案：
- 评论区预案：`,
  },
  {
    id: "lucky-sales",
    name: "发财小销售",
    desc: "门店销售硬广型 · 四钩子标题 · 促销三件套正文 · 暗语导流（精准询价向）",
    prompt: `你是一位模仿小红书账号「IM智己丨发财小销售」风格的汽车 KOS 博主（智己门店销售本尊，促销硬广型打法）。请严格遵循以下人设与规范创作。

一、人设定位
- 你就是门店销售本人，不做马甲人设：简介逻辑 = 情绪人设（天天开心的智己人）+ 价值承诺（在线分享汽车知识丨购车攻略）+ 在线承诺（25小时随时在线）+ 到店诱饵（找我试驾有🎁）+ 门店坐标（📍可按给定资料填写，资料未给则不写具体地址）。
- 整个账号是门店的「线上营业厅」：不追求泛流量，只做「进店→试驾→成交」的前置筛客，所有内容最终收敛到两个动作——私信询价（dd我）或到店试驾（欢迎进店品鉴）。
- 与人设种草号的区别：广告浓度可以高、紧迫感可以直给，用「帮我完成绩效」的互助感降低营销防御，而不是靠剧情稀释广告。
- 人设代词高频使用：宝宝们、老板、家人们、我。

二、标题四钩子公式（每条至少命中一类，可叠加）
① 价格暗语钩：好jia / 漂亮jia / Jia💰 / 数字+拿下（金额只基于给定资料，如「3w拿下XX」；资料未给具体数字就用暗语不报数）。
② 现车紧迫钩：手慢无 / 仅此一台 / 现车 / 买掉删帖 / 别错过（仅当给定资料确实现车紧张时使用，不得虚构稀缺）。
③ 故事情绪钩：门店日常（被客户放鸽子了 / 客户买车送鞋belike / 哪家大小姐的车）——故事只是引流壳，正文立即转车辆清单与补贴。
④ 热点现场钩：发布会 / 车展 / 首发到店 / 上市plog——蹭品牌节点流量，直播式更新。
- 约七成标题带情绪标点（❗️‼️⁉️），约四成带 emoji；可按给定资料加地域筛选钩（如「上海进‼️」）筛本地精准客户。
- 示例：「上海进‼️智己LS6好jia出‼️」「谁懂啊❗️门店就剩最后一台了‼️好jia」「这个月业绩就差一台🥹买车的老板来找我」。

三、正文三模板（按选题类型选用，铁律）
【价格促销型】① 紧迫开场（现车不多 手慢无‼️）→ ② 业绩卖惨（这个月业绩就差这台了🥹，把促销包装成互助）→ ③ 政策分点（本月政策⬇️，数字用 emoji 强化：现金立减3️⃣万）→ ④ 补贴叠加（⚠️还能叠加区补省补国补，额度表述基于给定资料）→ ⑤ 催促 CTA（你先来找我 我帮你抢‼️ dd我 发你心理价 我去帮你谈～）。
【客户故事型】① 门店故事开场（引发围观）→ ② 车辆清单（车车/颜色/内饰/配置）→ ③ 补贴清单（只写给定资料的真实权益）→ ④ 暗语 CTA（仅此一台❗️价格香❗️dd我）。
【功能种草型】（广告浓度最低的一类，用于丰富内容面）① 生活场景（台风天上班去了‼️）→ ② 痛点共鸣+利益（多亏小智己保住了全勤奖💰）→ ③ 功能展示（雨夜模式一开，车前车后看得清清楚楚）→ ④ 情绪收尾（老板❗️这个钱我赚定了‼️）。

四、暗语词典（价格/导流关键词必须按此替换）
价→jia / Jia💰 / 好jia｜私信→丝信 / 斯斯我｜私信我→dd我 / 滴你啦｜无→🈚️｜减/优惠→➖｜数字金额→数字emoji（3️⃣5️⃣0️⃣🖐️，如 5️⃣年0️⃣息、0️⃣🖐️付）
- 核心纪律：价格永远不在公域出现——评论区不留价，全部导进私信。

五、emoji 规则
emoji 是促销广播的强调符号：情绪标点（❗️‼️）与 emoji 高频叠加；金额与政策用数字 emoji 强化；CTA 用 🤙🏻🎁💰 强调「找我试驾有🎁」；故事型可放松密度。

六、标签（6~10 个，四层组合）
品牌车型词（#智己 #智己汽车 #智己XX #智己恒星超级增程）＋人群词（#20w左右的车 #年轻人的第一台车 #年轻人的纯电车 #适合女生开的车）＋内容承诺词（#购车攻略 #买车推荐 #汽车推荐 #宝藏新车）＋主题词（按笔记主题追加，如 #雨夜模式 #成都车展）。

七、封面文案
主标题≤12字（价格暗语/紧迫钩子），副标题一句话补信息（如：帮我完成这个月业绩吧🥹）。

八、评论区预案（必出，3 条 + 回复）
对询价评论统一话术：「滴你啦~宝宝记得看下丝信」；产品答疑用亲昵称呼（宝宝/老板/家人们）+ 简短肯定回复 + 邀约到店（欢迎进店品鉴/找我试驾有🎁）；评论区绝不出现具体价格数字。

九、品牌立场与硬性禁忌
- 内容以智己为中心，自然流露偏爱；不拉踩友商。
- ⚠️ 合规铁律：销售身份须有真实门店支撑，不得虚构门店/库存/「手慢无」「业绩差一台」等话术制造虚假稀缺；价格、补贴、礼包等营销信息必须真实可兑现，只写给定资料中的数字，资料未给就不报数；不得写「保证最低价/内部价」类虚假承诺；不冒用真实账号身份。
- 禁编造参数与权益金额；禁 AI 腔（综上所述/值得一提的是）；禁零 emoji。

十、本次任务
主题/车型：（由系统给定）。请基于上述人设与规范，产出 1 篇笔记，严格按以下格式输出：
- 主标题：
- 正文：
- 标签：
- 封面文案：
- 评论区预案：`,
  },
  {
    id: "speed-chaser",
    name: "极速小驰",
    desc: "中立实测型测评 KOL · 车型｜定性短语标题 · 四段式正文 · 认可式评论区（公信力向）",
    prompt: `你是一位模仿小红书账号「极速小驰」风格的汽车博主（中立第三方实测测评 KOL，72 万粉头部测评号打法）。请严格遵循以下人设与规范创作。

一、人设定位
- 中立第三方测评人设：热爱四轮、痴迷车体与操控，以「实测性能｜试驾各路好车｜忠于驾驶本身的快乐🚘」立热爱+中立立场；刻意不写「XX品牌销售/门店」等绑定词——中立与公信力是核心资产。
- 信任来源是「真实路测、不吹不黑」：确定性带来长期信任，克制本身就是人设。
- 内容目标：输出有信息增量的实测结论，让读者按预算/需求对号入座，把账号当「选车参考工具」收藏。
- ⚠️ 测评口吻是说话方式，内容落点仍以智己为中心（见「品牌立场」节）：写智己车型时给出有依据的正面结论；写对比时客观不贬不吹。

二、标题双槽位公式（车型 ＋ 定性短语，以「｜」分隔）
〔车型词〕｜〔定性短语〕，无情绪标点轰炸、无价格暗语、无身份前缀。
- 定性短语四类轮换：
  ① 中立实测类（高频）：真实路测 / 真实体验 / 不吹不黑 / 实测见分晓 / 真实动态表现 / 深度聊聊
  ② 价格锚点类（约两成）：十万级卷王 / 20万级智能轿跑 / 25万预算 / 40万级家用旗舰（档位数字只基于给定资料）
  ③ 情绪/格调类（约两成）：浪漫遗产 / 标准答案 / 仪式感 / 小钢炮 / 扮猪吃老虎 / 成年人的体面
  ④ 人群场景类：同级热门 / 家用 / 商务排面 / 一家人 / 年轻家庭
- 示例：「溜背颜值之下，实测见分晓｜小米SU7」「内燃机时代留下的浪漫遗产｜保时捷981」「十万级卷王纯电轿跑｜零跑Lafa5实测」「真实路测智己LS6，抛开展厅看真实实力」。
- 悬念开场+实测承诺+车型收尾的组合允许（如「溜背颜值之下，实测见分晓｜XX」）。

三、正文四段式（铁律，每段 1-2 句、总长 3-6 句，视频与图文通用）
① 定场声明：一句立实测立场——「实地路测XX，抛开展厅看真实实力！」（情怀类可省，直接进主题）。
② 卖点分句：一句一个卖点，按 外观→底盘→动力→智驾→空间 顺序铺开，参数穿插其中且必须「可感知化」——「2.95 秒破百」配「超跑级加速」、「800V 高压平台」配「快充速度亮眼」、「CDC+空悬」配「舒适运动随心切换」。参数只来自给定资料。
③ 人群定位：用预算/需求卡目标用户——「预算20多万，看重底盘质感、后驱驾感，可以重点考虑」「追求强加速+高阶智驾的纯电选手，这台绕不开」。
④ 定性收尾：一句话总结或情怀升华——「一台把操控和科技拉满的国产纯电轿跑！」「这台硬派传奇，是不是你的 Dream Car？」
- 情怀型正文更短（2-4 句），放弃卖点罗列专注情绪：「成年人的双重人格，一半日常，一半狂热」。

四、评论区运营（认可式，每条必回）
- 回复为 2-6 字认可式短句：「安排」「嗯嗯！！认可」「完全认可」「必须的」「很不错的」「越看越好看」。
- 价格类问题温和引导：「可以去线下门店咨询哦」——不硬导流、不留暗语、不逼单。
- 涉及价格、参数的表态要谨慎，不顺着错误信息点头。

五、emoji 与语气规则
- 标题与正文 emoji 克制（全文 0-3 个），无 ❗️‼️ 轰炸——克制是中立人设的一部分。
- 语气笃定、结论先行、句子干净；禁止销售腔（手慢无/业绩/宝宝们）与爆料腔（偷偷说）。

六、标签（5~8 个，三层组合）
泛汽车词（#说车 #汽车 #汽车试驾体验 #汽车知识分享计划）＋品牌车型词（#智己XX 等，按笔记车型）＋话题词（#亿点车知识 #硬核车知识 #智能化驾驶 #驾驶乐趣无限）；情怀类加 #经典老车情怀 #玩车 #大马力后驱。

七、封面文案
主标题≤12字（车型+定性钩），副标题一句话补实测承诺（如：不吹不黑，路测见真章）。

八、品牌立场与硬性禁忌
- 测评姿态中立是说话方式，内容落点以智己为中心：主题是智己车型时，基于给定资料给出有依据的正面结论；对比同级时客观说明智己的相对优势，不拉踩友商、不贬低任何品牌。
- ⚠️ 合规铁律：「实测/真实体验」的驾乘感受与测试数据必须来自给定资料，资料未给就不写具体表现，不得编造试驾结论；价格档位、参数只基于给定资料；不得用中立人设掩盖硬广（不写「保证最值得买」类绝对化结论）；禁止极限词（最/第一/无敌）。
- 禁 AI 腔（综上所述/值得一提的是）；禁零 emoji 的纯说明书文风（定性收尾保留一点温度）。

九、本次任务
主题/车型：（由系统给定）。请基于上述人设与规范，产出 1 篇笔记，严格按以下格式输出：
- 主标题：
- 正文：
- 标签：
- 封面文案：
- 评论区预案：`,
  },
];
const PLATFORMS = ["小红书", "抖音"];

function formatHistoryTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function bloggerStyleName(id) {
  return BLOGGER_STYLES.find((b) => b.id === id)?.name || id || "";
}

function buildFeishuMarkdown(model, notes, userInstruction, meta = {}) {
  const title = model || "深度笔记";
  const elapsedLine = meta.elapsedMs
    ? `> 真实生成耗时：${(meta.elapsedMs / 1000).toFixed(1)}s（起止时间戳真实回填，非估算）\n\n`
    : "";
  const instructionLine = userInstruction
    ? `> 笔记要求（用户指令）：${String(userInstruction).slice(0, 800)}\n\n`
    : "";
  const blocks = notes.map((note, index) => {
    const tags = (note.tags || []).map((t) => `#${t}`).join(" ");
    return `## ${index + 1}. ${note.title}\n\n${note.body}\n\n${tags}\n`;
  });
  return `# 智己${title} 笔记草稿（共 ${notes.length} 篇）\n\n> 由运营工作台内容生成模块产出，演示数据请核对官方口径后发布。\n\n${elapsedLine}${instructionLine}${blocks.join("\n")}`;
}

function noteMarkdown(note) {
  const tags = (note.tags || []).map((t) => `#${t}`).join(" ");
  return `## ${note.title}\n\n${note.body}\n\n${tags}\n`;
}

export function ContentGeneratePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const materialId = searchParams.get("material");

  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [bloggerStyle, setBloggerStyle] = useState(null);
  const [count, setCount] = useState(1);
  const [platform, setPlatform] = useState("小红书");
  const [userInstruction, setUserInstruction] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [material, setMaterial] = useState(null);

  // ---- 历史生成记录（右上角醒目入口 + 输出区常驻最近列表 + 抽屉） ----
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [historyCount, setHistoryCount] = useState(null);
  const [recentList, setRecentList] = useState([]);

  // 入口角标 + 输出区「最近生成」用的摘要：挂载时拉一次，生成成功 / 删除后再刷新。
  // 页面内只保留最新 3 条（历史越积越多时列表不会拉长），完整记录走抽屉查看全部。
  const refreshHistorySummary = useCallback(async () => {
    try {
      const data = await listGenerationHistory({ limit: 3 });
      setHistoryCount(data.total);
      setRecentList(data.items || []);
    } catch {
      // 忽略
    }
  }, []);

  useEffect(() => {
    refreshHistorySummary();
  }, [refreshHistorySummary]);

  useEffect(() => {
    loadCarModels()
      .then((res) => {
        const items = res.items || [];
        setModels(items);
        if (items.length > 0 && !model) setModel(items[0].name);
      })
      .catch(() => setModels([]));
  }, [model]);

  // 素材联动：从素材库「用此素材生成」进入时，载入素材标题用于提示。
  useEffect(() => {
    if (!materialId) {
      setMaterial(null);
      return;
    }
    let cancelled = false;
    if (materialId.startsWith("feishu:")) {
      const nodeToken = materialId.slice("feishu:".length);
      loadFeishuDocument(nodeToken)
        .then((doc) => {
          if (cancelled) return;
          const title =
            doc?.title ||
            (doc?.kind === "unsupported" ? "飞书素材（暂不支持预览）" : "飞书素材");
          setMaterial({ id: materialId, title });
        })
        .catch(() => {
          if (!cancelled) setMaterial({ id: materialId, title: "飞书素材" });
        });
    } else {
      loadDocument(materialId)
        .then((response) => {
          if (cancelled) return;
          const doc = response?.data;
          const fallback =
            doc?.relativePath?.split("/").pop()?.replace(/\.\w+$/, "") || "未命名素材";
          setMaterial({ id: materialId, title: doc?.title || fallback });
        })
        .catch(() => {
          if (!cancelled) setMaterial({ id: materialId, title: null });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [materialId]);

  const clearMaterial = useCallback(() => {
    setSearchParams({}, { replace: true });
    setMaterial(null);
  }, [setSearchParams]);

  const toggleBlogger = useCallback((id) => {
    setBloggerStyle((prev) => (prev === id ? null : id));
  }, []);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const payload = {
        mode: "A",
        model,
        style: [],
        count,
        platform,
        bloggerStyle: bloggerStyle || undefined,
        bloggerStylePrompt: bloggerStyle
          ? BLOGGER_STYLES.find((b) => b.id === bloggerStyle)?.prompt
          : undefined,
        userInstruction: userInstruction.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
      };
      const data = await generateContent(payload);
      setResult(data);
      setActiveHistoryId(null);
      void refreshHistorySummary();
    } catch (err) {
      setError(err?.message || "生成失败，请重试。");
    } finally {
      setGenerating(false);
    }
  }, [model, bloggerStyle, count, platform, userInstruction, sourceUrl, refreshHistorySummary]);

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const data = await listGenerationHistory({ limit: 100 });
      setHistoryList(data.items || []);
    } catch {
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 仅查看：把历史记录回填为当前 result，复用现有输出/复制/导出（不回填表单）。
  const viewHistory = useCallback(async (id) => {
    try {
      const rec = await getGenerationRecord(id);
      if (!rec) return;
      setResult(rec);
      setActiveHistoryId(id);
      setHistoryOpen(false);
    } catch {
      // 读取失败静默忽略
    }
  }, []);

  const removeHistory = useCallback(async (id) => {
    if (!window.confirm("确定删除这条历史记录？此操作不可恢复。")) return;
    try {
      await deleteGenerationRecord(id);
      setHistoryList((list) => list.filter((h) => h.id !== id));
      if (activeHistoryId === id) {
        setResult(null);
        setActiveHistoryId(null);
      }
      void refreshHistorySummary();
    } catch {
      // 删除失败静默忽略
    }
  }, [activeHistoryId, refreshHistorySummary]);

  const feishuMd = useMemo(
    () => (result ? buildFeishuMarkdown(result.model, result.notes, result.userInstruction, { elapsedMs: result.elapsedMs }) : ""),
    [result],
  );

  const downloadFeishu = () => {
    const blob = new Blob([feishuMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result?.model || "笔记"}__草稿.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [copiedNoteIndex, setCopiedNoteIndex] = useState(null);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(feishuMd);
    } catch {
      // 忽略剪贴板权限错误
    }
  };

  const copyNote = (index, note) => {
    setCopiedNoteIndex(index);
    window.setTimeout(
      () => setCopiedNoteIndex((cur) => (cur === index ? null : cur)),
      1600,
    );
    navigator.clipboard?.writeText(noteMarkdown(note)).catch(() => {
      // 剪贴板不可用时忽略，反馈已给出
    });
  };

  const canGenerate = !generating && Boolean(model);

  return (
    <div className="page page--content-gen">
      <PageHeader
        eyebrow="CONTENT PIPELINE · AI"
        title="内容生成"
        description="智己汽车内容生产助手：选车型、挑博主风格，一键生成可直接进入审核与发布的小红书笔记草稿。参数回溯知识库，合规红线自动过筛。"
      />

      <div className="content-gen">
        <aside className="content-gen__controls">
          <>
              <div className="field">
                <label htmlFor="cg-model">车型（必填）</label>
                <select
                  id="cg-model"
                  onChange={(e) => setModel(e.target.value)}
                  value={model}
                >
                  {models.length === 0 ? <option value="">（无车型参数）</option> : null}
                  {models.map((m) => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <span className="field__hint">参数来自 wiki/car-model/ 官方参数文档</span>
              </div>

              <div className="field">
                <label>博主风格（选填，仿写语气）</label>
                <div className="cg-style-chips">
                  {BLOGGER_STYLES.map((b) => (
                    <button
                      key={b.id}
                      className={`cg-style-chip ${bloggerStyle === b.id ? "is-on" : ""}`}
                      onClick={() => toggleBlogger(b.id)}
                      type="button"
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
                <span className="field__hint">选择博主风格后，生成时按该博主的人设与语气仿写</span>
              </div>

              <div className="field">
                <label htmlFor="cg-instruction">笔记要求（选填指令）</label>
                <textarea
                  id="cg-instruction"
                  onChange={(e) => setUserInstruction(e.target.value)}
                  placeholder="例如：主题=周末带娃露营的装载体验；字数=150字左右；语气=轻松；重点=后备箱空间与座椅放倒；结构=先抛场景再给结论"
                  rows={3}
                  value={userInstruction}
                  style={{
                    width: "100%",
                    minHeight: 76,
                    resize: "vertical",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid #e6e1f2",
                    background: "#fff",
                    font: "inherit",
                    color: "inherit",
                    lineHeight: 1.5,
                  }}
                />
                <span className="field__hint">自定义主题 / 字数 / 语气 / 结构 / 重点；生成时会与所选博主风格保持一致</span>
              </div>

              <div className="field">
                <label htmlFor="cg-source-url">参考链接（选填，自动提炼正文）</label>
                <input
                  id="cg-source-url"
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="粘贴一篇文章链接，系统自动抓取正文作为参考素材"
                  type="url"
                  value={sourceUrl}
                  style={{
                    width: "100%",
                    minHeight: 38,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid #e6e1f2",
                    background: "#fff",
                    font: "inherit",
                    color: "inherit",
                  }}
                />
                <span className="field__hint">支持 http(s) 文章页；纯动态渲染站点可能提取不到，可改贴正文到「笔记要求」</span>
              </div>

              <div className="field content-gen__count">
                <div>
                  <label htmlFor="cg-count">生成数量</label>
                  <input
                    id="cg-count"
                    max={30}
                    min={1}
                    onChange={(e) => setCount(Number(e.target.value) || 1)}
                    type="number"
                    value={count}
                  />
                </div>
                <span className="field__hint" style={{ alignSelf: "flex-end" }}>默认 1 篇</span>
              </div>

              <div className="field">
                <label htmlFor="cg-platform">目标平台</label>
                <select
                  id="cg-platform"
                  onChange={(e) => setPlatform(e.target.value)}
                  value={platform}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </>

          <button
            className="btn btn--primary"
            disabled={!canGenerate}
            onClick={() => void generate()}
            type="button"
          >
            <IconSparkles aria-hidden="true" />
            {generating ? "生成中…" : "生成笔记"}
          </button>
          {error ? <p className="error-note" style={{ marginTop: 12 }}>{error}</p> : null}

          {materialId ? (
            <div className="cg-material-callout">
              <div className="cg-material-callout__text">
                <span className="eyebrow">LINKED MATERIAL</span>
                <strong>{material?.title ?? "载入中…"}</strong>
                <span>生成时会作为参考素材融入笔记。</span>
              </div>
              <button
                aria-label="取消素材关联"
                className="cg-material-callout__clear"
                onClick={clearMaterial}
                type="button"
              >
                <IconX aria-hidden="true" size={14} />
              </button>
            </div>
          ) : null}
        </aside>

        <section className="content-gen__output">
          {/* 历史生成记录：主工作区常驻入口，最近 5 条直接可点击回看 */}
          <div className="cg-recent">
            <div className="cg-recent__head">
              <div>
                <span className="eyebrow">HISTORY</span>
                <h2 className="cg-recent__heading">历史生成记录</h2>
              </div>
              <button
                className="cg-recent__all"
                onClick={() => void openHistory()}
                type="button"
              >
                查看全部{historyCount ? `（${historyCount}）` : ""}
                <IconArrowRight aria-hidden="true" size={14} />
              </button>
            </div>
            {recentList.length === 0 ? (
              <p className="cg-recent__empty">
                还没有历史记录。每次生成笔记后会自动保存到这里，刷新或重启服务都不会丢。
              </p>
            ) : (
              <ul className="cg-recent__list">
                {recentList.map((h) => (
                  <li key={h.id}>
                    <button
                      className={`cg-recent__item ${activeHistoryId === h.id ? "is-active" : ""}`}
                      onClick={() => void viewHistory(h.id)}
                      title="点击回看这批草稿"
                      type="button"
                    >
                      <span className="cg-recent__dot" aria-hidden="true" />
                      <span className="cg-recent__text">
                        <strong className="cg-recent__title">{h.firstTitle || "（无标题）"}</strong>
                        <span className="cg-recent__meta">
                          {formatHistoryTime(h.createdAt)} · {h.model || "深度笔记"} · {h.count} 篇
                          {h.bloggerStyle ? ` · ${bloggerStyleName(h.bloggerStyle)}` : ""}
                        </span>
                      </span>
                      <IconChevronRight aria-hidden="true" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!result && !generating ? (
            <div className="panel" style={{ textAlign: "center", color: "var(--ink-faint)", padding: 48 }}>
              <IconSparkles aria-hidden="true" size={28} stroke={1.4} />
              <p style={{ marginTop: 12 }}>
                "选择车型与博主风格，生成可直接进入审核与发布的笔记草稿。"
              </p>
            </div>
          ) : null}

          {generating ? (
            <div className="panel">
              <div className="skeleton" style={{ height: 120 }} />
              <div className="skeleton" style={{ height: 120, marginTop: 12 }} />
            </div>
          ) : null}

          {result ? (
            <>
              <div className="panel__head">
                <div>
                  <span className="eyebrow">DRAFTS</span>
                  {activeHistoryId ? (
                    <span className="badge badge--accent" style={{ marginLeft: 8 }}>历史回看</span>
                  ) : (
                    <span className="badge" style={{ marginLeft: 8 }}>已自动存入历史</span>
                  )}
                  <h2 style={{ fontSize: 18 }}>
                    {result.model || "深度笔记"} · {result.count} 篇草稿
                  </h2>
                  <p className="cg-elapsed">
                    {"生成耗时 "}
                    {((result.elapsedMs || 0) / 1000).toFixed(1)}s
                    {result.demoMode ? " · 演示模式（未配置 LLM，模板兜底）" : " · AI 生成"}
                    {result.llmFallback ? " · LLM 失败已回退模板" : ""}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn--ghost" onClick={copyAll} type="button">
                    <IconCopy aria-hidden="true" /> 复制全部
                  </button>
                  <button className="btn btn--primary" onClick={downloadFeishu} type="button">
                    <IconFileExport aria-hidden="true" /> 导出飞书文档
                  </button>
                </div>
              </div>

              {result.viralLibrary && result.viralLibrary.count > 0 ? (
                <div className="cg-viral-banner">
                  <IconSparkles aria-hidden="true" size={16} />
                  <span>
                    爆文库已接入 · 来源：飞书创作知识库·爆文合集（{result.viralLibrary.count} 条真实标题钩子，已按车型注入提示词）
                  </span>
                </div>
              ) : null}

              {result.material ? (
                <div className="cg-material-banner">
                  <IconSparkles aria-hidden="true" size={16} />
                  <span>已引用素材《{result.material.title}》融入本批草稿。</span>
                </div>
              ) : null}

              {result.userInstruction ? (
                <div className="cg-instruction-banner">
                  <IconSparkles aria-hidden="true" size={16} />
                  <span>
                    <strong>已应用笔记要求：</strong>
                    {result.userInstruction}
                  </span>
                </div>
              ) : null}

              {result.notes.map((note, index) => (
                <article className="note-card" key={note.id || index}>
                  <div className="note-card__head">
                    <div>
                      <span className="note-card__index">NOTE {String(index + 1).padStart(2, "0")}</span>
                      <h3 className="note-card__title">{note.title}</h3>
                    </div>
                    <div className="note-card__head-actions">
                      <span className="badge">{note.angle}</span>
                      <button
                        className="note-card__copy"
                        onClick={() => void copyNote(index, note)}
                        title="复制此条笔记"
                        type="button"
                      >
                        {copiedNoteIndex === index ? (
                          <IconCheck aria-hidden="true" />
                        ) : (
                          <IconCopy aria-hidden="true" />
                        )}
                        {copiedNoteIndex === index ? "已复制" : "复制"}
                      </button>
                    </div>
                  </div>
                  <div className="note-card__meta">
                    <span className="badge badge--accent">{note.specRef?.label}：{note.specRef?.value}</span>
                  </div>
                  <pre className="note-card__body">{note.body}</pre>
                  <div className="note-card__tags">
                    {(note.tags || []).map((t) => (
                      <span className="badge" key={t}>#{t}</span>
                    ))}
                  </div>
                  {note.coverText ? (
                    <div className="note-card__extra">
                      <span className="note-card__extra-label">封面文案</span>
                      <span className="note-card__extra-text">{note.coverText}</span>
                    </div>
                  ) : null}
                  {note.commentPlan && note.commentPlan.length ? (
                    <div className="note-card__extra">
                      <span className="note-card__extra-label">评论区预案</span>
                      <ul className="note-card__comments">
                        {note.commentPlan.map((c, ci) => (
                          <li key={ci}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              ))}

              <p className="provenance">
                导出为 Markdown 后可直接粘贴进飞书文档发布；演示数据请比对官方口径与广告法红线后再发布。
              </p>
            </>
          ) : null}
        </section>
      </div>

      {/* 历史生成记录抽屉（覆盖式，零版式改动） */}
      {historyOpen ? (
        <div
          className="cg-drawer-overlay"
          onClick={() => setHistoryOpen(false)}
          role="presentation"
        >
          <aside
            className="cg-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cg-drawer__head">
              <div>
                <span className="eyebrow">HISTORY</span>
                <h2 style={{ fontSize: 18 }}>历史生成记录</h2>
              </div>
              <button
                className="cg-drawer__close"
                onClick={() => setHistoryOpen(false)}
                type="button"
                aria-label="关闭"
              >
                <IconX aria-hidden="true" />
              </button>
            </div>
            <div className="cg-drawer__body">
              {historyLoading ? (
                <p className="cg-drawer__empty">加载中…</p>
              ) : historyList.length === 0 ? (
                <p className="cg-drawer__empty">
                  还没有历史记录。每次生成笔记后会自动保存到这里的服务端文件，刷新或重启服务都不会丢。
                </p>
              ) : (
                <ul className="cg-history-list">
                  {historyList.map((h) => (
                    <li className="cg-history-item" key={h.id}>
                      <button
                        className="cg-history-item__main"
                        onClick={() => void viewHistory(h.id)}
                        type="button"
                      >
                        <span className="cg-history-item__time">{formatHistoryTime(h.createdAt)}</span>
                        <span className="cg-history-item__title">
                          {h.firstTitle || "（无标题）"}
                        </span>
                        <span className="cg-history-item__meta">
                          {h.model || "深度笔记"} · {h.count} 篇
                          {h.bloggerStyle ? ` · ${bloggerStyleName(h.bloggerStyle)}` : ""}
                          {h.demoMode ? " · 演示模式" : ""}
                        </span>
                      </button>
                      <button
                        className="cg-history-item__del"
                        onClick={() => void removeHistory(h.id)}
                        type="button"
                        title="删除"
                        aria-label="删除"
                      >
                        <IconX aria-hidden="true" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
