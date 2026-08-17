/**
 * dsh-kanban — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step): a sidebar footer
 * action that opens the kanban board (`/kanban`, served by the server half)
 * in a new tab.
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
      '.kb_badgeCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;margin-left:auto;font-size:12px;line-height:16px}',
    ].join('\n')

    const NS = 'dsh-kanban'
    const zh = {
      'action.open': '任务看板',
    }
    const en = {
      'action.open': 'Kanban',
    }

    function KanbanButton() {
      const t = (key, fallback) => fallback
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
      ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-kanban',
        locale: NS,
        order: 11,
      }, KanbanButton)), 'dsh-kanban: footer action')
      ctx.effect(() => () => style.remove(), 'dsh-kanban: style cleanup')
    }

    exports.apply = apply
    exports.inject = inject
    exports.KanbanButton = KanbanButton
    return module.exports
  },
})
