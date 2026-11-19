import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from '../../node_modules/typescript/lib/typescript.js'

const element = (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } })
const nodes = value => value && typeof value === 'object' ? [value, ...(value.props?.children ?? []).flatMap(nodes)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : value && typeof value === 'object' ? (value.props?.children ?? []).map(text).join('') : ''
const icons = new Proxy({}, { get: (_, name) => String(name) })
async function functions(path, names) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const selected = names.map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert(declaration, `Missing actual function ${name}`)
    return declaration.getText(ast).replace(/^export /, '')
  }).join('\n').replaceAll("import.meta.env.VITE_XIJIE_AUTH_MODE==='service'", 'true').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/'))
  return ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
}
function hooks() {
  const state = [], refs = []; let si = 0, ri = 0
  return {
    state,
    reset() { si = 0; ri = 0 },
    useState(initial) { const i = si++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useRef(initial) { const i = ri++; return refs[i] ??= { current: initial } },
    useEffect() {},
  }
}
const empty = () => ({ version: 1, credits: 0, entitlements: {}, inventory: {}, receipts: [], received: [], usedRewards: [], goals: [] })

test('wish celebration is scoped to accepted wish receipts and only plays once per identity', async () => {
  const code = await functions('../src/gifts/GiftWishGlow.tsx', ['claimWishGiftGlow'])
  const claim = vm.runInNewContext(code + '\nclaimWishGiftGlow', { wishGiftIds: new Set(['spark-wish-slip', 'blessing-river-lantern']), celebrated: new Set() })
  const receipt = { id: 'source-gift', status: 'in_transit', lines: [{ quantity: 1, giftId: 'spark-wish-slip' }] }
  assert.equal(claim('owner', undefined), false)
  assert.equal(claim('owner', { ...receipt, status: 'delivery_failed' }), false)
  assert.equal(claim('owner', { ...receipt, lines: [{ quantity: 1, giftId: 'paper-crane' }] }), false)
  assert.equal(claim('owner', receipt), true)
  assert.equal(claim('owner', { ...receipt, status: 'arrived' }), false)
  assert.equal(claim('other-owner', receipt), true)
})

test('an explorable residence opens the latest arrived receipt for the exact resident and world', async () => {
  const store = await functions('../src/gifts/store.ts', ['hasArrived', 'targetMatchesPerson', 'receiptMatchesPerson'])
  const code = await functions('../src/gifts/ResidenceGift.tsx', ['latestResidenceGift', 'ResidenceGift'])
  const person = { id: 7, serverId: 'resident', world: 'tide' }, opened = []
  const target = { id: 7, identity: 'resident', world: 'tide' }
  const placed = { id: 'confirmed-wish', target, createdAt: 10, arriveAt: 20, status: 'arrived', lines: [{ giftId: 'blessing-river-lantern', quantity: 1, snapshot: { name: '祈福河灯' } }] }
  const receipts = [
    { ...placed, id: 'older-arrival', createdAt: 1 },
    placed,
    { ...placed, id: 'wrong-person', target: { ...target, identity: 'other-resident' }, createdAt: 14 },
    { ...placed, id: 'previous-world', target: { ...target, world: 'isles' }, createdAt: 15 },
    { ...placed, id: 'in-transit', status: 'in_transit', createdAt: 16 },
    { ...placed, id: 'failed-delivery', status: 'delivery_failed', createdAt: 17 },
  ]
  const context = { React: { createElement: element }, useGiftState: owner => owner === 'owner' ? { receipts } : empty(),
    useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true, I: icons, GiftIcon: 'GiftIcon', useArrivalClock: () => 60 }
  const view = vm.runInNewContext(store + '\n' + code + '\nResidenceGift', context)
  const button = view({ owner: 'owner', person, onOpen: id => opened.push(id) })
  assert.equal(text(button), '祈福河灯')
  button.props.onClick()
  assert.deepEqual(opened, ['confirmed-wish'])
  assert.equal(view({ owner: 'other-owner', person, onOpen() {} }), null)
})

test('the world near-view sends the actual selected resident and receipt to the receipt route', async () => {
  const h = hooks(), calls = []
  const code = await functions('../src/world/WorldView.tsx', ['WorldView'])
  const place = { far: 'crossing', near: 'cabin', place: ['', ''], seat: ['', ''], invitation: ['', ''], line: ['', ''] }
  const people = [
    { id: 7, world: 'tide', memories: [], name: '先出现的人' },
    { id: 8, world: 'tide', memories: [], name: '当前的人' },
  ]
  const render = vm.runInNewContext(code + '\nWorldView', { React: { createElement: element }, ...h, useContext: () => false, useI18n: () => ({ lang: 'zh-CN', t: value => value }),
    isZh: () => true, NightCtx: {}, places: { tide: place }, useWorldMedia: () => ({}), useStatusTone() {}, useNativeBack() {}, I: icons,
    ArrowUpRight: 'ArrowUpRight', BookOpenText: 'BookOpenText', Eye: 'Eye', Lens: 'Lens', UsersThree: 'UsersThree', ResidenceGift: 'ResidenceGift',
  })
  const props = { world: 'tide', people, view: { near: true, personId: 8 }, giftOwner: 'owner',
    onGiftReceipt: (personId, receiptId) => calls.push([personId, receiptId]) }
  const near = nodes(render(props)).find(node => node.type === 'ResidenceGift')
  assert.equal(near.props.person.id, 8)
  near.props.onOpen('sealed-and-arrived')
  assert.deepEqual(calls, [[8, 'sealed-and-arrived']])
  h.reset()
  assert(!nodes(render({ ...props, view: { near: true, personId: 8, quiet: true } })).some(node => node.type === 'ResidenceGift'))
})

test('wallet loading and failure are not presented as an empty bag or zero usage', async () => {
  const h = hooks(), service = { status: 'loading', ledger: [] }, state = empty()
  const code = await functions('../src/gifts/AssetWallet.tsx', ['AssetWallet'])
  const render = vm.runInNewContext(code + '\nAssetWallet', { React: { createElement: element }, ...h, useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true,
    useGiftState: () => state, useGiftService: () => service, giftLedgerUsage: () => [], AccountPage: 'AccountPage', GiftIcon: 'GiftIcon', giftServiceMessage: () => '暂时加载不出来，请重试。', getGift() {} })
  const tree = () => { h.reset(); return render({ owner: 'current', onClose() {} }) }
  let view = tree(); assert(text(view).includes('—')); assert.equal(nodes(view).filter(node => node.props?.className === 'asset-empty').length, 0)
  service.status = 'error'; view = tree(); assert(text(view).includes('—')); assert.equal(nodes(view).filter(node => node.props?.className === 'asset-empty').length, 0)
  nodes(view).find(node => node.type === 'button' && text(node) === '使用记录').props.onClick(); view = tree()
  assert.equal(nodes(view).filter(node => node.props?.className === 'asset-empty').length, 0)
  service.status = 'ready'; view = tree(); assert.equal(nodes(view).filter(node => node.props?.className === 'asset-empty').length, 1)
  nodes(view).find(node => node.type === 'button' && text(node) === '背包礼物').props.onClick(); view = tree()
  assert.equal(nodes(view).filter(node => node.props?.className === 'asset-empty').length, 1); assert(!text(view).includes('—'))
})

test('notice inbox only reports no notices after both notification sources have loaded', async () => {
  const h = hooks(), service = { notificationsStatus: 'ready', notifications: [] }, reminders = { snapshot: { status: 'loading', notices: [] } }
  const code = await functions('../src/gifts/SystemInbox.tsx', ['SystemInbox'])
  const render = vm.runInNewContext(code + '\nSystemInbox', { React: { createElement: element }, ...h, useId: () => 'detail', useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true,
    useGiftState: empty, useGiftService: () => service, AccountPage: 'AccountPage', Bell: 'Bell', CaretDown: 'CaretDown', Ticket: 'Ticket', giftServiceMessage: () => '暂时无法读取通知' })
  const tree = () => { h.reset(); return render({ owner: 'current', reminders, onClose() {}, onAssets() {} }) }
  assert(!text(tree()).includes('还没有系统通知'))
  reminders.snapshot.status = 'error'; assert(text(tree()).includes('纪念日提醒暂时无法读取')); assert(!text(tree()).includes('还没有系统通知'))
  reminders.snapshot.status = 'ready'; assert(text(tree()).includes('还没有系统通知'))
  service.notificationsStatus = 'loading'
  assert(!text(tree()).includes('还没有系统通知'))
})

class AlbumError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code } }
async function goalHarness({ claimError, fulfilled = false } = {}) {
  const h = hooks(), calls = [], closed = []
  const own = { id: 'mine', status: 'approved', reward: { status: fulfilled ? 'fulfilled' : 'pending' } }
  const goal = { id: 'invitation', name: '一位朋友', kind: 'home', world: 'warm', message: '一扇蓝窗', current: 2, target: 6, parts: ['门牌', '窗'], isOwner: false, helped: true, canHelp: false, completed: false, contributions: [], album: { status: 'active', url: null, ownContribution: own, viewerScope: { id: 'visitor', kind: 'account' } } }
  const key = JSON.stringify(['invitation', undefined, undefined])
  h.state.push({ key, value: goal }, false, false, '', false, '', 'visitor', 0, fulfilled, false)
  const code = await functions('../src/gifts/GiftGoals.tsx', ['publicTitle', 'albumIssue', 'GiftGoalView'])
  const render = vm.runInNewContext(code + '\nGiftGoalView', { React: { createElement: element }, ...h, useI18n: () => ({ lang: 'zh-CN' }), isZh: () => true,
    useContentReports: () => undefined, AlbumError, I: icons, Suspense: 'Suspense', GiftGoalScene: 'GiftGoalScene', Header: 'Header',
    homeParts: ['门牌', '窗', '灯', '长椅', '花箱', '屋顶'], homePartsEn: ['Nameplate', 'Window', 'Lamp', 'Bench', 'Flower box', 'Roof'],
    albumPending() {}, albumContributionKey: () => 'pending', pendingAlbumReviews: () => [],
    claimAlbum: async (...args) => { calls.push(args); if (claimError) throw claimError; return { status: 'fulfilled' } },
    URLSearchParams, location: { search: '', origin: 'https://local.test' },
  })
  return { calls, closed, tree() { h.reset(); return render({ id: 'invitation', onClose: () => closed.push(true) }) } }
}

test('a shared-wish action first collects the voucher, then takes the user to gifts without collecting again', async () => {
  const h = await goalHarness(); let view = h.tree()
  const claim = nodes(view).find(node => node.type === 'button' && text(node) === '领取赠礼券'); assert(claim)
  await claim.props.onClick(); assert.equal(h.calls.length, 1); assert.equal(h.closed.length, 0)
  view = h.tree(); const choose = nodes(view).find(node => node.type === 'button' && text(node) === '去挑礼物'); assert(choose)
  choose.props.onClick(); assert.equal(h.calls.length, 1); assert.equal(h.closed.length, 1)
})

test('reopening an awarded shared wish offers the next action rather than another voucher claim', async () => {
  const h = await goalHarness({ fulfilled: true }), view = h.tree()
  assert(!nodes(view).some(node => node.type === 'button' && text(node) === '领取赠礼券'))
  nodes(view).find(node => node.type === 'button' && text(node) === '去挑礼物').props.onClick()
  assert.equal(h.calls.length, 0); assert.equal(h.closed.length, 1)
})

test('a closed invitation explains why collection is unavailable without claiming success', async () => {
  const h = await goalHarness({ claimError: new AlbumError(409, 'ALBUM_CLOSED') })
  await nodes(h.tree()).find(node => node.type === 'button' && text(node) === '领取赠礼券').props.onClick()
  const view = h.tree(); assert(text(view).includes('这张邀请已关闭，不能再投稿或领取新的赠礼券'))
  assert(!text(view).includes('赠礼券已到账')); assert.equal(h.closed.length, 0)
})
