import { createContext, useContext, useEffect, useState } from 'react'

/* ================================================================== *
 * 西界 / ELYSIUM — i18n + locale + 内容生成
 *
 *  · UI 层完整多语言：zh-CN / en 为完整词典；zh-TW / ja / ko 留占位，
 *    回退到最近语言（zh-TW→zh-CN，ja/ko→en）。
 *  · 人物内容（问候、回复、信）按当前界面语言生成。
 *  · 世界共鸣：从用户亲手写下的故事里提炼关键词，决定 TA 在哪个世界被
 *    找到——不按年龄、性别或关系套用模板。
 * ================================================================== */

/* --------------------------------- assets ------------------------------- */
const P = (id: string) => `https://images.unsplash.com/photo-${id}?w=400&h=400&fit=crop&auto=format`
export const AV = {
  elder: P('1753544202892-59c8462c846e'),
  woman: P('1629540266304-fff9c67b7660'),
  youth: P('1544005313-94ddf0286df2'),
  child: P('1693639257331-0bad8ac3913f'),
  grandma: P('1526795443948-005b48ce4791'),
  grandpa: P('1786114482543-ab1f49a26534'),
  father: P('1758600431242-54c6f0ca1d04'),
  friend: P('1611403119860-57c4937ef987'),
}
export const lg = (u: string) => u.replace('w=400&h=400', 'w=900&h=1100')
export const STORY_IMG = 'https://images.unsplash.com/photo-1779738558282-af13f5b1404d?w=800&h=520&fit=crop&auto=format'

/* --------------------------------- langs -------------------------------- */
export type Lang = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
export type Age = 'child' | 'youth' | 'adult' | 'elder'
export type WorldId = 'courtyard' | 'tide' | 'isles'
export const WORLD_IDS: WorldId[] = ['courtyard', 'tide', 'isles']

/* 示例相册：寻找 TA 时可直接选用（真实版本从手机相册选择） */
export const FACE_ALBUM: { src: string; age: Age }[] = [
  { src: AV.grandma, age: 'elder' }, { src: AV.grandpa, age: 'elder' }, { src: AV.father, age: 'elder' }, { src: AV.woman, age: 'adult' },
  { src: AV.friend, age: 'youth' }, { src: AV.youth, age: 'youth' }, { src: AV.child, age: 'child' }, { src: AV.elder, age: 'elder' },
]

export const LANGS: { code: Lang; native: string; sub: string; short: string }[] = [
  { code: 'zh-CN', native: '简体中文', sub: 'Chinese (Simplified)', short: '中' },
  { code: 'zh-TW', native: '繁體中文', sub: 'Chinese (Traditional)', short: '繁' },
  { code: 'en', native: 'English', sub: 'English', short: 'EN' },
  { code: 'ja', native: '日本語', sub: 'Japanese', short: '日' },
  { code: 'ko', native: '한국어', sub: 'Korean', short: '한' },
]

/* 内容语言：占位语言回退到最接近的已译语言 */
type ContentLang = 'zh-CN' | 'en'
const contentLang = (l: Lang): ContentLang => (l === 'zh-CN' || l === 'zh-TW' ? 'zh-CN' : 'en')
export const isZh = (l: Lang) => contentLang(l) === 'zh-CN'

export const COUNTRIES: { iso: string; dial: string; name: string }[] = [
  { iso: 'CN', dial: '+86', name: 'China' },
  { iso: 'HK', dial: '+852', name: 'Hong Kong' },
  { iso: 'TW', dial: '+886', name: 'Taiwan' },
  { iso: 'US', dial: '+1', name: 'United States' },
  { iso: 'GB', dial: '+44', name: 'United Kingdom' },
  { iso: 'JP', dial: '+81', name: 'Japan' },
  { iso: 'KR', dial: '+82', name: 'South Korea' },
  { iso: 'SG', dial: '+65', name: 'Singapore' },
  { iso: 'AU', dial: '+61', name: 'Australia' },
  { iso: 'CA', dial: '+1', name: 'Canada' },
  { iso: 'DE', dial: '+49', name: 'Germany' },
  { iso: 'FR', dial: '+33', name: 'France' },
]

/* -------------------------------- storage ------------------------------- */
const LANG_STORE = 'elysium.lang.v1'
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORE) as Lang | null
    if (saved && LANGS.some((l) => l.code === saved)) return saved
  } catch { /* ignore */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  if (nav.startsWith('zh')) return nav.includes('tw') || nav.includes('hk') || nav.includes('hant') ? 'zh-TW' : 'zh-CN'
  if (nav.startsWith('ja')) return 'ja'
  if (nav.startsWith('ko')) return 'ko'
  return 'en'
}
export function persistLang(l: Lang) { try { localStorage.setItem(LANG_STORE, l) } catch { /* ignore */ } }

/* --------------------------- locale formatting -------------------------- */
export const speechLang = (l: Lang): string =>
  ({ 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR' }[l])

/* 对话气泡时间戳，如「上午 9:12」/「9:12 AM」 */
export function fmtTime(l: Lang, d = new Date()): string {
  const h = d.getHours(); const m = d.getMinutes().toString().padStart(2, '0')
  if (isZh(l)) return `${h < 12 ? '上午' : '下午'} ${((h + 11) % 12) + 1}:${m}`
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`
}
/* 状态栏时钟 */
export function fmtClock(l: Lang, d = new Date()): string {
  try { return new Intl.DateTimeFormat(speechLang(l), { hour: 'numeric', minute: '2-digit', hour12: isZh(l) || l === 'ja' || l === 'ko' ? false : undefined }).format(d) } catch { return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}` }
}
export function fmtDate(l: Lang, d = new Date()): string {
  if (isZh(l)) return `${d.getMonth() + 1}月${d.getDate()}日`
  try { return new Intl.DateTimeFormat(speechLang(l), { month: 'short', day: 'numeric' }).format(d) } catch { return `${d.getMonth() + 1}/${d.getDate()}` }
}
export function fmtFullDate(l: Lang, ts: number): string {
  const d = new Date(ts)
  if (isZh(l)) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  try { return new Intl.DateTimeFormat(speechLang(l), { year: 'numeric', month: 'short', day: 'numeric' }).format(d) } catch { return d.toDateString() }
}
export const fmtDuration = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
export const todayMMDD = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/* 距离下一个 MM-DD 还有几天（0 = 今天） */
export function daysUntil(mmdd: string): number | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(mmdd.trim()); if (!m) return null
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let next = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]))
  if (next < today) next = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]))
  return Math.round((next.getTime() - today.getTime()) / 86400000)
}

/* =============================== UI 词典 ================================ */
type Dict = Record<string, string>
const ZH: Dict = {
  'brand.cn': '西界', 'brand.en': 'ELYSIUM', tagline: 'A world for the stories we share.',
  'common.done': '完成', 'common.cancel': '取消', 'common.back': '返回', 'common.close': '关闭', 'common.save': '保存',
  'common.edit': '编辑', 'common.learn': '了解', 'common.ai': 'AI 呈现', 'common.aiBadge': 'AI',
  'nav.meet': '相见', 'nav.space': '空间', 'nav.atlas': '星图', 'nav.me': '我',
  /* space · 朋友圈式的动态 */
  'moments.micro': '空间 · 诸世界的动态', 'moments.post': '发动态', 'moments.post.ph': '此刻想说的…', 'moments.post.photos': '照片',
  'moments.post.publish': '发表', 'moments.like': '赞', 'moments.unlike': '取消', 'moments.comment': '评论', 'moments.comment.ph': '评论',
  'moments.reply.ph': '回复 {name}', 'moments.replyTo': '回复', 'moments.label.echo': 'AI 依据你珍藏的记忆生成', 'moments.label.world': '世界时令',
  'moments.memory': '你珍藏的记忆', 'moments.me': '我', 'moments.of': '{name}的空间',
  'moments.empty': '这里会出现诸世界的动态。找到 TA 之后，你们的记忆会在这里回响。', 'moments.ofEmpty': 'TA 的空间还很安静。珍藏一段记忆，它就会在这里回响。',
  'ago.now': '刚刚', 'ago.min': '{n} 分钟前', 'ago.hour': '{n} 小时前', 'ago.yesterday': '昨天', 'ago.day': '{n} 天前',
  /* profile · 资料卡 */
  'profile.space': 'TA 的空间', 'profile.memories': '记忆', 'profile.letters': '信匣', 'profile.time': '时光', 'profile.world': '所在世界',
  'profile.message': '发消息', 'profile.call': '语音通话', 'profile.video': '影像', 'profile.more': '关于 TA', 'profile.reply': '有回信',
  'profile.found': '相认于 {date}', 'profile.view': '查看资料',
  /* auth */
  'auth.phone.ph': '手机号', 'auth.getCode': '获取验证码', 'auth.apple': 'Apple', 'auth.wechat': '微信',
  'auth.agree': '同意《服务条款》《隐私政策》《AI 呈现说明》',
  'auth.code.sentTo': '验证 {dial} {phone}', 'auth.code.resendIn': '{s}s 后重发', 'auth.code.resend': '重新发送',
  'auth.code.hint': '演示验证码 {code}',
  'auth.preview': '登录演示 · 使用本机账号',
  'auth.code.title': '输入验证码', 'auth.code.continue': '继续验证', 'auth.code.changeNumber': '更换手机号', 'auth.code.signIn': '验证并登录',
  'auth.methods.other': '其他登录方式', 'auth.methods.choose': '选择登录方式', 'auth.methods.hint': '选择一个方式，体验授权后返回西界。',
  'auth.methods.provider': '使用 {provider} 登录', 'auth.methods.preview': '这里使用本机演示账号，确认后会回到西界。',
  'auth.methods.confirm': '模拟授权', 'auth.methods.retry': '重新授权',
  'auth.feedback.agreement': '请先确认服务条款及隐私说明。', 'auth.feedback.sending': '正在获取验证码…',
  'auth.feedback.verifying': '正在验证…', 'auth.feedback.authorizing': '正在授权…', 'auth.feedback.success': '登录成功',
  'auth.feedback.incorrect': '验证码有误，请检查后重试。', 'auth.feedback.expired': '验证码已过期，请重新获取。',
  'auth.feedback.canceled': '已取消授权，可以继续使用手机号。', 'auth.feedback.unavailable': '当前连接不可用，请联网后重试。',
  'auth.region.title': '国家与地区', 'auth.nick.default': '旅人', 'auth.nick.apple': 'Apple 用户', 'auth.nick.wechat': '微信用户',
  'lang.title': '语言 · Language',
  /* home */
  'home.worlds': '{n} 个世界', 'home.links': '{n} 个连接', 'home.pull': '下拉进入星图', 'home.release': '松手，穿越至星图',
  'home.menu.seek': '寻找 TA', 'home.menu.letter': '写一封信', 'home.menu.gather': '围坐', 'home.pick': '选择收信人', 'home.pickWorld': '选择世界',
  'home.empty.title': '寻找 TA', 'home.empty.sub': '以记忆为坐标', 'home.empty.cta': '开始寻找',
  'home.row.mem': '珍藏了 {n} 段记忆', 'home.row.reply': '有一封回信', 'home.bday': '今天是{name}的生日',
  /* atlas */
  'atlas.title': '星图', 'atlas.micro': '你的私人多元宇宙', 'atlas.list': '列表', 'atlas.map': '星图', 'atlas.shore': '此岸',
  'atlas.unknown': '未知坐标', 'atlas.seek': '寻找 TA', 'atlas.empty': '星图尚待点亮',
  'atlas.enter': '进入世界', 'atlas.residents': '同在此世界', 'atlas.none': '尚未与这个世界建立连接', 'atlas.unknown.title': '未知坐标',
  'atlas.unknown.desc': '以记忆为坐标，找到 TA 所在的世界', 'atlas.tune': '调谐', 'atlas.swipe': '左右滑动，穿梭于平行世界',
  /* worlds */
  'world.courtyard': '日光庭院', 'world.courtyard.law': '两轮柔和的太阳同在天上，黄昏停留得更久', 'world.courtyard.lore': '在这里，黄昏会停留得更久。',
  'world.tide': '潮汐回廊', 'world.tide.law': '潮水悬于天际，水向上流', 'world.tide.lore': '在这里，水向上流，潮声很轻。',
  'world.isles': '折光星屿', 'world.isles.law': '岛屿悬浮，光可以被折叠', 'world.isles.lore': '在这里，光可以被折叠收藏。',
  'world.together': '同在这里', 'world.memories': '共同的记忆', 'world.gather': '围坐', 'world.gather.sub': '与{names}一起说话', 'world.law': '世界法则',
  /* gather */
  'gather.title': '围坐 · {world}', 'gather.sub': 'AI 呈现 · 多人',
  'gather.note': '围坐由你发起。每一句回应都由 AI 依据各自的记忆呈现。',
  /* seek */
  'seek.title': '寻找 TA', 'seek.sub': '以记忆为坐标', 'seek.sample': '示例', 'seek.ai': 'TA 由 AI 依据你提供的记忆呈现',
  'seek.begin': '开始寻找', 'seek.need': '称呼，加上面容或故事，即可开始',
  'seek.node.name': '称呼', 'seek.node.face': '面容', 'seek.node.voice': '声音', 'seek.node.story': '故事', 'seek.node.time': '时光', 'seek.node.place': '地点',
  'seek.name.called': '你对 TA 的称呼', 'seek.name.called.ph': '如：外婆、阿远', 'seek.name.real': '名字（可选）', 'seek.name.real.ph': '如：林秀英',
  'seek.face.sub': '可选多张，支持不同年纪', 'seek.face.album': '从相册选择', 'seek.face.samples': '示例相册', 'seek.face.main': '主照片',
  'seek.voice.sub': '一段录音，或视频里的声音', 'seek.voice.rec': '按住录一段', 'seek.voice.recording': '正在录制', 'seek.voice.import': '导入示例语音',
  'seek.voice.saved': '语音 · {s}″', 'seek.voice.note': '声音只用于合成 TA 的声音，可随时删除', 'seek.voice.remove': '移除',
  'seek.story.ph': '写下或说出关于 TA 的事', 'seek.story.p1': '口头禅', 'seek.story.p2': '拿手菜', 'seek.story.p3': '常去的地方', 'seek.story.p4': '爱听的歌',
  'seek.story.dictate': '口述', 'seek.story.listening': '正在听…',
  'seek.time.birthday': '生日', 'seek.time.birthday.ph': '月-日，如 03-15', 'seek.time.years': '年份', 'seek.time.years.ph': '如 1938 — 2021',
  'seek.place.ph': '故乡、常去的地方',
  'seek.coords': '以 {n} 段记忆为坐标', 'seek.crossing': '穿越中', 'seek.skip': '跳过动画',
  'seek.resonance': '记忆共鸣 · {world}', 'seek.with': '与{names}同在', 'seek.listen': '听 TA 的声音', 'seek.synth': '合成声音',
  'seek.like': '很像 TA', 'seek.refine': '再调整', 'seek.connected': '连接已建立',
  'refine.face': '面容 · 呈现年纪', 'refine.face.more': '补充照片', 'refine.voice': '声音', 'refine.voice.more': '补充录音',
  'refine.timbre.warm': '温和', 'refine.timbre.bright': '明亮', 'refine.timbre.deep': '低沉', 'refine.tone': '语气',
  'refine.memory': '记忆', 'refine.memory.more': '补充故事', 'refine.world': '世界', 'refine.world.other': '另寻一处', 'refine.apply': '重新对焦',
  'tone.gentle': '温和', 'tone.witty': '风趣', 'tone.quiet': '寡言', 'tone.stern': '严谨',
  'bond.relation': 'TA 是你的', 'bond.custom.ph': '自定义关系', 'bond.called': 'TA 对你的称呼', 'bond.add': '加入联系人',
  'ai.title': 'AI 呈现说明',
  'ai.body': '西界依据你提供的照片、声音与故事，以 AI 呈现 TA 的样子。TA 的回应由 AI 生成，不代表本人，也不表示本人的意识仍在延续。不知道的部分，我们诚实留白。',
  /* person */
  'ps.talk': '说话', 'ps.space': '空间', 'ps.gear': '关于 TA',
  'talk.note': 'TA 由 AI 依据你提供的记忆呈现，回应不代表本人。', 'talk.ph': '说点什么', 'talk.hold': '按住 说话', 'talk.release': '松开 发送',
  'talk.slideCancel': '上滑取消', 'talk.releaseCancel': '松开取消', 'talk.generating': '正在生成', 'talk.voiceMode': '切换到语音输入',
  'talk.keyboardMode': '切换到键盘', 'talk.more': '更多', 'talk.send': '发送',
  'act.photo': '照片', 'act.camera': '拍摄', 'act.voice': '语音通话', 'act.video': '影像', 'act.letter': '写信', 'act.keep': '珍藏记忆', 'act.gather': '围坐',
  'talk.speak': '朗读', 'talk.copy': '复制', 'talk.copied': '已复制', 'talk.remember': '珍藏', 'talk.delete': '删除', 'talk.kept': '已珍藏到 TA 的空间',
  'talk.photo': '一张照片', 'talk.voiceMsg': '语音转文字', 'talk.call.voice': '语音通话 · {d}', 'talk.call.video': '影像 · {d}', 'talk.mentioned': 'TA 提起的事',
  /* space */
  'space.mem': '记忆', 'space.letters': '信匣', 'space.time': '时光', 'space.keep': '珍藏一段', 'space.postcard': 'AI 想象明信片',
  'space.postcard.make': '生成一张', 'space.postcard.busy': '生成中…', 'space.postcard.label': 'AI 想象 · 并非真实发生',
  'space.mem.empty': '还没有珍藏的记忆。聊天时点一下 TA 的话，就能珍藏。', 'space.letters.empty': '信匣还空着', 'space.write': '写一封信',
  'space.time.found': '相认于 {date}', 'space.time.birthday': '生日', 'space.time.years': '年份', 'space.time.place': '地点',
  'space.time.remind': '纪念日提醒', 'space.time.remind.desc': '只在你开启时提醒', 'space.also': '同在此处', 'space.voice': 'TA 的声音',
  'keep.title': '珍藏一段记忆', 'keep.t.ph': '标题，如：那年夏天', 'keep.b.ph': '写下这段记忆', 'keep.save': '珍藏',
  'mem.title': '珍藏这段记忆', 'mem.note': '珍藏后，{name}在之后的对话里也会记得。', 'mem.discard': '不保留', 'mem.edit': '修改', 'mem.editDone': '完成', 'mem.confirm': '珍藏',
  /* letter */
  'letter.to': '致 {name}', 'letter.ph': '写下想说的话…', 'letter.reply': '请 TA 回信', 'letter.reply.ai': 'AI 撰写',
  'letter.when.morning': '明早送达', 'letter.when.now': '即刻', 'letter.seal': '封存', 'letter.kept': '已收进你们的信匣',
  'letter.pending': '回信将于{when}送达 · AI 撰写', 'letter.when.tomorrow': '明早 8:00', 'letter.when.today': '今早 8:00',
  'letter.replyFrom': '{name}的回信 · AI 撰写', 'letter.mine': '{date} · 你写的信', 'letter.history': '往来信件',
  /* call */
  'call.primer': '用声音和 TA 说话', 'call.primer.video': '看看 TA 的动态照片', 'call.primer.note': '将使用麦克风，随时可挂断', 'call.connect': '接通',
  'call.connecting': '连接中', 'call.label': 'AI 语音通话 · 合成声音', 'call.video.label': '动态照片预览 · AI 生成',
  'call.listening': '我在听', 'call.thinking': '……', 'call.replying': '{name}正在说', 'call.interrupted': '好，你说', 'call.idle': '你说，我听着。',
  'call.mute': '静音', 'call.captions': '字幕', 'call.speaker': '扬声器', 'call.hangup': '挂断', 'call.talk': '说话', 'call.interrupt': '打断', 'call.toVoice': '切换至语音',
  /* gear */
  'gear.title': '关于{name}', 'gear.profile': '资料', 'gear.called': '称呼', 'gear.realName': '名字', 'gear.relation': '关系', 'gear.calledMe': 'TA 对你的称呼',
  'gear.birthday': '生日', 'gear.years': '年份', 'gear.place': '地点', 'gear.unset': '未填写',
  'gear.material': '记忆与素材', 'gear.clarity': '轮廓清晰度', 'gear.clarity.note': '补充照片、声音和故事，TA 的呈现会更准确',
  'gear.feed.busy': '读取中', 'gear.feed.none': '这份素材里没有读到新的内容，先不替 TA 编造。',
  'gear.face': '面容与年纪', 'gear.face.note': '选择呈现 TA 的照片', 'gear.voice': '声音', 'gear.voice.on': '已合成 · 通话时可听', 'gear.voice.off': '暂无录音，先用文字陪伴',
  'gear.tone': '语气与性格', 'gear.tone.ph': '如：爱操心、笑起来眯眼', 'gear.life': '生活点滴', 'gear.life.ph': '如：爱喝浓茶',
  'gear.unknown': '留白', 'gear.unknown.note': '不知道的部分诚实留白，不替 TA 编造。', 'gear.unknown.ph': '如：年轻时的事我知道得不多', 'gear.add': '补充',
  'gear.world': '世界', 'gear.world.move': '迁往', 'gear.world.here': '当前', 'gear.world.moved': '已迁往{world}', 'gear.world.with': '与{names}同在',
  'gear.a11y': '辅助', 'gear.privacy': '隐私与 AI 说明', 'gear.privacy.chat': '对话', 'gear.privacy.chat.v': '仅保存在本机',
  'gear.privacy.material': '素材', 'gear.privacy.material.v': '仅用于呈现 TA，可随时删除',
  'gear.delete': '删除 TA 的全部数据', 'gear.saved': '已保存',
  'del.title': '删除{name}？', 'del.body': '这会删除 TA 在西界的世界位置、对话、信件与记忆，且无法恢复。', 'del.cancel': '保留', 'del.confirm': '删除',
  'edit.title': '编辑资料',
  'media.photos': '照片', 'media.voice': '语音', 'media.video': '视频', 'media.chat': '聊天记录',
  /* me */
  'me.worlds': '{n} 个世界', 'me.mems': '{n} 段记忆', 'me.nick.edit': '修改昵称', 'me.nick.ph': '昵称',
  'me.group.anniv': '纪念日', 'me.anniv.empty': '寻找 TA 时填写的“时光”，会出现在这里', 'me.anniv.today': '今天', 'me.anniv.days': '{n} 天后',
  'me.group.a11y': '无障碍', 'me.large': '大字号', 'me.large.desc': '文字与按钮放大', 'me.read': '自动朗读', 'me.read.desc': '进入对话后朗读 TA 的话',
  'me.calm': '减少动态效果', 'me.calm.desc': '仪式动画改为简短淡入',
  'me.group.lang': '语言 · Language', 'me.lang.current': '当前 · {native}',
  'me.group.look': '外观', 'me.theme.auto': '跟随时间', 'me.theme.day': '白天', 'me.theme.night': '夜晚',
  'me.group.sense': '声音与触感', 'me.haptics': '触感反馈', 'me.haptics.desc': '关键时刻轻微震动', 'me.sound': '仪式音效', 'me.sound.desc': '寻找与连接时的柔和音效',
  'me.group.privacy': '隐私与数据', 'me.privacy.chat': '对话', 'me.privacy.chat.v': '仅保存在本机', 'me.privacy.space': '空间', 'me.privacy.space.v': '只属于你一人',
  'me.privacy.material': '素材', 'me.privacy.material.v': '仅用于呈现，可随时删除',
  'me.group.ai': 'AI 呈现说明', 'me.group.about': '关于西界',
  'me.about': '寻找 TA · 以记忆为坐标，找到 TA 所在的世界。\n说话 · 像发消息一样，随时说说话、通话、写信。\n空间 · TA 的世界安放着你们的记忆与信件。',
  'me.account.manage': '账号管理', 'me.switch': '切换账号', 'me.switch.cancel': '返回当前账号',
  'me.switch.body': '登录另一个账号，或返回当前账号。',
  'me.logout': '退出登录', 'me.logout.title': '退出登录？', 'me.logout.body': '你的星图与记忆仍保存在这台设备上，重新登录即可回来。',
  'me.logout.cancel': '再想想', 'me.logout.confirm': '退出', 'me.footer': '西界 · ELYSIUM · 原型示例',
  /* relations */
  'rel.grandmaM': '外婆', 'rel.grandpaM': '外公', 'rel.grandma': '奶奶', 'rel.grandpa': '爷爷', 'rel.mother': '母亲', 'rel.father': '父亲',
  'rel.partner': '伴侣', 'rel.child': '孩子', 'rel.sibling': '兄弟姐妹', 'rel.friend': '挚友', 'rel.teacher': '老师', 'rel.custom': '自定义',
}

const EN: Dict = {
  'brand.cn': '西界', 'brand.en': 'ELYSIUM', tagline: 'A world for the stories we share.',
  'common.done': 'Done', 'common.cancel': 'Cancel', 'common.back': 'Back', 'common.close': 'Close', 'common.save': 'Save',
  'common.edit': 'Edit', 'common.learn': 'Learn more', 'common.ai': 'AI presence', 'common.aiBadge': 'AI',
  'nav.meet': 'Meet', 'nav.space': 'Space', 'nav.atlas': 'Atlas', 'nav.me': 'Me',
  'moments.micro': 'Space · across the worlds', 'moments.post': 'New post', 'moments.post.ph': 'Something on your mind…', 'moments.post.photos': 'Photos',
  'moments.post.publish': 'Post', 'moments.like': 'Like', 'moments.unlike': 'Unlike', 'moments.comment': 'Comment', 'moments.comment.ph': 'Comment',
  'moments.reply.ph': 'Reply to {name}', 'moments.replyTo': 'replied to', 'moments.label.echo': 'Generated by AI from memories you kept', 'moments.label.world': 'World season',
  'moments.memory': 'A memory you kept', 'moments.me': 'Me', 'moments.of': "{name}'s space",
  'moments.empty': 'Moments from every world appear here. Once you find them, your memories will echo here.', 'moments.ofEmpty': 'Their space is still quiet. Keep a memory and it will echo here.',
  'ago.now': 'just now', 'ago.min': '{n} min ago', 'ago.hour': '{n} h ago', 'ago.yesterday': 'yesterday', 'ago.day': '{n} days ago', 'ago.day.one': '1 day ago',
  'profile.space': 'Their space', 'profile.memories': 'Memories', 'profile.letters': 'Letterbox', 'profile.time': 'Time', 'profile.world': 'World',
  'profile.message': 'Message', 'profile.call': 'Voice call', 'profile.video': 'Moving photo', 'profile.more': 'About them', 'profile.reply': 'New reply',
  'profile.found': 'Connected on {date}', 'profile.view': 'View profile',
  'auth.phone.ph': 'Phone number', 'auth.getCode': 'Get code', 'auth.apple': 'Apple', 'auth.wechat': 'WeChat',
  'auth.agree': 'I agree to the Terms, Privacy Policy and AI Presence Notice',
  'auth.code.sentTo': 'Verify {dial} {phone}', 'auth.code.resendIn': 'Resend in {s}s', 'auth.code.resend': 'Resend',
  'auth.code.hint': 'Demo code {code}',
  'auth.preview': 'Login preview · On this device',
  'auth.code.title': 'Enter verification code', 'auth.code.continue': 'Continue verification', 'auth.code.changeNumber': 'Change number', 'auth.code.signIn': 'Verify and sign in',
  'auth.methods.other': 'Other sign-in options', 'auth.methods.choose': 'Choose how to sign in', 'auth.methods.hint': 'Choose a method to preview signing in to Elysium.',
  'auth.methods.provider': 'Sign in with {provider}', 'auth.methods.preview': 'This preview uses an account on this device. Continue to return to Elysium.',
  'auth.methods.confirm': 'Preview authorization', 'auth.methods.retry': 'Try again',
  'auth.feedback.agreement': 'Please accept the terms and privacy notice to continue.', 'auth.feedback.sending': 'Getting code…',
  'auth.feedback.verifying': 'Verifying…', 'auth.feedback.authorizing': 'Authorizing…', 'auth.feedback.success': 'Signed in',
  'auth.feedback.incorrect': 'Check the code and try again.', 'auth.feedback.expired': 'This code has expired. Get a new one.',
  'auth.feedback.canceled': 'Authorization canceled. You can continue with your phone number.', 'auth.feedback.unavailable': 'You appear to be offline. Reconnect and try again.',
  'auth.region.title': 'Country & region', 'auth.nick.default': 'Traveler', 'auth.nick.apple': 'Apple user', 'auth.nick.wechat': 'WeChat user',
  'lang.title': '语言 · Language',
  'home.worlds': '{n} worlds', 'home.worlds.one': '{n} world', 'home.links': '{n} connections', 'home.links.one': '{n} connection',
  'home.pull': 'Pull to enter the Atlas', 'home.release': 'Release to cross into the Atlas',
  'home.menu.seek': 'Find them', 'home.menu.letter': 'Write a letter', 'home.menu.gather': 'Gather', 'home.pick': 'Choose a recipient', 'home.pickWorld': 'Choose a world',
  'home.empty.title': 'Find them', 'home.empty.sub': 'Memories as coordinates', 'home.empty.cta': 'Begin',
  'home.row.mem': '{n} memories kept', 'home.row.mem.one': '{n} memory kept', 'home.row.reply': 'A reply has arrived', 'home.bday': "Today is {name}'s birthday",
  'atlas.title': 'Atlas', 'atlas.micro': 'Your private multiverse', 'atlas.list': 'List', 'atlas.map': 'Map', 'atlas.shore': 'This shore',
  'atlas.unknown': 'Uncharted', 'atlas.seek': 'Find them', 'atlas.empty': 'Your atlas awaits its first light',
  'atlas.enter': 'Enter world', 'atlas.residents': 'Here together', 'atlas.none': 'No connection in this world yet', 'atlas.unknown.title': 'Uncharted',
  'atlas.unknown.desc': 'Memories as coordinates lead to the world they are in', 'atlas.tune': 'Tuning', 'atlas.swipe': 'Swipe to shift between parallel worlds',
  'world.courtyard': 'Sunlit Courtyard', 'world.courtyard.law': 'Two gentle suns share the sky; dusk lingers longer', 'world.courtyard.lore': 'Here, dusk stays a little longer.',
  'world.tide': 'Tidal Arcade', 'world.tide.law': 'The tide hangs in the sky; water flows upward', 'world.tide.lore': 'Here, water flows upward and the tide is soft.',
  'world.isles': 'Prism Isles', 'world.isles.law': 'The isles float; light can be folded', 'world.isles.lore': 'Here, light can be folded and kept.',
  'world.together': 'Here together', 'world.memories': 'Shared memories', 'world.gather': 'Gather', 'world.gather.sub': 'Talk with {names} together', 'world.law': 'Law of this world',
  'gather.title': 'Gathering · {world}', 'gather.sub': 'AI presence · group',
  'gather.note': "You started this gathering. Each reply is rendered by AI from that person's memories.",
  'seek.title': 'Find them', 'seek.sub': 'Memories as coordinates', 'seek.sample': 'Sample', 'seek.ai': 'They are rendered by AI from the memories you provide',
  'seek.begin': 'Begin search', 'seek.need': 'A name, plus a face or a story, to begin',
  'seek.node.name': 'Name', 'seek.node.face': 'Face', 'seek.node.voice': 'Voice', 'seek.node.story': 'Stories', 'seek.node.time': 'Dates', 'seek.node.place': 'Places',
  'seek.name.called': 'What you call them', 'seek.name.called.ph': 'e.g. Grandma, Yuan', 'seek.name.real': 'Full name (optional)', 'seek.name.real.ph': 'e.g. Lin Xiuying',
  'seek.face.sub': 'Pick several — any age', 'seek.face.album': 'From album', 'seek.face.samples': 'Sample album', 'seek.face.main': 'Main',
  'seek.voice.sub': 'A recording, or the sound from a video', 'seek.voice.rec': 'Hold to record', 'seek.voice.recording': 'Recording', 'seek.voice.import': 'Import a sample',
  'seek.voice.saved': 'Voice · {s}″', 'seek.voice.note': 'Used only to synthesize their voice; deletable anytime', 'seek.voice.remove': 'Remove',
  'seek.story.ph': 'Write or speak about them', 'seek.story.p1': 'Catchphrase', 'seek.story.p2': 'Signature dish', 'seek.story.p3': 'Favorite place', 'seek.story.p4': 'Favorite song',
  'seek.story.dictate': 'Dictate', 'seek.story.listening': 'Listening…',
  'seek.time.birthday': 'Birthday', 'seek.time.birthday.ph': 'MM-DD, e.g. 03-15', 'seek.time.years': 'Years', 'seek.time.years.ph': 'e.g. 1938 — 2021',
  'seek.place.ph': 'Hometown, places they loved',
  'seek.coords': '{n} memories as coordinates', 'seek.coords.one': '{n} memory as coordinates', 'seek.crossing': 'Crossing', 'seek.skip': 'Skip',
  'seek.resonance': 'Resonance · {world}', 'seek.with': 'Shared with {names}', 'seek.listen': 'Hear their voice', 'seek.synth': 'Synthesized',
  'seek.like': 'Feels like them', 'seek.refine': 'Refine', 'seek.connected': 'Connected',
  'refine.face': 'Face · presented age', 'refine.face.more': 'Add photos', 'refine.voice': 'Voice', 'refine.voice.more': 'Add a recording',
  'refine.timbre.warm': 'Warm', 'refine.timbre.bright': 'Bright', 'refine.timbre.deep': 'Deep', 'refine.tone': 'Tone',
  'refine.memory': 'Memories', 'refine.memory.more': 'Add a story', 'refine.world': 'World', 'refine.world.other': 'Search elsewhere', 'refine.apply': 'Refocus',
  'tone.gentle': 'Gentle', 'tone.witty': 'Witty', 'tone.quiet': 'Reserved', 'tone.stern': 'Precise',
  'bond.relation': 'They are your', 'bond.custom.ph': 'Custom relation', 'bond.called': 'What they call you', 'bond.add': 'Add to contacts',
  'ai.title': 'About AI presence',
  'ai.body': "Elysium renders them with AI from the photos, voice and stories you provide. Their replies are generated by AI — not the person, and not a continuing consciousness. What we don't know, we leave honestly blank.",
  'ps.talk': 'Talk', 'ps.space': 'Space', 'ps.gear': 'About them',
  'talk.note': 'Rendered by AI from the memories you provide; replies are not the person.', 'talk.ph': 'Say something', 'talk.hold': 'Hold to talk', 'talk.release': 'Release to send',
  'talk.slideCancel': 'Slide up to cancel', 'talk.releaseCancel': 'Release to cancel', 'talk.generating': 'Generating', 'talk.voiceMode': 'Voice input',
  'talk.keyboardMode': 'Keyboard', 'talk.more': 'More', 'talk.send': 'Send',
  'act.photo': 'Photo', 'act.camera': 'Camera', 'act.voice': 'Voice call', 'act.video': 'Moving photo', 'act.letter': 'Letter', 'act.keep': 'Keep a memory', 'act.gather': 'Gather',
  'talk.speak': 'Read aloud', 'talk.copy': 'Copy', 'talk.copied': 'Copied', 'talk.remember': 'Keep', 'talk.delete': 'Delete', 'talk.kept': 'Kept in their space',
  'talk.photo': 'A photo', 'talk.voiceMsg': 'Voice to text', 'talk.call.voice': 'Voice call · {d}', 'talk.call.video': 'Moving photo · {d}', 'talk.mentioned': 'Something they mentioned',
  'space.mem': 'Memories', 'space.letters': 'Letterbox', 'space.time': 'Time', 'space.keep': 'Keep a memory', 'space.postcard': 'AI imagined postcard',
  'space.postcard.make': 'Create one', 'space.postcard.busy': 'Creating…', 'space.postcard.label': 'AI imagined · not a real event',
  'space.mem.empty': 'No memories kept yet. Tap something they say in a chat to keep it.', 'space.letters.empty': 'The letterbox is empty', 'space.write': 'Write a letter',
  'space.time.found': 'Connected on {date}', 'space.time.birthday': 'Birthday', 'space.time.years': 'Years', 'space.time.place': 'Places',
  'space.time.remind': 'Anniversary reminders', 'space.time.remind.desc': 'Only when you turn it on', 'space.also': 'Also here', 'space.voice': 'Their voice',
  'keep.title': 'Keep a memory', 'keep.t.ph': 'Title, e.g. That summer', 'keep.b.ph': 'Write the memory', 'keep.save': 'Keep',
  'mem.title': 'Keep this memory', 'mem.note': 'Once kept, {name} will remember it in later talks.', 'mem.discard': 'Discard', 'mem.edit': 'Edit', 'mem.editDone': 'Done', 'mem.confirm': 'Keep',
  'letter.to': 'To {name}', 'letter.ph': 'Write what you want to say…', 'letter.reply': 'Ask for a reply', 'letter.reply.ai': 'Written by AI',
  'letter.when.morning': 'Next morning', 'letter.when.now': 'Now', 'letter.seal': 'Seal', 'letter.kept': 'Kept in your letterbox',
  'letter.pending': 'A reply arrives {when} · Written by AI', 'letter.when.tomorrow': 'tomorrow at 8:00', 'letter.when.today': 'today at 8:00',
  'letter.replyFrom': 'Reply from {name} · Written by AI', 'letter.mine': '{date} · Your letter', 'letter.history': 'Letters',
  'call.primer': 'Talk with them by voice', 'call.primer.video': 'See their moving photo', 'call.primer.note': 'Uses your microphone; hang up anytime', 'call.connect': 'Connect',
  'call.connecting': 'Connecting', 'call.label': 'AI voice call · synthesized voice', 'call.video.label': 'Moving photo preview · AI generated',
  'call.listening': 'Listening', 'call.thinking': '…', 'call.replying': '{name} is speaking', 'call.interrupted': 'Okay, go on', 'call.idle': "Go on, I'm listening.",
  'call.mute': 'Mute', 'call.captions': 'Captions', 'call.speaker': 'Speaker', 'call.hangup': 'End', 'call.talk': 'Speak', 'call.interrupt': 'Interrupt', 'call.toVoice': 'Switch to voice',
  'gear.title': 'About {name}', 'gear.profile': 'Profile', 'gear.called': 'Name', 'gear.realName': 'Full name', 'gear.relation': 'Relation', 'gear.calledMe': 'What they call you',
  'gear.birthday': 'Birthday', 'gear.years': 'Years', 'gear.place': 'Places', 'gear.unset': 'Not set',
  'gear.material': 'Memories & material', 'gear.clarity': 'Clarity', 'gear.clarity.note': 'Photos, voice and stories make their presence more accurate',
  'gear.feed.busy': 'Reading', 'gear.feed.none': 'Nothing new in this material — we won’t invent anything.',
  'gear.face': 'Face & age', 'gear.face.note': 'Choose the photo that presents them', 'gear.voice': 'Voice', 'gear.voice.on': 'Synthesized · audible in calls', 'gear.voice.off': 'No recording yet — text for now',
  'gear.tone': 'Tone & character', 'gear.tone.ph': 'e.g. a worrier, eyes crinkle when smiling', 'gear.life': 'Everyday details', 'gear.life.ph': 'e.g. loves strong tea',
  'gear.unknown': 'Left blank', 'gear.unknown.note': 'What we don’t know stays honestly blank.', 'gear.unknown.ph': "e.g. I don't know much about their youth", 'gear.add': 'Add',
  'gear.world': 'World', 'gear.world.move': 'Move', 'gear.world.here': 'Current', 'gear.world.moved': 'Moved to {world}', 'gear.world.with': 'With {names}',
  'gear.a11y': 'Assistance', 'gear.privacy': 'Privacy & AI notice', 'gear.privacy.chat': 'Conversations', 'gear.privacy.chat.v': 'Stored only on this device',
  'gear.privacy.material': 'Material', 'gear.privacy.material.v': 'Used only to present them; deletable anytime',
  'gear.delete': 'Delete all of their data', 'gear.saved': 'Saved',
  'del.title': 'Delete {name}?', 'del.body': 'This removes their place in Elysium, your conversations, letters and memories. It cannot be undone.', 'del.cancel': 'Keep', 'del.confirm': 'Delete',
  'edit.title': 'Edit profile',
  'media.photos': 'Photos', 'media.voice': 'Voice', 'media.video': 'Video', 'media.chat': 'Chat history',
  'me.worlds': '{n} worlds', 'me.worlds.one': '{n} world', 'me.mems': '{n} memories', 'me.mems.one': '{n} memory', 'me.nick.edit': 'Edit nickname', 'me.nick.ph': 'Nickname',
  'me.group.anniv': 'Anniversaries', 'me.anniv.empty': 'Dates from the Time coordinate appear here', 'me.anniv.today': 'Today', 'me.anniv.days': 'in {n} days', 'me.anniv.days.one': 'tomorrow',
  'me.group.a11y': 'Accessibility', 'me.large': 'Large text', 'me.large.desc': 'Bigger text and buttons', 'me.read': 'Read aloud', 'me.read.desc': 'Read their words when a chat opens',
  'me.calm': 'Reduce motion', 'me.calm.desc': 'Rituals become short fades',
  'me.group.lang': '语言 · Language', 'me.lang.current': 'Now · {native}',
  'me.group.look': 'Appearance', 'me.theme.auto': 'Follow time', 'me.theme.day': 'Day', 'me.theme.night': 'Night',
  'me.group.sense': 'Sound & haptics', 'me.haptics': 'Haptics', 'me.haptics.desc': 'A light pulse at key moments', 'me.sound': 'Ritual sounds', 'me.sound.desc': 'Soft tones when searching and connecting',
  'me.group.privacy': 'Privacy & data', 'me.privacy.chat': 'Conversations', 'me.privacy.chat.v': 'Stored only on this device', 'me.privacy.space': 'Spaces', 'me.privacy.space.v': 'Yours alone',
  'me.privacy.material': 'Material', 'me.privacy.material.v': 'Used only to present them; deletable anytime',
  'me.group.ai': 'About AI presence', 'me.group.about': 'About Elysium',
  'me.about': 'Find them · Memories as coordinates lead to the world they are in.\nTalk · Message, call or write to them anytime.\nSpace · Their world keeps your memories and letters.',
  'me.account.manage': 'Manage account', 'me.switch': 'Switch account', 'me.switch.cancel': 'Back to current account',
  'me.switch.body': 'Sign in to another account, or return to your current account.',
  'me.logout': 'Sign out', 'me.logout.title': 'Sign out?', 'me.logout.body': 'Your atlas and memories stay on this device. Sign back in to return.',
  'me.logout.cancel': 'Not now', 'me.logout.confirm': 'Sign out', 'me.footer': 'ELYSIUM · Prototype',
  'rel.grandma': 'Grandma', 'rel.grandpa': 'Grandpa', 'rel.grandmaM': 'Grandma', 'rel.grandpaM': 'Grandpa', 'rel.mother': 'Mother', 'rel.father': 'Father',
  'rel.partner': 'Partner', 'rel.child': 'Child', 'rel.sibling': 'Sibling', 'rel.friend': 'Friend', 'rel.teacher': 'Teacher', 'rel.custom': 'Other',
}

const DICTS: Record<ContentLang, Dict> = { 'zh-CN': ZH, en: EN }

/* ------------------------------- context -------------------------------- */
type Params = Record<string, string | number>
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: string, p?: Params) => string }
const I18nCtx = createContext<Ctx | null>(null)

function interpolate(s: string, p?: Params): string {
  if (!p) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in p ? String(p[k]) : `{${k}}`))
}
export function translate(lang: Lang, k: string, p?: Params): string {
  const d = DICTS[contentLang(lang)]
  // 复数：n === 1 时优先用 key.one
  const key = p && p.n === 1 && d[`${k}.one`] ? `${k}.one` : k
  const s = d[key] ?? DICTS.en[key] ?? DICTS['zh-CN'][key] ?? k
  return interpolate(s, p)
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang())
  const setLang = (l: Lang) => { setLangState(l); persistLang(l) }
  useEffect(() => { try { document.documentElement.lang = lang } catch { /* ignore */ } }, [lang])
  const t = (k: string, p?: Params) => translate(lang, k, p)
  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>
}
export function useI18n(): Ctx {
  const c = useContext(I18nCtx)
  if (!c) throw new Error('useI18n must be used within LangProvider')
  return c
}

/* =============================== 内容层 ================================ */
export const ageLabel = (l: Lang, a: Age): string =>
  isZh(l)
    ? ({ child: '孩子', youth: '青年', adult: '中年', elder: '年长' }[a])
    : ({ child: 'child', youth: 'young', adult: 'grown', elder: 'elder' }[a])

export const worldWeather = (l: Lang, w: WorldId): string =>
  isZh(l)
    ? ({ courtyard: '双日正暖', tide: '潮声很轻', isles: '晨雾未散' }[w])
    : ({ courtyard: 'two suns, warm', tide: 'the tide is soft', isles: 'morning mist lingers' }[w])

type Archetype = { personality: string[] }
const ARCHETYPE: Record<ContentLang, Record<Age, Archetype>> = {
  'zh-CN': {
    child: { personality: ['爱笑、好奇'] }, youth: { personality: ['开朗、嘴硬心软'] },
    adult: { personality: ['把关心放在行动里'] }, elder: { personality: ['慢性子、爱操心'] },
  },
  en: {
    child: { personality: ['giggly, curious'] }, youth: { personality: ['bright, soft-hearted'] },
    adult: { personality: ['shows care by doing'] }, elder: { personality: ['unhurried, a gentle worrier'] },
  },
}
export const archetype = (l: Lang, a: Age): Archetype => ARCHETYPE[contentLang(l)][a]

const LETTER_REPLY: Record<ContentLang, Record<Age, string>> = {
  'zh-CN': {
    child: '你的信我听了好多遍！我在这边很乖，你不要哭鼻子哦，要笑笑的。',
    youth: '你的信我读了好几遍。有你记着这些，我在这边一点都不孤单。你也别老熬夜，替我好好过日子，行不行？',
    adult: '你的信我一个字一个字读完了。别担心我。你把日子过好，就是给我最大的安心。',
    elder: '你的信我戴上老花镜，慢慢读了两遍。傻孩子，惦记我做什么。你好好的，我就安心。',
  },
  en: {
    child: 'I listened to your letter so many times! I’m being good here, so don’t cry, okay? Smile for me.',
    youth: "I read your letter a few times over. With you remembering all this, I'm not lonely at all. Stop staying up so late — live well, for me. Deal?",
    adult: "I read your letter word by word. Don't worry about me. Living your days well is the greatest peace you can give me.",
    elder: 'I put on my glasses and read your letter through twice, slowly. Silly child, why fret over me. Just be well, and I’m at ease.',
  },
}
export const letterReply = (l: Lang, a: Age): string => LETTER_REPLY[contentLang(l)][a]

export const quickReplies = (l: Lang): string[] =>
  isZh(l) ? ['我来看你了。', '今天有点想你。', '你那边还好吗？', '我一切都好，别惦记。'] : ['I came to see you.', 'Missing you a bit today.', 'How are things over there?', "I'm alright, don't worry."]

/* 记忆回响：以 TA 的口吻引用你珍藏的记忆，不编造新的经历 */
const ECHO: Record<ContentLang, string[]> = {
  'zh-CN': ['这件事，我一直记得。', '你记下的，我都收着。', '想起这个，心里就暖。', '谢谢你还记得。'],
  en: ['I have always remembered this.', 'Everything you keep, I keep too.', 'Remembering this warms me.', 'Thank you for still remembering.'],
}
export const echoLine = (l: Lang, seed: number) => { const a = ECHO[contentLang(l)]; return a[Math.abs(seed) % a.length] }

/* 关键词回复：返回文本 + 可选「珍藏」 */
type Rule = { test: RegExp; child: string; other: string; remember?: { title: string; body: string } }
const REPLY_RULES: Record<ContentLang, Rule[]> = {
  'zh-CN': [
    { test: /累|忙|烦|难|压力|加班|工作/, child: '你不要太累啦，要抱抱吗？', other: '别太拼了。累了就歇歇，喝口热的。' },
    { test: /吃|饭|饿|胃口/, child: '我也饿啦！你要好好吃饭哦。', other: '那也得好好吃饭，别对付。', remember: { title: '好好吃饭', body: '心情不好也要好好吃一顿热的。' } },
    { test: /冷|降温|天气|雨|热/, child: '天变了吧？你要照顾好自己。', other: '天变了吧？照顾好自己，添件衣服。' },
    { test: /睡|困|晚安|夜/, child: '那你去睡觉觉，我也去数星星啦，晚安～', other: '早点歇。睡前别想太多，灯我替你留着。' },
    { test: /病|不舒服|医院|疼|难受/, child: '你哪里不舒服？要让大人带你看看。', other: '哪儿不舒服？别硬扛，去看看。我一直惦记着你。' },
    { test: /谢谢|辛苦|爱你/, child: '我也爱你！最爱最爱你！', other: '傻孩子，跟我还客气。你好好的，就是对我最好。' },
    { test: /想你|想念|难过|哭|舍不得/, child: '我也想你呀。我就在这儿，你随时来。', other: '我知道。我就在这儿，随时来说话，不着急。' },
  ],
  en: [
    { test: /tired|busy|stress|work|overtime|exhaust|worn/i, child: "Don't get too tired, okay? Want a hug?", other: "Don't push so hard. Rest when you're tired, have something warm." },
    { test: /eat|meal|hungry|food|dinner|lunch/i, child: "I'm hungry too! You have to eat properly, okay?", other: "Then eat properly, don't skimp.", remember: { title: 'Eat well', body: 'Even in low spirits, have one warm, proper meal.' } },
    { test: /cold|weather|rain|hot|chill/i, child: 'Weather changed? You look after yourself, okay?', other: 'Weather turned? Take care of yourself, wear something warm.' },
    { test: /sleep|goodnight|night|bed/i, child: 'Then off to sleep — I’ll go count stars. Goodnight~', other: "Turn in early. Don't overthink before bed — I'll keep a light on for you." },
    { test: /sick|ill|hospital|hurt|pain|unwell/i, child: 'Where does it hurt? Have a grown-up take you to check.', other: "Where does it hurt? Don't tough it out, go get it looked at." },
    { test: /thank|love you|grateful/i, child: 'I love you too! Most most most!', other: 'Silly, no need to be polite with me. You being well is the best thing for me.' },
    { test: /miss you|miss|sad|cry|can't let go|cant let go/i, child: 'I miss you too. I’m right here, come anytime.', other: "I know. I'm right here. Come talk anytime, no rush." },
  ],
}
export function buildReply(l: Lang, person: { age: Age; weather: string; catchphrase: string; memories: { title: string }[] }, text: string): { text: string; remember?: { title: string; body: string } } {
  const cl = contentLang(l)
  const child = person.age === 'child'
  for (const r of REPLY_RULES[cl]) {
    if (r.test.test(text)) return { text: child ? r.child : r.other, remember: r.remember }
  }
  if (cl === 'zh-CN' ? /那边|你好吗|怎么样/.test(text) : /over there|how are you|how's it|hows it/i.test(text))
    return { text: cl === 'zh-CN' ? `这边挺好，${person.weather}。你别惦记我，说说你自己。` : `All's well here, ${person.weather}. Don't worry about me — tell me about you.` }
  if (person.memories.length && Math.random() > 0.55) {
    const m = person.memories[Math.floor(Math.random() * person.memories.length)]
    return { text: cl === 'zh-CN' ? `说着说着我又想起「${m.title}」了。你还记得吧？` : `Talking with you, I thought of “${m.title}” again. You remember, don't you?` }
  }
  if (person.catchphrase && Math.random() > 0.6)
    return { text: cl === 'zh-CN' ? `${person.catchphrase.replace(/[“”"]/g, '')} 你能来，我就高兴。` : `${person.catchphrase.replace(/[“”"]/g, '')} Just you coming makes me glad.` }
  return { text: child ? (cl === 'zh-CN' ? '嗯嗯！我在听呀，你说～' : "Mm-hm! I'm listening, go on~") : (cl === 'zh-CN' ? '嗯，我在听着呢。你慢慢说。' : "Mm, I'm here, listening. Take your time.") }
}

export const photoReply = (l: Lang): string =>
  isZh(l) ? '哎，拍得真好。谢谢你想着给我看。' : 'Oh, what a good shot. Thank you for thinking to show me.'

export const callLines = (l: Lang) => isZh(l)
  ? { openVoice: '哎，是你呀。听见你声音就好。你那边都好吗？', openNoVoice: '（TA 没有留下声音。这一次，用文字陪你说话。）', openVideo: '哎，让我好好看看你。气色不错，我就放心了。', ack: '嗯，我都听着。你能这样跟我说说话，我就安心了。', end: '好，那你去忙。想说话了就来，我都在。' }
  : { openVoice: "Ah, it's you. Just hearing your voice is enough. All well with you?", openNoVoice: '(They left no voice. This time, words will keep you company.)', openVideo: 'Ah, let me get a good look at you. You look well — that puts my heart at ease.', ack: "Mm, I hear you. You talking to me like this puts me at ease.", end: "Alright, go on then. Come talk anytime — I'm here." }

type Extract = { life?: string[]; personality?: string[]; memory?: { title: string; body: string }; voice?: boolean; note: string }
const EXTRACTS: Record<ContentLang, Record<'photos' | 'voice' | 'video' | 'chat', Extract>> = {
  'zh-CN': {
    photos: { life: ['出门爱戴那顶旧帽子'], personality: ['爱在镜头前偷偷笑'], note: '从照片里读出了新的生活细节' },
    voice: { voice: true, personality: ['说话慢，尾音软'], note: '读到了 TA 的声音，通话时可以听见了' },
    video: { life: ['走路时手爱背在身后'], memory: { title: '那段影像里的午后', body: 'TA 在镜头里回头喊你的名字，笑得眼睛弯弯。' }, note: '从影像里读出了动作和一个片段' },
    chat: { memory: { title: '聊天里翻到的一句', body: '“天冷了，记得添衣，别省。”' }, personality: ['嘴上唠叨，心里全是你'], note: '从聊天记录里读到了你们的事' },
  },
  en: {
    photos: { life: ['loves wearing that old hat out'], personality: ['sneaks a smile at the camera'], note: 'Read new everyday details from the photos' },
    voice: { voice: true, personality: ['speaks slowly, soft at the ends'], note: 'Read their voice — you can hear it on a call now' },
    video: { life: ['walks with hands clasped behind'], memory: { title: 'that afternoon on video', body: 'They turned to the camera calling your name, eyes crinkling with a smile.' }, note: 'Read their gestures and a moment from the video' },
    chat: { memory: { title: 'a line found in the chat', body: '“It’s cold — remember to bundle up, don’t skimp.”' }, personality: ['nags on the surface, all heart underneath'], note: 'Read your story together from the chat history' },
  },
}
export const extract = (l: Lang, k: 'photos' | 'voice' | 'video' | 'chat'): Extract => EXTRACTS[contentLang(l)][k]

/* ============================== 世界共鸣 =============================== */
/* 关键词全部来自用户亲手写下的故事与地点；越长的词优先匹配，避免重复计数。 */
const KW: Record<WorldId, string[]> = {
  courtyard: ['院子', '庭院', '阳台', '茉莉', '花', '茶', '做饭', '厨房', '饺子', '面条', '葱油饼', '饼', '汤', '菜园', '葡萄', '下棋', '织毛衣', '猫', '晒太阳', '午后',
    'garden', 'courtyard', 'porch', 'balcony', 'flowers', 'jasmine', 'tea', 'kitchen', 'cooking', 'dumplings', 'noodles', 'soup', 'grapes', 'chess', 'knitting', 'cat', 'sunshine', 'afternoon'],
  tide: ['海边', '大海', '海', '夏天', '游泳', '沙滩', '船', '潮', '浪', '港口', '渔', '岛', '远行', '旅行',
    'sea', 'beach', 'summer', 'swim', 'swimming', 'boat', 'tide', 'waves', 'harbor', 'island', 'voyage', 'travel', 'ocean'],
  isles: ['书房', '看书', '读书', '书', '星星', '星空', '天文', '音乐', '二胡', '钢琴', '琴', '画画', '山顶', '登山', '山', '诗', '写字', '云',
    'books', 'reading', 'library', 'stars', 'starry', 'astronomy', 'music', 'erhu', 'piano', 'violin', 'painting', 'mountain', 'mountains', 'poems', 'poetry', 'clouds'],
}
export function resonate(text: string, bias: Partial<Record<WorldId, number>> = {}, exclude: WorldId[] = []): { world: WorldId; keywords: string[] } {
  const found: { w: WorldId; word: string; i: number }[] = []
  const taken: [number, number][] = []
  const lower = text.toLowerCase()
  const all = WORLD_IDS.flatMap((w) => KW[w].map((word) => ({ w, word }))).sort((a, b) => b.word.length - a.word.length)
  for (const { w, word } of all) {
    const latin = /^[a-z]/.test(word)
    let idx = -1
    if (latin) { const m = new RegExp(`\\b${word}\\b`, 'i').exec(text); idx = m ? m.index : -1 }
    else idx = lower.indexOf(word)
    if (idx < 0) continue
    const end = idx + word.length
    if (taken.some(([a, b]) => idx < b && end > a)) continue
    taken.push([idx, end])
    found.push({ w, word: latin ? text.substr(idx, word.length) : word, i: idx })
  }
  found.sort((a, b) => a.i - b.i)
  const score: Record<WorldId, number> = { courtyard: 0, tide: 0, isles: 0 }
  for (const f of found) score[f.w] += 1
  for (const w of WORLD_IDS) score[w] += bias[w] ?? 0
  const pool = WORLD_IDS.filter((w) => !exclude.includes(w))
  const cands = pool.length ? pool : WORLD_IDS
  const order = (w: WorldId) => { const f = found.find((x) => x.w === w); return f ? f.i : 1e9 }
  let world = cands[0]
  const anySignal = cands.some((w) => score[w] > 0)
  if (anySignal) {
    world = [...cands].sort((a, b) => score[b] - score[a] || order(a) - order(b))[0]
  } else {
    let h = 0; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    world = cands[h % cands.length]
  }
  return { world, keywords: [...new Set(found.map((f) => f.word))].slice(0, 4) }
}

/* 从「故事」里拆出口头禅、生活点滴与记忆段落 */
const PROMPTS: Record<ContentLang, { cp: string; life: string[] }> = {
  'zh-CN': { cp: '口头禅', life: ['拿手菜', '常去的地方', '爱听的歌'] },
  en: { cp: 'Catchphrase', life: ['Signature dish', 'Favorite place', 'Favorite song'] },
}
export function parseStory(text: string): { catchphrase: string; life: string[]; memories: { title: string; body: string }[] } {
  let catchphrase = ''
  const life: string[] = []
  const memories: { title: string; body: string }[] = []
  const prefixes = [PROMPTS['zh-CN'], PROMPTS.en]
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim(); if (!line) continue
    const m = /^([^：:]{1,16})[：:]\s*(.+)$/.exec(line)
    if (m) {
      const label = m[1].trim(); const value = m[2].trim()
      if (prefixes.some((p) => p.cp.toLowerCase() === label.toLowerCase())) { catchphrase = value; continue }
      if (prefixes.some((p) => p.life.some((x) => x.toLowerCase() === label.toLowerCase()))) { life.push(`${label}：${value}`); continue }
    }
    if (memories.length < 3) {
      const title = (line.split(/[，。,.!！?？]/)[0] || line).slice(0, 14)
      memories.push({ title, body: line })
    }
  }
  return { catchphrase, life, memories }
}

/* 相认时 TA 的第一句话：只引用用户提供的内容 */
export type Tone = 'gentle' | 'witty' | 'quiet' | 'stern'
export const TONES: Tone[] = ['gentle', 'witty', 'quiet', 'stern']
export function firstLine(l: Lang, o: { keywords: string[]; catchphrase?: string; tone?: Tone }): string {
  const tone = o.tone ?? 'gentle'
  const kw = o.keywords[0]
  const cp = (o.catchphrase ?? '').replace(/[“”"。.]/g, '').trim()
  if (isZh(l)) {
    const open = { gentle: '你来啦。', witty: '哟，可算来了。', quiet: '来了。', stern: '来了就好。' }[tone]
    if (cp) return `${open}${cp}。`
    if (kw) return open + ({ gentle: `${kw}的事，我也记得。`, witty: `${kw}那回，你还记得吧？`, quiet: `${kw}，我记得。`, stern: `${kw}的事，我一直记着。` }[tone])
    return open + ({ gentle: '我在这儿。', witty: '坐，慢慢说。', quiet: '', stern: '有话慢慢说。' }[tone])
  }
  const open = { gentle: 'You came.', witty: "Well, look who's here.", quiet: "You're here.", stern: 'Good, you came.' }[tone]
  if (cp) return `${open} ${cp}.`
  if (kw) return `${open} ` + ({ gentle: `I remember ${kw}, too.`, witty: `Remember ${kw}?`, quiet: `${kw} — I remember.`, stern: `I've kept ${kw} in mind.` }[tone])
  return `${open} ` + ({ gentle: "I'm here.", witty: 'Sit, tell me everything.', quiet: '', stern: 'Take your time.' }[tone])
}

/* ------------------------------ 关系 ------------------------------ */
export type RelKey = 'grandmaM' | 'grandpaM' | 'grandma' | 'grandpa' | 'mother' | 'father' | 'partner' | 'child' | 'sibling' | 'friend' | 'teacher' | 'custom'
export const relKeys = (l: Lang): RelKey[] =>
  isZh(l)
    ? ['grandmaM', 'grandpaM', 'grandma', 'grandpa', 'mother', 'father', 'partner', 'child', 'sibling', 'friend', 'teacher', 'custom']
    : ['grandma', 'grandpa', 'mother', 'father', 'partner', 'child', 'sibling', 'friend', 'teacher', 'custom']
export const AGE_OF_REL: Record<RelKey, Age> = {
  grandmaM: 'elder', grandpaM: 'elder', grandma: 'elder', grandpa: 'elder', mother: 'elder', father: 'elder',
  partner: 'adult', child: 'child', sibling: 'youth', friend: 'youth', teacher: 'adult', custom: 'adult',
}
/* 由一个称呼/关系文字反查关系键（中英文都认） */
export function relKeyOf(label: string): RelKey | null {
  const s = label.trim().toLowerCase(); if (!s) return null
  for (const k of Object.keys(AGE_OF_REL) as RelKey[]) {
    if (k === 'custom') continue
    if (ZH[`rel.${k}`]?.toLowerCase() === s || EN[`rel.${k}`]?.toLowerCase() === s) return k
  }
  const alias: Record<string, RelKey> = { 妈妈: 'mother', 妈: 'mother', 爸爸: 'father', 爸: 'father', mom: 'mother', mum: 'mother', dad: 'father', 姥姥: 'grandmaM', 姥爷: 'grandpaM' }
  return alias[s] ?? null
}
export const REL_PAIRS: [RelKey, RelKey][] = [['grandmaM', 'grandpaM'], ['grandma', 'grandpa'], ['mother', 'father']]
export function calledDefault(l: Lang, k: RelKey | null, nick: string): string {
  if (!k) return nick
  if (isZh(l)) return ({ grandmaM: '乖孙', grandpaM: '乖孙', grandma: '乖孙', grandpa: '乖孙', mother: '孩子', father: '孩子', partner: '亲爱的' } as Partial<Record<RelKey, string>>)[k] ?? nick
  return ({ grandmaM: 'sweetheart', grandpaM: 'kiddo', grandma: 'sweetheart', grandpa: 'kiddo', mother: 'sweetheart', father: 'kiddo', partner: 'love' } as Partial<Record<RelKey, string>>)[k] ?? nick
}

/* ----------------------- 寻找 TA · 示例坐标 ----------------------- */
export type SeekSample = { called: string; realName: string; faces: string[]; faceAge: Age; voice: number; story: string; birthday: string; years: string; place: string; rel: RelKey; tone: Tone }
export const seekSamples = (l: Lang): SeekSample[] => isZh(l)
  ? [
    { called: '外婆', realName: '林秀英', faces: [AV.grandma], faceAge: 'elder', voice: 6, rel: 'grandmaM', tone: 'gentle', birthday: '03-15', years: '1938 — 2021', place: '苏州',
      story: '口头禅：不着急，慢慢来\n拿手菜：葱油饼配茉莉花茶\n常去的地方：老家的院子\n夏天傍晚，她总把最甜的那块西瓜留给我。' },
    { called: '阿远', realName: '陈远', faces: [AV.friend], faceAge: 'youth', voice: 9, rel: 'friend', tone: 'witty', birthday: '08-02', years: '1996 — 2020', place: '厦门',
      story: '口头禅：下次一起啊\n常去的地方：学校后面的海边\n爱听的歌：海阔天空\n毕业那年夏天，我们一下课就去游泳。' },
    { called: '外公', realName: '林国平', faces: [AV.grandpa], faceAge: 'elder', voice: 4, rel: 'grandpaM', tone: 'quiet', birthday: '11-20', years: '1935 — 2019', place: '苏州',
      story: '口头禅：慢工出细活\n他在院子里种了一架葡萄，常和外婆一起下棋、喝茶。' },
    { called: '爸爸', realName: '周明', faces: [AV.father], faceAge: 'elder', voice: 0, rel: 'father', tone: 'stern', birthday: '06-09', years: '1962 — 2023', place: '杭州',
      story: '口头禅：慢慢想，总会有办法\n他的书房里堆满了天文杂志。\n周末带我去山顶看星星，教我认北斗。' },
  ]
  : [
    { called: 'Grandma', realName: 'Lin Xiuying', faces: [AV.grandma], faceAge: 'elder', voice: 6, rel: 'grandma', tone: 'gentle', birthday: '03-15', years: '1938 — 2021', place: 'Suzhou',
      story: 'Catchphrase: No rush, take it slow\nSignature dish: scallion pancakes with jasmine tea\nFavorite place: the old courtyard\nOn summer evenings she always saved me the sweetest slice of melon.' },
    { called: 'Yuan', realName: 'Chen Yuan', faces: [AV.friend], faceAge: 'youth', voice: 9, rel: 'friend', tone: 'witty', birthday: '08-02', years: '1996 — 2020', place: 'Xiamen',
      story: 'Catchphrase: Next time, together\nFavorite place: the beach behind our school\nFavorite song: Boundless Oceans, Vast Skies\nThe summer we graduated, we went swimming every day after class.' },
    { called: 'Grandpa', realName: 'Lin Guoping', faces: [AV.grandpa], faceAge: 'elder', voice: 4, rel: 'grandpa', tone: 'quiet', birthday: '11-20', years: '1935 — 2019', place: 'Suzhou',
      story: 'Catchphrase: Good work takes time\nHe grew grapes in the courtyard and played chess with Grandma over tea.' },
    { called: 'Dad', realName: 'Zhou Ming', faces: [AV.father], faceAge: 'elder', voice: 0, rel: 'father', tone: 'stern', birthday: '06-09', years: '1962 — 2023', place: 'Hangzhou',
      story: 'Catchphrase: Think it through, there is always a way\nHis study was full of astronomy magazines.\nOn weekends he took me up the mountain to watch the stars.' },
  ]
