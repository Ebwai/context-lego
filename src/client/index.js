window.__ModuleLoader__.load({
  id: 'dsh-conversation-tree',
  factory(require) {
    const { createElement: h, useEffect, useLayoutEffect, useMemo, useRef, useState } = require('react')
    const key = 'dsh-conversation-tree/v2'
    const root = { id: null, title: '系统提示词', kind: 'root' }
    const button = (label, action, props = {}) =>
      h('button', { type: 'button', onClick: action, ...props }, label)

    function load(storageKey = key) {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      if (!Array.isArray(value)) throw new Error('对话树数据无法读取')
      return value
    }

    function deleteTreeNodes(nodes, id, subtree) {
      const target = nodes.find(node => node.id === id)
      if (!target) return nodes
      const removed = new Set([id])
      if (subtree) {
        let changed = true
        while (changed) {
          changed = false
          for (const node of nodes) if (removed.has(node.parentId) && !removed.has(node.id)) { removed.add(node.id); changed = true }
        }
      }
      return nodes.filter(node => !removed.has(node.id)).map(node =>
        !subtree && node.parentId === id ? { ...node, parentId: target.parentId } : node)
    }

    function readBoards() {
      const saved = JSON.parse(localStorage.getItem(`${key}/boards`) ?? 'null')
      if (!saved) return { activeId: 'default', boards: [{ id: 'default', name: '画板 1' }] }
      if (!Array.isArray(saved.boards) || !saved.boards.length || saved.boards.some(board => typeof board.id !== 'string' || typeof board.name !== 'string')) throw new Error('画板列表无法读取')
      return { ...saved, activeId: saved.boards.some(board => board.id === saved.activeId) ? saved.activeId : saved.boards[0].id }
    }

    function BoardManager(props) {
      const [catalog, setCatalog] = useState(() => { try { return readBoards() } catch (error) { return { boards: [], error: error.message } } })
      const [locked, setLocked] = useState(false)
      const [autoOpen, setAutoOpen] = useState(false)
      const [editingName, setEditingName] = useState(false)
      const [nameDraft, setNameDraft] = useState('')
      function save(next) { setAutoOpen(true); localStorage.setItem(`${key}/boards`, JSON.stringify(next)); setCatalog(next) }
      if (catalog.error) return h('p', { role: 'alert' }, catalog.error)
      const active = catalog.boards.find(board => board.id === catalog.activeId)
      function create() {
        const board = { id: crypto.randomUUID(), name: `画板 ${catalog.boards.length + 1}` }
        save({ activeId: board.id, boards: [...catalog.boards, board] })
      }
      function rename(event) {
        event.preventDefault()
        const name = nameDraft.trim()
        if (!name) return
        save({ ...catalog, boards: catalog.boards.map(board => board.id === active.id ? { ...board, name } : board) })
        setEditingName(false)
      }
      const controls = h('div', { className: 'dct-board-controls' },
        editingName ? h('form', { className: 'dct-rename-form', onSubmit: rename,
          onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditingName(false) } } },
          h('input', { value: nameDraft, autoFocus: true, 'aria-label': '画板名称', maxLength: 80, disabled: locked,
            onChange: event => setNameDraft(event.target.value) }),
          h('button', { type: 'submit', title: '保存名称', 'aria-label': '保存画板名称', disabled: locked || !nameDraft.trim(), className: 'dct-icon-button' }, '✓'),
          button('×', () => setEditingName(false), { title: '取消', 'aria-label': '取消重命名', className: 'dct-icon-button' }))
        : h('label', {}, h('span', {}, '画板'), h('select', { value: active.id, disabled: locked, title: active.name, 'aria-label': '切换画板',
          onChange: event => save({ ...catalog, activeId: event.target.value }) },
          catalog.boards.map(board => h('option', { key: board.id, value: board.id, title: board.name }, board.name)))),
        !editingName && button('✎', () => { setNameDraft(active.name); setEditingName(true) }, { disabled: locked, title: '重命名画板', 'aria-label': '重命名画板', className: 'dct-icon-button' }),
        !editingName && button('+', create, { disabled: locked, title: '新建画板', 'aria-label': '新建画板', className: 'dct-icon-button' }))
      return h(TreeApp, { ...props, key: active.id, storageKey: active.id === 'default' ? key : `${key}/board/${active.id}`, boardControls: controls, onLock: setLocked, autoOpen })
    }

    function pathTo(nodes, parentId) {
      const path = []
      const byId = new Map(nodes.map(node => [node.id, node]))
      const visited = new Set()
      for (let id = parentId; id !== null;) {
        const node = byId.get(id)
        if (!node || visited.has(id)) throw new Error('无法还原祖先路径')
        visited.add(id)
        path.push(node)
        id = node.parentId
      }
      return path.reverse()
    }

    function compositionContext(nodes, selected, inherited = []) {
      const byId = new Map(nodes.map(node => [node.id, node]))
      const seen = new Set()
      const context = []
      for (const id of selected) {
        const node = byId.get(id)
        if (!node) continue
        const inputs = inherited.includes(id) && !node.detached ? pathTo(nodes, id) : [node]
        for (const item of inputs) {
          if (seen.has(item.id) || item.kind === 'compaction' || item.status === 'compacted') continue
          seen.add(item.id)
          context.push(item)
        }
      }
      return context.sort((a, b) => (a.detached ? 0 : pathTo(nodes, a.id).length) - (b.detached ? 0 : pathTo(nodes, b.id).length))
    }

    function compositionPlacement(nodes, selected, inherited = []) {
      const byId = new Map(nodes.map(node => [node.id, node]))
      const chains = selected.map(id => byId.get(id)).filter(node => node && !node.detached && inherited.includes(node.id))
      const parent = chains.sort((a, b) => pathTo(nodes, b.id).length - pathTo(nodes, a.id).length)[0]
      const primary = new Set(parent ? pathTo(nodes, parent.id).map(node => node.id) : [])
      return { parentId: parent?.id ?? null, extraSourceIds: selected.filter(id => byId.has(id) && !primary.has(id)) }
    }

    function branchContext(nodes, parentId) {
      const parent = nodes.find(node => node.id === parentId)
      const byId = new Map(nodes.map(node => [node.id, node]))
      const ids = parent?.contextIds
      const path = parent?.kind === 'turn' && Array.isArray(ids) && ids.every(id => byId.has(id)) ? [...ids.map(id => byId.get(id)), parent] : pathTo(nodes, parentId)
      return path.filter(node => node && node.kind !== 'compaction' && node.status !== 'compacted')
    }

    function contextFor(draft, nodes) {
      if (draft.mode === 'quote' && !draft.inheritPath) return []
      if (draft.mode === 'manual') return compositionContext(nodes, draft.selected, draft.inherited)
      if (draft.mode === 'branch') return branchContext(nodes, draft.parentId)
      return pathTo(nodes, draft.parentId).filter(node => node.kind !== 'compaction' && node.status !== 'compacted')
    }

    function nativeTurnOwner(nodes, sessionId, event) {
      return nodes.find(node => node.sessionId === sessionId && (node.turn === event.data.turn
        || node.turn === undefined && node.status === 'running' && node.afterSeq < event.seq))
    }

    function quotePrompt(text, action, question = '') {
      return `引用原文：\n<quoted_text>\n${text}\n</quoted_text>\n\n${action === 'explain' ? '请解释以上引用内容。' : question.trim()}`
    }

    function SelectionActions({ node, onBranch, disabled, children }) {
      const surface = useRef(null)
      const menu = useRef(null)
      const [selection, setSelection] = useState(null)
      const selectionRef = useRef(null)
      selectionRef.current = selection
      useEffect(() => {
        const dismiss = event => {
          if (!menu.current?.contains(event.target)) setSelection(null)
        }
        const escape = event => {
          if (event.key === 'Escape' && selectionRef.current) {
            event.preventDefault()
            event.stopPropagation()
            setSelection(null)
          }
        }
        const clear = () => setSelection(null)
        document.addEventListener('pointerdown', dismiss, true)
        document.addEventListener('keydown', escape, true)
        document.addEventListener('scroll', clear, true)
        window.addEventListener('resize', clear)
        return () => {
          document.removeEventListener('pointerdown', dismiss, true)
          document.removeEventListener('keydown', escape, true)
          document.removeEventListener('scroll', clear, true)
          window.removeEventListener('resize', clear)
        }
      }, [])
      function readSelection(event) {
        if (disabled || menu.current?.contains(event.target)) return
        const value = window.getSelection()
        if (!value || value.isCollapsed || !value.rangeCount) { setSelection(null); return }
        const element = value.anchorNode?.nodeType === 1 ? value.anchorNode : value.anchorNode?.parentElement
        if (!surface.current?.contains(value.anchorNode) || !surface.current.contains(value.focusNode)
          || element?.closest('input, textarea, [contenteditable="true"]')) { setSelection(null); return }
        const text = value.toString().trim()
        if (!text) { setSelection(null); return }
        const rect = value.getRangeAt(0).getBoundingClientRect()
        const width = Math.min(340, window.innerWidth - 24)
        setSelection({ text, inheritPath: false, asking: false, question: '',
          left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
          top: Math.max(48, rect.top - 100), width })
      }
      function branch(action) {
        if (!selection || (action === 'ask' && !selection.question.trim())) return
        const current = selection
        setSelection(null)
        void onBranch(node, { text: current.text, action, question: current.question, inheritPath: current.inheritPath })
      }
      return h('div', { ref: surface, className: 'dct-quote-surface',
        onPointerUp: readSelection, onKeyUp: event => { if (event.key === 'Shift') readSelection(event) } },
        children,
        selection && h('div', { ref: menu, className: 'dct-selection-menu', role: 'dialog', 'aria-label': '选中文字操作',
          style: { position: 'fixed', left: selection.left, top: selection.top, width: selection.width, maxHeight: window.innerHeight - selection.top - 12 },
          onPointerDown: event => event.stopPropagation() },
          h('div', { className: 'dct-actions' },
            button('解释', () => branch('explain'), { disabled, onMouseDown: event => event.preventDefault() }),
            button('进一步询问', () => setSelection(current => ({ ...current, asking: true, top: Math.max(48, Math.min(current.top, window.innerHeight - 270)) })), { disabled, onMouseDown: event => event.preventDefault() })),
          h('label', { className: 'dct-inherit-path' },
            h('input', { type: 'checkbox', checked: selection.inheritPath,
              disabled: node.detached || (node.kind !== 'root' && node.status !== 'done'),
              title: node.kind !== 'root' && node.status !== 'done' ? '本轮完成后可继承完整上下文' : undefined,
              onChange: event => setSelection(current => ({ ...current, inheritPath: event.target.checked })) }),
            '继承从根节点到当前节点的完整上下文'),
          selection.asking && h('form', { onSubmit: event => { event.preventDefault(); branch('ask') } },
            h('textarea', { autoFocus: true, 'aria-label': '针对选中文字继续提问', placeholder: '针对选中文字，输入你的问题',
              value: selection.question, onChange: event => setSelection(current => ({ ...current, question: event.target.value })) }),
            h('button', { type: 'submit', disabled: disabled || !selection.question.trim() }, '创建分支并询问'))))
    }

    function titleFor(text) {
      return Array.from(text.replace(/\s+/gu, ' ').trim()).slice(0, 60).join('')
    }

    function inspectRun(eventSource, afterSeq = -1, activeTurn) {
      let turn = activeTurn
      const answers = []
      for (const { event } of eventSource.getSnapshot().entries) {
        if (event.seq <= afterSeq) continue
        if (event.type === 'turn/start') {
          turn ??= event.data.turn
        }
        if (turn === undefined || event.data?.turn !== turn) continue
        if (event.type === 'assistant/message') {
          const text = event.data.message.content
            .filter(block => block.type === 'text')
            .map(block => block.text).join('')
          if (text.trim()) answers.push(text)
        }
        if (event.type === 'turn/end') {
          const reason = event.data.reason
          const answer = answers.join('\n\n')
          if (reason.kind === 'error') {
            return { status: 'error', answer, error: reason.error.message || reason.error.code }
          }
          if (reason.kind !== 'completed') return { status: 'error', answer, error: `Agent 本轮未完成（${reason.kind}）` }
          if (!answer) return { status: 'error', error: 'Agent 本轮结束，但没有返回正文' }
          return { status: 'done', answer, endSeq: event.seq, turn }
        }
      }
      return null
    }

    function readInitial(storageKey = key) {
      try {
        return { nodes: load(storageKey), error: '' }
      } catch (error) {
        return { nodes: [], error: String(error.message ?? error) }
      }
    }

    function layoutTree(nodes, draftId, draftParent, draftSources = []) {
      const children = new Map()
      const add = node => {
        if (!children.has(node.parentId)) children.set(node.parentId, [])
        children.get(node.parentId).push(node)
      }
      for (const node of nodes) if (!node.detached) add(node)
      if (draftId) add({ id: draftId, parentId: draftParent, kind: 'draft', title: '未发送的卡片', extraSourceIds: draftSources })

      // Allocate one row per leaf and center each parent over its children.
      const positions = new Map()
      const pending = [{ node: root, depth: 0, finish: false }]
      let nextRow = 0
      while (pending.length) {
        const { node, depth, finish } = pending.pop()
        const branch = children.get(node.id) ?? []
        if (!finish) positions.set(node.id, { node, x: depth * 164, y: 0 })
        if (branch.length && !finish) {
          pending.push({ node, depth, finish: true })
          for (let index = branch.length - 1; index >= 0; index--) {
            pending.push({ node: branch[index], depth: depth + 1, finish: false })
          }
          continue
        }
        const y = branch.length
          ? (positions.get(branch[0].id).y + positions.get(branch.at(-1).id).y) / 2
          : nextRow++ * 98
        positions.get(node.id).y = y
      }
      const origin = positions.get(null).y
      for (const point of positions.values()) point.y -= origin
      const bottom = Math.max(...Array.from(positions.values(), point => point.y)) + 150
      nodes.filter(node => node.detached).forEach((node, index) => positions.set(node.id, { node, x: (index % 5) * 164, y: bottom + Math.floor(index / 5) * 98 }))
      return positions
    }

    function zoomAt(view, scale, x, y) {
      const next = Math.max(0.2, Math.min(2.5, scale))
      const ratio = next / view.scale
      return { x: x + (view.x - x) * ratio, y: y + (view.y - y) * ratio, scale: next }
    }

    function Board({ layout: baseLayout, draftId, draftParent, editor, expanded, openNodes, onExpand, renderCard, renderDraft, onBranch, selectedIds, branchDisabled }) {
      const [size, setSize] = useState({ width: 0, height: 0 })
      const [view, setView] = useState(null)
      const [dragging, setDragging] = useState(false)
      const [cardSizes, setCardSizes] = useState(new Map())
      const resizing = useRef(null)
      const board = useRef(null)
      const drag = useRef(null)
      const frame = useRef(0)
      const { width, height } = size
      const home = { x: Math.min(96, width * 0.18), y: height / 2, scale: 1 }
      const camera = view ?? home
      const activeId = draftId ?? expanded
      const visibleIds = draftId ? [...openNodes.filter(id => id !== draftId).slice(-3), draftId] : openNodes
      const windows = new Map(visibleIds.filter(id => baseLayout.has(id)).map(id => {
        const saved = cardSizes.get(id) ?? { width: 700, height: 520 }
        return [id, { width: Math.max(280, Math.min(saved.width, width - 24)),
          height: Math.max(200, Math.min(saved.height, height - 24)) }]
      }))
      const layout = new Map(Array.from(baseLayout, ([id, point]) => {
        let x = point.x, y = point.y
        for (const [windowId, dimensions] of windows) {
          const origin = baseLayout.get(windowId)
          x += Math.sign(point.x - origin.x) * dimensions.width / (2 * camera.scale)
          y += Math.sign(point.y - origin.y) * dimensions.height / (2 * camera.scale)
        }
        return [id, { ...point, x, y }]
      }))

      function beginResize(event, direction, node) {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        resizing.current = { id: event.pointerId, node, direction,
          x: event.clientX, y: event.clientY, ...windows.get(node) }
      }
      function moveResize(event) {
        const start = resizing.current
        if (!start || start.id !== event.pointerId) return
        event.stopPropagation()
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        const next = {
          width: Math.max(280, Math.min(width - 24, start.width + (start.direction.includes('e') ? 2 * dx : start.direction.includes('w') ? -2 * dx : 0))),
          height: Math.max(200, Math.min(height - 24, start.height + (start.direction.includes('s') ? 2 * dy : start.direction.includes('n') ? -2 * dy : 0))),
        }
        setCardSizes(current => new Map(current).set(start.node, next))
      }
      function endResize(event) {
        if (resizing.current?.id === event.pointerId) {
          resizing.current = null
          event.stopPropagation()
        }
      }

      useLayoutEffect(() => {
        const element = board.current
        const resize = new ResizeObserver(([entry]) => {
          setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
        })
        resize.observe(element)
        return () => resize.disconnect()
      }, [])

      useLayoutEffect(() => {
        const element = board.current
        const wheel = event => {
          if (event.target.closest('.dct-card')) return
          event.preventDefault()
          const rect = element.getBoundingClientRect()
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
          const factor = Math.exp(-event.deltaY * unit * 0.0018)
          setView(current => {
            const from = current ?? { x: Math.min(96, rect.width * 0.18), y: rect.height / 2, scale: 1 }
            return zoomAt(from, from.scale * factor, event.clientX - rect.left, event.clientY - rect.top)
          })
        }
        element.addEventListener('wheel', wheel, { passive: false })
        return () => {
          element.removeEventListener('wheel', wheel)
          cancelAnimationFrame(frame.current)
        }
      }, [])

      useLayoutEffect(() => {
        if (activeId === undefined) return
        const point = layout.get(activeId)
        const { clientWidth, clientHeight } = board.current
        if (!point || !clientWidth || !clientHeight) return
        setView(current => {
          const scale = current?.scale ?? 1
          return { x: clientWidth / 2 - point.x * scale, y: clientHeight / 2 - point.y * scale, scale }
        })
        editor.current?.focus({ preventScroll: true })
      }, [activeId, draftParent])

      function beginDrag(event) {
        if (event.button !== 0 || event.target.closest('button, .dct-card')) return
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camera }
        setDragging(true)
      }

      function moveDrag(event) {
        const start = drag.current
        if (start?.id !== event.pointerId) return
        const x = start.camera.x + event.clientX - start.x
        const y = start.camera.y + event.clientY - start.y
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => setView({ ...start.camera, x, y }))
      }

      function endDrag(event) {
        if (drag.current?.id !== event.pointerId) return
        drag.current = null
        setDragging(false)
      }

      function zoom(factor) {
        setView(current => {
          const from = current ?? home
          return zoomAt(from, from.scale * factor, width / 2, height / 2)
        })
      }

      function onKeyDown(event) {
        if (event.target !== board.current) return
        const offsets = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }
        if (event.key in offsets) {
          const [dx, dy] = offsets[event.key]
          setView(current => {
            const from = current ?? home
            return { ...from, x: from.x + dx, y: from.y + dy }
          })
        } else if (event.key === '+' || event.key === '=') zoom(1.25)
        else if (event.key === '-') zoom(0.8)
        else if (event.key === 'Home') setView(null)
        else return
        event.preventDefault()
      }

      function project(point) {
        return { x: camera.x + point.x * camera.scale, y: camera.y + point.y * camera.scale }
      }

      const dots = []
      const edges = []
      for (const { node, x, y } of layout.values()) {
        const point = project({ x, y })
        if (windows.has(node.id)) point.x -= windows.get(node.id).width / 2
        const parent = layout.get(node.parentId)
        if (width && height && parent && node.kind !== 'root' && !node.detached) {
          const start = project(parent)
          if (windows.has(parent.node.id)) start.x += windows.get(parent.node.id).width / 2
          if (point.x >= 0 && start.x <= width && Math.max(start.y, point.y) >= 0 && Math.min(start.y, point.y) <= height) {
            const middle = (start.x + point.x) / 2
            edges.push(h('path', { key: node.id, d: `M ${start.x} ${start.y} C ${middle} ${start.y}, ${middle} ${point.y}, ${point.x} ${point.y}` }))
          }
        }
        for (const sourceId of node.extraSourceIds ?? []) {
          const source = layout.get(sourceId)
          if (!source || sourceId === node.parentId) continue
          const start = project(source)
          if (windows.has(source.node.id)) start.x += windows.get(source.node.id).width / 2
          edges.push(h('path', { key: `${node.id}-source-${sourceId}`, className: 'dct-composition-edge', d: `M ${start.x} ${start.y} L ${point.x} ${point.y}` }))
        }
        if (!width || !height || point.x < -16 || point.x > width + 16 || point.y < -16 || point.y > height + 16) continue
        if (windows.has(node.id)) continue
        const label = node.detached ? `积木 · ${node.title}` : node.kind === 'prompt' ? `提示词 · ${node.title}` : node.title
        const active = node.kind === 'draft' || expanded === node.id
        dots.push(h('div', { key: node.id ?? 'root', className: 'dct-node', style: { left: point.x, top: point.y, '--hit': `${Math.min(30, 76 * camera.scale)}px` } }, button('', () => node.kind === 'draft' ? editor.current?.focus() : onExpand(node.id), {
          key: node.id ?? 'root',
          className: 'dct-dot',
          'data-kind': node.kind,
          'data-selected': selectedIds?.has(node.id) || undefined,
          'data-status': node.status,
          'aria-expanded': active,
          'aria-label': label,
          title: label,
        }), node.kind !== 'draft' && !node.detached && button(h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true }, h('path', { d: 'M8 3v10M3 8h10', strokeLinecap: 'round' })), () => onBranch(node.id), { className: 'dct-node-add', title: '继承此节点上下文并创建分支', 'aria-label': `从${label}创建分支`, disabled: branchDisabled || (node.kind !== 'root' && node.status !== 'done') })))
      }

      const card = Array.from(windows, ([id, dimensions]) => {
        const active = layout.get(id)
        const anchor = project(active)
        return h('div', {
          key: id ?? 'root', className: 'dct-card',
          style: { width: dimensions.width, height: dimensions.height,
            left: anchor.x - dimensions.width / 2, top: anchor.y - dimensions.height / 2 },
        },
          h('div', { className: 'dct-card-body' }, id === draftId ? renderDraft() : renderCard(active.node)),
          ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(direction => h('div', {
            key: direction, className: 'dct-resize', 'data-direction': direction,
            title: '拖动调整窗口大小',
            onPointerDown: event => beginResize(event, direction, id),
            onPointerMove: moveResize, onPointerUp: endResize,
            onPointerCancel: endResize, onLostPointerCapture: endResize,
          })),
        )
      })

      const grid = 24 * camera.scale
      return h('section', {
        className: 'dct-canvas', 'aria-label': '对话树画布', tabIndex: 0, ref: board,
        'data-dragging': dragging || undefined,
        onPointerDown: beginDrag, onPointerMove: moveDrag, onPointerUp: endDrag,
        onPointerCancel: endDrag, onLostPointerCapture: endDrag, onKeyDown,
        style: { backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${camera.x % grid}px ${camera.y % grid}px` },
      },
      h('svg', { className: 'dct-edges', 'aria-hidden': true }, edges),
      dots,
      card,
      h('div', { className: 'dct-camera', 'aria-label': '画布缩放' },
        button('−', () => zoom(0.8), { 'aria-label': '缩小画布' }),
        h('span', {}, `${Math.round(camera.scale * 100)}%`),
        button('+', () => zoom(1.25), { 'aria-label': '放大画布' }),
        button('回到根节点', () => setView(null))))
    }

    const styles = `
      .dct-launch, .dct button:not(.dct-native-content *, .dct-resource-body *), .dct input:not(.dct-native-content *, .dct-resource-body *), .dct select:not(.dct-native-content *, .dct-resource-body *), .dct textarea:not(.dct-native-content *, .dct-resource-body *) { font: inherit; }
      .dct-launch, .dct button:not(.dct-native-content *, .dct-resource-body *) { cursor: pointer; color: inherit; }
      .dct-launch { pointer-events: auto; position: fixed; right: 24px; bottom: 24px; z-index: 5;
        border: 1px solid #7991ef; border-radius: 999px; padding: 9px 15px; color: #fff;
        background: #405ace; box-shadow: 0 4px 18px #1113; }
      .dct { --bg: light-dark(#f5f7fc,#151925); --panel: light-dark(#fff,#202636);
        --ink: light-dark(#1e2940,#eef1ff); --muted: light-dark(#56647e,#b2bed8);
        --line: light-dark(#cdd5e6,#48546d); --accent: light-dark(#344db5,#aabaff);
        color-scheme: light dark; color: var(--ink); background: var(--bg); box-sizing: border-box;
        width: 100%; max-width: none; height: calc(100dvh - 40px);
        max-height: none; margin: auto 0 0; padding: 0; border: 0; border-top: 1px solid var(--line); }
      .dct::backdrop { background: #10152780; }
      .dct[open] { display: flex; flex-direction: column; }
      .dct * { box-sizing: border-box; }
      .dct .dct-native-content { height: min(620px, 64dvh); min-height: 300px; display: flex; flex-direction: column; }
      .dct .dct-native-content > [data-conversation-content] { flex: 1; min-height: 0; }
      .dct .dct-selection-menu { z-index: 20; padding: 10px; display: grid; gap: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: 0 6px 24px #141c3833; cursor: auto; max-height: calc(100dvh - 64px); overflow: auto; }
      .dct .dct-inherit-path { display: flex; align-items: center; gap: 6px; font-size: 12px; }
      .dct .dct-selection-menu form { display: grid; gap: 8px; }
      .dct .dct-quote-reference { overflow-wrap: anywhere; font-size: 12px; color: var(--muted); }
      .dct .dct-quote-reference blockquote { white-space: pre-wrap; margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--line); }
      .dct .dct-delete-menu { display: grid; gap: 8px; border: 1px solid var(--line); }
      .dct .dct-capacity { padding: 8px 12px; color: var(--muted); font-size: 12px; }
      .dct .dct-native-content { --dsh-chat-content-width: 100%; }
      .dct header:not(.dct-native-content *, .dct-resource-body *) { padding: 18px 22px; display: flex; align-items: center; justify-content: space-between;
        gap: 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
      .dct h1:not(.dct-native-content *, .dct-resource-body *), .dct h2:not(.dct-native-content *, .dct-resource-body *), .dct p:not(.dct-native-content *, .dct-resource-body *) { margin: 0; }
      .dct h1:not(.dct-native-content *, .dct-resource-body *) { font-size: 22px; font-weight: 500; }
      .dct h2:not(.dct-native-content *, .dct-resource-body *) { font-size: 15px; font-weight: 500; }
      .dct p:not(.dct-native-content *, .dct-resource-body *), .dct small:not(.dct-native-content *, .dct-resource-body *) { color: var(--muted); }
      .dct header:not(.dct-native-content *, .dct-resource-body *) p { margin-top: 4px; font-size: 13px; }
      .dct button:not(.dct-native-content *, .dct-resource-body *) { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
        padding: 6px 10px; }
      .dct button:not(.dct-native-content *, .dct-resource-body *):hover { border-color: var(--accent); }
      .dct button:not(.dct-native-content *, .dct-resource-body *):focus-visible, .dct :is(input, textarea, select):focus-visible {
        outline: 2px solid var(--accent); outline-offset: 2px; }
      .dct button:not(.dct-native-content *, .dct-resource-body *):disabled { opacity: .55; cursor: default; }
      .dct .dct-primary { color: white; background: #405ace; border-color: #405ace; }
      .dct .dct-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .dct .dct-content { display: grid; grid-template-columns: minmax(0,1fr); min-height: 0; flex: 1; }
      .dct .dct-content[data-picking] { grid-template-columns: minmax(0,1fr) clamp(200px, 27%, 320px); }
      .dct .dct-canvas { position: relative; overflow: hidden; touch-action: none; cursor: grab;
        background-image: radial-gradient(circle, var(--line) 0.9px, transparent 1.2px); }
      .dct .dct-canvas[data-dragging] { cursor: grabbing; user-select: none; }
      .dct .dct-edges { position: absolute; inset: 0; width: 100%; height: 100%;
        fill: none; stroke: var(--accent); stroke-opacity: .42; stroke-width: 1.5; pointer-events: none; }
      .dct .dct-node { position: absolute; width: var(--hit); height: var(--hit); transform: translate(-50%,-50%); }
      .dct .dct-node::after { content: ''; position: absolute; left: -8px; right: -8px; top: -30px; bottom: 0; pointer-events: none; }
      .dct .dct-node .dct-dot { left: 50%; top: 50%; }
      .dct .dct-node > .dct-node-add { position: absolute; left: 50%; bottom: calc(100% - 3px); transform: translateX(-50%); width: 25px; height: 25px; display: grid; place-items: center; padding: 0; margin: 0; line-height: 1; visibility: hidden; opacity: 0; }
      .dct .dct-node-add svg { display: block; pointer-events: none; }
      .dct .dct-node:hover .dct-node-add, .dct .dct-node:focus-within .dct-node-add { visibility: visible; opacity: 1; }
      .dct .dct-compose-selection, .dct .dct-brick-editor { display: grid; gap: 8px; }
      .dct .dct-composition-edge { stroke: #238b63; stroke-opacity: .75; }
      .dct .dct-dot { position: absolute; transform: translate(-50%,-50%); width: var(--hit);
        height: var(--hit); display: grid; place-items: center; padding: 0; background: transparent;
        border: 0; border-radius: 50%; }
      .dct .dct-dot::before { content: ''; width: 10px; height: 10px; border-radius: 50%;
        background: var(--accent); box-shadow: 0 0 0 2px var(--bg); }
      .dct .dct-dot[data-kind="root"]::before { width: 15px; height: 15px; }
      .dct .dct-dot[data-kind="prompt"]::before { background: light-dark(#9b6bb3,#c49add); border-radius: 3px; }
      .dct .dct-dot[data-selected="true"]::before { background: #20a46c; box-shadow: 0 0 0 4px #20a46c33; }
      .dct .dct-dot[data-status="error"]::before { background: light-dark(#a02631,#ffb0b7); }
      .dct .dct-dot:is([data-kind="draft"],[data-status="running"])::before { background: var(--bg); border: 2px dashed var(--accent); }
      .dct .dct-dot:is(:hover,[aria-expanded="true"])::before { box-shadow: 0 0 0 4px var(--line); }
      .dct .dct-camera { position: absolute; right: 14px; bottom: 14px; z-index: 2; display: flex; gap: 6px;
        align-items: center; background: var(--panel); border: 1px solid var(--line);
        padding: 5px; border-radius: 10px; cursor: default; }
      .dct .dct-camera span { min-width: 40px; text-align: center; font-size: 13px; }
      .dct .dct-card-body { height: 100%; overflow: auto; border-radius: 12px; }
      .dct .dct-card-body .dct-native-content { height: 100%; min-height: 0; }
      .dct .dct-resize { position: absolute; z-index: 4; touch-action: none; width: 12px; height: 12px; }
      .dct .dct-resize[data-direction="n"] { top: -4px; left: 12px; right: 12px; width: auto; height: 8px; cursor: ns-resize; }
      .dct .dct-resize[data-direction="s"] { bottom: -4px; left: 12px; right: 12px; width: auto; height: 8px; cursor: ns-resize; }
      .dct .dct-resize[data-direction="w"] { left: -4px; top: 12px; bottom: 12px; height: auto; width: 8px; cursor: ew-resize; }
      .dct .dct-resize[data-direction="e"] { right: -4px; top: 12px; bottom: 12px; height: auto; width: 8px; cursor: ew-resize; }
      .dct .dct-resize[data-direction="nw"] { left: -4px; top: -4px; cursor: nwse-resize; }
      .dct .dct-resize[data-direction="ne"] { right: -4px; top: -4px; cursor: nesw-resize; }
      .dct .dct-resize[data-direction="sw"] { left: -4px; bottom: -4px; cursor: nesw-resize; }
      .dct .dct-resize[data-direction="se"] { right: -4px; bottom: -4px; cursor: nwse-resize; }
      .dct .dct-card { position: absolute; overflow: visible; overscroll-behavior: contain; cursor: auto;
        background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
        box-shadow: 0 8px 24px #141c3826; z-index: 1; }
      .dct aside:not(.dct-native-content *, .dct-resource-body *) { overflow: auto; padding: 18px; background: var(--panel); border-inline-start: 1px solid var(--line); }
      .dct aside:not(.dct-native-content *, .dct-resource-body *) p { margin: 6px 0 12px; }
      .dct ul:not(.dct-native-content *, .dct-resource-body *) { list-style: none; padding: 0; margin: 0; }
      .dct li:not(.dct-native-content *, .dct-resource-body *) { padding-top: 10px; }
      .dct .dct-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
      .dct .dct-row h2 { overflow-wrap: anywhere; }
      .dct .dct-row > .dct-actions { flex: none; flex-wrap: nowrap; }
      .dct .dct-row button { white-space: nowrap; }
      .dct .dct-details { display: grid; padding: 12px; gap: 8px; }
      .dct .dct-card-heading { position: sticky; top: 0; z-index: 5; background: var(--panel); padding: 12px 0; margin-top: -12px; }
      .dct .dct-card-heading > .dct-actions { flex-wrap: wrap; justify-content: flex-end; flex-shrink: 1; }
      .dct .dct-bubble { border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; min-width: 0; }
      .dct .dct-bubble p { color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 4px; }
      .dct .dct-error { color: light-dark(#a02631,#ffb0b7); overflow-wrap: anywhere; }
      .dct .dct-notice { padding: 8px 22px; background: var(--panel); }
      .dct .dct-editor { padding: 12px; display: grid; gap: 10px; }
      .dct .dct-editor label { display: grid; gap: 5px; }
      .dct select:not(.dct-native-content *, .dct-resource-body *), .dct textarea:not(.dct-native-content *, .dct-resource-body *) { color: var(--ink); background: var(--bg); width: 100%;
        border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
      .dct textarea:not(.dct-native-content *, .dct-resource-body *) { resize: vertical; min-height: 95px; }
      .dct .dct-picker label { display: flex; align-items: flex-start; gap: 6px; overflow-wrap: anywhere; }
      .dct .dct-picker input { flex: none; accent-color: #405ace; }
      .dct .dct-resource-card { position: fixed; z-index: 30; width: min(460px,calc(100vw - 24px)); height: min(540px,calc(100dvh - 100px)); min-width: 260px; min-height: 180px; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px #141c3840; overflow: hidden; resize: both; }
      .dct .dct-resource-handle { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: move; touch-action: none; background: var(--panel); border-bottom: 1px solid var(--line); flex: none; gap: 8px; }
      .dct .dct-resource-handle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dct .dct-resource-body { flex: 1; min-height: 0; position: relative; overflow: hidden; }
      .dct .dct-resource-body [data-sidebar-right-mode] { display: none; }
      .dct .dct-resource-body [data-sidebar-right-panel] { position: absolute !important; inset: 0 !important; transform: none !important; width: 100% !important; max-width: none !important; height: 100% !important; visibility: visible !important; opacity: 1 !important; }
      .dct .dct-toolbar { display: grid; grid-template-columns: minmax(190px,1fr) minmax(210px,1.15fr) minmax(145px,.8fr) minmax(190px,1.05fr); gap: 14px; padding: 8px 22px; align-items: center; overflow-x: auto; flex: none; background: var(--panel); border-bottom: 1px solid var(--line); }
      .dct .dct-toolbar > *, .dct .dct-toolbar label { min-width: 0; }
      .dct .dct-toolbar label { display: flex; align-items: center; gap: 7px; flex: 1; white-space: nowrap; font-size: 12px; color: var(--muted); }
      .dct .dct-board-controls, .dct .dct-workspace-control, .dct .dct-rename-form { display: flex; align-items: center; gap: 4px; min-width: 0; }
      .dct .dct-rename-form { flex: 1; }
      .dct .dct-toolbar select, .dct .dct-toolbar input { width: 0; min-width: 0; flex: 1; height: 32px; padding: 4px 20px 4px 7px; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); background: var(--panel); font: inherit; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
      .dct .dct-toolbar input { padding-right: 7px; }
      .dct .dct-toolbar .dct-icon-button { width: 28px; height: 30px; padding: 0; flex: none; border-color: transparent; background: transparent; font-size: 17px; }
      .dct .dct-toolbar .dct-icon-button:hover { background: var(--bg); border-color: var(--line); }
      @media (max-width: 620px) {
        .dct header:not(.dct-native-content *, .dct-resource-body *) { flex-wrap: wrap; padding: 12px; }
        .dct .dct-content[data-picking] { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) minmax(0, 30%); }
        .dct aside:not(.dct-native-content *, .dct-resource-body *) { padding: 12px; }
        .dct aside:not(.dct-native-content *, .dct-resource-body *) { border-top: 1px solid var(--line); border-inline-start: 0; }
      }
    `

    function NativeConversation({ useSession, useInput, renderFactorySlot, measureCapacity, model, draft }) {
      const owner = { model, draft }
      const session = useSession(value => value)
      const input = useInput(value => value)
      const [capacity, setCapacity] = useState(null)
      useEffect(() => {
        let cancelled = false
        const timer = setTimeout(async () => {
          try {
            const [provider, model] = owner.model ? JSON.parse(owner.model) : []
            const result = await measureCapacity({ text: input.draft, provider, model })
            if (!result.ok || result.value?.result?.kind !== 'success') throw new Error(result.error?.message ?? result.value?.result?.text ?? '容量读取失败')
            if (!cancelled) setCapacity(JSON.parse(result.value.result.text))
          } catch (error) { if (!cancelled) setCapacity({ error: String(error.message ?? error) }) }
        }, 250)
        return () => { cancelled = true; clearTimeout(timer) }
      }, [input.draft, owner.model, measureCapacity])
      return h('div', { className: 'dct-native-content' },
        (owner.draft || input.draft) && h('div', { role: 'status', className: 'dct-capacity' },
          capacity?.error ?? (capacity ? `当前上下文约 ${Math.round(capacity.tokens).toLocaleString()} tokens · ${capacity.maximum ? `${(capacity.tokens / capacity.maximum * 100).toFixed(1)}% / ${capacity.maximum.toLocaleString()} tokens` : '模型未提供最大容量'}` : '正在计算上下文容量…')),
        renderFactorySlot('conversation.content', { variant: 'embedded', phase: session.blank ? 'hero' : 'active', hero: false }))
    }

    function installResourceMirror(ctx, source, target) {
      let disposers = []
      let children = []
      const alias = name => name === 'rightbar.session' ? 'context-lego.resources' : `context-lego.resources/${name}`
      function clear() { children.splice(0).reverse().forEach(dispose => dispose()); disposers.splice(0).reverse().forEach(dispose => dispose()) }
      function refresh() {
        clear()
        for (const entry of ctx.slots.entries(source)) {
          const declared = entry.children && Object.fromEntries(Object.entries(entry.children).map(([name, spec]) => [alias(name), spec]))
          const Native = entry.component
          const Component = props => {
            const adapted = { ...props }
            if (props.renderSlot) adapted.renderSlot = (name, owner, options) => props.renderSlot(alias(name), owner, options)
            if (props.renderSlotChain) adapted.renderSlotChain = (name, owner, options) => props.renderSlotChain(alias(name), owner, options)
            if (source === 'rightbar.session') {
              const { sessionId, actions, onNavigate, onClose, navigation } = props
              useEffect(() => {
                actions.open(sessionId)
                actions.setExpanded(sessionId, true)
                actions.setMode?.(sessionId, 'push')
                if (navigation?.address) ctx.sidebarRight.openResourceIn(sessionId, navigation.address, navigation.options)
                else if (navigation?.kind) ctx.sidebarRight.openTabIn(sessionId, navigation.kind, navigation.options)
              }, [sessionId, navigation?.revision])
              Object.assign(adapted, { active: true, canShow: true, width: 440, viewportWidth: 1024,
                syncPresentation: () => {}, reportAutoFullscreen: () => {}, toggleFullscreen: () => {},
                retainTab: () => () => {},
                openTab: (kind, options) => { ctx.sidebarRight.openTabIn(sessionId, kind, options); onNavigate?.() },
                actions: { ...actions, setExpanded: (id, expanded) => expanded ? actions.setExpanded(id, true) : onClose?.() } })
            }
            return h(Native, adapted)
          }
          disposers.push(ctx.slots.register({ name: target, ...entry.options, ...(entry.select ? { select: entry.select } : {}),
            ...(entry.inject ? { inject: entry.inject } : {}), ...(entry.locale ? { locale: entry.locale } : {}),
            ...(entry.store ? { store: entry.store } : {}), ...(declared ? { children: declared } : {}) }, Component))
          for (const name of Object.keys(entry.children ?? {})) children.push(installResourceMirror(ctx, name, alias(name)))
        }
      }
      refresh()
      const unsubscribe = ctx.slots.subscribe(source, refresh)
      return () => { unsubscribe(); clear() }
    }

    function FloatingResources({ node, sessions, SessionProvider, renderSlot, navigation, onClose, position, onPosition }) {
      const [reference, setReference] = useState(null)
      const [failure, setFailure] = useState('')
      const dragging = useRef(null)
      useEffect(() => {
        setReference(null); setFailure('')
        if (!node?.sessionId) return
        let disposed = false
        const retained = sessions.retain(node.sessionId, { source: 'workspaceOperation' })
        retained.ready.then(() => { if (!disposed) setReference(retained) }).catch(error => { if (!disposed) setFailure(String(error.message ?? error)) })
        return () => { disposed = true; retained.release() }
      }, [node?.sessionId, sessions])
      const left = Math.max(8, Math.min(position.x, window.innerWidth - 260))
      const top = Math.max(44, Math.min(position.y, window.innerHeight - 100))
      return h('section', { className: 'dct-resource-card', 'aria-label': '节点资源预览', style: { left, top } },
        h('div', { className: 'dct-resource-handle', onPointerDown: event => {
          if (event.button !== 0 || event.target.closest('button')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top }
        }, onPointerMove: event => {
          const start = dragging.current
          if (start?.id !== event.pointerId) return
          onPosition({ x: Math.max(8, Math.min(window.innerWidth - 260, start.left + event.clientX - start.x)), y: Math.max(44, Math.min(window.innerHeight - 100, start.top + event.clientY - start.y)) })
        }, onPointerUp: () => { dragging.current = null }, onLostPointerCapture: () => { dragging.current = null } },
          h('span', { title: node?.title }, `资源 · ${node?.title ?? '尚未选择节点'}`),
          button('×', onClose, { 'aria-label': '关闭资源卡片', title: '关闭资源卡片' })),
        h('div', { className: 'dct-resource-body' },
          failure ? h('p', { role: 'alert' }, failure) : !node?.sessionId ? h('p', {}, '打开会话节点并点击其中的文件或网页，即可在这里查看。')
            : !reference ? h('p', { role: 'status' }, '正在加载资源…')
              : h(SessionProvider, { session: reference }, renderSlot('context-lego.resources', { navigation, onClose }))))
    }

    function NativeSession({ node, sessions, SessionProvider, renderSlot, onEvents }) {
      const [reference, setReference] = useState(null)
      const [failure, setFailure] = useState('')
      const callback = useRef(onEvents)
      callback.current = onEvents
      useEffect(() => {
        let disposed = false
        let unsubscribe
        const retained = sessions.retain(node.sessionId, { source: 'workspaceOperation' })
        retained.ready.then(({ eventSource }) => {
          if (disposed) return
          setReference(retained)
          const refresh = () => callback.current?.(eventSource.getSnapshot().entries)
          unsubscribe = eventSource.subscribe(refresh)
          refresh()
        }).catch(error => { if (!disposed) setFailure(String(error.message ?? error)) })
        return () => { disposed = true; unsubscribe?.(); retained.release() }
      }, [node.sessionId, sessions])
      if (failure) return h('p', { role: 'alert', className: 'dct-error' }, failure)
      if (!reference) return h('p', { role: 'status' }, '正在加载 Harness 原生会话…')
      return h(SessionProvider, { session: reference },
        renderSlot('context-lego.session', { model: node.model, draft: node.kind === 'draft' }))
    }

    function TreeApp({ sessions, executeHistory, remote, SessionProvider, renderSlot, storageKey = key, boardControls, onLock, useWorkspaces, workspaceService, pickDirectory, autoOpen, resourceBridge }) {
      const [initial] = useState(() => readInitial(storageKey))
      const [settings] = useState(() => JSON.parse(localStorage.getItem(`${storageKey}/settings`) ?? '{}'))
      const workspaceList = useWorkspaces(value => value)
      const [workspaceId, setWorkspaceId] = useState(settings.workspaceId ?? '')
      const [deleteTarget, setDeleteTarget] = useState(null)
      const [resourceOpen, setResourceOpen] = useState(false)
      const [resourceHistory, setResourceHistory] = useState({})
      const [lastResourceNode, setLastResourceNode] = useState(null)
      const [resourcePosition, setResourcePosition] = useState(() => JSON.parse(localStorage.getItem(`${storageKey}/resource-position`) ?? 'null') ?? { x: Math.max(12, window.innerWidth - 480), y: 190 })
      const [nodes, setNodes] = useState(initial.nodes)
      const state = useRef(initial.nodes)
      const [error, setError] = useState(initial.error)
      const [draft, setDraft] = useState(null)
      const [picking, setPicking] = useState(false)
      const [selected, setSelected] = useState([])
      const [inherited, setInherited] = useState([])
      const [brickDraft, setBrickDraft] = useState(null)
      const [cwd, setCwd] = useState(settings.cwd ?? '')
      const [preset, setPreset] = useState(settings.preset ?? '')
      const [model, setModel] = useState(settings.model ?? '')
      const [catalog, setCatalog] = useState([])
      const [presets, setPresets] = useState([])
      useEffect(() => {
        let disposed = false
        Promise.all([remote.session.modelCatalog(), remote.agentPresets.list()]).then(([models, agents]) => {
          if (disposed) return
          if (!models.ok) throw new Error(models.error.message)
          if (!agents.ok) throw new Error(agents.error.message)
          setCatalog(models.value.groups.flatMap(group => group.models.map(item => ({ ...item, provider: group.id }))))
          setModel(current => current || JSON.stringify([models.value.default.provider, models.value.default.model]))
          setPresets(agents.value.presets.filter(item => !item.broken))
        }).catch(error => { if (!disposed) setError(String(error.message ?? error)) })
        return () => { disposed = true }
      }, [remote])
      const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem(`${storageKey}/system`) ?? '')
      const [openNodes, setOpenNodes] = useState([])
      const expanded = openNodes.at(-1)
      function setExpanded(value) {
        setOpenNodes(current => {
          const id = typeof value === 'function' ? value(current.at(-1)) : value
          if (id === undefined) return []
          return current.includes(id) ? current : [...current, id].slice(-4)
        })
      }
      function closeNode(id) {
        setOpenNodes(current => current.filter(item => item !== id))
      }
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        localStorage.setItem(`${storageKey}/settings`, JSON.stringify({ workspaceId, cwd, model, preset }))
      }, [storageKey, workspaceId, cwd, model, preset])
      useEffect(() => { onLock?.(busy || Boolean(draft) || Boolean(brickDraft)); return () => onLock?.(false) }, [busy, Boolean(draft), Boolean(brickDraft), onLock])
      const watchers = useRef(new Map())
      async function chooseFolder() {
        setBusy(true)
        setError('')
        try {
          const path = await pickDirectory()
          if (!path) return
          const workspace = await workspaceService.create({ path })
          setWorkspaceId(workspace.workspaceId)
          setCwd(workspace.path)
        } catch (error) { setError(String(error.message ?? error)) }
        finally { setBusy(false) }
      }
      function deleteNode(subtree) {
        if (!deleteTarget) return
        const target = state.current.find(node => node.id === deleteTarget)
        const next = deleteTreeNodes(state.current, deleteTarget, subtree)
        const remaining = new Set(next.map(node => node.id))
        const removed = state.current.filter(node => !remaining.has(node.id))
        if (removed.some(node => node.status === 'running')) { setError('请先停止或等待要删除的 Agent 运行结束。'); return }
        write(next)
        for (const node of removed) watchers.current.get(node.id)?.abort()
        setSelected(current => current.filter(id => remaining.has(id)))
        setInherited(current => current.filter(id => remaining.has(id)))
        setExpanded(target?.parentId ?? undefined)
        setDeleteTarget(null)
      }
      const dialog = useRef(null)
      const editor = useRef(null)
      useEffect(() => { if (autoOpen && !dialog.current.open) dialog.current.showModal() }, [])
      const draftId = draft?.id
      const draftParent = draft?.parentId
      const resourceNode = draft?.sessionId ? { ...draft, title: '新对话' } : nodes.find(node => node.id === expanded && node.sessionId) ?? lastResourceNode
      useEffect(() => resourceBridge?.subscribe(event => {
        const current = draft?.sessionId ? { ...draft, title: '新对话' } : state.current.find(node => node.id === expanded && node.sessionId)
        if (!current) return false
        if (event.address?.startsWith('dsh-resource://file/session/')) {
          const addressedSession = event.address.slice('dsh-resource://file/session/'.length).split('/')[0]
          if (decodeURIComponent(addressedSession) !== current.sessionId) return false
        }
        const navigation = { ...event, revision: crypto.randomUUID() }
        setResourceHistory(history => ({ ...history, [current.id]: navigation }))
        setLastResourceNode(current)
        setResourceOpen(true)
        return true
      }), [resourceBridge, expanded, draft])
      useEffect(() => { localStorage.setItem(`${storageKey}/resource-position`, JSON.stringify(resourcePosition)) }, [storageKey, resourcePosition])
      const layout = useMemo(() => layoutTree(nodes, draftId, draftParent, draft?.extraSourceIds), [nodes, draftId, draftParent, draft?.extraSourceIds])

      function write(next) {
        localStorage.setItem(storageKey, JSON.stringify(next))
        state.current = next
        setNodes(next)
      }

      function update(id, change) {
        write(state.current.map(node => node.id === id ? { ...node, ...change } : node))
      }

      async function watch(node, submit) {
        if (watchers.current.has(node.id)) return
        const controller = new AbortController()
        watchers.current.set(node.id, controller)
        let reference
        let unsubscribe
        try {
          reference = sessions.retain(node.sessionId, { source: 'workspaceOperation', signal: controller.signal })
          const { session, eventSource } = await reference.ready
          controller.signal.throwIfAborted()
          if (submit) {
            const entries = eventSource.getSnapshot().entries
            node = { ...node, afterSeq: entries.at(-1)?.event.seq ?? -1 }
            update(node.id, { afterSeq: node.afterSeq })
            const result = await session.prompt([{ type: 'text', text: submit }], 'queue', controller.signal)
            if (!result.ok) throw new Error(result.error?.message ?? result.error?.code ?? 'Harness 拒绝了提问')
          }
          await new Promise((resolve, reject) => {
            controller.signal.addEventListener('abort', resolve, { once: true })
            const refresh = () => {
              try {
                const entries = eventSource.getSnapshot().entries
                for (const { event } of entries) {
                  if (event.seq <= (node.afterSeq ?? -1) || event.type !== 'compaction/end') continue
                  const turn = entries.findLast(item => item.event.seq < event.seq && item.event.type === 'turn/start')?.event.data.turn
                  const compactId = `${node.id}-compact-${event.seq}`
                  const continuationId = `${compactId}-continue`
                  if (state.current.some(item => item.id === compactId)) continue
                  const prior = entries.filter(item => item.event.seq > node.afterSeq && item.event.seq < event.seq && item.event.type === 'assistant/message')
                    .flatMap(item => item.event.data.message.content.filter(block => block.type === 'text').map(block => block.text)).join('\n\n')
                  const compact = { id: compactId, parentId: node.id, kind: 'compaction', title: '上下文压缩', status: 'compacted', question: 'Harness 已压缩上下文，Agent 在后续卡片继续执行。', contextIds: [] }
                  const continuation = { ...node, id: continuationId, parentId: compactId, title: '继续执行', question: '', afterSeq: event.seq, turn, status: 'running', answer: '' }
                  continuation.contextIds = pathTo(state.current, node.parentId).filter(item => item.kind !== 'compaction' && item.status !== 'compacted').map(item => item.id)
                  write([...state.current.map(item => item.id === node.id ? { ...item, answer: prior, status: 'compacted' } : item), compact, continuation])
                  node = continuation
                  setExpanded(continuationId)
                }
                const result = inspectRun(eventSource, node.afterSeq, node.turn)
                if (!result) return
                update(node.id, result)
                resolve()
              } catch (error) {
                reject(error)
              }
            }
            unsubscribe = eventSource.subscribe(refresh)
            refresh()
          })
        } catch (error) {
          if (!controller.signal.aborted) {
            try {
              update(node.id, { status: 'error', error: String(error.message ?? error) })
            } catch (storageError) {
              setError(String(storageError.message ?? storageError))
            }
          }
        } finally {
          unsubscribe?.()
          reference?.release()
          watchers.current.delete(node.id)
        }
      }

      useEffect(() => {
        const active = watchers.current
        for (const node of state.current) {
          if (node.status === 'running' && node.sessionId) void watch(node)
        }
        return () => {
          for (const controller of active.values()) controller.abort()
        }
      }, [])

      async function startDraft(mode, parentId = null, quote = null) {
        if (busy || brickDraft) return
        if (quote?.inheritPath && pathTo(state.current, parentId).some(node => node.kind === 'turn' && node.status !== 'done' && node.status !== 'compacted')) {
          setError('请等待这条路径上的对话完成后，再继承完整上下文。')
          return
        }
        if (draft) {
          setError('请先完成或取消当前编辑的卡片。')
          editor.current?.focus()
          return
        }
        setError(initial.error)
        setExpanded(undefined)
        setPicking(false)
        const placement = mode === 'manual' ? compositionPlacement(state.current, selected, inherited)
          : state.current.find(node => node.id === parentId)?.detached ? { parentId: null, extraSourceIds: [parentId] } : { parentId, extraSourceIds: [] }
        const next = { id: crypto.randomUUID(), mode, ...placement, text: '', selected: mode === 'manual' ? [...selected] : [], inherited: mode === 'manual' ? [...inherited] : [],
          ...(quote ? { quote: quote.text, quoteAction: quote.action, inheritPath: quote.inheritPath, question: quotePrompt(quote.text, quote.action, quote.question) } : {}) }
        setBusy(true)
        try {
          const effectiveSystemPrompt = quote && !quote.inheritPath ? '' : systemPrompt
          const sessionId = await createNativeSession(contextFor(next, state.current), effectiveSystemPrompt)
          const reference = sessions.retain(sessionId, { source: 'workspaceOperation' })
          try {
            const { eventSource } = await reference.ready
            const prepared = { ...next, sessionId, afterSeq: eventSource.getSnapshot().entries.at(-1)?.event.seq ?? -1, model, cwd, preset, workspaceId, systemPrompt: effectiveSystemPrompt }
            if (quote) {
              const ancestors = contextFor(prepared, state.current)
              const node = { ...prepared, kind: 'turn', title: titleFor(quote.text), contextIds: ancestors.map(item => item.id), nativeHistory: 1, status: 'running' }
              write([...state.current, node])
              setExpanded(node.id)
              void watch(node, next.question)
            } else setDraft(prepared)
          } finally { reference.release() }
        } catch (error) { setError(String(error.message ?? error)) }
        finally { setBusy(false) }
      }

      async function createNativeSession(context, effectiveSystemPrompt = systemPrompt) {
        const parent = context.at(-1)
        const prefix = context.slice(0, -1).map(node => node.id)
        const samePrefix = parent?.contextIds?.length === prefix.length
          && parent.contextIds.every((id, index) => id === prefix[index])
        if (parent?.nativeHistory === 1 && parent.endSeq !== undefined && samePrefix && parent.systemPrompt === effectiveSystemPrompt && parent.cwd === cwd && parent.preset === preset && parent.model === model && (parent.workspaceId ?? '') === workspaceId) {
          return sessions.fork({ sessionId: parent.sessionId, atSeq: parent.endSeq })
        }
        const anchor = context.find(node => node.sessionId)
        const summary = anchor && sessions.list.getSnapshot().byId[anchor.sessionId]
        const options = summary?.workspaceId ? { workspaceId: summary.workspaceId }
          : summary?.cwd ? { cwd: summary.cwd } : {}
        if (summary?.projectionValues?.agentPreset) options.agentPreset = summary.projectionValues.agentPreset
        if (workspaceId) { delete options.cwd; options.workspaceId = workspaceId }
        else if (cwd.trim()) { delete options.workspaceId; options.cwd = cwd.trim() }
        const sessionId = await sessions.create(options)
        if (preset) {
          const result = await remote.agentPresets.select(sessionId, preset)
          if (!result.ok) throw new Error(result.error.message)
        }
        if (model) {
          const [provider, modelId] = JSON.parse(model)
          const result = await remote.session.selectModel({ sessionId, provider, model: modelId })
          if (!result.ok) throw new Error(result.error.message)
        }
        if (!context.length && !effectiveSystemPrompt.trim()) return sessionId
        const reference = sessions.retain(sessionId, { source: 'workspaceOperation' })
        try {
          await reference.ready
          const selection = context.map(node => node.kind === 'prompt'
            ? { kind: 'prompt', question: node.question }
            : { kind: 'turn', sessionId: node.sessionId, endSeq: node.endSeq, legacy: node.nativeHistory !== 1, question: node.question })
          if (effectiveSystemPrompt.trim()) selection.unshift({ kind: 'system', question: effectiveSystemPrompt })
          const result = await executeHistory(sessionId, selection)
          if (!result.ok) throw new Error(result.error?.message ?? '原生上下文组装失败')
          if (result.value?.result?.kind !== 'success') {
            throw new Error(result.value?.result?.text ?? '上下文插件未加载，请重启 Harness')
          }
          return sessionId
        } finally {
          reference.release()
        }
      }

      function recordNativeTurns(base, entries) {
        const starts = entries.filter(({ event }) => event.seq > (base.afterSeq ?? -1) && event.type === 'turn/start')
        for (const { event } of starts) {
          const owner = nativeTurnOwner(state.current, base.sessionId, event)
          if (owner) {
            if (owner.turn === undefined) update(owner.id, { turn: event.data.turn })
            continue
          }
          const previous = state.current.filter(node => node.sessionId === base.sessionId && node.kind === 'turn').at(-1)
          const lower = previous?.endSeq ?? base.afterSeq ?? -1
          const nextStart = starts.find(item => item.event.seq > event.seq)?.event.seq ?? Infinity
          const question = entries.find(item => item.event.seq > lower && item.event.seq < nextStart && item.event.type === 'user/message' && item.event.data.source?.kind === 'user')
          if (!question) continue
          const text = question?.event.data.content?.filter(block => block.type === 'text').map(block => block.text).join('') ?? base.question ?? ''
          const first = base.kind === 'draft' && !state.current.some(node => node.id === base.id)
          const parentId = first ? base.parentId : previous?.id ?? base.id
          const ancestors = first ? contextFor(base, state.current) : branchContext(state.current, parentId)
          const node = { id: first ? base.id : crypto.randomUUID(), parentId, kind: 'turn', title: titleFor(text) || 'Agent 对话', question: text,
            sessionId: base.sessionId, afterSeq: event.seq - 1, turn: event.data.turn, nativeHistory: 1, status: 'running',
            contextIds: ancestors.map(item => item.id), extraSourceIds: first ? base.extraSourceIds : [], model: base.model, cwd: base.cwd, preset: base.preset, workspaceId: base.workspaceId, systemPrompt: base.systemPrompt }
          write([...state.current, node])
          if (first) setDraft(null)
          setExpanded(node.id)
          void watch(node)
        }
      }

      function nativeSession(node) {
        return h(NativeSession, { key: node.sessionId, node, sessions, SessionProvider, renderSlot, onEvents: entries => recordNativeTurns(node, entries) })
      }

      function renderDraft() {
        return h('section', { className: 'dct-native-card' },
          h('div', { className: 'dct-details dct-row' }, h('h2', {}, '新对话'),
            button('取消', () => { setDraft(null); setError(initial.error) }, { disabled: busy })),
          nativeSession({ ...draft, kind: 'draft' }))
      }

      function bubble(label, text) {
        return h('div', { className: 'dct-bubble' }, h('small', {}, label), h('p', {}, text))
      }

      function renderCard(node) {
        const heading = node.detached ? `积木 · ${node.title}` : node.kind === 'prompt' ? `提示词 · ${node.title}` : node.title
        return h(SelectionActions, { node, disabled: busy || Boolean(draft) || Boolean(initial.error),
          onBranch: (source, quote) => startDraft('quote', source.id, quote) },
        h('article', { className: 'dct-details', 'aria-label': heading },
          h('div', { className: 'dct-row dct-card-heading' },
            h('h2', {}, heading),
            h('div', { className: 'dct-actions' },
              node.kind !== 'root' && button('滑动到此节点问答', async event => {
                const control = event.currentTarget
                const card = control.closest('article')
                const normalize = value => value.replace(/\s+/g, '').replace(/\u200b/g, '')
                const text = normalize(node.question ?? '')
                if (!text) return
                control.disabled = true
                const previous = control.textContent
                control.textContent = '正在定位…'
                try {
                  for (let attempt = 0; attempt < 100 && card.isConnected; attempt++) {
                    const content = card.querySelector('.dct-native-content') ?? card
                    // Markdown splits a message across paragraphs, lists and code blocks.
                    // Find the smallest containing element rather than assuming a <p>.
                    const candidates = [...content.querySelectorAll('*')].filter(element =>
                      !element.closest('textarea, input, button, [contenteditable="true"]')
                      && normalize(element.textContent ?? '').includes(text))
                    const target = (node.turn !== undefined
                      ? [...content.querySelectorAll('[data-chat-turn][data-chat-flow-kind="user"]:not([hidden])')].find(element => Number(element.dataset.chatTurn) === node.turn)
                      : null) ?? candidates.find(element => !candidates.some(other => other !== element && element.contains(other)))
                    if (target) {
                      const boundary = card.closest('.dct-card-body') ?? card
                      for (let parent = target.parentElement; parent && boundary.contains(parent); parent = parent.parentElement) {
                        if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
                          const scale = parent.getBoundingClientRect().height / parent.offsetHeight || 1
                          const heading = card.querySelector('.dct-card-heading')
                          const inset = parent === boundary ? (heading?.offsetHeight ?? 0) + 12 : 12
                          parent.scrollTop += (target.getBoundingClientRect().top - parent.getBoundingClientRect().top) / scale - inset
                        }
                      }
                      return
                    }
                    const earlier = [...content.querySelectorAll('button')].find(element => /加载更早|加载更多|Load earlier/i.test(element.textContent))
                    if (!earlier) break
                    if (!earlier.disabled) earlier.click()
                    await new Promise(resolve => setTimeout(resolve, 150))
                  }
                  setError('未找到此节点的用户消息，请确认原生会话已加载完成后重试。')
                } finally {
                  if (control.isConnected) { control.disabled = false; control.textContent = previous }
                }
              }),
              !node.detached && button('+', () => startDraft('branch', node.id), {
                title: '从此节点发起对话',
                'aria-label': '从此节点发起对话',
                disabled: (node.kind !== 'root' && node.status !== 'done') || busy || Boolean(initial.error),
              }),
              node.kind !== 'root' && button('删除', () => setDeleteTarget(node.id), { disabled: busy || Boolean(draft), 'aria-label': '删除节点' }),
              button('收起', () => closeNode(node.id)))),
          picking && node.kind !== 'root' && node.status === 'done' && h('div', { className: 'dct-compose-selection' }, h('label', {},
            h('input', { type: 'checkbox', checked: selected.includes(node.id),
              onChange: event => { setSelected(current => event.target.checked ? [...current, node.id] : current.filter(id => id !== node.id)); if (!event.target.checked) setInherited(current => current.filter(id => id !== node.id)) } }),
            `参与上下文组装${selected.includes(node.id) ? ` · 第 ${orderedSelection.findIndex(item => item.id === node.id) + 1} 项` : ''}`),
            !node.detached && h('label', {}, h('input', { type: 'checkbox', checked: inherited.includes(node.id), disabled: !selected.includes(node.id),
              onChange: event => setInherited(current => event.target.checked ? [...current, node.id] : current.filter(id => id !== node.id)) }), '同时纳入从根节点到此节点的全部上下文')),
          node.quote && h('details', { className: 'dct-quote-reference' }, h('summary', {}, `引用原文 · ${node.inheritPath ? '已继承完整路径' : '仅引用选中文字'}`), h('blockquote', {}, node.quote)),
          node.kind === 'root' ? h('label', {}, '系统提示词', h('textarea', {
            value: systemPrompt, placeholder: '输入全局系统提示词', disabled: busy,
            onChange: event => { setSystemPrompt(event.target.value); localStorage.setItem(`${storageKey}/system`, event.target.value) },
          })) : node.sessionId && node.kind === 'turn' ? nativeSession(node) : [
            h('div', { key: 'question' }, bubble(node.kind === 'prompt' ? '提示词' : '用户', node.question)),
            node.answer && h('div', { key: 'answer' }, bubble('Agent', node.answer)),
            node.status === 'running' && h('p', { key: 'running', role: 'status' }, 'Agent 正在处理这一轮…'),
            node.error && h('p', { key: 'error', className: 'dct-error' }, node.error),
            node.contextIds.length > 0 && h('small', { key: 'context' }, '本轮上下文 · ',
              node.contextIds.map(id => layout.get(id)?.node.title ?? id).join(' → ')),
          ]))
      }

      const orderedSelection = compositionContext(nodes, selected, inherited)
      const selectedIds = new Set(picking ? orderedSelection.map(node => node.id) : [])
      if (picking && selected.some(id => inherited.includes(id) && !nodes.find(node => node.id === id)?.detached)) selectedIds.add(null)
      function saveBrick(event) {
        event.preventDefault()
        if (!brickDraft?.text.trim()) return
        const node = { id: crypto.randomUUID(), parentId: null, detached: true, kind: 'prompt', status: 'done', title: brickDraft.title.trim() || titleFor(brickDraft.text), question: brickDraft.text.trim(), contextIds: [] }
        write([...state.current, node])
        setBrickDraft(null)
        setExpanded(node.id)
      }
      return h('div', {},
        h('style', {}, styles),
        button('对话树', () => dialog.current.showModal(), { className: 'dct-launch' }),
        h('dialog', { className: 'dct', ref: dialog, 'aria-labelledby': 'dct-title' },
          h('header', {},
            h('div', {}, h('h1', { id: 'dct-title' }, '对话树'),
              h('p', {}, '拖动平移，滚轮缩放；点击节点展开，悬停 + 创建继承上下文的分支。')),
            h('div', { className: 'dct-actions' },
              button('资源', () => setResourceOpen(true), { title: '查看当前节点点击的资源', 'aria-label': '打开资源卡片', 'aria-pressed': resourceOpen }),
              button(picking ? '退出组合' : '组合上下文', () => setPicking(value => !value), { disabled: busy || Boolean(draft) || Boolean(brickDraft), 'aria-pressed': picking }),
              picking && button(`创建对话（${selected.length}）`, () => startDraft('manual'), { disabled: busy || !selected.length }),
              button('＋ 新增积木节点', () => { setExpanded(undefined); setBrickDraft({ title: '', text: '' }) }, { className: 'dct-primary', disabled: busy || Boolean(draft) || Boolean(brickDraft) || Boolean(initial.error) }),
              button('关闭', () => dialog.current.close()))),
          h('div', { className: 'dct-toolbar', 'aria-label': '画板运行设置' },
            boardControls,
            h('div', { className: 'dct-workspace-control' },
            h('label', {}, '工作区 ', h('select', { value: workspaceId, disabled: busy || Boolean(draft), 'aria-label': '画板工作区', title: workspaceList.items.find(item => item.workspaceId === workspaceId)?.path ?? cwd ?? '默认工作区', onChange: event => { setWorkspaceId(event.target.value); setCwd(workspaceList.items.find(item => item.workspaceId === event.target.value)?.path ?? '') } },
              h('option', { value: '' }, cwd ? `当前目录 · ${cwd}` : '默认工作区'),
              workspaceList.items.map(item => h('option', { key: item.workspaceId, value: item.workspaceId }, `${item.title} · ${item.path}`)))),
            button('…', () => void chooseFolder(), { disabled: busy || Boolean(draft), title: '选择文件夹', 'aria-label': '选择文件夹', className: 'dct-icon-button' })), 
            h('label', {}, 'Agent 预设 ', h('select', { value: preset, title: presets.find(item => item.id === preset)?.name ?? (preset || '默认预设'), 'aria-label': 'Agent 预设', disabled: busy || Boolean(draft), onChange: event => setPreset(event.target.value) }, h('option', { value: '' }, '默认预设'), presets.map(item => h('option', { key: item.id, value: item.id }, item.name ?? item.id)))),
            h('label', {}, '模型 ', h('select', { value: model, title: model ? JSON.parse(model).join(' / ') : '默认模型', 'aria-label': '模型', disabled: busy || Boolean(draft), onChange: event => setModel(event.target.value) }, h('option', { value: '' }, '默认模型'), catalog.map(item => h('option', { key: JSON.stringify([item.provider, item.id]), value: JSON.stringify([item.provider, item.id]) }, `${item.provider} / ${item.name}`))))),
          resourceOpen && h(FloatingResources, { key: resourceNode?.sessionId ?? 'empty', node: resourceNode, sessions, SessionProvider, renderSlot, navigation: resourceHistory[resourceNode?.id] ?? (resourceNode ? { kind: 'guide', revision: resourceNode.id } : undefined), onClose: () => setResourceOpen(false), position: resourcePosition, onPosition: setResourcePosition }),
          brickDraft && h('form', { className: 'dct-brick-editor dct-notice', onSubmit: saveBrick, 'aria-label': '新增积木节点' },
            h('label', {}, '积木名称', h('input', { autoFocus: true, value: brickDraft.title, onChange: event => setBrickDraft(current => ({ ...current, title: event.target.value })) })),
            h('label', {}, '提示词模板', h('textarea', { value: brickDraft.text, placeholder: '例如：让 Agent 编写 MCP 的规范与步骤', onChange: event => setBrickDraft(current => ({ ...current, text: event.target.value })) })),
            h('div', { className: 'dct-actions' }, h('button', { type: 'submit', disabled: !brickDraft.text.trim() }, '保存积木'), button('取消', () => setBrickDraft(null)))),
          deleteTarget && h('section', { className: 'dct-delete-menu dct-notice', role: 'dialog', 'aria-label': '删除节点选项' },
            h('p', {}, `删除“${nodes.find(node => node.id === deleteTarget)?.title ?? '节点'}”`),
            h('p', {}, '仅删除节点时，直接子节点会接到它的父节点。Harness 原始会话记录保留。'),
            h('div', { className: 'dct-actions' }, button('只删除这个节点', () => deleteNode(false)), button('删除此节点及以下全部节点', () => deleteNode(true)), button('取消删除', () => setDeleteTarget(null)))),
          picking && h('p', { className: 'dct-notice' }, `已纳入 ${orderedSelection.length} 个节点（祖先自动去重）。绿色表示已纳入；可逐节点选择是否继承完整路径。`),
          error && h('p', { className: 'dct-error dct-notice', role: 'alert' }, error),
          h('div', { className: 'dct-content', 'data-picking': undefined },
            h(Board, {
              layout, draftId, draftParent, editor, expanded, openNodes,
              onExpand: id => { if (!draft) setExpanded(current => current === id ? undefined : id) },
              renderCard, renderDraft, selectedIds, onBranch: id => startDraft('branch', id), branchDisabled: busy || Boolean(draft) || Boolean(brickDraft),
            }))))
    }

    return {
      name: 'dsh-conversation-tree-client',
      inject: ['slots', 'sessions', 'remote', 'remote.commands', 'remote.session', 'remote.agentPresets', 'workspaces', 'uiWorkspace', 'sidebarRight'],
      apply(ctx) {
        const listeners = new Set()
        const resourceBridge = { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
        if (typeof document !== 'undefined') ctx.effect(() => {
          const openLink = event => {
            if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
            const link = event.target.closest?.('.dct-card a[href]')
            if (!link || !document.querySelector('.dct[open]')) return
            const address = link.getAttribute('href')
            const navigation = /^https?:\/\//i.test(address) ? { kind: 'browser', options: { params: { url: address } } }
              : address?.startsWith('dsh-resource://') ? { address } : null
            if (!navigation) return
            for (const listener of listeners) if (listener(navigation)) { event.preventDefault(); event.stopPropagation(); break }
          }
          document.addEventListener('click', openLink, true)
          return () => document.removeEventListener('click', openLink, true)
        })
        for (const name of ['openResource', 'openTab']) {
          const original = ctx.sidebarRight[name]
          const intercept = function(value, options) {
            if (document.querySelector('.dct[open]') && document.querySelector('.dct-card [data-conversation-session]')) {
              const event = name === 'openResource' ? { address: value, options } : { kind: value, options }
              for (const listener of listeners) if (listener(event)) return
            }
            return original.call(this, value, options)
          }
          ctx.sidebarRight[name] = intercept
          ctx.effect(() => () => { if (ctx.sidebarRight[name] === intercept) ctx.sidebarRight[name] = original })
        }
        ctx.effect(() => ctx.slots.inject('context-lego.resources', () => ctx.slots.inject('rightbar.session', () =>
          installResourceMirror(ctx, 'rightbar.session', 'context-lego.resources'))))
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-conversation-tree',
          children: { 'context-lego.session': { kind: 'single', scope: 'session' }, 'context-lego.resources': { kind: 'single', scope: 'session' } },
          inject: () => ({
            sessions: ctx.sessions,
            resourceBridge,
            workspaceService: ctx.workspaces,
            pickDirectory: () => globalThis.__DSH_DIRECTORY_PICKER__ ? globalThis.__DSH_DIRECTORY_PICKER__.pick() : ctx.uiWorkspace.pickDirectory(),
            remote: { session: ctx.remote.session, agentPresets: ctx.remote.agentPresets },
            measureCapacity: (sessionId, input) => ctx.remote.commands.execute(sessionId, `/context-lego-capacity ${JSON.stringify(input)}`, []),
            executeHistory: (sessionId, selection) => ctx.remote.commands.execute(sessionId,
              `/context-lego-history ${JSON.stringify(selection)}`, []),
          }),
        }, BoardManager)))
        ctx.effect(() => ctx.slots.inject('context-lego.session', () => ctx.slots.register({
          name: 'context-lego.session',
          inject: sessionId => ({
            measureCapacity: input => ctx.remote.commands.execute(sessionId, `/context-lego-capacity ${JSON.stringify(input)}`, []),
          }),
        }, NativeConversation)))
        for (const command of ['context-lego-capacity', 'context-lego-history']) {
          ctx.effect(() => ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
            name: 'conversation.chat.commandview', key: command,
          }, () => null)))
        }
      },
    }
  },
})
