/**
 * dsh-kanban — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step). Clicking the
 * sidebar entry flips the CURRENT window into a full-screen board overlay
 * (iframe of /kanban) — no new browser tab, no route change. A close button
 * (top-right) and the sidebar entry itself toggle back to the conversation.
 *
 *   * sidebar.footer.action  — the left-column entry 「任务看板」
 *   * shell.overlay          — the full-frame board layer
 *
 * The two components share one tiny open/close store via
 * useSyncExternalStore, so the overlay tracks the entry without a rebuild.
 */
window.__ModuleLoader__.load({
  id: 'dsh-kanban',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let react = require('react')
    let react_jsx_runtime = require('react/jsx-runtime')
    let primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const css = [
      '.kb_badge{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}',
      '.kb_badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '.kb_badge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.kb_badgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
      '.kb_overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-base,#0f1115);display:flex;flex-direction:column;pointer-events:auto}',
      '.kb_overlayBar{flex:none;height:40px;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}',
      '.kb_overlayTitle{color:var(--dsw-alias-label-secondary);font-size:13px;margin-right:auto}',
      '.kb_close{cursor:pointer;height:26px;padding:0 10px;border:none;border-radius:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;font-size:12px}',
      '.kb_close:hover{color:var(--dsw-alias-label-primary)}',
      '.kb_frame{flex:1;min-height:0;width:100%;border:none;background:var(--dsw-alias-bg-base,#0f1115)}',
    ].join('\n')

    const NS = 'dsh-kanban'

    /* --- tiny open/close store shared by entry and overlay --------------- */
    const store = { open: false, listeners: new Set() }
    function setOpen(value) {
      store.open = !!value
      for (const fn of store.listeners) fn()
    }
    function subscribe(fn) {
      store.listeners.add(fn)
      return () => store.listeners.delete(fn)
    }
    function getOpen() {
      return store.open
    }
    function useOpen() {
      return react.useSyncExternalStore(subscribe, getOpen)
    }

    /** Full-screen board layer. */
    function KanbanOverlay() {
      const open = useOpen()
      if (!open) return null
      return react_jsx_runtime.jsxs('div', {
        className: 'kb_overlay',
        children: [
          react_jsx_runtime.jsxs('div', {
            className: 'kb_overlayBar',
            children: [
              react_jsx_runtime.jsx('span', { className: 'kb_overlayTitle', children: '任务看板' }),
              react_jsx_runtime.jsx('button', {
                className: 'kb_close',
                onClick: () => setOpen(false),
                children: '关闭',
              }),
            ],
          }),
          react_jsx_runtime.jsx('iframe', { className: 'kb_frame', src: '/kanban', title: 'Kanban' }),
        ],
      })
    }

    /** Left-column entry: toggle the board overlay. */
    function KanbanLauncher(props) {
      const open = useOpen()
      return react_jsx_runtime.jsx('button', {
        className: 'kb_badge',
        'data-active': open || undefined,
        title: '任务看板',
        onClick: () => setOpen(!open),
        children: [
          react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 16 }),
          react_jsx_runtime.jsx('span', { className: 'kb_badgeLabel', children: '任务看板' }),
        ],
      })
    }

    /** Services required by the client plugin body. */
    const inject = ['slots']

    function apply(ctx) {
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)
      const disposers = [
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-kanban',
          locale: NS,
          order: 11,
        }, KanbanLauncher)), 'dsh-kanban: sidebar entry'),
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-kanban-board',
        }, KanbanOverlay)), 'dsh-kanban: board overlay'),
        ctx.effect(() => () => style.remove(), 'dsh-kanban: style cleanup'),
      ]
      return () => disposers.forEach((d) => (typeof d === 'function' ? d() : undefined))
    }

    exports.apply = apply
    exports.inject = inject
    exports.KanbanLauncher = KanbanLauncher
    exports.KanbanOverlay = KanbanOverlay
    return module.exports
  },
})
