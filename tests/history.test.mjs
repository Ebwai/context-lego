import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { prepareHistory, appendHistory } from '../src/history.js'
import { Session } from '@deepseek-ai/dsh-session'

import * as llm from '@deepseek-ai/dsh-llm'
const deps = {Session, ...llm, projections: []}
const surface = {surfaceOp: 'append'}
function fixture(id, question) {
  const s = Session.create(id)
  s.append('system/message', {turn:1,step:1,message:llm.createSystemMessage('system')}, surface)
  s.append('turn/start', {turn:1})
  s.append('step/start', {turn:1,step:1})
  s.append('user/message', llm.createUserMessage({content:[{type:'text',text:question}],source:{kind:'user'}}),surface)
  s.append('assistant/message', {turn:1,step:1,stream:[],message:llm.createAssistantMessage({source:{provider:'test',model:'test'},content:[{type:'tool-call',id:'call-1',name:'read',arguments:'{}'}]})},surface)
  s.append('tool/call',{turn:1,step:1,callId:'call-1',name:'read',arguments:'{}'})
  s.append('tool/result',{turn:1,step:1,message:llm.createToolResultMessage({callId:'call-1',content:[{type:'text',text:'tool output'}],isError:false})},surface)
  s.append('assistant/message',{turn:1,step:1,stream:[],message:llm.createAssistantMessage({source:{provider:'test',model:'test'},content:[{type:'text',text:'answer'}]})},surface)
  s.append('step/end',{turn:1,step:1})
  const end = s.append('turn/end',{turn:1,reason:{kind:'completed'}})
  return {s, ref:{kind:'turn',sessionId:id,endSeq:end.seq}}
}
const a=fixture('a','question a'),b=fixture('b','question b')
const sources=new Map([['a',a.s],['b',b.s]])
const read=async ref=>{const s=sources.get(ref.sessionId);return {events:s.snapshotEvents(),header:s.header,inheritedEventCount:s.inheritedEventCount}}
const records=await prepareHistory([a.ref],read,deps)
const target=Session.create('target');appendHistory(target,records)
assert.deepEqual(target.deriveMessages(),a.s.deriveMessages())
const combined=Session.create('combined')
appendHistory(combined,await prepareHistory([b.ref,a.ref],read,deps))
assert.deepEqual(combined.deriveMessages().map(m=>m.role),['system','user','assistant','tool','assistant','user','assistant','tool','assistant'])
const msgs=combined.deriveMessages();assert.equal(msgs[1].content[0].text,'question b')
assert.notEqual(msgs[2].content[0].id,msgs[6].content[0].id)
assert.equal(msgs[6].content[0].id,msgs[7].toolCallId)
const legacy=Session.create('legacy')
appendHistory(legacy,await prepareHistory([{...a.ref,legacy:true,question:'original question'}],read,deps))
assert.equal(legacy.deriveMessages()[1].content[0].text,'original question')
await assert.rejects(prepareHistory([a.ref,a.ref],read,deps),/重复选择/)
await assert.rejects(prepareHistory([a.ref], async () => {
  const snapshot = await read(a.ref)
  snapshot.events = snapshot.events.filter(event => event.type !== 'tool/result').map((event, seq) => ({ ...event, seq }))
  return snapshot
}, deps), /完整轮次不可用/)
await assert.rejects(prepareHistory([{ ...a.ref, endSeq: undefined }], async () => {
  const snapshot = await read(a.ref)
  snapshot.events = snapshot.events.filter(event => event.type !== 'tool/result').map((event, seq) => ({ ...event, seq }))
  return snapshot
}, deps), /尚无结果/)
const prompts=Session.create('prompts')
appendHistory(prompts,await prepareHistory([{kind:'prompt',question:'reusable'}],read,deps))
assert.equal(prompts.deriveMessages()[0].role,'user')
console.log('PASS actual Harness Session: exact native messages, ordered merge, paired tool ids, legacy migration, duplicate rejection, prompt nodes')

let client
const clientCode = readFileSync(new URL('../src/client/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  .replace("    return {\n      name: 'dsh-conversation-tree-client'", "    return { inspectRun, contextFor, layoutTree, NativeConversation, quotePrompt, nativeTurnOwner, deleteTreeNodes, load, readBoards, compositionContext, compositionPlacement, installResourceMirror,\n      name: 'dsh-conversation-tree-client'")
const boardStorage = new Map()
vm.runInNewContext(clientCode, { localStorage: { getItem: key => boardStorage.get(key) ?? null }, window: { __ModuleLoader__: { load({ factory }) { client = factory(() => ({ createElement: (type, props, ...children) => ({ type, props, children }), useEffect: () => {}, useState: () => [null, () => {}] })) } } } })
assert.equal(client.readBoards().activeId, 'default')
boardStorage.set('dsh-conversation-tree/v2', JSON.stringify([{ id: 'legacy-node' }]))
boardStorage.set('isolated-board', JSON.stringify([{ id: 'new-node' }]))
assert.equal(client.load()[0].id, 'legacy-node')
assert.equal(client.load('isolated-board')[0].id, 'new-node')
assert.equal(client.load('empty-board').length, 0)
assert.ok(Array.from(client.inject).includes('remote'), 'Cordis requires the remote root service when reading ctx.remote')
let slotRegistration
client.apply({
  sidebarRight: { openResource() {}, openTab() {} },
  sessions: {}, remote: { session: {}, agentPresets: {}, commands: {} },
  effect: effect => effect(),
  slots: { entries: () => [], subscribe: () => () => {}, inject: (_name, register) => register(), register: registration => { if (registration.name === 'shell.overlay') slotRegistration = registration } },
})
const injected = slotRegistration.inject()
assert.ok(injected.remote.session)
assert.ok(injected.remote.agentPresets)
assert.equal(slotRegistration.children['context-lego.session'].scope, 'session')
let embedded
client.NativeConversation({
  useSession: () => ({ blank: false }), useInput: () => ({ draft: '' }), draft: false,
  renderFactorySlot: (name, props) => { embedded = { name, props } },
})
assert.equal(embedded.name, 'conversation.content')
assert.equal(embedded.props.variant, 'embedded')
assert.equal(embedded.props.hero, false)
const mirrored = []
const disposedMirrors = []
const nativeEntry = { component: () => null, options: { id: 'native-view' }, children: { 'native.child': { kind: 'single', scope: 'session' } } }
const stopMirror = client.installResourceMirror({ slots: {
  entries: name => name === 'native.parent' ? [nativeEntry] : [],
  subscribe: () => () => {},
  register: (options, component) => { mirrored.push({ options, component }); return () => disposedMirrors.push(options.name) },
} }, 'native.parent', 'context-lego.test-native')
assert.equal(mirrored[0].options.name, 'context-lego.test-native')
assert.equal(mirrored[0].options.children['context-lego.resources/native.child'].scope, 'session')
const nativeRender = mirrored[0].component({ renderSlot: name => name })
assert.equal(nativeRender.props.renderSlot('native.child'), 'context-lego.resources/native.child')
stopMirror()
assert.ok(disposedMirrors.includes('context-lego.test-native'))
const inherited = a.s.snapshotEvents()
const followup = [
  { type: 'turn/start', data: { turn: 2 } },
  { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: 'new answer' }] } } },
  { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
].map((event, index) => ({ ...event, seq: inherited.length + index }))
const result = client.inspectRun({ getSnapshot: () => ({ entries: [...inherited, ...followup].map(event => ({ event })) }) }, inherited.at(-1).seq)
assert.equal(result.answer, 'new answer')
assert.equal(result.turn, 2)
assert.equal(result.endSeq, followup.at(-1).seq)
console.log('PASS client: inherited turns cannot overwrite the new node reply')
const tree = [
  { id: 'left', parentId: null, status: 'done' },
  { id: 'same', parentId: null, status: 'done' },
  { id: 'right', parentId: 'left', status: 'done' },
]
assert.deepEqual(Array.from(client.contextFor({ mode: 'manual', selected: ['right', 'same', 'left'] }, tree), item => item.id), ['same', 'left', 'right'])
assert.deepEqual(Array.from(client.contextFor({ mode: 'quote', parentId: 'right', selected: [], inheritPath: false }, tree)), [])
assert.deepEqual(Array.from(client.contextFor({ mode: 'quote', parentId: 'right', selected: [], inheritPath: true }, tree), item => item.id), ['left', 'right'])
const mergeTree = [
  { id: 'a', parentId: null, status: 'done' },
  { id: 'b', parentId: 'a', status: 'done' },
  { id: 'c', parentId: 'a', status: 'done' },
  { id: 'd', parentId: 'b', status: 'done' },
  { id: 'brick', parentId: null, detached: true, kind: 'prompt', status: 'done' },
]
assert.deepEqual(Array.from(client.compositionContext(mergeTree, ['d', 'c', 'brick'], ['d', 'c']), n => n.id), ['brick', 'a', 'b', 'c', 'd'])
assert.deepEqual(Array.from(client.compositionContext(mergeTree, ['d', 'c']), n => n.id), ['c', 'd'])
const placement = client.compositionPlacement(mergeTree, ['d', 'c', 'brick'], ['d', 'c'])
assert.equal(placement.parentId, 'd')
assert.deepEqual(Array.from(placement.extraSourceIds), ['c', 'brick'])
const combinedParent = { kind: 'turn', id: 'combined', parentId: 'd', contextIds: ['brick', 'a', 'b', 'c', 'd'], status: 'done' }
assert.deepEqual(Array.from(client.contextFor({ mode: 'branch', parentId: 'combined', selected: [] }, [...mergeTree, combinedParent]), n => n.id), ['brick', 'a', 'b', 'c', 'd', 'combined'])
assert.deepEqual(Array.from(client.contextFor({ mode: 'branch', parentId: 'd', selected: [] }, mergeTree.map(n => ({ ...n, kind: 'prompt', contextIds: [] }))), n => n.id), ['a', 'b', 'd'])
const brickLayout = client.layoutTree([mergeTree.at(-1)], undefined, null)
assert.equal(brickLayout.get('brick').x, 0)
assert.ok(brickLayout.get('brick').y > brickLayout.get(null).y)
const deletedSingle = client.deleteTreeNodes(tree, 'left', false)
assert.deepEqual(Array.from(deletedSingle, n => n.id), ['same', 'right'])
assert.equal(deletedSingle.find(n => n.id === 'right').parentId, null)
assert.equal(tree.find(n => n.id === 'right').parentId, 'left', 'deletion must not mutate saved originals')
assert.deepEqual(Array.from(client.deleteTreeNodes(tree, 'left', true), n => n.id), ['same'])
assert.equal(client.deleteTreeNodes(tree, 'missing', true), tree)
const pendingQuote = { id: 'quote-draft', sessionId: 'quote-session', status: 'running', afterSeq: 5 }
assert.equal(client.nativeTurnOwner([pendingQuote], 'quote-session', { seq: 8, data: { turn: 1 } }).id, 'quote-draft')
assert.equal(client.nativeTurnOwner([{ ...pendingQuote, turn: 1 }], 'quote-session', { seq: 20, data: { turn: 2 } }), undefined)
assert.ok(client.quotePrompt('exact selected text', 'explain').includes('exact selected text'))
assert.ok(client.quotePrompt('selected', 'ask', 'What does this mean?').endsWith('What does this mean?'))
assert.equal(client.layoutTree([], undefined, null).size, 1)
assert.equal(client.layoutTree([], undefined, null).get(null).node.title, '系统提示词')
const explicitSystem = Session.create('explicit-system')
appendHistory(explicitSystem, await prepareHistory([{ kind: 'system', question: 'custom system' }, a.ref], read, deps))
assert.equal(explicitSystem.deriveMessages()[0].role, 'system')
assert.equal(explicitSystem.deriveMessages()[0].content[0].text, 'custom system')
const continued = client.inspectRun({ getSnapshot: () => ({ entries: followup.slice(1).map(event => ({ event })) }) }, inherited.at(-1).seq, 2)
assert.equal(continued.answer, 'new answer')
console.log('PASS composition: depth order, selection order, system root, system role, continuation')

