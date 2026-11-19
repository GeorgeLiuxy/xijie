import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isZh, useI18n } from '../i18n'
import { ConsentError, consentBundle, type ConsentSnapshot } from './consentBundle'

type PermissionProps = { sessionId: string; onUnauthorized: () => void; onChanged?: () => void; onAgreed?: () => void | Promise<void> }
type Client = ReturnType<typeof consentBundle>
type Lifetime = {
  controller: AbortController
  client: Client
  read: number
  writing: boolean
  refreshQueued: boolean
}

const documentTitles: Record<string, [string, string]> = {
  privacy_notice: ['隐私说明', 'Privacy notice'],
  private_story_storage: ['人物、对话与珍藏', 'Characters, conversations and treasures'],
  private_person_voice_storage: ['人物声音保存', 'Character voice storage'],
  private_person_photo_storage: ['人物照片保存', 'Character photo storage'],
  private_photo_storage: ['私人动态照片', 'Private post photos'],
  virtual_gift_storage: ['虚拟赠礼与资产记录', 'Virtual gifts and asset records'],
  gift_delivery_photo_storage: ['赠礼旅途留影', 'Gift journey photos'],
  private_letter_storage: ['书信保存', 'Letter storage'],
  ai_text_processing: ['AI 对话与记忆', 'AI conversations and memory'],
  production_model_execution: ['AI 服务', 'AI service'],
  person_gift_returns: ['人物回礼', 'Character return gifts'],
  person_letter_replies: ['书信回信', 'Letter replies'],
  person_gather_replies: ['围坐回应', 'Gathering replies'],
  private_chat_photo_storage: ['聊天照片保存', 'Chat photo storage'],
  person_chat_image_replies: ['AI 看图回应', 'AI image replies'],
  person_world_actions: ['世界行动与虚拟经历', 'World actions and virtual experiences'],
  person_story_branches: ['平行故事线', 'Parallel storylines'],
  person_offline_life: ['不在时的生活', 'Life while you are away'],
  person_voice_calls: ['实时 AI 语音通话', 'Live AI voice calls'],
  private_chat_reply_speech: ['私聊回应合成朗读', 'AI reply speech'],
}

/** One explicit agreement covers the displayed purposes; fine-grained controls stay optional. */
export function PrivacyStatement({ sessionId, onUnauthorized, onChanged, onAgreed, children }: PermissionProps & { children?: ReactNode }) {
  const { lang } = useI18n(), zh = isZh(lang), locale = zh ? 'zh-CN' : 'en'
  const [snapshot, setSnapshot] = useState<ConsentSnapshot>()
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [readFailed, setReadFailed] = useState(false), [pending, setPending] = useState(false)
  const [message, setMessage] = useState(''), [manage, setManage] = useState(false)
  const callbacks = useRef({ onUnauthorized, onChanged, onAgreed }); callbacks.current = { onUnauthorized, onChanged, onAgreed }
  const lifetime = useRef<Lifetime | undefined>(undefined)
  const current = (life: Lifetime) => lifetime.current === life && !life.controller.signal.aborted

  async function read(life: Lifetime, quiet = false) {
    if (!current(life)) return
    if (life.writing) { life.refreshQueued = true; return }
    const revision = ++life.read
    if (!quiet) setLoading(true)
    try {
      const value = await life.client.load()
      if (!current(life) || life.writing || revision !== life.read) return
      setSnapshot(value); setReadFailed(false); setPending(life.client.hasPending)
      if (!quiet) setMessage('')
    } catch {
      if (!current(life) || life.writing || revision !== life.read) return
      setReadFailed(true); setPending(life.client.hasPending)
      setMessage(zh ? '暂时无法确认你的同意记录，请重试。' : 'The statement and agreement status could not be loaded. Please reload.')
    } finally {
      if (current(life) && !life.writing && revision === life.read) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const client = consentBundle({ sessionId, onUnauthorized: () => callbacks.current.onUnauthorized(), onChanged: () => callbacks.current.onChanged?.() }, controller.signal, locale)
    const life: Lifetime = { controller, client, read: 0, writing: false, refreshQueued: false }
    lifetime.current = life
    setSnapshot(undefined); setLoading(true); setBusy(false); setReadFailed(false)
    setPending(client.hasPending); setMessage(''); setManage(false)
    void read(life)
    const refresh = () => { if (document.visibilityState !== 'hidden') void read(life, true) }
    window.addEventListener('focus', refresh)
    window.addEventListener('xijie:consents-changed', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort(); life.read++
      if (lifetime.current === life) lifetime.current = undefined
      window.removeEventListener('focus', refresh)
      window.removeEventListener('xijie:consents-changed', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [sessionId, locale])

  async function agree() {
    const life = lifetime.current
    if (!life || !current(life) || life.writing || loading) return
    if (readFailed && !life.client.hasPending) { await read(life); return }
    if (!life.client.hasPending && (!snapshot || snapshot.complete && !callbacks.current.onAgreed)) return
    life.writing = true; life.read++; setBusy(true); setMessage('')
    try {
      const value = life.client.hasPending ? await life.client.retry() : snapshot!.complete ? await life.client.load() : await life.client.grant(snapshot!)
      if (!current(life)) return
      setSnapshot(value); setReadFailed(false); setPending(life.client.hasPending)
      setMessage(value.complete && !life.client.hasPending
        ? zh ? '已同意，日常使用无需逐项确认。' : 'Agreed. You do not need to approve each feature again.'
        : zh ? '部分功能尚未确认，请继续确认。' : 'Some features are still unconfirmed. Please continue.')
      if (value.complete && !life.client.hasPending && callbacks.current.onAgreed) {
        try { await callbacks.current.onAgreed() }
        catch {
          if (current(life)) setMessage(zh ? '同意已保存，下一步暂时无法完成，请再次点击「继续」。' : 'Your agreement is saved. The next step could not be completed; select Continue to retry.')
        }
      }
    } catch (error) {
      if (!current(life)) return
      const remains = life.client.hasPending
      setPending(remains); setReadFailed(!remains)
      setMessage(remains
        ? zh ? '同意结果尚未全部确认，请点击「继续确认」。' : 'The full agreement is not yet confirmed. Select Continue confirmation.'
        : error instanceof ConsentError && (error.status === 409 || error.status === 412)
          ? zh ? '说明或你的选择刚有变化，请重试查看，再选择是否同意。' : 'The statement or permissions changed. Reload, review and agree again.'
          : zh ? '这次同意还没能完成，请重试后继续。' : 'This agreement is not complete. Reload the status to continue.')
    } finally {
      life.writing = false
      if (current(life)) {
        setBusy(false)
        if (life.refreshQueued) { life.refreshQueued = false; void read(life, true) }
      }
    }
  }

  // Keep the action outside the long reading area, without a forced scroll-to-end step.
  const complete = snapshot?.complete === true && !pending && !readFailed
  return <section className="me-privacy-statement" aria-label={zh ? '隐私与 AI 使用声明' : 'Privacy and AI statement'} aria-busy={busy || loading}>
    <p className="me-privacy-intro">{zh ? '请阅读以下说明，了解你的资料会怎样使用。' : 'Read how your information is used below.'}</p>
    <article className="me-privacy-document" role="region" aria-label={zh ? '完整隐私与 AI 使用声明' : 'Full privacy and AI statement'} tabIndex={0}>
      <h3>{zh ? '西界隐私与 AI 使用声明' : 'Elysium privacy and AI statement'}</h3>
      <p>{zh ? '点击一次「同意并继续」，即同意下面说明的资料保存和 AI 使用方式，日常使用无需再逐项确认。你可以随时在「管理授权」里调整。功能是否开放，以使用时的页面提示为准。' : 'Select Agree and continue once to agree to the storage and AI uses below. You will not need to approve each feature again in everyday use. You can change your choices in Manage permissions. Each feature is available only when its page says it is open.'}</p>
      <h4>{zh ? '一、保存你主动留下的内容' : '1. Keeping what you choose to share'}</h4>
      <p>{zh ? '你填写的人物资料、对话、珍藏、私人动态、书信和赠礼记录，以及主动选入的照片、声音，会保存在当前账号，供你以后查看和使用。私人内容仅自己可见。普通动态和它下面的点赞、评论不会交给 AI。' : 'The character details, conversations, treasures, private posts, letters and gift records you provide, together with the photos and voice samples you choose, are kept in your account for you to revisit. Private content is for your eyes only. Ordinary posts and their likes and comments are not sent to AI.'}</p>
      <h4>{zh ? '二、AI 怎样使用这些内容' : '2. How AI uses your information'}</h4>
      <p>{zh ? '使用已开放的 AI 功能时，必要的人物资料、你的输入，以及该功能需要的对话和记忆，会交给 OpenAI 生成回应、整理记忆或形成私人回响。每位 TA 使用自己的资料和记忆。新保存或修改的珍藏可以形成私人回响，回响下的新评论也可由对应 TA 回应；不会因为这次同意而重新整理全部旧珍藏。人物资料里没有的信息会按「尚不了解」处理。AI 呈现和回应不代表本人，也不表示本人的意识仍在延续；生成的故事不等于真实往事。' : 'When you use an available AI feature, OpenAI receives the character details, your input, and the conversations or memories needed for that feature to create a response, organize memories or make private echoes. Each character uses their own information and memories. New or edited treasures can create private echoes, and their character can reply to new comments on those echoes. Agreeing does not trigger a fresh review of all old treasures. Missing profile details are treated as unknown. AI portrayals and replies do not represent the person or imply that their consciousness continues. Generated stories are not records of real events.'}</p>
      <h4>{zh ? '三、照片与声音怎样使用' : '3. Photos and voice'}</h4>
      <p>{zh ? '人物资料照片、私人动态照片和赠礼旅途留影只用于保存和展示，不交给 AI。聊天里的看图回应，只把你这次主动发送的单张照片、必要的人物资料和所在世界交给 AI，不读取旧私聊、珍藏或长期记忆；这张照片和看图回应不会带入后续文字聊天，也不会用于整理记忆、推荐珍藏或围坐回应。\n\n你录制或选择的原声只供保存和回听，不用于声音克隆，也不用于 AI 通话。实时语音和视频通话暂未开放。若你登记开通提醒，西界只保存选择的通话类型和登记时间，你可随时取消。相机和麦克风仅在你主动使用时，按手机系统提示请求。' : 'Profile photos, private post photos and gift journey photos are kept for display and are not sent to AI. An image reply uses only the single photo you send for that reply, necessary character details and the current world. It does not read old private chats, treasures or long-term memory. Neither the photo nor its reply is used in later text chats, automatic memory, memory suggestions or gatherings.\n\nOriginal voice samples are saved for listening, not for voice cloning or AI calls. Live voice and video calls are not available yet. If you request an opening reminder, we keep the type of call you selected and registration time. You can cancel at any time. Your phone requests camera or microphone access when you choose to use them.'}</p>
      <h4>{zh ? '四、书信与礼物' : '4. Letters and gifts'}</h4>
      <p>{zh ? '你可以只保存原信，也可以在写信时选择要不要回信。请求回信时，AI 只使用这封信、必要的人物资料、当前世界和最近的迁居信息，不读取其他信件、旧私聊、珍藏或长期记忆，也不会把书信自动变成记忆。若你主动关联某段回忆，选中的文字会作为信的正文发送，生成前会核对这段关联的回忆是否仍有效。\n\n新的赠礼可以由 AI 根据礼物、数量、赠言和必要的人物资料决定是否回礼，不读取聊天、珍藏或照片。TA 也可能不回礼；生成失败时不会用固定套话冒充回应。收到的回礼用于拆开和陈列，不增加邮资、赠礼券或背包库存。' : 'You can save a letter without requesting a reply, or choose a reply when writing it. A requested reply uses that letter, necessary character details, the current world and recent moves. It does not read other letters, old private chats, treasures or long-term memory, and letters do not automatically become memories. If you link a memory, the text you select is sent as part of the letter. The app checks that the linked memory is still available before generating a reply.\n\nFor new gifts, AI may decide whether to return a gift using the gift, quantity, note and necessary character details, without reading chats, treasures or photos. A character may not send a return gift. Failed generation is not replaced with a canned reply. Return gifts can be opened and displayed; they do not add postage, vouchers or backpack inventory.'}</p>
      <h4>{zh ? '五、一起围坐时' : '5. When you gather together'}</h4>
      <p>{zh ? '围坐时，AI 使用你这轮发言、各位 TA 的资料和各自参与过的围坐内容。每位 TA 可以使用自己已获同意的珍藏和长期记忆，也可能在围坐中提到这些内容；不会读取其他 TA 的私聊和记忆，也不读取原始私聊、书信或照片。围坐不会自动整理长期记忆、添加珍藏或执行世界行动。' : 'In a gathering, AI uses your current message, each character’s profile and gatherings they took part in. Each character may use and mention their own permitted treasures and long-term memories. They do not read another character’s private chats or memories, or raw private chats, letters or photos. Gatherings do not automatically create long-term memories, add treasures or carry out world actions.'}</p>
      <h4>{zh ? '六、故事线与不在时的生活' : '6. Storylines and life while you are away'}</h4>
      <p>{zh ? '你在聊天中明确提出的一次虚拟行动，可以留下故事经历，供 TA 以后回应。这些只是虚拟故事，不代表现实中发生过，也不会自动珍藏、迁居、送礼或花费资产。\n\n你可以从当前主线另开故事线，保留分开前的共同经历，之后各自继续，结局不会合并。分支里的聊天只属于这条故事线，不会整理进主线的长期记忆。\n\n「不在时的生活」默认关闭，仍需由你为每位 TA 主动开启。开启后，每天最多留下一段虚拟经历；不会花费资产、替你发消息、迁居或公开发布。你可以随时暂停；暂停或撤回后，不会继续生成未完成的经历，再次开启也不会补写之前错过的日子。' : 'A virtual action you clearly request in chat can become a story experience for the character to recall later. It is fictional, not a real-world event, and does not automatically become a treasure, move a character, send a gift or spend assets.\n\nYou can start a separate storyline from the current main story. It keeps the shared past, then continues separately without merging endings. Branch conversations stay within that storyline and do not enter the main story’s long-term memory.\n\nLife while you are away is off by default and must be enabled for each character. When enabled, it may create at most one virtual experience a day. It does not spend assets, send messages as you, move characters or publish content. You can pause it at any time. Pausing or withdrawing stops unfinished experiences; enabling it again does not fill in missed days.'}</p>
      <h4>{zh ? '七、分享与购买由你决定' : '7. You choose what to share or buy'}</h4>
      <p>{zh ? '只有你主动发布或分享时，公开邀请才展示你填写的标题和附言。投稿按提交时的说明，由发起人审核；同意被采用的内容可由发起人收进 TA 的记忆，并用于其已同意的 AI 功能。投稿者可以撤回自己的文字和后续使用。\n\n虚拟赠礼与真实购买分开。购买是否开放，以购买页面为准；真实付款仍需你另外选择并确认。同意本声明不会自动付款、消费资产、替你发消息或公开内容。' : 'Public invitations show your title and message only when you choose to publish or share them. Contributions follow the explanation shown when you submit and are reviewed by the organizer. Content you allow to be adopted can be kept in their character’s memories and used in their permitted AI features. Contributors can withdraw their words and future use.\n\nVirtual gifts and real purchases are separate. The purchase page shows whether buying is available, and real payments still require your separate choice and confirmation. Agreeing here does not automatically pay, spend assets, send messages as you or publish content.'}</p>
      <h4>{zh ? '八、你可以调整、取回和删除' : '8. Changing your choices, keeping a copy and deleting'}</h4>
      <p>{zh ? '你可在「管理授权」里调整或撤回某项同意，停止相应的新处理。撤回某些保存同意后，对应内容也会暂停显示；这不等于删除，仍可导出资料或注销账号。已经下载到设备或显示给他人的副本无法远程收回。重新同意不会自动重做之前已停止的操作。' : 'You can change or withdraw a choice in Manage permissions to stop new processing for that use. Withdrawing some storage choices also pauses the display of that content. This is not deletion: you can still export your information or delete the account. Copies already downloaded to a device or shown to others cannot be recalled remotely. Agreeing again does not automatically restart operations that were stopped earlier.'}</p>
      {snapshot ? <details className="me-privacy-detailed-terms">
        <summary className="min-h-11 py-3 cursor-pointer text-sky-deep underline underline-offset-4">{zh ? '查看详细条款' : 'Read the detailed terms'}</summary>
        {snapshot.documents.map((item, index) => <section className="me-privacy-document-part" key={item.purpose}>
          <h4>{index + 1}. {documentTitles[item.purpose]?.[zh ? 0 : 1] ?? (zh ? '服务使用说明' : 'Service use statement')}</h4>
          <p>{item.text}</p>
        </section>)}
      </details> : <p className="me-privacy-loading">{loading ? zh ? '正在打开当前说明…' : 'Opening the current terms…' : zh ? '详细条款暂时打不开，请重试后再同意。' : 'The detailed terms are unavailable. Please retry before agreeing.'}</p>}
    </article>
    <div className="me-privacy-action">
      <button type="button" className={`me-primary ${complete && !onAgreed ? 'me-privacy-agreed' : 'btn-dark'}`} disabled={busy || loading || complete && !onAgreed || !snapshot && !readFailed && !pending} onClick={() => void agree()}>
        {busy ? zh ? '正在确认…' : 'Confirming…' : loading ? zh ? '正在打开…' : 'Loading…' : pending ? zh ? '继续确认' : 'Continue confirmation' : readFailed ? zh ? '重试' : 'Reload' : complete ? onAgreed ? zh ? '继续' : 'Continue' : zh ? '已同意' : 'Agreed' : zh ? '同意并继续' : 'Agree and continue'}
      </button>
      {message && <p className="me-privacy-feedback" role="status">{message}</p>}
    </div>
    {children && <details className="me-privacy-manage" open={manage} onToggle={event => setManage(event.currentTarget.open)}>
      <summary aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }}>{zh ? '管理授权' : 'Manage permissions'}</summary>
      {manage && <fieldset disabled={busy}><legend className="sr-only">{zh ? '按功能调整授权' : 'Adjust permissions by feature'}</legend>{children}</fieldset>}
    </details>}
  </section>
}
