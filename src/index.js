import { Session } from '@deepseek-ai/dsh-session'
import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendHistory, prepareHistory } from './history.js'

export const name = 'dsh-conversation-tree'
export const inject = ['commands', 'sessions', 'sessionQuery', 'tokenMeter', 'llm']

export function apply(ctx) {
  const active = new Set()
  ctx.effect(() => ctx.commands.register({
    name: 'context-lego-capacity', recordInput: false,
    description: 'Measure the assembled draft without a model call',
    handler: async ({ agent, rawInput, signal }) => {
      const { text, provider, model } = JSON.parse(rawInput)
      const snapshot = await ctx.sessionQuery.observeSession(agent.id)
      let preview
      try { preview = Session.create(agent.id, structuredClone(snapshot.events), structuredClone(snapshot.header), snapshot.inheritedEventCount, ctx.sessions.messageProjections) }
      finally { snapshot[Symbol.dispose]() }
      if (text) preview.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const measurement = ctx.tokenMeter.measure(preview)
      const info = provider && model ? await ctx.llm.resolveModelInfo(provider, model, signal) : null
      return { kind: 'success', text: JSON.stringify({ tokens: measurement.totalTokens, maximum: info?.context?.contextWindow ?? null }) }
    },
  }))
  ctx.effect(() => ctx.commands.register({
    name: 'context-lego-history',
    description: 'Assemble selected turns as native Harness history',
    recordInput: false,
    handler: async ({ agent, rawInput, signal }) => {
      if (active.has(agent.id)) throw new Error('该会话正在组装上下文')
      active.add(agent.id)
      try {
        const selection = JSON.parse(rawInput)
        if (!Array.isArray(selection)) throw new Error('上下文选择格式无效')
        if (agent.status !== 'idle' || agent.session.deriveMessages().some(message => message.role !== 'system')) {
          throw new Error('只能向尚未开始对话的新会话组装历史')
        }
        const target = await ctx.sessionQuery.observeSession(agent.id)
        let seed
        try {
          seed = structuredClone(target.events)
        } finally {
          target[Symbol.dispose]()
        }
        const history = await prepareHistory(selection, async input => {
          signal.throwIfAborted()
          const source = await ctx.sessionQuery.observeSession(input.sessionId)
          try {
            return {
              events: structuredClone(source.events),
              header: structuredClone(source.header),
              inheritedEventCount: source.inheritedEventCount,
            }
          } finally {
            source[Symbol.dispose]()
          }
        }, { Session, createSystemMessage, createUserMessage, projections: ctx.sessions.messageProjections })

        signal.throwIfAborted()
        // Validate the complete import before publishing any of it.
        const checked = Session.create(agent.id, seed, agent.session.header, 0, ctx.sessions.messageProjections)
        appendHistory(checked, history)
        if (agent.status !== 'idle' || agent.session.deriveMessages().some(message => message.role !== 'system')) {
          throw new Error('会话在组装期间已收到其他输入，请重新创建卡片')
        }
        appendHistory(agent.session, history)
        await ctx.sessions.flush(agent.session)
        return { kind: 'success', text: '原生上下文已组装' }
      } finally {
        active.delete(agent.id)
      }
    },
  }))
}

