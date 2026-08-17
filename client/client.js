/**
 * dsh-kanban — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step):
 *   1. When dsh-better-sidebar is installed, registers a sidebar tab
 *      embedding the board (`/kanban`) in an iframe via the optional
 *      `ctx.betterSidebar` service.
 *   2. Always registers a sidebar footer action that opens the board in a
 *      new tab (works without dsh-better-sidebar).
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
      '.kb_badgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
    ].join('\n')

    const NS = 'dsh-kanban'

    /** Full-board iframe for the better-sidebar tab. */
    function KanbanFrame() {
      return react_jsx_runtime.jsx('iframe', {
        src: '/kanban',
        title: 'Kanban',
        style: {
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'var(--dsw-alias-bg-base, #0f1115)',
        },
      })
    }

    function KanbanButton() {
      return react_jsx_runtime.jsx('button', {
        className: 'kb_badge',
        title: 'Open the kanban board',
        onClick: () => { window.open('/kanban', '_blank', 'noopener') },
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
      const disposers = []

      // 1. Sidebar tab — only when dsh-better-sidebar provides the service.
      try {
        const service = ctx.betterSidebar
        if (service && typeof service.registerTab === 'function') {
          disposers.push(service.registerTab({
            id: 'kanban',
            title: () => '任务看板',
            icon: (size) => react_jsx_runtime.jsx(primitives.IconDataOutline16, { size }),
            order: 30,
            single: true,
            component: KanbanFrame,
          }))
        }
      } catch {
        /* better-sidebar absent — the footer action still works */
      }

      // 2. Footer action (always available).
      disposers.push(ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-kanban',
        locale: NS,
        order: 11,
      }, KanbanButton)), 'dsh-kanban: footer action'))

      disposers.push(ctx.effect(() => () => style.remove(), 'dsh-kanban: style cleanup'))
      return () => disposers.forEach((d) => (typeof d === 'function' ? d() : undefined))
    }

    exports.apply = apply
    exports.inject = inject
    exports.KanbanButton = KanbanButton
    exports.KanbanFrame = KanbanFrame
    return module.exports
  },
})
