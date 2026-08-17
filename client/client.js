/**
 * dsh-kanban — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step). Clicking an entry
 * flips the CURRENT window into a full-screen board overlay (iframe of
 * /kanban) — no new browser tab, no route change. The close button (top-right)
 * or the entry itself toggles back to the conversation.
 *
 * Entry points:
 *   1. `sidebar.footer.action` — full-width row at the left column's foot
 *      (`任务看板`). The framework's footerActions flex container is
 *      row+nowrap and other plugins (usage-stats) occupy the whole first row,
 *      so the plugin also injects `flex-wrap:wrap` on that container — the
 *      entry wraps onto its own second row and stays visible.
 *   2. `conversation.session.header.actions` — compact button in the session
 *      header action row (visible once a conversation is open).
 *
 * The overlay mounts directly onto document.body (not via a host seat) so it
 * always sits on top of every other stacked layer.
 */
window.__ModuleLoader__.load({
  id: 'dsh-kanban',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let react = require('react')
    let react_jsx_runtime = require('react/jsx-runtime')
    let react_dom = require('react-dom')
    let primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    const css = [
      /* allow the sidebar foot to wrap so our full-width entry gets its own row */
      '[class$="_footerActions"]{flex-wrap:wrap;align-content:flex-start}',
      '.kb_badge{width:100%;min-height:40px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}',
      '.kb_badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '.kb_badge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}',
      '.kb_badgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
      '.kb_headerBtn{height:28px;display:inline-flex;align-items:center;gap:5px;padding:0 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
      '.kb_headerBtn:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '.kb_headerBtn[data-active]{background:var(--dsw-alias-accent-limpid);border-color:var(--dsw-alias-accent)}',
      '.kb_overlay{position:fixed;inset:0;z-index:2147483647;background:var(--dsw-alias-bg-base,#0f1115);display:flex;flex-direction:column;pointer-events:auto}',
      '.kb_overlayBar{flex:none;height:40px;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}',
      '.kb_overlayTitle{color:var(--dsw-alias-label-secondary);font-size:13px;margin-right:auto}',
      '.kb_close{cursor:pointer;height:26px;padding:0 10px;border:none;border-radius:6px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);font:inherit;font-size:12px}',
      '.kb_close:hover{color:var(--dsw-alias-label-primary)}',
      '.kb_frame{flex:1;min-height:0;width:100%;border:none;background:var(--dsw-alias-bg-base,#0f1115)}',
    ].join('\n')

    const NS = 'dsh-kanban'

    /* --- open/close store shared by entries and overlay ------------------ */
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

    /** Full-screen board layer, mounted on document.body. */
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

    /** Left-column foot entry: full-width row. */
    function KanbanFooterButton() {
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

    /** Session header action: compact toggle. */
    function KanbanHeaderButton() {
      const open = useOpen()
      return react_jsx_runtime.jsxs('button', {
        className: 'kb_headerBtn',
        'data-active': open || undefined,
        title: open ? '关闭任务看板' : '打开任务看板',
        onClick: () => setOpen(!open),
        children: [
          react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 14 }),
          react_jsx_runtime.jsx('span', { children: open ? '关闭看板' : '任务看板' }),
        ],
      })
    }

    /** Services required by the client plugin body. */
    const inject = ['slots']

    function apply(ctx) {
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)

      // Overlay mounts at body level (no host seat) so z-index beats everyone.
      const mount = document.createElement('div')
      document.body.appendChild(mount)
      react_dom.render(react_jsx_runtime.jsx(KanbanOverlay, {}), mount)

      const disposers = [
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-kanban',
          locale: NS,
          order: 11,
        }, KanbanFooterButton)), 'dsh-kanban: footer entry'),
        ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'dsh-kanban',
          locale: NS,
          order: 100,
        }, KanbanHeaderButton)), 'dsh-kanban: session header action'),
        () => {
          react_dom.unmountComponentAtNode(mount)
          mount.remove()
          style.remove()
        },
      ]
      return () => disposers.forEach((d) => (typeof d === 'function' ? d() : undefined))
    }

    exports.apply = apply
    exports.inject = inject
    exports.KanbanFooterButton = KanbanFooterButton
    exports.KanbanHeaderButton = KanbanHeaderButton
    exports.KanbanOverlay = KanbanOverlay
    return module.exports
  },
})
