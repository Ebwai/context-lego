// The Host owns history reads. Browser requests carry turn locators, not model messages.
export function appendHistory(session, records) {
  for (const record of records) {
    let data = record.data
    if (record.type === 'developer/message' && typeof data.headerSeq === 'object') {
      const header = session.append('request/header', data.headerSeq.header)
      data = { ...data, headerSeq: header.seq }
    }
    session.append(record.type, data, record.options)
  }
}

export async function prepareHistory(selection, readSource, { Session, createSystemMessage, createUserMessage, projections }) {
  const records = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'system/message', data: { turn: 1, step: 1, message: createSystemMessage('') }, options: { surfaceOp: 'append' } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const knownSources = new Map()
  const selected = new Set()
  const toolIds = new Set()
  let turn = 1
  let copiedSystem = false
  const append = (type, data, surface = false) => records.push({
    type, data, options: surface ? { surfaceOp: 'append' } : undefined,
  })

  for (const input of selection) {
    if (!input || typeof input !== 'object') throw new Error('节点引用无效')
    if (input.kind === 'system') {
      if (typeof input.question !== 'string') throw new Error('系统提示词格式无效')
      records[2].data.message = createSystemMessage(input.question)
      copiedSystem = true
      continue
    }
    turn++
    if (input.kind === 'prompt') {
      if (typeof input.question !== 'string' || !input.question.trim()) throw new Error('提示词为空')
      append('turn/start', { turn })
      append('user/message', createUserMessage({
        content: [{ type: 'text', text: input.question }], source: { kind: 'user' },
      }), true)
      append('turn/end', { turn, reason: { kind: 'completed' } })
      continue
    }
    if (typeof input.sessionId !== 'string') throw new Error('历史节点缺少 Harness 会话引用')
    let source = knownSources.get(input.sessionId)
    if (!source) {
      source = await readSource(input)
      knownSources.set(input.sessionId, source)
    }
    const { events, header, inheritedEventCount } = source
    const end = input.endSeq === undefined
      ? events.findLast(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')
      : events[input.endSeq]
    if (!end || end.type !== 'turn/end' || end.data.reason.kind !== 'completed') {
      throw new Error('所选节点的完整轮次不可用，请先完成这一轮对话')
    }
    const start = events.findLast(event => event.seq < end.seq && event.type === 'turn/start' && event.data.turn === end.data.turn)
    if (!start) throw new Error('历史轮次缺少开始记录')
    const identity = `${input.sessionId}/${end.seq}`
    if (selected.has(identity)) throw new Error('同一轮历史不能重复选择')
    selected.add(identity)

    const replay = Session.create(header.id, events.slice(0, end.seq + 1), header, inheritedEventCount, projections)
    const native = replay.surface.nodes.map(seq => ({ event: events[seq], message: replay.deriveEventMessage(events[seq]) }))
      .filter(item => item.message)
    if (!copiedSystem) {
      const systems = native.filter(item => item.message.role === 'system').map(({ message }) => ({
        type: 'system/message', data: { turn: 1, step: 1, message }, options: { surfaceOp: 'append' },
      }))
      if (systems.length) records.splice(2, 1, ...systems)
      copiedSystem = true
    }
    const own = native.filter(item => item.event.seq > start.seq && item.event.seq < end.seq && item.message.role !== 'system')
    if (!own.some(item => item.message.role === 'user') || !own.some(item => item.message.role === 'assistant')) {
      throw new Error('这一轮原始问答已被压缩或替换，无法单独组装，请选择可用轮次')
    }
    append('turn/start', { turn })
    append('step/start', { turn, step: 1 })
    const calls = new Map()
    const outstanding = new Set()
    let replacedLegacyQuestion = false
    for (const { event, message: original } of own) {
      const message = structuredClone(original)
      const toolCalls = []
      if (input.legacy && message.role === 'user' && message.source.kind === 'user' && !replacedLegacyQuestion) {
        if (typeof input.question !== 'string') throw new Error('旧节点缺少原始提问')
        message.content = [{ type: 'text', text: input.question }]
        replacedLegacyQuestion = true
      }
      if (message.role === 'assistant') {
        for (const block of message.content) {
          if (block.type !== 'tool-call') continue
          if (calls.has(block.id)) throw new Error('同一轮包含重复工具调用标识')
          const oldId = block.id
          // Preserve identifiers unless two independently generated turns collide.
          if (toolIds.has(oldId)) block.id = `lego-${turn}-${calls.size}-${oldId}`
          calls.set(oldId, block.id)
          toolIds.add(block.id)
          outstanding.add(block.id)
          toolCalls.push({ turn, step: 1, callId: block.id, name: block.name, arguments: block.arguments })
        }
      }
      if (message.role === 'tool') {
        const callId = calls.get(message.toolCallId)
        if (!callId || !outstanding.delete(callId)) throw new Error('工具请求与结果不完整，无法组装这一轮')
        message.toolCallId = callId
        message.source.callId = callId
      }
      if (message.role === 'user') append('user/message', message, true)
      else if (message.role === 'assistant') append('assistant/message', { turn, step: 1, message, stream: [] }, true)
      else if (message.role === 'tool') append('tool/result', { turn, step: 1, message }, true)
      else if (message.role === 'developer') {
        const data = { turn, step: 1, message }
        if (event.data.headerSeq !== undefined) {
          const sourceHeader = events[event.data.headerSeq]
          if (sourceHeader?.type !== 'request/header') throw new Error('历史工具定义缺失')
          // Header positions are resolved when appending to the target Session.
          data.headerSeq = { header: structuredClone(sourceHeader.data) }
        }
        append('developer/message', data, true)
      } else throw new Error(`暂不支持导入消息角色 ${message.role}`)
      for (const call of toolCalls) append('tool/call', call)
    }
    if (outstanding.size) throw new Error('这一轮包含尚无结果的工具调用')
    append('step/end', { turn, step: 1 })
    append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return records
}
