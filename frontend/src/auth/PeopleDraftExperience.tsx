import { useCallback, useEffect, useRef, useState } from 'react'
import { isZh, useI18n, WORLD_IDS, type WorldId } from '../i18n'
import { Sheet } from '../ui'
import { PrivacyStatement } from './PrivacyStatement'
import type { PostPhoto,ReadyPersonVoice,ConversationTone,VoiceTimbre,PersonVoiceContext } from '../model'
export type {ReadyPersonVoice,ConversationTone,VoiceTimbre,PersonVoiceContext} from '../model'
import { MediaError, preparePhotos, socialPhotoDataUrl } from '../serviceMedia'
import { usePersonPhotoMedia, personPhotos, type PhotoChoice } from '../servicePersonPhotos'
import { prepareGuestPersonDraft, readGuestJournal, recordGuestPersonDraft } from '../guestJournal'

export type ServicePerson = {
  id: string; displayName: string; relationship: string; story?: string; worldId: string
  realName?: string; calledMe?: string; birthMonthDay?: string; yearsText?: string; place?: string
  personality?:string[];life?:string[];unknowns?:string[];catchphrase?:string|null
  voiceId?:string|null;readyVoice?:ReadyPersonVoice|null;hasVoice?:boolean;voiceTarget?:{kind:'person_draft';id:string};conversationTone?:ConversationTone|null;voiceTimbre?:VoiceTimbre|null
  mediaLinks: unknown[]; mediaIds?: string[]; media?: PostPhoto[]; photoTarget?: { kind: 'person_draft'; id: string }; status: 'active'; version: number; createdAt: string; updatedAt: string
}
export type ServiceDraft = {
  accountId: string; sessionId: string; guestId?: string; onUnauthorized: () => void; onConfirmed?: (person: ServicePerson, world: WorldId) => void
}
type ServiceWorld = { id: string; code: WorldId; displayName: string; enabled: boolean; catalogVersion: number }
type ServicePreview = {
  id: string; draftId: string; draftVersion: number; status: string; renderMode: 'user_input'
  summary?: string; suggestedWorldId?: string; expiresAt: string
  suggestedPersonality?: string[]; suggestedCatchphrase?: string
}
type Journey = { preview: ServicePreview; worlds: ServiceWorld[]; selected: ServiceWorld }

type Fields = { displayName: string; relationship: string; story: string; realName: string; calledMe: string; birthMonthDay: string; yearsText: string; place: string }
type Field = keyof Fields
type Preferences={conversationTone:ConversationTone|null;voiceTimbre:VoiceTimbre|null}
type Draft = Partial<Fields> & Partial<Preferences> & { id: string; status: string; version: number; updatedAt: string; mediaIds?: string[]; media?: PostPhoto[];voiceId?:string|null;readyVoice?:ReadyPersonVoice|null;hasVoice?:boolean;voiceTarget?:{kind:'person_draft';id:string} }
type Editor = { id?: string; version?: number; fields: Fields; saved: Fields; photos: PhotoChoice[]; savedMediaIds: string[];preferences?:Preferences;savedPreferences?:Preferences;readyVoice?:ReadyPersonVoice|null }
type Purpose = 'privacy_notice' | 'private_story_storage'
type Policy = { id: string; kind: Purpose; version: number; documentUrl: string }
type Consent = {
  currentAuthorizationVersions: Record<Purpose, number>
  currentDecisions: { privacy_notice?: 'acknowledge'; private_story_storage?: 'grant' | 'revoke' }
  storyStorage: { allowed: boolean; authorizationVersion: number; privateFeedAllowed?: boolean }
  personPhotoStorage?: { allowed: boolean; authorizationVersion: number }
}
type Permission = { mode: 'save' | 'preview' | 'manage'; policies: Policy[]; consent: Consent }
type Envelope<T, M> = { data: T; meta?: M }
type Feedback = { kind: 'error' | 'status'; text: string }

const fields = ['displayName', 'relationship', 'story', 'realName', 'calledMe', 'birthMonthDay', 'yearsText', 'place'] as const
const emptyFields: Fields = { displayName: '', relationship: '', story: '', realName: '', calledMe: '', birthMonthDay: '', yearsText: '', place: '' }
const limits: Record<Field, number> = { displayName: 80, relationship: 40, story: 20_000, realName: 80, calledMe: 80, birthMonthDay: 5, yearsText: 120, place: 200 }

class DraftRequestError extends Error {
  constructor(readonly status: number) {
    super('The draft request failed.')
  }
}

function toFields(draft: Partial<Fields>): Fields {
  return Object.fromEntries(fields.map(field => [field, draft[field] ?? ''])) as Fields
}
const noPreferences:Preferences={conversationTone:null,voiceTimbre:null}
function preferences(draft:Partial<Preferences>):Preferences{if(draft.conversationTone!=null&&!['gentle','witty','quiet','stern'].includes(draft.conversationTone)||draft.voiceTimbre!=null&&!['warm','bright','deep'].includes(draft.voiceTimbre))throw new Error('Invalid person preferences');return {conversationTone:draft.conversationTone??null,voiceTimbre:draft.voiceTimbre??null}}
function voiceMetadata(draft:Pick<Draft,'readyVoice'|'voiceId'|'hasVoice'>):ReadyPersonVoice|null{const v=draft.readyVoice;if(v==null){if(draft.voiceId)throw new Error('Missing voice metadata');return null}if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id)||!Number.isSafeInteger(v.version)||v.version<1||!Number.isSafeInteger(v.durationMs)||v.durationMs<1||v.durationMs>30000||v.mimeType!=='audio/wav'||!Number.isSafeInteger(v.byteSize)||v.byteSize<46||(v.byteSize-44)%2!==0||v.byteSize>1440044||!/^[a-f0-9]{64}$/.test(v.sha256)||draft.voiceId!==undefined&&draft.voiceId!==v.id||draft.hasVoice===false)throw new Error('Invalid voice metadata');return v}

function policyLink(path: string) {
  const url = new URL(path, location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith('/v1/policies/')) {
    throw new Error('Unexpected policy document URL.')
  }
  return url.href
}

export function usePeopleDraft(
  service: ServiceDraft | undefined,
  onClose: () => void,
  initialStory: string,
  onPreview: (world: WorldId) => void,
  initialName = '',
) {
  const sessionId = service?.sessionId
  const renderedSession=useRef(sessionId);renderedSession.current=sessionId
  const onUnauthorized = service?.onUnauthorized
  const { lang } = useI18n()
  const zh = isZh(lang)
  const locale = zh ? 'zh-CN' : 'en'
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [editor, setEditorState] = useState<Editor>(() => ({
    fields: { ...emptyFields, displayName: initialName, story: initialStory }, saved: emptyFields, photos: [], savedMediaIds: [],
  }))
  const editorRef=useRef(editor);editorRef.current=editor
  function setEditor(value:Editor|((previous:Editor)=>Editor)){const next=typeof value==='function'?value(editorRef.current):value;editorRef.current=next;setEditorState(next)}
  const [journey, setJourney] = useState<Journey | null>(null)
  const [confirmationAttempted, setConfirmationAttempted] = useState(false)
  const [photoPermission, setPhotoPermissionState] = useState(false)
  const photoPermissionRef = useRef(photoPermission); photoPermissionRef.current = photoPermission
  function setPhotoPermission(value: boolean) { photoPermissionRef.current = value; setPhotoPermissionState(value) }
  const [picker, setPicker] = useState(false)
  const [permission, setPermissionState] = useState<Permission | null>(null)
  const permissionRef = useRef(permission); permissionRef.current = permission
  function setPermission(value: Permission | null) { permissionRef.current = value; setPermissionState(value) }
  const [discard, setDiscard] = useState<{ action: () => void; fromPicker: boolean } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const active = useRef<AbortController | null>(null)
  const retryKeys = useRef(new Map<string, string>())
  const preferredWorld = useRef<WorldId | undefined>(undefined)
  const permissionHeading = useRef<HTMLHeadingElement>(null)
  const photoState = usePersonPhotoMedia(service, editor.id ? [{ target: editor.id, media: editor.photos.filter((photo): photo is PostPhoto => typeof photo !== 'string') }] : [])
  const photosDirty = editor.photos.some(photo => typeof photo === 'string') || JSON.stringify(editor.photos.map(photo => typeof photo === 'string' ? '' : photo.id)) !== JSON.stringify(editor.savedMediaIds)
  const dirty = JSON.stringify(editor.preferences??noPreferences)!==JSON.stringify(editor.savedPreferences??noPreferences)||photosDirty || fields.some(field => editor.fields[field].trim() !== editor.saved[field])
  const canPreview = !!(editor.fields.displayName.trim() && editor.fields.story.trim())
  const labels: Record<Field, string> = zh
    ? { displayName: '称呼', relationship: '关系', story: '故事', realName: '名字', calledMe: 'TA 对你的称呼', birthMonthDay: '生日', yearsText: '年份', place: '地点' }
    : { displayName: 'Name', relationship: 'Relationship', story: 'Story', realName: 'Full name', calledMe: 'What they call you', birthMonthDay: 'Birthday', yearsText: 'Years', place: 'Places' }

  const api = useCallback(async <T, M = never>(path: string, signal: AbortSignal, options?: RequestInit) => {
    if (!sessionId||renderedSession.current!==sessionId||signal.aborted) throw new DOMException('Draft session changed','AbortError')
    const headers = new Headers(options?.headers)
    headers.set('X-Xijie-Expected-Session', sessionId)
    const response = await fetch(path, { ...options, headers, signal, credentials: 'same-origin', cache: 'no-store' })
    if(signal.aborted||renderedSession.current!==sessionId)throw new DOMException('Draft session changed','AbortError')
    if (!response.ok) throw new DraftRequestError(response.status)
    const result = await response.json() as Envelope<T, M>
    if(signal.aborted||renderedSession.current!==sessionId)throw new DOMException('Draft session changed','AbortError')
    if (result.data == null) throw new Error('Missing draft service data.')
    return result
  }, [sessionId])

  const run = useCallback(async (work: (signal: AbortSignal) => Promise<void>, message: string) => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    const { signal } = controller
    setBusy(true)
    setFeedback(null)
    try {
      await work(signal)
    } catch (error) {
      if (signal.aborted||renderedSession.current!==sessionId) return
      if ((error instanceof DraftRequestError || error instanceof MediaError) && error.status === 401) onUnauthorized?.()
      else { if (error instanceof MediaError && error.status === 403) setPhotoPermission(true)
        setFeedback({ kind: 'error', text: error instanceof MediaError && error.status === 403 ? (zh ? '请查阅隐私与 AI 使用声明后重试，所选照片已保留。' : 'Review the privacy and AI statement, then retry. Your selection is kept.') : message }) }
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }, [onUnauthorized,sessionId])

  const readList = useCallback(async (signal: AbortSignal, cursor?: string) => {
    const query = new URLSearchParams({ status: 'draft', limit: '20' })
    if (cursor) query.set('cursor', cursor)
    const result = await api<Draft[], { nextCursor: string | null }>('/v1/person-drafts?' + query, signal)
    if (signal.aborted) return
    setDrafts(previous => {
      if (!cursor) return result.data
      const known = new Set(previous?.map(draft => draft.id))
      return [...(previous ?? []), ...result.data.filter(draft => !known.has(draft.id))]
    })
    setNextCursor(result.meta?.nextCursor ?? null)
  }, [api])

  useEffect(() => () => {
    active.current?.abort()
    active.current = null
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !onUnauthorized) return
    const controller = new AbortController()
    const confirmVisibleSession = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data } = await api<{ id: string }>('/v1/sessions/current', controller.signal)
        if (!controller.signal.aborted && data.id !== sessionId) onUnauthorized()
      } catch (error) {
        if (!controller.signal.aborted && error instanceof DraftRequestError && error.status === 401) onUnauthorized()
      }
    }
    document.addEventListener('visibilitychange', confirmVisibleSession)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', confirmVisibleSession)
    }
  }, [api, onUnauthorized, sessionId])

  useEffect(() => {
    if (permission) permissionHeading.current?.focus()
  }, [permission])

  async function write<T>(path: string, method: 'POST' | 'PATCH', body: unknown, signal: AbortSignal, match?: number, acceptedKey?: string) {
    const json = JSON.stringify(body)
    const fingerprint = JSON.stringify([method, path, match, json])
    const key = acceptedKey ?? retryKeys.current.get(fingerprint) ?? crypto.randomUUID()
    retryKeys.current.set(fingerprint, key)
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': key }
    if (match !== undefined) headers['If-Match'] = '"v' + match + '"'
    const result = await api<T>(path, signal, { method, headers, body: json })
    return result.data
  }

  async function readConsent(signal: AbortSignal) {
    const result = await api<unknown[], Consent>('/v1/accounts/me/consents', signal)
    const meta = result.meta
    if (!meta?.currentAuthorizationVersions || !meta.currentDecisions
      || ['privacy_notice', 'private_story_storage'].some(purpose => !Number.isSafeInteger(meta.currentAuthorizationVersions[purpose as Purpose]) || meta.currentAuthorizationVersions[purpose as Purpose] < 0)
      || typeof meta.storyStorage?.allowed !== 'boolean'
      || meta.storyStorage.authorizationVersion !== meta.currentAuthorizationVersions.private_story_storage
      || meta.storyStorage.privateFeedAllowed !== undefined && typeof meta.storyStorage.privateFeedAllowed !== 'boolean') {
      throw new Error('Missing consent state.')
    }
    return meta
  }

  function storageAllowed(consent: Consent) {
    return consent.currentDecisions.privacy_notice === 'acknowledge'
      && consent.currentAuthorizationVersions.privacy_notice > 0
      && consent.currentDecisions.private_story_storage === 'grant'
      && consent.currentAuthorizationVersions.private_story_storage > 0
      && consent.storyStorage.allowed === true && consent.storyStorage.privateFeedAllowed === true
  }

  async function readPermission(mode: Permission['mode'], signal: AbortSignal, known?: Consent): Promise<Permission> {
    const [consent, result] = await Promise.all([
      known ?? readConsent(signal),
      api<Policy[]>('/v1/policies/current?locale=' + locale, signal),
    ])
    if (['privacy_notice', 'private_story_storage'].some(kind => !result.data.some(policy => policy.kind === kind))) {
      throw new Error('Missing current policy.')
    }
    const policies = result.data.filter(policy => policy.kind === 'privacy_notice' || policy.kind === 'private_story_storage')
    policies.forEach(policy => policyLink(policy.documentUrl))
    return { mode, consent, policies }
  }

  function showPermission(next: Permission) {
    setPermission(next)
  }

  function setField(field: Field, value: string) {
    setEditor(previous => ({ ...previous, fields: { ...previous.fields, [field]: value } }))
    setFeedback(null)
  }

  function openPicker(cursor?: string) {
    setPicker(true)
    void run(signal => readList(signal, cursor), zh ? '暂时无法读取草稿。' : 'Drafts could not be loaded.')
  }

  function closePicker() {
    active.current?.abort()
    active.current = null
    setBusy(false)
    setPicker(false)
    setFeedback(null)
  }

  function newDraft() {
    retryKeys.current.clear()
    setConflict(false)
    setFeedback(null)
    setPicker(false)
    setEditor({ fields: emptyFields, saved: emptyFields, photos: [], savedMediaIds: [] })
  }

  async function openDraft(id: string) {
    await run(async signal => {
      const { data } = await api<Draft>('/v1/person-drafts/' + id, signal)
      if (signal.aborted) return
      if (data.status !== 'draft') {
        setFeedback({ kind: 'error', text: zh ? '这份草稿已无法续写。' : 'This draft is no longer available to edit.' })
        return
      }
      retryKeys.current.clear()
      setConflict(false)
      setPicker(false)
      const saved = toFields(data)
      const photos = personPhotos(data)
      setEditor({ id: data.id, version: data.version, saved, fields: saved, photos, savedMediaIds: photos.map(photo => photo.id),preferences:preferences(data),savedPreferences:preferences(data),readyVoice:voiceMetadata(data) })
    }, zh ? '暂时无法打开这份草稿。' : 'This draft could not be opened.')
  }

  useEffect(() => {
    if (!service?.guestId) return
    void run(async signal => {
      const guest = await readGuestJournal()
      if (signal.aborted || guest?.guestId !== service.guestId || guest?.owner !== service.accountId
        || !guest?.personDraft || !('id' in guest.personDraft)) return
      const { data } = await api<Draft>('/v1/person-drafts/' + guest.personDraft.id, signal)
      if (signal.aborted || data.id !== guest.personDraft.id) return
      if (data.status !== 'draft') {
        setFeedback({ kind: 'error', text: zh ? '这份本机资料已进入账号。请返回后打开人物或记忆。' : 'This material is already in the account. Go back to open the person or memory.' })
        return
      }
      const saved = toFields(data), photos = personPhotos(data)
      setEditor({ id: data.id, version: data.version, saved, fields: saved, photos, savedMediaIds: photos.map(photo => photo.id), preferences: preferences(data), savedPreferences: preferences(data), readyVoice: voiceMetadata(data) })
    }, zh ? '暂时无法续写已带入的资料，请返回后重试。' : 'The transferred draft could not be opened. Go back and try again.')
  }, [sessionId, service?.guestId])

  function askBeforeLeaving(action: () => void, fromPicker = false) {
    if (busy) return
    if (!dirty) { action(); return }
    setPicker(false)
    setDiscard({ action, fromPicker })
  }

  function keepEditing() {
    if (discard?.fromPicker) setPicker(true)
    setDiscard(null)
  }

  function discardEdits() {
    if (!discard) return
    const { action, fromPicker } = discard
    setDiscard(null)
    if (fromPicker) setPicker(true)
    action()
  }

  async function rebaseDraft() {
    if (!editor.id) return
    await run(async signal => {
      const { data } = await api<Draft>('/v1/person-drafts/' + editor.id, signal)
      if (signal.aborted) return
      const saved = toFields(data)
      const merged = { ...saved }
      for (const field of fields) {
        if (editor.fields[field] !== editor.saved[field]) merged[field] = editor.fields[field]
      }
      const photos = personPhotos(data)
      setEditor({ id: data.id, version: data.version, saved, fields: merged, photos: photosDirty ? editor.photos : photos, savedMediaIds: photos.map(photo => photo.id),savedPreferences:preferences(data),preferences:{conversationTone:(editor.preferences??noPreferences).conversationTone!==(editor.savedPreferences??noPreferences).conversationTone?(editor.preferences??noPreferences).conversationTone:preferences(data).conversationTone,voiceTimbre:(editor.preferences??noPreferences).voiceTimbre!==(editor.savedPreferences??noPreferences).voiceTimbre?(editor.preferences??noPreferences).voiceTimbre:preferences(data).voiceTimbre},readyVoice:voiceMetadata(data) })
      setConflict(false)
      setFeedback({
        kind: 'status',
        text: zh ? '已更新为最新资料，并保留了你刚填写的内容。查看后可以继续保存。' : 'The latest saved details are loaded and your edits are kept. Review them, then save.',
      })
    }, zh ? '暂时无法加载最新资料，请稍后重试。' : 'The latest saved details could not be loaded. Please try again later.')
  }

  async function persistDraft(current: Editor, signal: AbortSignal, mode: 'save' | 'preview',forceCreate=false): Promise<Editor | undefined> {
    const body: Partial<Record<Field, string | null>>&Partial<Preferences> = {}
    for (const field of fields) {
      const value = current.fields[field].trim()
      if (current.id ? value !== current.saved[field] : value !== '') body[field] = value || null
    }
    const prefs=current.preferences??noPreferences,savedPrefs=current.savedPreferences??noPreferences
    if(current.id?prefs.conversationTone!==savedPrefs.conversationTone:prefs.conversationTone!==null)body.conversationTone=prefs.conversationTone
    if(current.id?prefs.voiceTimbre!==savedPrefs.voiceTimbre:prefs.voiceTimbre!==null)body.voiceTimbre=prefs.voiceTimbre
    const photoChanged = current.photos.some(photo => typeof photo === 'string') || JSON.stringify(current.photos.map(photo => typeof photo === 'string' ? '' : photo.id)) !== JSON.stringify(current.savedMediaIds)
    if (!Object.keys(body).length && !photoChanged && (!forceCreate||current.id)) return current
    const path = current.id ? '/v1/person-drafts/' + current.id : '/v1/person-drafts'
    let result: Draft
    let originalCreateKey: string | undefined
    let savedPreviousAttempt = false
    try {
      if (!current.id && service?.guestId) {
        const guest = await prepareGuestPersonDraft(service.guestId, service.accountId, body as Record<string, string | null>)
        const command = guest?.personDraft
        if (signal.aborted || !command) return
        if ('id' in command) {
          result = (await api<Draft>(path + '/' + command.id, signal)).data
          if (result.id !== command.id) throw new Error('Wrong guest draft')
          savedPreviousAttempt = true
        } else {
          originalCreateKey = command.key
          savedPreviousAttempt = JSON.stringify(command.body) !== JSON.stringify(body)
          result = await write<Draft>(path, 'POST', command.body, signal, undefined, command.key)
        }
      } else result = current.id && !Object.keys(body).length ? { id: current.id, version: current.version!, status: 'draft', updatedAt: '', ...current.saved,...prefs,readyVoice:current.readyVoice??null,voiceId:current.readyVoice?.id??null,hasVoice:!!current.readyVoice, media: current.photos.filter((photo): photo is PostPhoto => typeof photo !== 'string'), mediaIds: current.savedMediaIds } : await write<Draft>(path, current.id ? 'PATCH' : 'POST', body, signal, current.version)
      if (signal.aborted) return
      // Persist the stable target before any upload; a failed photo keeps the accepted text and selection.
      if(!/^[a-f0-9-]{36}$/i.test(result.id)||current.id&&result.id!==current.id||!Number.isSafeInteger(result.version)||result.version<1||result.status!=='draft')throw new Error('Invalid saved draft')
      if (service?.guestId && originalCreateKey) {
        await recordGuestPersonDraft(service.guestId, service.accountId, originalCreateKey, result.id)
        if (signal.aborted) return
      }
      current = { ...current, id: result.id, version: result.version, saved: toFields(result),preferences:preferences(result),savedPreferences:preferences(result),readyVoice:voiceMetadata(result) }
      setEditor(current)
      if (savedPreviousAttempt) {
        setFeedback({ kind: 'status', text: zh ? '已找回先前的草稿。当前更改仍在这里，请再次保存。' : 'The earlier draft was recovered. Your current changes are kept here. Save them again to continue.' })
        return
      }
      if (photoChanged) {
        if (!photoState.client) throw new Error('Missing photo session')
        const mediaIds: string[] = []
        for (const photo of current.photos) {
          if (typeof photo !== 'string') { if (!mediaIds.includes(photo.id)) mediaIds.push(photo.id) }
          else { for (const id of await photoState.client.upload(await preparePhotos([photo]), result.id)) if (!mediaIds.includes(id)) mediaIds.push(id) }
          if (signal.aborted) return
        }
        result = await write<Draft>('/v1/person-drafts/' + result.id, 'PATCH', { mediaIds }, signal, result.version)
      }
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof DraftRequestError && error.status === 412) {
        setConflict(true)
        setPermission(null)
        setFeedback({
          kind: 'error',
          text: zh ? '资料已在另一处修改，你刚填写的内容已保留。' : 'The draft changed elsewhere. Your edits are still here.',
        })
        return
      }
      if (error instanceof DraftRequestError && error.status === 403) {
        const next = await readPermission(mode, signal)
        if (signal.aborted) return
        if (storageAllowed(next.consent)) throw error
        showPermission(next)
        setFeedback({
          kind: 'error',
          text: zh ? '保存前请确认当前资料授权。' : 'Review the current data permission before saving.',
        })
        return
      }
      throw error
    }
    if (signal.aborted) return
    const saved = toFields(result)
    retryKeys.current.clear()
    const photos = personPhotos(result)
    const updated = { id: result.id, version: result.version, fields: saved, saved, photos, savedMediaIds: photos.map(photo => photo.id),preferences:preferences(result),savedPreferences:preferences(result),readyVoice:voiceMetadata(result) }
    setEditor(updated)
    setPermission(null)
    setConflict(false)
    if (mode === 'save') setFeedback({ kind: 'status', text: zh ? '草稿已保存。' : 'Draft saved.' })
    return updated
  }

  async function saveOrPreview(mode: 'save' | 'preview', signal: AbortSignal) {
    const updated = await persistDraft(editor, signal, mode)
    if (mode === 'save' || !updated?.id || updated.version === undefined || signal.aborted) return
    const path = '/v1/person-drafts/' + updated.id + '/previews'
    try {
      const { data } = await api<ServiceWorld[]>('/v1/worlds', signal)
      const worlds = data.filter(world => world.enabled && WORLD_IDS.includes(world.code))
      const preferred = worlds.find(world => world.code === preferredWorld.current)
      const accepted = await write<Pick<ServicePreview, 'id'>>(path, 'POST', {
        renderMode: 'user_input', ...(preferred ? { worldPreferenceId: preferred.id } : {}),
      }, signal, updated.version)
      const { data: preview } = await api<ServicePreview>(path + '/' + accepted.id, signal)
      if (signal.aborted) return
      if (preview.status !== 'succeeded' || preview.renderMode !== 'user_input' || preview.draftVersion !== updated.version) {
        setFeedback({ kind: 'error', text: zh ? '这次预览已失效，请重新寻找。' : 'This preview has expired. Start the search again.' })
        retryKeys.current.clear()
        return
      }
      if (signal.aborted) return
      const selected = worlds.find(world => world.id === preview.suggestedWorldId) ?? worlds[0]
      if (!selected) throw new Error('No world is available.')
      retryKeys.current.clear()
      setConfirmationAttempted(false)
      setJourney({ preview, worlds, selected })
      onPreview(selected.code)
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof DraftRequestError && error.status === 412) {
        setConflict(true)
        setFeedback({ kind: 'error', text: zh ? '这份草稿已在另一处修改，请先查看最新内容，再继续寻找。' : 'This draft changed elsewhere. View the latest saved details before searching.' })
        return
      }
      if (error instanceof DraftRequestError && error.status === 403) {
        const next = await readPermission('preview', signal)
        if (signal.aborted) return
        if (storageAllowed(next.consent)) throw error
        showPermission(next)
        return
      }
      throw error
    }
  }

  async function saveDraft(mode: 'save' | 'preview' = 'save', worldCode?: WorldId) {
    if (worldCode) preferredWorld.current = worldCode
    const invalid = fields.find(field => [...editor.fields[field].trim()].length > limits[field])
    if (invalid) {
      const limit = limits[invalid]
      setFeedback({ kind: 'error', text: zh ? labels[invalid] + '最多可填写 ' + limit + ' 个字符。' : labels[invalid] + ' can contain up to ' + limit + ' characters.' })
      return
    }
    if (editor.fields.birthMonthDay) {
      const value = editor.fields.birthMonthDay.trim()
      const match = /^(\d{2})-(\d{2})$/.exec(value)
      const month = Number(match?.[1]), day = Number(match?.[2])
      const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
      if (!match || !max || day < 1 || day > max) {
        setFeedback({ kind: 'error', text: zh ? '生日请填写有效的月-日，例如 03-15。' : 'Enter a valid MM-DD birthday, for example 03-15.' })
        return
      }
    }
    if (mode === 'preview' && !canPreview) {
      setFeedback({ kind: 'error', text: zh ? '请写下称呼和一句回忆。' : 'Enter a name and one memory.' })
      return
    }
    if (mode === 'save' && !dirty) return
    await run(async signal => {
      const consent = await readConsent(signal)
      if (signal.aborted) return
      if (storageAllowed(consent)) {
        await saveOrPreview(mode, signal)
      } else {
        const next = await readPermission(mode, signal, consent)
        if (!signal.aborted) showPermission(next)
      }
    }, mode === 'preview'
      ? (zh ? '暂时无法预览，已保留填写内容。请重试。' : 'The preview could not be loaded. Your entries are still here. Try again.')
      : (zh ? '草稿暂未保存，输入仍保留在这里。请重试。' : 'The draft could not be saved. Your edits are still here. Try again.'))
  }

  function selectWorld(id: string) {
    if (busy || confirmationAttempted || !journey) return
    const selected = journey.worlds.find(world => world.id === id)
    if (selected) setJourney({ ...journey, selected })
  }

  function closePreview() {
    if (busy) return
    setJourney(null)
    setFeedback(null)
  }

  function confirmPreview(onConfirmed: (person: ServicePerson, world: WorldId) => void, onInvalid: () => void, details?: { relationship: string; calledMe?: string | null }) {
    if (!journey || !editor.id) return
    const { preview, selected } = journey
    const path = '/v1/person-drafts/' + editor.id + '/confirm'
    void run(async signal => {
      setConfirmationAttempted(true)
      try {
        const person = await write<ServicePerson>(path, 'POST', { previewId: preview.id, worldId: selected.id, ...details }, signal, preview.draftVersion)
        if (!signal.aborted) onConfirmed(person, selected.code)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof DraftRequestError && (error.status === 409 || error.status === 412 || error.status === 403)) {
          setJourney(null)
          retryKeys.current.clear()
          onInvalid()
          if (error.status === 412) setConflict(true)
          setFeedback({ kind: 'error', text: error.status === 403
            ? (zh ? '资料授权已变更，请重新确认后再寻找。' : 'Your data permission changed. Review it before searching again.')
            : (zh ? '这次预览已无法确认，请重新寻找。' : 'This preview can no longer be confirmed. Start the search again.') })
          return
        }
        throw error
      }
    }, zh ? '暂时无法确认，请重试。' : 'This person could not be confirmed. Try again.')
  }

  async function openPermissions() {
    await run(async signal => {
      const next = await readPermission('manage', signal)
      if (!signal.aborted) {
        setPicker(false)
        showPermission(next)
      }
    }, zh ? '暂时无法读取资料授权。' : 'Data permissions could not be loaded.')
  }

  async function confirmAgreement() {
    if (!permission || permissionRef.current !== permission || permission.mode === 'manage' || renderedSession.current !== sessionId) return
    const mode = permission.mode
    await run(async signal => {
      const consent = await readConsent(signal)
      if (signal.aborted || renderedSession.current !== sessionId || permissionRef.current !== permission) return
      if (!storageAllowed(consent)) {
        setFeedback({ kind: 'error', text: zh ? '暂时无法确认同意是否保存，填写内容已保留，请点击「继续」重试。' : 'We could not confirm whether your agreement was saved. Your entries are kept; select Continue to retry.' })
        return
      }
      setPermission(null)
      await saveOrPreview(mode, signal)
    }, zh ? '同意已保存，下一步暂时无法完成。填写内容已保留，请返回后重试。' : 'Your agreement is saved, but the next step could not be completed. Your entries are kept; go back and retry.')
  }

  async function confirmPhotoAgreement() {
    if (!photoPermission || !photoPermissionRef.current || renderedSession.current !== sessionId) return
    await run(async signal => {
      const consent = await readConsent(signal)
      if (signal.aborted || renderedSession.current !== sessionId || !photoPermissionRef.current) return
      if (!storageAllowed(consent) || consent.personPhotoStorage?.allowed !== true || !(consent.personPhotoStorage.authorizationVersion > 0)) {
        setFeedback({ kind: 'error', text: zh ? '暂时无法确认同意是否保存，所选照片已保留，请点击「继续」重试。' : 'We could not confirm whether your agreement was saved. Your photos are kept; select Continue to retry.' })
        return
      }
      setPhotoPermission(false)
      setFeedback(null)
    }, zh ? '暂时无法确认照片保存状态，所选照片已保留。请返回后重试。' : 'Photo storage could not be confirmed. Your selection is kept; go back and retry.')
  }

  async function withdrawPermission() {
    if (!permission || permission.mode !== 'manage') return
    await run(async signal => {
      const { consent, policies, mode } = permission
      const policy = policies.find(entry => entry.kind === 'private_story_storage')
      if (!policy) throw new Error('Missing current policy.')
      try {
        await write('/v1/accounts/me/consents', 'POST', {
          policyId: policy.id, version: policy.version, purpose: 'private_story_storage', decision: 'revoke',
          expectedAuthorizationVersion: consent.currentAuthorizationVersions.private_story_storage,
        }, signal)
      } catch (error) {
        if (!signal.aborted && error instanceof DraftRequestError && (error.status === 412 || error.status === 409)) {
          const next = await readPermission(mode, signal)
          if (!signal.aborted) {
            showPermission(next)
            setFeedback({ kind: 'error', text: zh ? '授权状态有更新，请查看后再确认。' : 'Permissions changed. Review them before confirming.' })
          }
          return
        }
        throw error
      }
      if (signal.aborted) return
      const next = await readPermission('manage', signal)
      if (!signal.aborted) {
        showPermission(next)
        setFeedback({ kind: 'status', text: zh ? '保存授权已收回。' : 'Permission to save has been withdrawn.' })
      }
    }, zh ? '暂时无法完成操作，请重试。' : 'This action could not be completed. Try again.')
  }

  const dismissPermission = () => {
    if (busy) return
    setPermission(null)
    setFeedback(null)
    if (permission?.mode === 'manage') setPicker(true)
  }

  function closePhotoPermission() {
    active.current?.abort()
    active.current = null
    setBusy(false)
    setPhotoPermission(false)
  }

  async function ensureVoiceTarget():Promise<PersonVoiceContext>{
    if(!service||!sessionId||active.current)throw new DraftRequestError(409)
    let target:PersonVoiceContext|undefined
    await run(async signal=>{
      const consent=await readConsent(signal)
      if(!storageAllowed(consent)){showPermission(await readPermission('save',signal,consent));return}
      const saved=await persistDraft(editorRef.current,signal,'save',true)
      if(saved?.id&&!signal.aborted&&renderedSession.current===sessionId)target={accountId:service.accountId,sessionId,draftId:saved.id,onUnauthorized:service.onUnauthorized}
    },zh?'声音目标尚未保存，填写内容已保留。请确认资料授权后重试。':'The voice target has not been saved. Your entries are kept. Review storage permission and retry.')
    if(!target)throw new DraftRequestError(503)
    return target
  }

  async function bindVoice(id:string|null):Promise<void>{
    if(!service||!sessionId||active.current||id!==null&&!/^[a-f0-9-]{36}$/i.test(id))throw new DraftRequestError(409)
    const current=editorRef.current
    if(!current.id||!current.version)throw new DraftRequestError(409)
    const expectedVersion=current.version
    let bound=false
    await run(async signal=>{
      const data=await write<Draft>('/v1/person-drafts/'+current.id,'PATCH',{voiceId:id},signal,expectedVersion)
      if(data.id!==current.id||data.status!=='draft'||!Number.isSafeInteger(data.version)||data.version<expectedVersion)throw new Error('Invalid voice acknowledgement')
      const confirmed=(await api<Draft>('/v1/person-drafts/'+current.id,signal)).data
      if(confirmed.id!==current.id||confirmed.status!=='draft'||confirmed.version<data.version)throw new Error('Invalid voice readback')
      const actual=voiceMetadata(confirmed)
      setEditor(previous=>({...previous,version:confirmed.version,readyVoice:actual,saved:toFields(confirmed),savedPreferences:preferences(confirmed)}))
      if((actual?.id??null)!==id)throw new DraftRequestError(409)
      retryKeys.current.clear();bound=true;setFeedback(null)
    },zh?'还没能确认声音是否保存，原选择已保留，请再次保存。':'We could not confirm whether the voice sample was saved. Your selection is kept; please save again.')
    if(!bound)throw new DraftRequestError(503)
  }

  return {
    agreementContext: service && sessionId ? { sessionId, onUnauthorized: () => { if (renderedSession.current === sessionId) service.onUnauthorized() } } : undefined,
    confirmAgreement, confirmPhotoAgreement,
    voiceContext:service&&sessionId&&editor.id?{accountId:service.accountId,sessionId,draftId:editor.id,onUnauthorized:service.onUnauthorized}:undefined,
    readyVoice:editor.readyVoice??null,ensureVoiceTarget,bindVoice,
    conversationTone:editor.preferences?.conversationTone??null,voiceTimbre:editor.preferences?.voiceTimbre??null,
    setConversationTone:(value:ConversationTone|null)=>{if(!busy)setEditor(previous=>({...previous,preferences:{...(previous.preferences??noPreferences),conversationTone:value}}))},
    setVoiceTimbre:(value:VoiceTimbre|null)=>{if(!busy)setEditor(previous=>({...previous,preferences:{...(previous.preferences??noPreferences),voiceTimbre:value}}))},
    photos: editor.photos, photoSources: editor.photos.map(photo => typeof photo === 'string' ? photo : photoState.urls[photo.id] ?? ''),
    addPhotos: (files: File[]) => run(async signal => {
      if (editor.photos.length + files.length > 6) throw new Error('Photo limit')
      const sources = await Promise.all(files.map(socialPhotoDataUrl))
      if (!signal.aborted) setEditor(previous => ({ ...previous, photos: [...previous.photos, ...sources.filter((source, index) => sources.indexOf(source) === index && !previous.photos.includes(source))] }))
    }, zh ? '最多选择六张 JPEG、PNG 或 WebP 照片，每张不超过 10 MiB。无法读取的照片未加入。' : 'Choose up to six JPEG, PNG or WebP photos, each up to 10 MiB. Unreadable photos were not added.'),
    removePhoto: (index: number) => { if (!busy) setEditor(previous => ({ ...previous, photos: previous.photos.filter((_, i) => i !== index) })) },
    mainPhoto: (index: number) => { if (!busy) setEditor(previous => ({ ...previous, photos: [previous.photos[index], ...previous.photos.filter((_, i) => i !== index)] })) },
    fields: editor.fields, canPreview, dirty, busy, conflict, feedback, picker, permission, discard,
    journey, confirmationAttempted, selectWorld, closePreview, confirmPreview,
    photoPermission: photoPermission && service ? service : undefined, closePhotoPermission,
    hasLayer: picker || !!permission || !!discard || photoPermission,
    drafts, nextCursor, openPicker, closePicker, setField, openPermissions, dismissPermission,
    permissionHeading, withdrawPermission,
    saveDraft, rebaseDraft, keepEditing, discardEdits,
    close: () => askBeforeLeaving(onClose),
    newDraft: () => askBeforeLeaving(newDraft, true),
    openDraft: (id: string) => askBeforeLeaving(() => void openDraft(id), true),
  }
}

type DraftController = ReturnType<typeof usePeopleDraft>

export function DraftFeedback({ feedback }: { feedback: Feedback | null }) {
  return feedback && <p className="text-[13px] leading-relaxed" role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>
}

export function PeopleDraftSheets({ draft, night }: { draft: DraftController; night: boolean }) {
  const { lang } = useI18n()
  const zh = isZh(lang)
  const secondary = 'seek-panel-control min-h-11 rounded-full px-4 py-2.5 text-[14px] disabled:opacity-50'
  const primary = 'btn-dark min-h-11 rounded-full px-4 py-2.5 text-[14px] font-semibold disabled:opacity-50'
  if (draft.photoPermission && draft.agreementContext) return <Sheet dark={night} onClose={draft.closePhotoPermission} title={zh ? '隐私与 AI 使用声明' : 'Privacy and AI statement'}><PrivacyStatement key={draft.agreementContext.sessionId} {...draft.agreementContext} onAgreed={draft.confirmPhotoAgreement} /><DraftFeedback feedback={draft.feedback} /></Sheet>
  if (draft.discard) return (
    <Sheet key="discard" dark={night} onClose={draft.keepEditing} title={zh ? '放弃未保存的修改？' : 'Discard unsaved changes?'}
      footer={<div className="flex gap-3">
        <button type="button" onClick={draft.keepEditing} className={secondary + ' flex-1'}>{zh ? '继续编辑' : 'Keep editing'}</button>
        <button type="button" onClick={draft.discardEdits} className={primary + ' flex-1'}>{zh ? '放弃修改' : 'Discard changes'}</button>
      </div>}>
      <p className="text-sm leading-relaxed">{zh ? '这次输入还没有保存到草稿。' : 'These edits have not been saved to the draft.'}</p>
    </Sheet>
  )

  if (draft.permission) {
    const { consent, policies, mode } = draft.permission
    const askStorage = consent.currentDecisions.private_story_storage !== 'grant'
    if (mode !== 'manage') return <Sheet key="permission" dark={night} onClose={draft.dismissPermission} title={zh ? '隐私与 AI 使用声明' : 'Privacy and AI statement'}>
      {draft.agreementContext && <PrivacyStatement key={draft.agreementContext.sessionId} {...draft.agreementContext} onAgreed={draft.confirmAgreement} />}
      <DraftFeedback feedback={draft.feedback} />
    </Sheet>
    return (
      <Sheet key="permission" dark={night} onClose={draft.dismissPermission} title={zh ? '隐私与 AI 使用声明' : 'Privacy and AI statement'}
        footer={!askStorage ? <button type="button" className={secondary + ' w-full'} onClick={() => void draft.withdrawPermission()} disabled={draft.busy}>
          {zh ? '收回保存授权' : 'Withdraw permission to save'}
        </button> : undefined}>
        <div className="space-y-4 text-sm leading-relaxed">
          <p tabIndex={-1} ref={draft.permissionHeading}>
            {askStorage
                ? (zh ? '当前未授权保存文字草稿。' : 'Permission to save text drafts is off.')
                : (zh ? '当前已授权保存文字草稿。收回后仍可查看已有草稿。' : 'Permission to save is on. Previously saved drafts remain available after withdrawal.')}
          </p>
          <ul className="flex flex-wrap gap-4">
            {policies.map(policy => <li key={policy.id}>
              <a href={policyLink(policy.documentUrl)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {policy.kind === 'privacy_notice' ? (zh ? '资料使用说明' : 'Data notice') : (zh ? '文字资料保存说明' : 'Text draft storage purpose')}
              </a>
            </li>)}
          </ul>
          <DraftFeedback feedback={draft.feedback} />
        </div>
      </Sheet>
    )
  }

  if (!draft.picker) return null
  const dates = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <Sheet key="drafts" dark={night} onClose={draft.closePicker} title={zh ? '寻找草稿' : 'Search drafts'}
      footer={<div className="flex gap-3">
        <button type="button" onClick={() => void draft.openPermissions()} disabled={draft.busy} className={secondary + ' flex-1'}>{zh ? '资料授权' : 'Data permissions'}</button>
        {(draft.dirty || draft.conflict) && <button type="button" onClick={() => void (draft.conflict ? draft.rebaseDraft() : draft.saveDraft())} disabled={draft.busy} className={secondary + ' flex-1'}>{draft.conflict ? (zh ? '读取最新草稿' : 'Load latest draft') : (zh ? '保存草稿' : 'Save draft')}</button>}
        <button type="button" onClick={draft.newDraft} disabled={draft.busy} className={primary + ' flex-1'}>{zh ? '新建草稿' : 'New draft'}</button>
      </div>}>
      <div className="space-y-3">
        <DraftFeedback feedback={draft.feedback} />
        {draft.busy && <p role="status" className="text-sm">{zh ? '正在读取草稿…' : 'Loading drafts…'}</p>}
        {draft.feedback?.kind === 'error' && <button type="button" disabled={draft.busy} className={secondary} onClick={() => draft.openPicker()}>{zh ? '重试' : 'Retry'}</button>}
        {draft.drafts?.length === 0 && !draft.busy && <p className="text-sm">{zh ? '还没有保存过草稿。' : 'No drafts saved yet.'}</p>}
        {draft.drafts?.map(item => <button type="button" key={item.id} onClick={() => draft.openDraft(item.id)}
          disabled={draft.busy} className="seek-panel-control min-h-14 w-full rounded-2xl px-4 py-3 text-left disabled:opacity-50">
          <span className="block break-words">{item.displayName || (zh ? '未命名草稿' : 'Untitled draft')}</span>
          <span className="mt-1 block text-xs text-ink-soft">{dates.format(new Date(item.updatedAt))}</span>
        </button>)}
        {draft.nextCursor && <button type="button" disabled={draft.busy} className={secondary} onClick={() => draft.openPicker(draft.nextCursor!)}>{zh ? '加载更多草稿' : 'Load more drafts'}</button>}
      </div>
    </Sheet>
  )
}
