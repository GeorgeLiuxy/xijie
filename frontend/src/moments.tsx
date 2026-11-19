import { useContext, useEffect, useRef, useState } from 'react'
import {useContentReports} from './ContentReports'
import { useI18n, isZh, type WorldId } from './i18n'
import { type Author, type Person, type Post, type User } from './model'
import { socialPhotoDataUrl } from './serviceMedia'
import { PrivatePhoto, type ReadPrivatePhoto } from './PrivatePhoto'
import { WORLDS, WorldScene } from './worlds'
import { DeepField, Lens } from './fx'
import { I, NightCtx, Sheet, Toast, haptic, useStatusTone } from './ui'
import { PersonalGiftScene } from './gifts/PersonalGiftScene'
import type { GiftOpenOptions } from './gifts/types'
import { ReceivedGiftsShelf } from './gifts/ReceivedGiftsShelf'
import { useNativeBack } from './mobile/back'
import './moments-theme.css'

/* ------------------------------------------------------------------ *
 * 空间：像微信朋友圈一样的「诸世界动态」
 *   · 记忆回响：联系人以自己的口吻引用你珍藏的记忆（明确标注 AI 生成）
 *   · 世界时令：各个世界的法则与时令
 *   · 你的动态：你发出的文字与照片，联系人会来点赞、评论
 * 从资料卡进入时，只看这一位的空间。
 * ------------------------------------------------------------------ */

type Commenting = { postId: number; to?: Author; toName?: string; replyToCommentId?: string }
const commentDraftKey = ({ postId, to, replyToCommentId }: Commenting) => JSON.stringify([postId, to ?? null, replyToCommentId ?? null])

export function Moments({ user, people, posts, filter, giftOwner, focusGiftId, onGift, onReceivedGift, onMySpace, onBack, onPost, onRemove, readPhoto, onLike, onComment, onProfile, onWorld }: {
  user: User; people: Person[]; posts: Post[]; filter?: number | 'me'
  onBack?: () => void; onPost?: (text: string, images: string[]) => void | boolean | Promise<boolean>; onLike: (postId: number) => void | boolean | Promise<boolean>
  onRemove?: (postId: number, expectedVersion?: number) => Promise<boolean>; readPhoto?: ReadPrivatePhoto
  onComment: (postId: number, text: string, to?: Author, replyToCommentId?: string) => void | boolean | Promise<boolean>; onProfile: (id: number) => void; onWorld: (w: WorldId) => void
  giftOwner?: string; focusGiftId?: string; onGift?: (personId: number, options?: GiftOpenOptions) => void
  onReceivedGift?: (id: string) => void; onMySpace?: (trigger: HTMLButtonElement) => void
}) {
  const { t, lang } = useI18n()
  const [unavailableText, setUnavailableText] = useState('')
  useEffect(() => {
    if (!unavailableText) return
    const timer = window.setTimeout(() => setUnavailableText(''), 2500)
    return () => clearTimeout(timer)
  }, [unavailableText])
  const night = useContext(NightCtx)
  const [scrolled, setScrolled] = useState(false)
  useStatusTone(night ? 'light' : 'dark')
  const [compose, setCompose] = useState(false)
  const [composeText, setComposeText] = useState('')
  const [composeImgs, setComposeImgs] = useState<string[]>([])
  const [pending, setPending] = useState<'post' | 'comment' | 'remove' | null>(null)
  const operation = useRef<'post' | 'comment' | 'remove' | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [readingPhotos, setReadingPhotos] = useState(false)
  const [photoFailures, setPhotoFailures] = useState(0)
  const readingPhotosRef = useRef(false)
  const [menu, setMenu] = useState<number | null>(null)
  const [commenting, setCommenting] = useState<Commenting | null>(null)
  const [removing, setRemoving] = useState<Post | null>(null)
  const [viewing, setViewing] = useState<{ postId: number; index: number } | null>(null)
  const viewed = viewing ? posts.find(post => post.id === viewing.postId) : undefined
  const photoCount = viewed?.media?.length || viewed?.images.length || 0
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const draftKey = commenting ? commentDraftKey(commenting) : null
  const draft = draftKey ? commentDrafts[draftKey] ?? '' : ''
  const scRef = useRef<HTMLDivElement>(null)
  const nativeBackRoot = useRef<HTMLDivElement>(null)
  useNativeBack(() => {
    if (operation.current) return true
    if (commenting) setCommenting(null)
    else if (menu != null) setMenu(null)
    else return false
    return true
  }, commenting != null || menu != null, 30, nativeBackRoot)
  const isFeed = filter == null
  const self = filter === 'me'
  const zh = isZh(lang)
  const owner = typeof filter === 'number' ? people.find((p) => p.id === filter) : undefined
  const list = posts.filter((p) => isFeed || p.author === filter || typeof filter === 'number' && p.relatedPersonId === filter).sort((a, b) => b.at - a.at)
  /* 「赞 / 评论」菜单与按钮同高：若这一行贴近底部（全局空间有悬浮导航），先把它滚上来再展开 */
  const openMenu = (id: number | null, anchor?: HTMLElement) => {
    setMenu(id)
    const sc = scRef.current
    if (id == null || !anchor || !sc) return
    const over = anchor.getBoundingClientRect().bottom + (isFeed ? 128 : 28) - sc.getBoundingClientRect().bottom
    if (over > 0) sc.scrollBy({ top: over, behavior: 'smooth' })
  }

  const nameOf = (a: Author): string => (a === 'me' ? user.nick : typeof a === 'number' ? people.find((p) => p.id === a)?.name ?? '' : t(`world.${a.slice(6)}`))
  const ago = (ts: number) => {
    const d = Date.now() - ts
    if (d < 60e3) return t('ago.now')
    if (d < 3600e3) return t('ago.min', { n: Math.floor(d / 60e3) })
    if (d < 86400e3) return t('ago.hour', { n: Math.floor(d / 3600e3) })
    if (d < 172800e3) return t('ago.yesterday')
    return t('ago.day', { n: Math.floor(d / 86400e3) })
  }
  const sendComment = async () => {
    const tx = draft.trim(); if (!tx || !commenting || !draftKey || !posts.some((p) => p.id === commenting.postId)) return
    if (operation.current) return
    operation.current = 'comment'; setPending('comment')
    try {
      if (await onComment(commenting.postId, tx, commenting.to, commenting.replyToCommentId) === false || !mounted.current) return
      setCommentDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next })
      setCommenting(null); haptic(6)
    } catch { if (mounted.current) setUnavailableText(zh ? '还没能确认是否保存成功，内容已保留，请重试。' : 'We could not confirm whether it was saved. Your draft is kept; please retry.') }
    finally { operation.current = null; if (mounted.current) setPending(null) }
  }
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || readingPhotosRef.current) return
    const selected = Array.from(files).slice(0, 9 - composeImgs.length)
    if (!selected.length) return
    readingPhotosRef.current = true
    setReadingPhotos(true); setPhotoFailures(0)
    const urls: string[] = []
    let failures = 0
    try {
      for (const file of selected) {
        try { urls.push(await socialPhotoDataUrl(file)) } catch { failures += 1 }
      }
      // The draft belongs to Moments, so closing the sheet does not discard late image reads.
      if (mounted.current) { setComposeImgs((current) => [...current, ...urls].slice(0, 9)); setPhotoFailures(failures) }
    } finally {
      readingPhotosRef.current = false
      if (mounted.current) setReadingPhotos(false)
    }
  }
  const publishPost = async () => {
    const text = composeText.trim()
    if (operation.current || readingPhotosRef.current || (!text && !composeImgs.length)) return
    if (!onPost) {
      setUnavailableText(zh ? '暂时无法发表，内容已保留，请稍后再试。' : 'Posting is unavailable right now. Your draft is kept; please try again later.')
      return
    }
    operation.current = 'post'; setPending('post')
    try {
      if (await onPost(text, composeImgs) === false || !mounted.current) return
      setComposeText(''); setComposeImgs([]); setPhotoFailures(0)
      setCompose(false); haptic([8, 30, 8])
    } catch { if (mounted.current) setUnavailableText(zh ? '还没能确认是否保存成功，内容已保留，请重试。' : 'We could not confirm whether it was saved. Your draft is kept; please retry.') }
    finally { operation.current = null; if (mounted.current) setPending(null) }
  }
  const openComposer = () => { setMenu(null); setCompose(true) }
  const removePost = async () => {
    if (!removing || !onRemove || operation.current) return
    operation.current = 'remove'; setPending('remove')
    try { if (await onRemove(removing.id, removing.serverVersion) && mounted.current) { setRemoving(null); haptic(6) } }
    catch { if (mounted.current) setUnavailableText(zh ? '还没能确认是否删除成功，请重试。' : 'We could not confirm whether it was deleted. Please retry.') }
    finally { operation.current = null; if (mounted.current) setPending(null) }
  }
  const modal = compose || !!commenting || !!removing || !!viewed

  return (
    <div ref={nativeBackRoot} className="absolute inset-0 overflow-hidden bg-canvas">
      <div ref={scRef} inert={modal} onScroll={isFeed ? undefined : (e) => setScrolled(e.currentTarget.scrollTop > 230)} onClick={() => menu != null && setMenu(null)} className="absolute inset-x-0 top-0 bottom-[var(--app-safe-bottom)] overflow-y-auto scroll-quiet">
        {isFeed ? <header className="moments-feed-header">
          <h1>{t('nav.space')}</h1>
          <div className="moments-feed-actions">
            {onMySpace && <button className="moments-feed-own" onClick={event => onMySpace(event.currentTarget)}>{zh ? '我的空间' : 'My space'}</button>}
            <button className="moments-feed-publish btn-dark" onClick={openComposer} aria-label={t('moments.post')}>
              <I.Camera aria-hidden /><span>{zh ? t('moments.post') : t('moments.post.publish')}</span>
            </button>
          </div>
        </header> : <>
          <div className="moments-cover relative h-[318px] overflow-hidden">
            {owner ? <WorldScene world={owner.world} className="moments-world-art" /> : <DeepField variant="swirl" dim={0.22} className="moments-cosmos" />}
            {owner && giftOwner && onGift && <PersonalGiftScene owner={giftOwner} person={owner} focusReceiptId={focusGiftId}
              onOpen={(receiptId) => onGift(owner.id, { tab: 'receipts', receiptId })} />}
            {!owner && (
              <div className="moments-cover-title absolute left-5 right-auto max-w-[calc(100%-40px)] top-[calc(var(--app-status-height)+60px)] rounded-2xl px-4 py-3">
                <h1 className="font-serif text-[32px] leading-none tracking-[0.16em]">{self ? (zh ? '我的空间' : 'My space') : t('nav.space')}</h1>
                <div className="mt-2 font-mono text-[9.5px] tracking-[0.2em] text-ink-soft">{self ? 'PERSONAL SPACE' : `MOMENTS · ${t('moments.micro')}`}</div>
              </div>
            )}
          </div>
          <div className="relative -mt-[48px] px-5 flex items-end justify-end gap-3">
            <span className="mb-[54px] min-w-0 truncate rounded-full bg-paper px-3 py-0.5 font-serif text-[21px] text-ink">{owner ? owner.name : user.nick}</span>
            {owner ? <Lens world={owner.world} avatar={owner.avatar} name={owner.name} size={76} dark={night} glow /> : <MeAvatar nick={user.nick} size={76} />}
          </div>
        </>}

        <div className={isFeed ? 'pb-[140px]' : 'mt-2 pb-[140px]'}>
          {self && giftOwner && onReceivedGift && <ReceivedGiftsShelf owner={giftOwner} onOpen={onReceivedGift}/>}
          {list.length === 0 && <p className="px-10 py-12 text-center text-[13.5px] leading-relaxed text-muted">{self ? (isZh(lang) ? '这里会留下你发布的日常，也可以陈列收到的心意。' : 'A place for your own moments and the gifts you choose to display.') : owner ? t('moments.ofEmpty') : t('moments.empty')}</p>}
          {list.map((p, i) => (
            <PostItem key={p.id} p={p} index={i} people={people} user={user} nameOf={nameOf} ago={ago} zh={zh} menuOpen={menu === p.id}
              readPhoto={readPhoto} onPhoto={(index) => { setMenu(null); setViewing({ postId: p.id, index }) }} onRemove={onRemove && p.author === 'me' && p.kind === 'mine' ? () => { setMenu(null); setRemoving(p) } : undefined}
              onMenu={openMenu} onLike={() => onLike(p.id)} onComment={(to, replyToCommentId, toName) => setCommenting({ postId: p.id, to, replyToCommentId, toName: toName ?? (to != null ? nameOf(to) : undefined) })}
              onProfile={onProfile} onWorld={onWorld} />
          ))}
        </div>
      </div>

      {isFeed && <div aria-hidden className="moments-nav-shade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[calc(var(--app-safe-bottom)+104px)]" />}

      {!isFeed && <div inert={modal} className={`absolute inset-x-0 top-0 z-20 pt-[var(--app-status-height)] pb-2 px-4 flex items-center justify-between transition-colors duration-300 ${scrolled ? 'bg-canvas' : ''}`}>
        <div className="absolute inset-x-0 top-0 h-[var(--app-status-height)] bg-canvas pointer-events-none" aria-hidden />
        {onBack
          ? <button autoFocus={self} onClick={onBack} aria-label={t('common.back')} className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full bg-paper text-ink active:bg-cloud"><I.Back className="h-5 w-5" /></button>
          : <span className="w-11 shrink-0" />}
        <span className={`min-w-0 truncate px-2 font-serif text-[18px] text-ink transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!scrolled}>{owner ? t('moments.of', { name: owner.name }) : self ? (zh ? '我的空间' : 'My space') : t('nav.space')}</span>
        {!owner
          ? <button onClick={openComposer} aria-label={t('moments.post')} className="h-11 w-11 shrink-0 flex items-center justify-center rounded-full bg-paper text-ink active:bg-cloud"><I.Camera className="h-[22px] w-[22px]" weight="fill" /></button>
          : <span className="w-11 shrink-0" />}
      </div>}

      {commenting && (
        <div className="absolute inset-0 z-[90]">
          {/* 与 Sheet 同一套遮罩与不透明底：盖住底部导航，不让图标透出来 */}
          <div className="moments-comment-scrim absolute inset-0 animate-fade" onClick={() => { if (!operation.current) setCommenting(null) }} />
          <div role="dialog" aria-modal="true" aria-label={t('moments.comment')} className="app-composer absolute inset-x-0 bottom-0 bg-canvas shadow-2xl rounded-t-[24px] px-3 pt-3 pb-[30px] animate-sheet"
            onKeyDown={e => {
              if (e.key === 'Escape' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.stopPropagation(); if (!operation.current) setCommenting(null) }
            }}>
            <div className="flex items-center gap-2">
              <button disabled={!!pending} onClick={() => setCommenting(null)} aria-label={t('common.close')} className="h-11 w-11 shrink-0 grid place-items-center rounded-full bg-cloud text-ink active:bg-sky-tint"><I.X className="h-4 w-4" /></button>
              <input autoFocus disabled={!!pending} value={draft} onChange={(e) => {
                const value = e.target.value.slice(0, 200)
                if (draftKey) setCommentDrafts((current) => ({ ...current, [draftKey]: value }))
              }} onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void sendComment() }
              }}
                aria-label={commenting.toName ? t('moments.reply.ph', { name: commenting.toName }) : t('moments.comment.ph')}
                placeholder={commenting.toName ? t('moments.reply.ph', { name: commenting.toName }) : t('moments.comment.ph')}
                className="min-w-0 flex-1 h-11 rounded-full bg-paper ring-1 ring-line px-4 text-[15.5px] text-ink outline-none placeholder:text-muted focus:ring-sky/40" />
              <button onClick={() => { void sendComment() }} disabled={!!pending || !draft.trim()} aria-busy={pending === 'comment'} className="h-11 shrink-0 px-5 rounded-full btn-dark text-[15px] font-medium active:scale-95 transition-transform disabled:opacity-60">{t('talk.send')}</button>
            </div>
          </div>
        </div>
      )}
      {compose && <Composer text={composeText} imgs={composeImgs} pending={pending === 'post'} readingPhotos={readingPhotos} photoFailures={photoFailures}
        onText={setComposeText} onRemovePhoto={(index) => setComposeImgs((current) => current.filter((_, i) => i !== index))}
        onAddPhotos={addPhotos} onClose={() => { if (!operation.current) setCompose(false) }} onPost={() => { void publishPost() }} />}
      {removing && <Sheet title={zh ? '删除这条动态？' : 'Delete this post?'} onClose={() => { if (!operation.current) setRemoving(null) }}
        footer={<div className="flex gap-2.5"><button disabled={pending === 'remove'} onClick={() => setRemoving(null)} className="flex-1 rounded-full ring-1 ring-line py-3 text-[16px] text-ink disabled:opacity-50">{t('del.cancel')}</button><button disabled={pending === 'remove'} aria-busy={pending === 'remove'} onClick={() => { void removePost() }} className="rounded-full bg-coral text-white px-7 py-3 text-[15px] font-semibold disabled:opacity-50">{t('del.confirm')}</button></div>}>
        <p className="text-[14px] leading-relaxed text-ink-soft">{zh ? '动态、配图及其下的评论会一起删除。' : 'This post, its photos and comments will be removed.'}</p>
      </Sheet>}
      {viewed && viewing && photoCount > 0 && <Sheet tall title={zh ? `照片 ${viewing.index + 1} / ${photoCount}` : `Photo ${viewing.index + 1} / ${photoCount}`} onClose={() => setViewing(null)}>
        {viewed.media?.[viewing.index] && readPhoto ? <PrivatePhoto postId={viewed.id} photo={viewed.media[viewing.index]} read={readPhoto} contain label={zh ? '查看照片' : 'View photo'} className="h-[58vh] w-full rounded-xl" />
          : viewed.images[viewing.index] && <img src={viewed.images[viewing.index]} alt={zh ? '发布的照片' : 'Posted photo'} className="h-[58vh] w-full rounded-xl object-contain" />}
        {photoCount > 1 && <div className="mt-4 flex items-center justify-between gap-3"><button disabled={viewing.index === 0} onClick={() => setViewing({ ...viewing, index: viewing.index - 1 })} className="min-h-11 rounded-full bg-paper px-5 text-[14px] text-ink ring-1 ring-line disabled:opacity-40">{zh ? '上一张' : 'Previous'}</button><button disabled={viewing.index === photoCount - 1} onClick={() => setViewing({ ...viewing, index: viewing.index + 1 })} className="min-h-11 rounded-full bg-paper px-5 text-[14px] text-ink ring-1 ring-line disabled:opacity-40">{zh ? '下一张' : 'Next'}</button></div>}
      </Sheet>}
      {unavailableText && <Toast text={unavailableText} dark={night} />}
    </div>
  )
}

/* ------------------------------- 一条动态 ------------------------------- */
function PostItem({ p, index, people, user, nameOf, ago, zh, menuOpen, onMenu, onLike, onComment, onProfile, onWorld, readPhoto, onPhoto, onRemove }: {
  p: Post; index: number; people: Person[]; user: User; nameOf: (a: Author) => string; ago: (ts: number) => string; zh: boolean; menuOpen: boolean
  onMenu: (id: number | null, anchor?: HTMLElement) => void; onLike: () => void | boolean | Promise<boolean>; onComment: (to?: Author, replyToCommentId?: string, toName?: string) => void; onProfile: (id: number) => void; onWorld: (w: WorldId) => void
  readPhoto?: ReadPrivatePhoto; onPhoto: (index: number) => void; onRemove?: () => void
}) {
  const { t } = useI18n()
  const reports=useContentReports()
  const liking = useRef(false), mounted = useRef(true)
  const [likePending, setLikePending] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const like = async () => {
    if (liking.current) return
    liking.current = true; setLikePending(true)
    try { if (await onLike() !== false && mounted.current) { onMenu(null); haptic(6) } }
    catch { /* The service adapter retains and reports unknown results. */ }
    finally { liking.current = false; if (mounted.current) setLikePending(false) }
  }
  const person = typeof p.author === 'number' ? people.find((x) => x.id === p.author) : undefined
  const world = typeof p.author === 'string' && p.author.startsWith('world:') ? (p.author.slice(6) as WorldId) : undefined
  const historicalWorld = p.world ?? person?.world ?? world
  const code = historicalWorld ? WORLDS[historicalWorld].code : ''
  const liked = p.likes.includes('me')
  const label = p.kind === 'movement' ? zh ? '迁居记录' : 'Relocation record' : p.kind === 'echo' || p.kind === 'status' ? t('moments.label.echo') : p.kind === 'world' ? t('moments.label.world') : ''
  const openAuthor = person ? () => onProfile(person.id) : world ? () => onWorld(world) : undefined
  const authorName = p.authorName ?? nameOf(p.author)
  const sep = zh ? '，' : ', '
  return (
    <article className="flex gap-3 px-4 py-4 border-b border-line/70 rise-in" style={{ animationDelay: `${Math.min(index, 6) * 0.04}s` }}>
      {openAuthor ? <button onClick={openAuthor} className="shrink-0 h-fit rounded-full active:scale-95 transition-transform" aria-label={authorName}>
        {person ? <Lens world={historicalWorld ?? person.world} avatar={person.avatar} name={authorName} size={46} /> : world && <WorldBadge world={world} />}
      </button> : <MeAvatar nick={authorName || user.nick} size={46} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {openAuthor ? <button onClick={openAuthor} className="min-w-0 text-left [overflow-wrap:anywhere] text-[15.5px] font-semibold text-sky-deep">{authorName}</button>
            : <span className="min-w-0 [overflow-wrap:anywhere] text-[15.5px] font-semibold text-sky-deep">{authorName}</span>}
          {code && <span className="shrink-0 font-mono text-[9.5px] tracking-[0.16em] text-muted">{code}</span>}
        </div>
        {p.kind === 'status'
          ? <p className="mt-1 font-serif italic text-[19px] leading-relaxed text-ink [overflow-wrap:anywhere]">“{p.text}”</p>
          : <p className="mt-1 text-[15.5px] leading-relaxed text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{p.text}</p>}
        {p.quote && (
          <div className="mt-2 rounded-xl bg-sun-tint px-3.5 py-2.5">
            <div className="font-mono text-[9.5px] tracking-[0.18em] text-ink">{t('moments.memory')}</div>
            <p className="mt-1 font-serif text-[15.5px] leading-relaxed text-ink [overflow-wrap:anywhere]">{p.quote}</p>
          </div>
        )}
        {p.media?.length && readPhoto ? p.media.length === 1
          ? <PrivatePhoto postId={p.id} photo={p.media[0]} read={readPhoto} label={zh ? '查看第 1 张照片' : 'View photo 1'} onOpen={() => onPhoto(0)} className="mt-2.5 h-52 w-[74%] rounded-xl ring-1 ring-black/5" />
          : <div className="mt-2.5 grid w-[88%] grid-cols-3 gap-1.5">{p.media.slice(0, 9).map((photo, i) => <PrivatePhoto key={photo.id} postId={p.id} photo={photo} read={readPhoto} label={zh ? `查看第 ${i + 1} 张照片` : `View photo ${i + 1}`} onOpen={() => onPhoto(i)} className="aspect-square w-full rounded-lg" />)}</div>
          : <>{p.images.length === 1 && <button onClick={() => onPhoto(0)} aria-label={zh ? '查看第 1 张照片' : 'View photo 1'} className="mt-2.5 block h-52 w-[74%] overflow-hidden rounded-xl ring-1 ring-black/5"><img src={p.images[0]} alt="" className="h-full w-full object-cover" /></button>}
            {p.images.length > 1 && <div className="mt-2.5 grid w-[88%] grid-cols-3 gap-1.5">{p.images.slice(0, 9).map((s, i) => <button key={i} onClick={() => onPhoto(i)} aria-label={zh ? `查看第 ${i + 1} 张照片` : `View photo ${i + 1}`} className="aspect-square w-full overflow-hidden rounded-lg"><img src={s} alt="" className="h-full w-full object-cover" /></button>)}</div>}</>}

        <div className="mt-2.5 flex items-center gap-2">
          <span className="text-[12px] text-muted shrink-0">{ago(p.at)}</span>
          {label && <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-sky/10 px-2 py-[2px] text-[10.5px] text-sky-deep"><I.Spark className="h-3 w-3 shrink-0" /><span className="truncate">{label}</span></span>}
          <span className="flex-1" />
          <div className="relative shrink-0">
            {menuOpen && (
              <div className="absolute right-12 top-1/2 z-10 -translate-y-1/2 flex items-center rounded-xl bg-paper text-ink ring-1 ring-line shadow-lg overflow-hidden pop-in origin-right" onClick={(e) => e.stopPropagation()}>
                <button disabled={likePending} aria-busy={likePending} onClick={() => { void like() }} className="min-h-11 flex items-center gap-1.5 whitespace-nowrap px-3 text-[13.5px] active:bg-cloud disabled:opacity-60"><I.Heart className="h-[17px] w-[17px] text-sky-deep" weight={liked ? 'fill' : 'duotone'} />{liked ? t('moments.unlike') : t('moments.like')}</button>
                <span className="h-5 w-px bg-line" />
                <button onClick={() => { onComment(); onMenu(null) }} className="min-h-11 flex items-center gap-1.5 whitespace-nowrap px-3 text-[13.5px] active:bg-cloud"><I.Comment className="h-[17px] w-[17px]" />{t('moments.comment')}</button>
                {onRemove && <><span className="h-5 w-px bg-line" /><button onClick={onRemove} className="min-h-11 whitespace-nowrap px-3 text-[13.5px] text-coral active:bg-cloud">{t('talk.delete')}</button></>}
                {reports&&p.serverId&&<><span className="h-5 w-px bg-line"/><button onClick={()=>{onMenu(null);reports.open({subjectType:'post',subjectId:p.serverId!})}} className="min-h-11 whitespace-nowrap px-3 text-[13.5px] text-ink active:bg-cloud">{zh?'举报':'Report'}</button></>}
              </div>
            )}
            <button onClick={(e) => { e.stopPropagation(); onMenu(menuOpen ? null : p.id, e.currentTarget) }} aria-label={`${t('moments.like')} / ${t('moments.comment')}`} aria-expanded={menuOpen} className="-my-1.5 h-11 w-11 rounded-lg text-sky-deep flex items-center justify-center active:scale-95 transition-transform"><span className="h-7 w-10 rounded-lg bg-cloud grid place-items-center"><I.More className="h-5 w-5" /></span></button>
          </div>
        </div>

        {(p.likes.length > 0 || p.comments.length > 0) && (
          <div className="mt-2.5 overflow-hidden rounded-xl bg-paper text-[14px]">
            {p.likes.length > 0 && <div className="flex items-start gap-1.5 px-3 py-2"><I.Heart className="mt-[3px] h-[15px] w-[15px] shrink-0 text-sky-deep" weight="fill" /><span className="min-w-0 text-sky-deep leading-relaxed [overflow-wrap:anywhere]">{p.likes.map(nameOf).join(sep)}</span></div>}
            {p.likes.length > 0 && p.comments.length > 0 && <div className="h-px bg-line/80" />}
            {p.comments.length > 0 && (
              <div className="space-y-1 px-3 py-2">
                {p.comments.map((c) => {
                  const CommentLine = c.author === 'me' ? 'p' : 'button'
                  return <div key={c.id} className="flex items-start gap-1">
                    <CommentLine onClick={c.author === 'me' ? undefined : () => onComment(c.author, c.serverId, c.authorName)} className="block min-w-0 flex-1 text-left leading-relaxed [overflow-wrap:anywhere]">
                      <span className="font-medium text-sky-deep">{c.authorName ?? nameOf(c.author)}</span>
                      {c.to != null && <><span className="text-ink-soft"> {t('moments.replyTo')} </span><span className="font-medium text-sky-deep">{c.toName ?? nameOf(c.to)}</span></>}
                      <span className="text-ink">{zh ? '：' : ': '}{c.text}</span>
                      {c.ai && <span className="ml-1.5 rounded px-1 align-[1px] font-mono text-[9px] tracking-[0.1em] text-sky-deep ring-1 ring-sky/40">AI</span>}
                    </CommentLine>
                    {reports && c.serverId && <button type="button" aria-label={zh ? '举报这条评论' : 'Report this comment'}
                      className="grid min-h-8 w-9 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-cloud"
                      onClick={() => reports.open({ subjectType: 'comment', subjectId: c.serverId! })}><I.More className="h-4 w-4" /></button>}
                  </div>
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

/* ------------------------------- 发动态 ------------------------------- */
function Composer({ text, imgs, pending, readingPhotos, photoFailures, onText, onRemovePhoto, onAddPhotos, onClose, onPost }: {
  text: string; imgs: string[]; pending: boolean; readingPhotos: boolean; photoFailures: number
  onText: (text: string) => void; onRemovePhoto: (index: number) => void; onAddPhotos: (files: FileList | null) => Promise<void>
  onClose: () => void; onPost: () => void
}) {
  const { t, lang } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  return (
    <Sheet tall onClose={onClose} title={t('moments.post')}
      footer={<button onClick={onPost} disabled={pending || readingPhotos || (!text.trim() && !imgs.length)} aria-busy={pending} className="w-full h-13 py-3.5 rounded-full btn-dark text-[16px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-60">{pending ? isZh(lang) ? '正在发布…' : 'Publishing…' : t('moments.post.publish')}</button>}>
      <textarea autoFocus disabled={pending} value={text} onChange={(e) => onText([...e.target.value].slice(0, 500).join(''))} rows={5} placeholder={t('moments.post.ph')} className="w-full resize-none bg-transparent outline-none text-[17px] leading-relaxed text-ink placeholder:text-muted" />
      <div className="mt-3 grid grid-cols-3 gap-2">
        {imgs.map((s, i) => (
          <div key={i} className="relative aspect-square overflow-hidden rounded-xl">
            <img src={s} alt="" className="h-full w-full object-cover" />
            <button disabled={pending} onClick={() => onRemovePhoto(i)} aria-label={t('talk.delete')} className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/55 text-white flex items-center justify-center"><I.X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {imgs.length < 9 && (
          <button onClick={() => input.current?.click()} disabled={pending || readingPhotos} className="aspect-square rounded-xl border border-dashed border-line flex flex-col items-center justify-center gap-1 text-muted active:bg-black/[0.03] disabled:opacity-50">
            <I.Photos className="h-7 w-7" /><span className="text-[12px]">{t('moments.post.photos')}</span>
          </button>
        )}
      </div>
      {(readingPhotos || photoFailures > 0) && <p role="status" className="mt-3 text-[13px] leading-relaxed text-ink-soft">
        {readingPhotos ? (isZh(lang) ? '正在读取照片…' : 'Reading photos…')
          : isZh(lang) ? `${photoFailures} 张照片未能读取，请重新选择。` : `${photoFailures} photo${photoFailures === 1 ? '' : 's'} could not be read. Please choose again.`}
      </p>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { void onAddPhotos(e.target.files); e.target.value = '' }} />
    </Sheet>
  )
}

/* ------------------------------- 头像 ------------------------------- */
function MeAvatar({ nick, size }: { nick: string; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-2xl font-serif text-[#294542]" style={{ width: size, height: size, fontSize: size * 0.42, background: 'linear-gradient(145deg, #fff8ea 0%, #ecdcbc 100%)', boxShadow: 'inset 0 0 0 1px rgba(235,201,149,0.85), 0 12px 26px -14px rgba(0,0,0,0.55)' }}>{nick.slice(0, 1)}</span>
  )
}
function WorldBadge({ world }: { world: WorldId }) {
  return (
    <span className="relative block h-[46px] w-[46px] overflow-hidden rounded-full" style={{ boxShadow: `0 0 0 1px rgba(235,201,149,0.75), 0 0 16px -2px ${WORLDS[world].glow}` }}>
      <img src={WORLDS[world].thumb} alt="" className="h-full w-full object-cover" />
      <span className="absolute inset-0" style={{ background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.5), transparent 45%), radial-gradient(circle at 75% 80%, rgba(0,0,0,0.5), transparent 58%)' }} />
    </span>
  )
}
