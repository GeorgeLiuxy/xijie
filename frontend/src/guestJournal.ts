const STORE = 'journal'
const KEY = 'current'
const eventName = 'xijie:guest-journey-changed'
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

export type GuestPersonSeed = { guestId: string; name: string; story: string }
type Original = { id: string; title: string; body: string }
type Transfer = { personId: string; memoryId?: string }
type DraftBody = Record<string, string | null>
type PersonDraft = { id: string } | { key: string; body: DraftBody; startedAt: number }
export type GuestJournal = GuestPersonSeed & { owner?: string; original?: Original; transfer?: Transfer; personHandoff?: boolean; personDraft?: PersonDraft }
const draftFields = new Set(['displayName', 'story', 'relationship', 'realName', 'calledMe', 'birthMonthDay', 'yearsText', 'place', 'conversationTone', 'voiceTimbre'])
const validDraftBody = (value: unknown): value is DraftBody => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.entries(value).every(([key, text]) => draftFields.has(key) && (text === null || field(text, 20000)))

const field = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && !!value.trim() && [...value].length <= limit && !value.includes('\0') && !/\p{Surrogate}/u.test(value)

function stored(value: unknown): GuestJournal | undefined {
  if (value === undefined) return
  const journal = value as GuestJournal
  if (!journal || typeof journal.guestId !== 'string' || !uuid.test(journal.guestId) || !field(journal.name, 80) || !field(journal.story, 20000)
    || journal.owner !== undefined && (typeof journal.owner !== 'string' || !uuid.test(journal.owner))
    || journal.personHandoff !== undefined && typeof journal.personHandoff !== 'boolean'
    || journal.personDraft !== undefined && (!journal.owner || !journal.personDraft || typeof journal.personDraft !== 'object'
      || ('id' in journal.personDraft ? !uuid.test(journal.personDraft.id)
        : !uuid.test(journal.personDraft.key) || !validDraftBody(journal.personDraft.body) || !Number.isSafeInteger(journal.personDraft.startedAt)))
    || journal.original !== undefined && (!journal.original || !uuid.test(journal.original.id) || !field(journal.original.title, 120) || !field(journal.original.body, 10000))
    || journal.transfer !== undefined && (!journal.owner || !journal.transfer || !uuid.test(journal.transfer.personId)
      || journal.transfer.memoryId !== undefined && !uuid.test(journal.transfer.memoryId)
      || !journal.transfer.memoryId && !journal.original)) throw new Error('Unreadable guest journal')
  return journal
}

function openJournal(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('xijie-device-guest-journey', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

async function journalTransaction(update?: (current: GuestJournal | undefined) => GuestJournal | undefined): Promise<GuestJournal | undefined> {
  const db = await openJournal()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, update ? 'readwrite' : 'readonly')
      const collection = tx.objectStore(STORE)
      const request = collection.get(KEY)
      let result: GuestJournal | undefined
      let failure: unknown
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? tx.error)
      request.onsuccess = () => {
        try {
          const current = stored(request.result)
          result = update ? stored(update(current)) : current
          if (update) {
            if (result) collection.put(result, KEY)
            else collection.delete(KEY)
          }
        } catch (error) { failure = error; tx.abort() }
      }
    })
  } finally { db.close() }
}

export const readGuestJournal = () => journalTransaction()

async function change(update: (current: GuestJournal | undefined) => GuestJournal | undefined) {
  const result = await journalTransaction(update)
  window.dispatchEvent(new Event(eventName))
  return result
}

export function watchGuestJournal(listener: () => void) {
  window.addEventListener(eventName, listener)
  window.addEventListener('focus', listener)
  return () => {
    window.removeEventListener(eventName, listener)
    window.removeEventListener('focus', listener)
  }
}

export function saveGuestPerson(name: string, story: string) {
  return change(current => {
    if (current?.owner || !field(name, 80) || !field(story, 20000)) throw new Error('Guest person cannot be saved')
    return { ...current, guestId: current?.guestId ?? crypto.randomUUID(), name: name.trim(), story: story.trim() }
  })
}

export function saveGuestOriginal(guestId: string, title: string, body: string) {
  return change(current => {
    if (current?.guestId !== guestId || current.owner || !field(title, 120) || !field(body, 10000)) throw new Error('Guest original cannot be saved')
    return { ...current, original: { id: current.original?.id ?? crypto.randomUUID(), title: title.trim(), body: body.trim() } }
  })
}

function own(current: GuestJournal | undefined, guestId: string, accountId: string) {
  if (current?.guestId !== guestId || !uuid.test(accountId) || current.owner && current.owner !== accountId) throw new Error('Guest ownership changed')
  return { ...current, owner: accountId }
}

export function acceptGuestPerson(guestId: string, accountId: string) {
  return change(current => own(current, guestId, accountId))
}

export function prepareGuestPersonDraft(guestId: string, accountId: string, body: DraftBody) {
  return change(current => {
    const owned = own(current, guestId, accountId)
    if (owned.personHandoff || !validDraftBody(body)) throw new Error('Guest person handoff changed')
    if (owned.personDraft && 'key' in owned.personDraft && Date.now() - owned.personDraft.startedAt > 6 * 86400000)
      throw new Error('Guest draft acceptance requires review')
    return { ...owned, personDraft: owned.personDraft ?? { key: crypto.randomUUID(), body, startedAt: Date.now() } }
  })
}

export function recordGuestPersonDraft(guestId: string, accountId: string, key: string, id: string) {
  return change(current => {
    const owned = own(current, guestId, accountId)
    const prior = owned.personDraft
    if (!uuid.test(id) || !prior || ('id' in prior ? prior.id !== id : prior.key !== key)) throw new Error('Guest draft receipt changed')
    return { ...owned, personDraft: { id } }
  })
}

export function completeGuestPerson(guestId: string, accountId: string, draftId: string | undefined) {
  return change(current => {
    const owned = own(current, guestId, accountId)
    if (!owned.personDraft || !('id' in owned.personDraft) || owned.personDraft.id !== draftId) return owned
    return { ...owned, personHandoff: true }
  })
}

export function beginGuestTransfer(guestId: string, accountId: string, personId: string) {
  return change(current => {
    const owned = own(current, guestId, accountId)
    if (!uuid.test(personId) || !owned.original || owned.transfer && owned.transfer.personId !== personId) throw new Error('Guest transfer changed')
    return { ...owned, transfer: owned.transfer ?? { personId } }
  })
}

export function completeGuestTransfer(guestId: string, accountId: string, personId: string, memoryId: string) {
  return change(current => {
    const owned = own(current, guestId, accountId)
    if (!uuid.test(memoryId) || owned.transfer?.personId !== personId
      || owned.transfer.memoryId && owned.transfer.memoryId !== memoryId) throw new Error('Guest transfer changed')
    return { ...owned, original: undefined, transfer: { personId, memoryId } }
  })
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('xijie:private-drafts-erased', event => {
  const id = (event as CustomEvent<{ accountId?: string }>).detail?.accountId
  if (typeof id === 'string') void change(current => current?.owner === id ? undefined : current).catch(() => {})
})
