import { useEffect, useRef, useState } from 'react'
import { isZh, useI18n } from '../i18n'
import { permissionIntentKey as intentKey, type ProcessingPurpose, type Purpose } from './consentPurposes'

type Policy = { id: string; kind: string; version: number; documentUrl: string; privateFeedProcessingEnabled?: boolean }
type Decision = { policyId: string; version: number; purpose: Purpose; decision: 'acknowledge' | 'grant' | 'revoke'; expectedAuthorizationVersion: number }
type Step = { key: string; body: Decision }
type Intent = { decision: 'grant' | 'revoke'; steps: Step[] }
type Permission = {
  policies: Record<Purpose, Policy>
  documents: Record<Purpose, string>
  versions: Record<Purpose, number>
  noticeAcknowledged: boolean
  allowed: boolean
  hasGrant: boolean
}
class PermissionError extends Error { constructor(readonly status: number) { super('Permission request failed') } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

function storedIntent(sessionId: string, purpose: ProcessingPurpose): Intent | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(intentKey(sessionId, purpose)) ?? 'null') as Intent | null
    if (value && ['grant', 'revoke'].includes(value.decision) && Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 2
      && value.steps.every(step => uuid.test(step.key) && uuid.test(step.body?.policyId) && natural(step.body.version) && step.body.version > 0
        && natural(step.body.expectedAuthorizationVersion) && (step.body.purpose === 'privacy_notice' && step.body.decision === 'acknowledge'
          || step.body.purpose === purpose && step.body.decision === value.decision))) return value
  } catch { /* A failed local read never establishes permission. */ }
}
function rememberIntent(sessionId: string, purpose: ProcessingPurpose, value?: Intent) {
  try {
    if (value) sessionStorage.setItem(intentKey(sessionId, purpose), JSON.stringify(value))
    else sessionStorage.removeItem(intentKey(sessionId, purpose))
  } catch { /* The open panel also retains its accepted operation identity. */ }
}

type PermissionProps = { sessionId: string; onUnauthorized: () => void; onChanged?: () => void }
export function AiTextPermission(props: PermissionProps) { return <><TextPermission {...props} purpose="ai_text_processing" /><TextPermission {...props} purpose="production_model_execution" /><TextPermission {...props} purpose="person_voice_calls" /><ChatReplySpeechPermission {...props}/></> }
export function ChatReplySpeechPermission(props: PermissionProps) { return <TextPermission {...props} purpose="private_chat_reply_speech" /> }
export function TextStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="private_story_storage" /> }
export function PhotoStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="private_photo_storage" /> }
export function PersonPhotoStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="private_person_photo_storage" /> }
export function VoiceCallsPermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_voice_calls" /> }
export function PersonVoiceStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="private_person_voice_storage" /> }
export function GiftStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="virtual_gift_storage" /> }
export function GiftReturnsPermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_gift_returns" /> }
export function GiftPhotoStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="gift_delivery_photo_storage" /> }
export function LetterStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="private_letter_storage" /> }
export function LetterRepliesPermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_letter_replies" /> }
export function GatherRepliesPermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_gather_replies" /> }
export function ChatPhotoStoragePermission(props: PermissionProps) { return <TextPermission {...props} purpose="private_chat_photo_storage" /> }
export function ChatImageRepliesPermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_chat_image_replies" /> }
export function WorldActionPermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_world_actions" /> }
export function StoryBranchesPermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_story_branches" /> }
export function OfflineLifePermission(props: PermissionProps) { return <TextPermission {...props} purpose="person_offline_life" /> }
function TextPermission({ sessionId, onUnauthorized, onChanged, purpose }: PermissionProps & { purpose: ProcessingPurpose }) {
  const { lang } = useI18n(), zh = isZh(lang)
  const voiceCalls=purpose==='person_voice_calls',voiceStorage=purpose==='private_person_voice_storage'
  const chatSpeech=purpose==='private_chat_reply_speech'
  const production = purpose === 'production_model_execution'
  const worldActions = purpose === 'person_world_actions'
  const storyBranches=purpose==='person_story_branches',offlineLife=purpose==='person_offline_life',storyControls=storyBranches||offlineLife
  const chatPhoto = purpose === 'private_chat_photo_storage', chatReplies = purpose === 'person_chat_image_replies'
  const chatCopy = chatSpeech ? {
    region: zh ? '私聊合成朗读授权' : 'AI reply speech permission',
    title: zh ? '私聊合成朗读' : 'AI reply speech',
    detail: zh ? '查看合成朗读说明' : 'Read the speech policy',
    grant: zh ? '允许合成朗读' : 'Allow AI reply speech',
    revoke: zh ? '撤回合成朗读授权' : 'Withdraw AI reply speech permission',
    description: zh ? '你主动选择合成一条已保存的回应时，只将这条回应的文字发送给 OpenAI，生成标准 AI 合成语音。它不会使用人物原声或麦克风。生成的音频随这条回应私人保存。撤回后停止新处理和播放。文字保存不受影响。'
      : 'If you choose to synthesize a saved reply, only that reply’s text is sent to OpenAI for a standard AI voice. The original voice and microphone are not used. The audio is kept privately with the reply. Withdrawal stops new synthesis and playback. Text storage remains available.',
  } : voiceCalls ? {
    region:zh?'实时 AI 语音通话授权':'Live AI voice call permission',title:zh?'AI 语音通话':'Live AI voice calls',detail:zh?'查看实时语音处理说明':'Read live voice processing policy',
    grant:zh?'允许实时 AI 语音通话':'Allow live AI voice calls',revoke:zh?'撤回实时语音通话授权':'Withdraw live voice call permission',
    description:zh?'使用已开放的语音通话时，你主动接通后，OpenAI 会使用本次麦克风声音和必要的人物资料，生成标准 AI 合成语音。不使用或克隆保存的原声，也不读取旧聊天、珍藏或长期记忆。西界不保存本次录音或逐字稿，保留通话起止、时长和声音设置等必要记录，不会把通话加入后续聊天或自动记忆。需要同意文字保存和 AI 服务；挂断、退出账号或撤回后会停止。影像入口仍为照片预览。':'When you connect to an available voice call, OpenAI uses your microphone and necessary character details to generate a standard AI voice. Saved original voice samples are not used or cloned, and past chats, treasures and long-term memories are excluded. Elysium does not save recordings or word-for-word transcripts, only necessary records such as call start, end, duration and voice settings. The call does not become future chat context or automatic memory. Text storage and AI service agreement are required. Hanging up, signing out or withdrawing stops the call. The image entry remains a photo preview.',
  } : purpose==='private_person_voice_storage' ? {
    region:zh?'人物声音保存授权':'Person voice storage permission',title:zh?'保存与聆听人物声音':'Save and listen to a person voice sample',detail:zh?'查看人物声音保存说明':'Read person voice storage policy',
    grant:zh?'允许人物声音保存':'Allow person voice storage',revoke:zh?'撤回人物声音保存授权':'Withdraw person voice storage permission',
    description:zh?'你主动录制或选择并确认的原声，会保存在这位 TA 的资料里，供你回听。不发送给 AI，也不用于模仿 TA 的声音或 AI 通话。你可以移除原声，或单独撤回这项同意；撤回后会停止保存和播放，普通文字和照片不受影响。':'The original voice sample you record or choose and confirm is saved with this character for you to listen to. It is not sent to AI, used to imitate their voice or used in AI calls. You can remove the sample or withdraw this choice separately. Withdrawing stops saving and playback without changing ordinary text or photos.',
  } : production ? {
    region:zh?'AI 服务授权':'AI service permission',title:zh?'AI 服务':'AI service',detail:zh?'查看 AI 服务说明':'Read the AI service explanation',
    grant:zh?'允许 AI 服务':'Allow AI service',revoke:zh?'撤回 AI 服务同意':'Withdraw AI service agreement',
    description:zh?'使用已开放的 AI 功能时，OpenAI 只会使用你已同意、且当前功能需要的人物资料、文字或照片。各项资料范围仍可单独管理，人物资料里没有的信息按「尚不了解」处理。过去的同意不会自动扩展到新的使用范围。撤回后停止新的 AI 处理和未完成结果的保存，已有内容仍可查看、导出或删除。':'Available AI features use OpenAI only with the character details, text or photos you have agreed to share for that feature. You can still manage each type of use separately. Missing profile details are treated as unknown. Earlier choices do not automatically cover new uses. Withdrawing stops new AI processing and unfinished results from being saved; existing content can still be viewed, exported or deleted.',
  } : storyBranches ? {
    region:zh?'故事分支授权':'Story branch permission',title:zh?'平行故事线':'Parallel storylines',detail:zh?'查看故事分支说明':'Read story branch policy',
    grant:zh?'允许平行故事线':'Allow parallel storylines',revoke:zh?'撤回故事分支授权':'Withdraw story branch permission',
    description:zh?'你可以从主线当前末端另开故事线。分支保留分开前的共同虚拟经历和当时场景，之后各自继续，不合并结局。OpenAI 使用该人物获准的资料、珍藏、这条线的对话和共同经历回应。分支里的聊天不会整理进主线的长期记忆。需要文字保存和 AI 文字处理授权；撤回停止未完成的生成，不会自动重做已停止的操作。':'Create a storyline from the current end of the main story. It retains the shared virtual past and its starting scene; later events stay separate and endings do not merge. OpenAI uses this character’s authorized profile, treasures, branch conversations and shared experiences. Branch chats do not become real-world long-term memory. Text storage and AI text processing are required. Withdrawal stops unfinished generation without reviving old tasks.',
  } : offlineLife ? {
    region:zh?'离线生活授权':'Offline life permission',title:zh?'不在时的生活':'Life while you are away',detail:zh?'查看离线生活说明':'Read offline life policy',
    grant:zh?'允许离线生活':'Allow offline life',revoke:zh?'撤回离线生活授权':'Withdraw offline life permission',
    description:zh?'授权后仍需为人物明确开启。开启后，OpenAI 每天最多为该人物生成一次主线中的有限虚拟经历，回来可在聊天回顾。不消费资产、不替你发消息、不迁居或公开发布，也不连续生成下一段。可随时暂停；暂停或撤回阻止未完成处理，再次开启不会补跑旧任务。需要文字保存、AI 文字处理和世界行动授权。':'After permission, enable each character explicitly. OpenAI may create at most one bounded virtual experience per day in their main story, for you to revisit in chat. It never spends assets, sends messages as you, relocates or publishes, or triggers another episode. Pause at any time. Pausing or withdrawal stops unfinished work; enabling again does not catch up missed tasks. Text storage, AI text processing and world action permissions are required.',
  } : worldActions ? {
    region: zh ? '世界行动授权' : 'World action permission', title: zh ? '世界行动与虚拟经历' : 'World actions and virtual experiences',
    detail: zh ? '查看世界行动说明' : 'Read world action policy',
    grant: zh ? '允许世界行动' : 'Allow world actions', revoke: zh ? '撤回世界行动授权' : 'Withdraw world action permission',
    description: zh ? '另行允许后，OpenAI 会依据你当前的私聊文字、该人物获准的资料、对话和记忆，以及TA 所在的虚拟世界，判断你是否明确请求一次立即、有限的虚拟行动。确认发生的虚拟故事会保存为经历，并可用于该人物后续回应；不会自动珍藏，也不会当作现实经历。需要文字保存和 AI 文字处理授权。本授权不执行迁居、赠礼、支付、资产操作、其他人物行动或离线自动生活，也不改变画面和背包。撤回停止未完成处理，再次同意不会自动重做已停止的操作；已保存文字仍按文字保存授权读取，导出和删除不受影响。' : 'Separately allow OpenAI to use your current direct-chat text, this character’s authorized profile, conversations and memories, and the current virtual world to identify explicit requests for one immediate, limited virtual action. Confirmed narrative events and virtual experience memories are saved and may inform this character’s later replies. They are not automatically treasured or treated as real experiences. Text storage and AI text processing permissions are required. This does not perform relocation, gifts, payments, asset operations, actions by other characters or autonomous offline activity, or change the scene or backpack. Withdrawal stops unfinished processing; allowing again does not resume old tasks. Saved text remains readable with text storage permission. Export and deletion remain available.',
  } : chatPhoto ? {
    region: zh ? '聊天照片保存授权' : 'Chat photo storage permission', title: zh ? '聊天照片保存' : 'Chat photo storage',
    detail: zh ? '查看聊天照片保存说明' : 'Read chat photo storage policy',
    grant: zh ? '允许保存聊天照片' : 'Allow chat photo storage', revoke: zh ? '撤回聊天照片保存授权' : 'Withdraw chat photo storage permission',
    description: zh ? '允许后，你在私聊中主动发送的单张照片会作为当前账号的私人图片保存和显示。本授权不会开启 AI 看图；发送还需文字保存和独立 AI 看图回应授权。撤回后停止照片上传和查看，其余获准文字仍可查看；重新允许可以再查看仍保存着的照片，不会自动继续已停止的上传或生成。已有资料仍可导出或删除。' : 'Privately store and display individual photos you choose to send in direct chats. This permission does not enable AI image processing; sending also requires text storage and separate AI image reply permission. Withdrawal stops photo uploads and normal reads, while other authorized text remains available. Allowing again restores access to valid saved photos without reviving old uploads or tasks. Export and deletion remain available.',
  } : chatReplies ? {
    region: zh ? 'AI看图回应授权' : 'AI image reply permission', title: zh ? 'AI 看图回应' : 'AI image replies',
    detail: zh ? '查看 AI 看图回应说明' : 'Read AI image reply policy',
    grant: zh ? '允许AI看图回应' : 'Allow AI image replies', revoke: zh ? '撤回AI看图回应授权' : 'Withdraw AI image reply permission',
    description: zh ? '另行允许后，OpenAI 会使用你本次主动发送的单张照片、TA 的必要资料和所在世界，生成一次看图回应。不读取旧私聊、珍藏或长期记忆。照片和这次看图回应不会带入后续文字聊天，也不会用于整理记忆、推荐珍藏或围坐回应。需要文字保存和聊天照片保存授权；撤回停止未完成回应，再次同意不会自动重做已停止的操作，已保存回应仍按文字保存授权读取。' : 'Separately allow OpenAI to use the single photo you send, necessary character text and the current virtual world for one image reply. Old chats, treasures and long-term memories are excluded. Neither the photo nor its reply enters later text AI, automatic memory, treasure suggestions or gathering context. Text and chat photo storage permissions are required. Withdrawal stops unfinished replies; allowing again does not revive old tasks. Saved replies remain readable with text storage permission.',
  } : undefined
  const gatherReplies = purpose === 'person_gather_replies'
  const returns = purpose === 'person_gift_returns'
  const gift = purpose === 'virtual_gift_storage'
  const giftPhoto = purpose === 'gift_delivery_photo_storage'
  const letterStorage = purpose === 'private_letter_storage', letterReplies = purpose === 'person_letter_replies'
  const letterPurpose = letterStorage || letterReplies
  const storage = purpose === 'private_story_storage'
  const personPhoto = purpose === 'private_person_photo_storage'
  const photo = purpose === 'private_photo_storage' || personPhoto
  const [photoUnavailable, setPhotoUnavailable] = useState(false)
  const [permission, setPermission] = useState<Permission>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [noticeChecked, setNoticeChecked] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<Intent | undefined>(() => storedIntent(sessionId, purpose))
  const lifetime = useRef<AbortController | null>(null)
  const reading = useRef(0)
  const writing = useRef(false)
  const writeRevision = useRef(0)
  const noticeRevision = useRef('')
  const callbacks = useRef(onUnauthorized); callbacks.current = onUnauthorized
  const changed = useRef(onChanged); changed.current = onChanged
  const session = useRef(sessionId); session.current = sessionId

  async function request(path: string, signal: AbortSignal, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set('X-Xijie-Expected-Session', sessionId)
    const response = await fetch(path, { ...init, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new PermissionError(response.status)
    return response
  }

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    writing.current = false; setBusy(false); noticeRevision.current = ''
    setPermission(undefined); setLoading(true); setMessage(''); setNoticeChecked(false)
    setPending(storedIntent(sessionId, purpose))
    void load(controller.signal)
    const refresh = () => { if (!writing.current && document.visibilityState !== 'hidden') void load(controller.signal, true) }
    const interval = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh); window.addEventListener('xijie:consents-changed', refresh); document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort(); reading.current++; writeRevision.current++
      window.clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('xijie:consents-changed', refresh); document.removeEventListener('visibilitychange', refresh)
    }
  }, [sessionId, lang, purpose])

  async function load(signal = lifetime.current?.signal, quiet = false) {
    if (!signal || signal.aborted) return false
    const revision = ++reading.current
    const live = () => !signal.aborted && session.current === sessionId && revision === reading.current
    if (!quiet) setLoading(true)
    try {
      const locale = zh ? 'zh-CN' : 'en'
      const [policyResponse, consentResponse] = await Promise.all([
        request('/v1/policies/current?locale=' + locale, signal), request('/v1/accounts/me/consents?limit=1', signal),
      ])
      const policies = (await policyResponse.json()).data as Policy[]
      const meta = (await consentResponse.json()).meta as {
        currentAuthorizationVersions: Record<string, number>; currentDecisions: Record<string, string>
        voiceCalls?: {allowed:boolean;authorizationVersion:number}
        chatReplySpeech?: {allowed:boolean;authorizationVersion:number}
        personVoiceStorage?: {allowed:boolean;authorizationVersion:number}
        productionModelExecution?: { allowed: boolean; authorizationVersion: number }
        aiTextProcessing: { allowed: boolean; authorizationVersion: number; privateFeedProcessingAllowed?: boolean }
        storyStorage?: { allowed: boolean; authorizationVersion: number; privateFeedAllowed?: boolean }
        giftStorage?: { allowed: boolean; authorizationVersion: number }
        giftReturns?: { allowed: boolean; authorizationVersion: number }
        giftPhotoStorage?: { allowed: boolean; authorizationVersion: number }
        letterStorage?: { allowed: boolean; authorizationVersion: number }
        letterReplies?: { allowed: boolean; authorizationVersion: number }
        gatherReplies?: { allowed: boolean; authorizationVersion: number }
        chatPhotoStorage?: { allowed: boolean; authorizationVersion: number }
        chatImageReplies?: { allowed: boolean; authorizationVersion: number }
        worldActionProcessing?: { allowed: boolean; authorizationVersion: number; historicalWorldEventsAllowed?: boolean }
        storyBranches?: { allowed: boolean; authorizationVersion: number }
        offlineLife?: { allowed: boolean; authorizationVersion: number }
        personPhotoStorage?: { allowed: boolean; authorizationVersion: number }
        photoStorage?: { allowed: boolean; authorizationVersion: number }
      }
      if ((chatSpeech || voiceCalls || voiceStorage || production || photo || gift || returns || giftPhoto || letterPurpose || gatherReplies || chatPhoto || chatReplies || worldActions || storyControls) && Array.isArray(policies) && !policies.some(item => item.kind === purpose)) {
        if (live()) { setPhotoUnavailable(true); setPermission(undefined) }
        return true
      }
      if (live()) setPhotoUnavailable(false)
      const authority = chatSpeech ? meta.chatReplySpeech : voiceCalls ? meta.voiceCalls : voiceStorage ? meta.personVoiceStorage : production ? meta.productionModelExecution : storyBranches ? meta.storyBranches : offlineLife ? meta.offlineLife : worldActions ? meta.worldActionProcessing : chatPhoto ? meta.chatPhotoStorage : chatReplies ? meta.chatImageReplies : gatherReplies ? meta.gatherReplies : letterStorage ? meta?.letterStorage : letterReplies ? meta?.letterReplies : giftPhoto ? meta?.giftPhotoStorage : returns ? meta?.giftReturns : gift ? meta?.giftStorage : personPhoto ? meta?.personPhotoStorage : photo ? meta?.photoStorage : storage ? meta?.storyStorage : meta?.aiTextProcessing
      if (!Array.isArray(policies) || !meta?.currentAuthorizationVersions || !meta.currentDecisions
        || typeof authority?.allowed !== 'boolean' || !natural(authority.authorizationVersion)
        || authority.authorizationVersion !== meta.currentAuthorizationVersions[purpose]
        || authority.allowed && authority.authorizationVersion === 0) throw new Error('Invalid permission state')
      const selected = {} as Record<Purpose, Policy>, documents = {} as Record<Purpose, string>
      await Promise.all((['privacy_notice', purpose] as const).map(async purpose => {
        const matches = policies.filter(item => item.kind === purpose), policy = matches[0]
        if (matches.length !== 1 || !uuid.test(policy?.id) || !natural(policy.version) || policy.version === 0
          || !natural(meta.currentAuthorizationVersions[purpose]) || policy.privateFeedProcessingEnabled !== undefined && typeof policy.privateFeedProcessingEnabled !== 'boolean') throw new Error('Missing permission policy')
        const path = '/v1/policies/' + policy.id + '/' + policy.version + '?locale=' + locale
        if (policy.documentUrl !== path) throw new Error('Invalid policy document path')
        selected[purpose] = policy
        documents[purpose] = await (await request(path, signal)).text()
        if (!documents[purpose].trim()) throw new Error('Empty permission policy')
      }))
      if (!live()) return false
      const notice = JSON.stringify([selected.privacy_notice.id, selected.privacy_notice.version, meta.currentAuthorizationVersions.privacy_notice])
      if (noticeRevision.current !== notice) {
        if (noticeRevision.current) changed.current?.()
        setNoticeChecked(false); noticeRevision.current = notice
      }
      setPermission({ policies: selected, documents, versions: {
          privacy_notice: meta.currentAuthorizationVersions.privacy_notice,
          ai_text_processing: meta.currentAuthorizationVersions.ai_text_processing,
          private_story_storage: meta.currentAuthorizationVersions.private_story_storage,
          private_photo_storage: meta.currentAuthorizationVersions.private_photo_storage ?? 0,
          virtual_gift_storage: meta.currentAuthorizationVersions.virtual_gift_storage ?? 0,
          person_gift_returns: meta.currentAuthorizationVersions.person_gift_returns ?? 0,
          gift_delivery_photo_storage: meta.currentAuthorizationVersions.gift_delivery_photo_storage ?? 0,
          private_letter_storage: meta.currentAuthorizationVersions.private_letter_storage ?? 0,
          person_letter_replies: meta.currentAuthorizationVersions.person_letter_replies ?? 0,
          person_gather_replies: meta.currentAuthorizationVersions.person_gather_replies ?? 0,
          private_chat_photo_storage: meta.currentAuthorizationVersions.private_chat_photo_storage ?? 0,
          person_chat_image_replies: meta.currentAuthorizationVersions.person_chat_image_replies ?? 0,
          person_world_actions: meta.currentAuthorizationVersions.person_world_actions ?? 0,
          person_story_branches: meta.currentAuthorizationVersions.person_story_branches ?? 0,
          person_offline_life: meta.currentAuthorizationVersions.person_offline_life ?? 0,
          production_model_execution: meta.currentAuthorizationVersions.production_model_execution ?? 0,
          person_voice_calls: meta.currentAuthorizationVersions.person_voice_calls ?? 0,
          private_person_voice_storage: meta.currentAuthorizationVersions.private_person_voice_storage ?? 0,
          private_chat_reply_speech: meta.currentAuthorizationVersions.private_chat_reply_speech ?? 0,
          private_person_photo_storage: meta.currentAuthorizationVersions.private_person_photo_storage ?? 0,
        }, noticeAcknowledged: meta.currentDecisions.privacy_notice === 'acknowledge', allowed: authority.allowed && (!storage || meta.storyStorage?.privateFeedAllowed === true)
          && (voiceCalls || voiceStorage || production || storage || photo || gift || returns || giftPhoto || letterPurpose || gatherReplies || chatPhoto || chatReplies || worldActions || storyControls || selected.ai_text_processing?.privateFeedProcessingEnabled !== true || meta.aiTextProcessing.privateFeedProcessingAllowed === true),
        hasGrant: meta.currentDecisions[purpose] === 'grant' })
      return true
    } catch (error) {
      if (!live()) return false
      setPermission(undefined)
      if (error instanceof PermissionError && error.status === 401) callbacks.current()
      setMessage(zh ? '暂时无法查看你的选择，请重试。' : 'Permission could not be loaded. Try again.')
      return false
    } finally { if (live()) setLoading(false) }
  }

  async function submit(decision: 'grant' | 'revoke', retry?: Intent) {
    const signal = lifetime.current?.signal
    if (!permission || !signal || signal.aborted || writing.current || pending && !retry) return
    if (decision === 'grant' && !retry && !permission.noticeAcknowledged && !noticeChecked) return
    const operation = ++writeRevision.current
    reading.current++; setLoading(false)
    const step = (purpose: Purpose, choice: Decision['decision']): Step => ({ key: crypto.randomUUID(), body: {
      policyId: permission.policies[purpose].id, version: permission.policies[purpose].version,
      purpose, decision: choice, expectedAuthorizationVersion: permission.versions[purpose],
    } })
    let intent = retry ?? { decision, steps: [
      ...(!permission.noticeAcknowledged && decision === 'grant' ? [step('privacy_notice', 'acknowledge')] : []),
      step(purpose, decision),
    ] }
    writing.current = true; setBusy(true); setMessage(''); setPending(intent); rememberIntent(sessionId, purpose, intent)
    const live = () => !signal.aborted && session.current === sessionId && operation === writeRevision.current
    try {
      while (intent.steps.length) {
        const current = intent.steps[0]
        const response = await request('/v1/accounts/me/consents', signal, { method: 'POST', headers: {
          'Content-Type': 'application/json', 'Idempotency-Key': current.key,
        }, body: JSON.stringify(current.body) })
        const result = (await response.json()).data
        if (!result || !uuid.test(result.id) || result.purpose !== current.body.purpose || result.decision !== current.body.decision
          || result.authorizationVersion !== current.body.expectedAuthorizationVersion + 1) throw new Error('Invalid permission receipt')
        intent = { ...intent, steps: intent.steps.slice(1) }
        if (!live()) return
        rememberIntent(sessionId, purpose, intent.steps.length ? intent : undefined)
        setPending(intent.steps.length ? intent : undefined)
        changed.current?.()
        window.dispatchEvent(new Event('xijie:consents-changed'))
      }
      const refreshed = await load(signal)
      if (live() && refreshed) setMessage(zh ? '你的选择已保存。' : 'Permission settings were updated.')
    } catch (error) {
      // An aborted request may already have committed. Its original key remains available when the panel reopens.
      if (!live()) return
      if (error instanceof PermissionError && error.status >= 400 && error.status < 500) {
        rememberIntent(sessionId, purpose); setPending(undefined)
        if (error.status === 401) callbacks.current()
        await load(signal)
        if (live()) setMessage(error.status === 409 || error.status === 412
          ? zh ? '说明或你的选择刚有变化，请看过后再确认。' : 'Permission or policy changed. Review it and choose again.'
          : zh ? '这次选择还没能完成，请查看当前情况后再试。' : 'This change was not accepted. Review the state and retry.')
      } else setMessage(zh ? '还没能确认是否保存，请点上方按钮继续。' : 'The result is not confirmed. Retry the previous operation.')
    } finally { if (operation === writeRevision.current) writing.current = false; if (live()) setBusy(false) }
  }

  if (photoUnavailable) return null
  return <section className="me-ai-purpose" aria-label={chatCopy ? chatCopy.region : gatherReplies ? zh ? 'AI围坐回应授权' : 'AI gathering reply permission' : letterStorage ? zh ? '书信保存授权' : 'Letter storage permission' : letterReplies ? zh ? 'AI书信回信授权' : 'AI letter reply permission' : giftPhoto ? zh ? '赠礼留影保存授权' : 'Gift journey photo storage permission' : returns ? zh ? '人物 AI 回礼授权' : 'Character AI return gift permission' : gift ? zh ? '虚拟赠礼保存授权' : 'Virtual gift storage permission' : personPhoto ? zh ? '人物照片保存授权' : 'Character photo storage permission' : photo ? zh ? '照片保存授权' : 'Photo storage permission' : storage ? zh ? '文字保存授权' : 'Text storage permission' : zh ? 'AI 文字处理授权' : 'AI text permission'} aria-busy={loading || busy}>
    <h3>{chatCopy ? chatCopy.title : gatherReplies ? zh ? 'AI 围坐回应' : 'AI gathering replies' : letterStorage ? zh ? '私人书信保存' : 'Private letter storage' : letterReplies ? zh ? 'AI 书信回信' : 'AI letter replies' : giftPhoto ? zh ? '赠礼留影保存' : 'Gift journey photo storage' : returns ? zh ? '人物 AI 回礼' : 'Character AI return gifts' : gift ? zh ? '虚拟赠礼与试用资产' : 'Virtual gifts and trial assets' : personPhoto ? zh ? '人物照片保存' : 'Character photo storage' : photo ? zh ? '私人照片保存' : 'Private photo storage' : storage ? zh ? '私人文字保存' : 'Private text storage' : zh ? 'AI 文字处理' : 'AI text processing'}</h3>
    <p role="status">{loading ? zh ? '正在查看你的选择…' : 'Loading permission…'
      : permission?.allowed ? zh ? '已允许' : 'Allowed' : permission ? zh ? '尚未允许' : 'Not allowed' : ''}</p>
    {permission && <>
      <p>{chatCopy ? chatCopy.description : gatherReplies ? zh ? '另行允许后，OpenAI 会使用你本次围坐发言、各自的人物资料与虚拟世界，以及该人物参与过的围坐，生成最多三位人物各一轮回应。如果你也允许了 AI 文字处理，该人物当前获准的珍藏和私聊长期记忆可能在围坐回应中提及；每位 TA 只使用自己的记忆，不读取其他人物的私聊或记忆正文。不读取完整的旧私聊、书信或照片，不自动整理围坐记忆、珍藏或执行世界操作。需要文字保存授权；撤回停止未完成回应，再次同意不会自动重做已停止的操作，已保存的围坐仍按文字保存授权读取。' : 'Separately allow OpenAI to use your current gathering message, each character’s profile and virtual world, and gatherings they participated in, for one reply each from up to three characters. If AI text processing is also allowed, that character’s currently authorized treasures and long-term private-chat memories may be mentioned. Each character accesses only their own private memories, never another character’s private chats or memory text. Raw private chats, letters and photos are excluded. Gatherings do not create memories or treasures or perform world actions. Text storage permission is required. Withdrawal stops unfinished replies; allowing again does not resume them. Saved gatherings remain readable with text storage permission.' : letterStorage ? zh ? '允许后，原信、实际回信、时间偏好与已读记录保存在当前账号，仅自己可见。本授权不会开启 AI 回信；可以只保存原信。撤回后停止查看和新的保存，已有资料仍可导出或删除。' : 'Privately store your letters, actual replies, delivery preferences and read status in this account. Storage does not enable AI replies; you can keep a letter without requesting a reply. Withdrawal stops normal reads and new saves. Export and deletion remain available.' : letterReplies ? zh ? '另行允许后，OpenAI 会使用你主动请求回信的本封原信、人物必要文字及TA 所在的虚拟世界与最近迁居信息，生成一次回信。可选择即刻或下一次早上 8:00；8:00 前预约可能在当天送达。需要书信保存和文字保存授权，不读取照片、其他原信、原始聊天、珍藏或自动记忆，不生成书信记忆，不推送或循环来信。撤回后停止未完成任务，重新允许不会自动重做已停止的操作；已提交的信仍按书信保存授权读取。' : 'Separately allow OpenAI to use this letter, necessary character text and the current virtual world and recent move to generate one requested reply. Choose now or the next 08:00, which may be today when scheduled before 08:00. Letter and text storage permissions are required. Photos, other letters, raw chats, treasures and automatic memories are excluded. Letters do not create memories, push messages or recurring replies. Withdrawal stops unfinished tasks; allowing again does not revive them. Completed letters remain readable with letter storage permission.' : giftPhoto ? zh ? '允许后，主动观看赠礼旅途生成的虚拟场景留影会保存在当前账号，仅自己可见，不交给 AI。需要虚拟赠礼保存授权，不需要 AI 授权，也不代表真实世界投递。完整重看会替换同一寄件的留影，提前结束不会保存。撤回后停止上传、保存和读取；重新允许可查看仍有效的已保存留影，之前停止的上传不会自动继续。已有资料仍可导出或删除。' : 'Privately save the virtual scene captured when you choose to watch a gift journey. Photos are never sent to AI and do not prove a real-world delivery. Virtual gift storage permission is required; AI permission is not. Watching the whole journey again replaces that delivery’s photo; finishing early saves nothing. Withdrawal stops uploads, saving and reads. Allowing again restores access to valid saved photos, without resuming old uploads under new permission. Export and deletion remain available.' : returns ? zh ? '另行允许后，OpenAI 会使用之后新寄件的礼物、数量、赠言及必要的人物资料，决定是否回礼并生成一份礼物与附言。TA 也可能不回礼；失败不会用模板代替。需要文字保存与虚拟赠礼保存授权，不使用照片、聊天或珍藏。来礼可拆开、陈列，并产生私人站内通知，不增加邮资、券或背包库存。撤回后停止旧任务，重新允许不会补扫旧寄件；已有资料仍可导出或删除。' : 'Separately allow OpenAI to use new gifts, quantities, notes and minimal character text to decide whether to return one gift and write its note. They may choose not to return a gift; failures are not replaced with templates. Text and virtual gift storage permissions are required. Photos, chats and treasures are excluded. Returned gifts can be opened and displayed with private in-app notices, without adding postage, vouchers or inventory. Withdrawal stops existing tasks; allowing again does not scan old deliveries. Export and deletion remain available.' : gift ? zh ? '允许后，赠言、寄件记录和邮资、赠礼券和背包记录保存在当前账号，供你自己回看。本授权不会开启 AI 回礼；AI 回礼需要另行允许，也不涉及真实付款。撤回后停止新的赠礼和正常读取，已有资料仍可导出或删除。' : 'Save gift notes, delivery records and trial asset history privately in this account for display and reconciliation. This permission does not enable AI return gifts; those require separate permission. No real payment is involved. Withdrawal stops new gifts and normal reads; export and deletion remain available.' : personPhoto ? zh ? '允许后，你选入寻找 TA 和人物资料的照片会保存在当前账号，仅自己可见。照片只用于资料和头像显示，不交给 AI。撤回后停止新的上传和读取，已有资料仍可导出或删除。' : 'Store photos chosen for your character drafts and profiles privately in this account. They are used only for profile and portrait display, never sent to AI. Withdrawal stops new uploads and reads; export and deletion remain available.' : photo ? zh ? '允许后，你选入空间动态的照片会保存为当前账号的私人照片，仅自己可见，不交给 AI。撤回后停止新的上传和读取，已有资料仍可导出或删除。' : 'Store your chosen space photos as private publication copies in this account, for your eyes only and without AI processing. Withdrawal stops new uploads and reads; export and deletion remain available.' : storage ? zh ? '允许后，人物资料、对话、珍藏和私人动态保存在当前账号。动态仅自己可见，文字保存不会开启 AI 处理。撤回后仍可导出或删除已有资料。' : 'Store character details, chats, treasured memories and private posts in this account. Posts are private. Storage does not enable AI processing; export and deletion remain available after withdrawal.' : permission.policies.ai_text_processing?.privateFeedProcessingEnabled === true ? zh
        ? '允许后，必要的人物资料、聊天与珍藏会交给 OpenAI，生成回复、整理记忆，并围绕你之后新珍藏或修订的记忆产生私人回响。对应人物也可以回应回响下的新评论。普通动态不会交给模型，不会重新处理之前保存的珍藏。撤回后停止新的 AI 处理。'
        : 'Allow OpenAI to use necessary character details, chats and treasured originals for replies and memory processing. New or revised treasures can produce private echoes, and their character can respond to new comments on those echoes. Ordinary posts are excluded and old treasures are not swept. Withdrawal stops new AI processing.' : zh ? '允许后，相关人物资料、对话与珍藏会交给 OpenAI 生成文字回复或整理珍藏建议。撤回后停止新的 AI 处理，已有内容仍可查看。'
        : 'If allowed, relevant character details, chats and treasured memories are sent to OpenAI for text replies or memory suggestions. Withdrawing stops new AI processing; existing content remains available.'}</p>
      <details><summary>{chatCopy ? chatCopy.detail : gatherReplies ? zh ? '查看 AI 围坐回应说明' : 'Read AI gathering reply policy' : letterStorage ? zh ? '查看书信保存说明' : 'Read letter storage policy' : letterReplies ? zh ? '查看 AI 书信回信说明' : 'Read AI letter reply policy' : giftPhoto ? zh ? '查看赠礼留影保存说明' : 'Read gift journey photo policy' : returns ? zh ? '查看人物 AI 回礼说明' : 'Read character AI return gift policy' : gift ? zh ? '查看虚拟赠礼保存说明' : 'Read virtual gift storage policy' : personPhoto ? zh ? '查看人物照片保存说明' : 'Read character photo storage policy' : photo ? zh ? '查看照片保存说明' : 'Read photo storage policy' : storage ? zh ? '查看文字保存说明' : 'Read text storage policy' : zh ? '查看 AI 文字处理说明' : 'Read AI text processing policy'}</summary><p className="whitespace-pre-line">{permission.documents[purpose]}</p></details>
      {!permission.noticeAcknowledged && <>
        <details><summary>{zh ? '查看更新的隐私说明' : 'Read the updated privacy notice'}</summary><p className="whitespace-pre-line">{permission.documents.privacy_notice}</p></details>
        <label className="me-ai-check"><input type="checkbox" checked={noticeChecked} disabled={busy || !!pending} onChange={event => setNoticeChecked(event.currentTarget.checked)} />
          <span>{zh ? '我已阅读更新的隐私说明' : 'I have read the updated privacy notice'}</span>
        </label>
      </>}
      {pending ? <button className="me-primary btn-dark" disabled={busy} onClick={() => void submit(pending.decision, pending)}>
        {busy ? zh ? '正在确认…' : 'Confirming…' : pending.decision === 'grant' ? zh ? '继续确认同意' : 'Retry previous permission grant' : zh ? '继续确认撤回' : 'Retry previous withdrawal'}
      </button> : <button className={permission.allowed ? 'me-secondary btn-ghost' : 'me-primary btn-dark'} disabled={busy || loading || !permission.allowed && !permission.noticeAcknowledged && !noticeChecked}
        onClick={() => void submit(permission.allowed ? 'revoke' : 'grant')}>
        {busy ? zh ? '正在保存…' : 'Saving…' : chatCopy ? permission.allowed ? chatCopy.revoke : chatCopy.grant : gatherReplies ? permission.allowed ? zh ? '撤回AI围坐回应授权' : 'Withdraw AI gathering reply permission' : zh ? '允许AI围坐回应' : 'Allow AI gathering replies' : letterStorage ? permission.allowed ? zh ? '撤回书信保存授权' : 'Withdraw letter storage permission' : zh ? '允许保存书信' : 'Allow letter storage' : letterReplies ? permission.allowed ? zh ? '撤回AI书信回信授权' : 'Withdraw AI letter reply permission' : zh ? '允许AI书信回信' : 'Allow AI letter replies' : giftPhoto ? permission.allowed ? zh ? '撤回赠礼留影保存授权' : 'Withdraw gift journey photo storage permission' : zh ? '允许保存赠礼留影' : 'Allow gift journey photo storage' : returns ? permission.allowed ? zh ? '撤回人物 AI 回礼授权' : 'Withdraw character AI return gift permission' : zh ? '允许人物 AI 回礼' : 'Allow character AI return gifts' : gift ? permission.allowed ? zh ? '撤回虚拟赠礼授权' : 'Withdraw virtual gift permission' : zh ? '允许保存虚拟赠礼' : 'Allow virtual gift storage' : personPhoto ? permission.allowed ? zh ? '撤回人物照片保存授权' : 'Withdraw character photo storage permission' : zh ? '允许保存人物照片' : 'Allow character photo storage' : photo ? permission.allowed ? zh ? '撤回照片保存授权' : 'Withdraw photo storage permission' : zh ? '允许保存私人照片' : 'Allow private photo storage' : storage ? permission.allowed ? zh ? '收回文字保存授权' : 'Withdraw text storage permission' : zh ? '允许保存私人文字' : 'Allow private text storage' : permission.allowed ? zh ? '撤回 AI 授权' : 'Withdraw AI permission' : zh ? '允许 AI 文字处理' : 'Allow AI text processing'}
      </button>}
      {!pending && permission.hasGrant && !permission.allowed && <button className="me-secondary btn-ghost" disabled={busy || loading} onClick={() => void submit('revoke')}>
        {chatCopy ? chatCopy.revoke : gatherReplies ? zh ? '撤回已有AI围坐回应授权' : 'Withdraw existing AI gathering reply permission' : letterStorage ? zh ? '撤回已有书信保存授权' : 'Withdraw existing letter storage permission' : letterReplies ? zh ? '撤回已有AI书信回信授权' : 'Withdraw existing AI letter reply permission' : giftPhoto ? zh ? '撤回已有赠礼留影保存授权' : 'Withdraw existing gift journey photo storage permission' : returns ? zh ? '撤回已有人物 AI 回礼授权' : 'Withdraw existing character AI return gift permission' : gift ? zh ? '撤回已有虚拟赠礼授权' : 'Withdraw existing virtual gift permission' : personPhoto ? zh ? '撤回已有人物照片保存授权' : 'Withdraw existing character photo storage permission' : photo ? zh ? '撤回已有照片保存授权' : 'Withdraw existing photo storage permission' : storage ? zh ? '收回已有文字保存授权' : 'Withdraw existing text storage permission' : zh ? '撤回已有 AI 授权' : 'Withdraw existing AI permission'}
      </button>}
    </>}
    {!permission && !loading && <button className="me-secondary btn-ghost" onClick={() => void load()}>{zh ? '重新读取' : 'Reload'}</button>}
    {message && <p role="status">{message}</p>}
  </section>
}
