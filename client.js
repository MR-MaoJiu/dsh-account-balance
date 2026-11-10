/**
 * 余额徽章 —— Client 半边。
 *
 * 注册到 `conversation.composer.dock`，与「轮/步」「token 用量」「上下文占用」
 * 同处输入框下方的状态栏；余额通过 `ctx.remote.account` 向 Host 的
 * deepseekAccount 服务请求，点击徽章展开详情面板。
 */
window.__ModuleLoader__.load({
  id: '@local/account-balance',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } = React

    // react-dom 用于把详情面板 portal 到 document.body（状态栏容器是 docked composer，会裁剪浮层）
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (reactDom && typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal
    } catch (error) {
      createPortal = null
    }

    const NS = 'account-balance'
    const VERSION = '1.0.0'
    const SLOT = 'conversation.composer.dock'
    const REFRESH_INTERVAL_MS = 60 * 1000
    const STALE_MS = 15 * 1000
    const PANEL_MARGIN = 12
    const PANEL_GAP = 8
    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 }

    /**
     * 请求体里的 `client.version` 是「客户端构建版本」，Host 会原样带给开放平台。
     * 优先取 Harness 自身的 release 版本，取不到时才退回本插件版本，
     * 避免用一个与运行时不符的版本号冒充客户端。
     */
    function clientVersion() {
      try {
        const boot = typeof window !== 'undefined' ? window.__DSH_BOOT__ : null
        const release = boot && boot.release
        const version = release && release.version
        if (typeof version === 'string' && version) return version
      } catch (error) {
        // 读不到 boot 全局时静默退回插件版本
      }
      return VERSION
    }

    const messages = {
      en: {
        title: 'Balance',
        toppedUp: 'Topped-up balance',
        bonus: 'Granted balance',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        topUp: 'Top up',
        updated: 'Updated {time}',
        hint: 'Refreshes every minute.',
        loading: 'Balance…',
        signedOut: 'Sign in to view balance',
        signedOutHint: 'Sign in from Settings → Account to see the balance.',
        unavailable: 'Balance unavailable',
        unavailableHint: 'The balance service did not respond.',
        empty: 'No balance data',
      },
      zh: {
        title: '余额',
        toppedUp: '充值余额',
        bonus: '赠送余额',
        refresh: '刷新',
        refreshing: '刷新中…',
        topUp: '前往充值',
        updated: '更新于 {time}',
        hint: '每分钟自动刷新。',
        loading: '余额…',
        signedOut: '登录后查看余额',
        signedOutHint: '请在 设置 → 账户 中登录后查看余额。',
        unavailable: '余额不可用',
        unavailableHint: '余额服务暂时没有响应。',
        empty: '暂无余额信息',
      },
    }

    const CSS = [
      '.dsb_anchor{min-width:0;flex:none;order:1;display:inline-flex;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.dsb_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}',
      '.dsb_pill svg{flex:none;width:14px;height:14px}',
      '.dsb_pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '@media (hover:hover){.dsb_pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}',
      '.dsb_pill:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dsb_panel{z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px),var(--dsh-anchored-max-width,100vw));max-width:min(440px,calc(100vw - 24px),var(--dsh-anchored-max-width,100vw));border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;max-height:var(--dsh-anchored-max-height,none);border:0;padding:16px;font-size:12px;line-height:18px;position:fixed;overflow:hidden auto}',
      '.dsb_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}',
      '.dsb_titleLabel{align-items:center;gap:6px;display:inline-flex}',
      '.dsb_titleLabel svg{flex:none;width:14px;height:14px}',
      '.dsb_total{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:500}',
      '.dsb_rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.dsb_details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}',
      '.dsb_details dt,.dsb_details dd{min-width:0;margin:0}',
      '.dsb_details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
      '.dsb_note{color:var(--dsw-alias-label-tertiary);margin:0 0 2px}',
      '.dsb_note+.dsb_note{margin-top:4px}',
      '.dsb_hint{color:var(--dsw-alias-label-tertiary);margin-top:10px}',
      '.dsb_footer{justify-content:space-between;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2);display:flex}',
      '.dsb_updated{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}',
      '.dsb_actions{align-items:center;gap:4px;display:inline-flex}',
      '.dsb_action{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);background:0 0;border:none;padding:3px 8px;font:inherit;cursor:pointer;text-decoration:none;white-space:nowrap}',
      '.dsb_action[aria-disabled="true"]{opacity:.5;cursor:default}',
      '@media (hover:hover){.dsb_action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}',
      '.dsb_action:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
    ].join('\n')

    /**
     * 钱包图标（描边、跟随文字颜色）。
     * 采用 24 网格绘制、按 14px 显示，描边宽度换算后约 1.17px，
     * 与状态栏相邻图标（gauge / database，1.3@16）的视觉粗细一致。
     */
    function icon(size) {
      const px = size || 14
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: px,
          height: px,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
        },
        h('path', {
          d: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
        }),
        h('path', { d: 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4' })
      )
    }

    function symbolOf(currency) {
      if (currency === 'CNY') return '¥'
      if (currency === 'USD') return '$'
      return typeof currency === 'string' ? currency : ''
    }

    /** 千分位：只处理已定好两位小数的字符串 */
    function addCommas(fixed) {
      const parts = String(fixed).split('.')
      const head = Number(parts[0])
      const int = Number.isFinite(head) ? head.toLocaleString('en-US') : parts[0]
      return parts.length > 1 ? int + '.' + parts[1] : int
    }

    function roundDown2(value) {
      return (Math.floor(value * 100) / 100).toFixed(2)
    }

    /** 复刻官方账户页的余额显示规则：0 / <0.01 / 负数 / 千分位 */
    function formatAmount(amount, currency) {
      const symbol = symbolOf(currency)
      const raw = amount === null || amount === undefined ? '' : String(amount).trim()
      if (raw === '') return '—'
      const value = Number(raw)
      if (!Number.isFinite(value)) return symbol + raw
      if (value === 0) return symbol + '0.00'
      if (value < 0) {
        const abs = -value
        return '-' + symbol + (abs < 0.01 ? '0.01' : addCommas(abs.toFixed(2)))
      }
      if (value < 0.01) return '<' + symbol + '0.01'
      return symbol + addCommas(roundDown2(value))
    }

    function formatTotals(wallets) {
      if (!Array.isArray(wallets) || wallets.length === 0) return ''
      const sums = new Map()
      for (const wallet of wallets) {
        if (!wallet || typeof wallet.currency !== 'string') continue
        const amount = Number(wallet.balance)
        sums.set(wallet.currency, (sums.get(wallet.currency) || 0) + (Number.isFinite(amount) ? amount : 0))
      }
      const parts = []
      for (const [currency, sum] of sums) parts.push(formatAmount(String(sum), currency))
      return parts.join(' + ')
    }

    function formatClock(timestamp) {
      try {
        return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } catch (error) {
        return ''
      }
    }

    /**
     * 面板定位：优先放锚点上方，视口不够时放到下方，并夹紧到视口内。
     * 与官方 useAnchoredPosition({ side: 'top', gap: 8, margin: 12 }) 一致。
     */
    function usePanelPosition(open, anchorRef, panelRef) {
      const [position, setPosition] = useState(null)
      useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return undefined
        }
        const measure = () => {
          const anchor = anchorRef.current
          const panel = panelRef.current
          if (!anchor || !panel) return
          const rect = anchor.getBoundingClientRect()
          const box = panel.getBoundingClientRect()
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          let left = rect.left + rect.width / 2 - box.width / 2
          left = Math.max(PANEL_MARGIN, Math.min(left, viewportWidth - box.width - PANEL_MARGIN))
          let top = rect.top - box.height - PANEL_GAP
          if (top < PANEL_MARGIN) top = rect.bottom + PANEL_GAP
          top = Math.max(PANEL_MARGIN, Math.min(top, viewportHeight - box.height - PANEL_MARGIN))
          setPosition({ left: Math.round(left), top: Math.round(top) })
        }
        measure()
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        return () => {
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
        }
      }, [open, anchorRef, panelRef])
      return position
    }

    /** 语言切换时强制重渲染（其它 pill 也走同一套 locale 通知） */
    function useLocaleRevision(locale) {
      const [, bump] = useReducer((value) => value + 1, 0)
      useEffect(() => {
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => bump())
      }, [locale])
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account'],
      apply(ctx) {
        const locale = ctx.get('locale')
        const account = ctx.get('remote.account')

        // 词典：与官方插件相同的多语言注册形式，随插件卸载自动撤销
        if (locale && typeof locale.register === 'function') {
          ctx.effect(
            () => locale.register(NS, { en: messages.en, zh: messages.zh }),
            'account-balance: dictionaries'
          )
        }

        const bound = locale && typeof locale.bind === 'function' ? locale.bind(NS) : null
        const fallbackT = (key, params) => {
          let active = ''
          try {
            const snapshot = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null
            if (snapshot && typeof snapshot.active === 'string') active = snapshot.active
          } catch (error) {
            active = ''
          }
          if (!active && typeof navigator !== 'undefined' && navigator.language) active = navigator.language
          const dict = active.toLowerCase().startsWith('zh') ? messages.zh : messages.en
          let text = dict[key] === undefined ? key : dict[key]
          if (params) {
            for (const name of Object.keys(params)) {
              text = text.split('{' + name + '}').join(String(params[name]))
            }
          }
          return text
        }
        const t = bound || fallbackT

        const clientMetadata = () => {
          let active = 'en'
          try {
            const snapshot = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null
            if (snapshot && typeof snapshot.active === 'string' && snapshot.active) active = snapshot.active
            else if (typeof navigator !== 'undefined' && navigator.language) active = navigator.language
          } catch (error) {
            active = 'en'
          }
          return {
            version: clientVersion(),
            locale: active,
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          }
        }

        function BalanceBadge() {
          useLocaleRevision(locale)
          const [open, setOpen] = useState(false)
          const [state, setState] = useState({
            status: 'loading',
            wallets: [],
            bonusWallets: [],
            updatedAt: 0,
            refreshing: false,
            error: '',
          })
          const [links, setLinks] = useState(null)
          const rootRef = useRef(null)
          const panelRef = useRef(null)
          const inflight = useRef(false)
          const lastAttempt = useRef(0)
          const position = usePanelPosition(open, rootRef, panelRef)

          const refresh = useCallback(async () => {
            if (!account || typeof account.getBalance !== 'function') {
              setState({ status: 'failed', wallets: [], bonusWallets: [], updatedAt: Date.now(), refreshing: false, error: '' })
              return
            }
            if (inflight.current) return
            inflight.current = true
            lastAttempt.current = Date.now()
            setState((prev) => (prev.status === 'loading' ? prev : Object.assign({}, prev, { refreshing: true })))
            try {
              const result = await account.getBalance(clientMetadata())
              if (!result || result.ok !== true) {
                const detail = result && result.error ? result.error.message || result.error.code || '' : ''
                throw new Error(detail || 'balance request failed')
              }
              const value = result.value
              if (value === null || value === undefined) {
                setState({ status: 'signed-out', wallets: [], bonusWallets: [], updatedAt: Date.now(), refreshing: false, error: '' })
              } else if (value.status === 'ready') {
                setState({
                  status: 'ready',
                  wallets: Array.isArray(value.value) ? value.value : [],
                  bonusWallets: Array.isArray(value.bonusWallets) ? value.bonusWallets : [],
                  updatedAt: Date.now(),
                  refreshing: false,
                  error: '',
                })
              } else {
                setState({ status: 'failed', wallets: [], bonusWallets: [], updatedAt: Date.now(), refreshing: false, error: '' })
              }
            } catch (error) {
              setState({
                status: 'failed',
                wallets: [],
                bonusWallets: [],
                updatedAt: Date.now(),
                refreshing: false,
                error: error && error.message ? String(error.message) : '',
              })
            } finally {
              inflight.current = false
            }
          }, [])

          // 首次加载 + 每分钟刷新（页面隐藏时跳过）+ 回到前台立即刷新
          useEffect(() => {
            refresh()
          }, [refresh])
          useEffect(() => {
            const timer = setInterval(() => {
              if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh()
            }, REFRESH_INTERVAL_MS)
            const onVisibility = () => {
              if (document.visibilityState === 'visible') refresh()
            }
            document.addEventListener('visibilitychange', onVisibility)
            return () => {
              clearInterval(timer)
              document.removeEventListener('visibilitychange', onVisibility)
            }
          }, [refresh])

          // 平台链接（充值入口）只取一次
          useEffect(() => {
            if (!account || typeof account.getState !== 'function') return undefined
            let cancelled = false
            Promise.resolve()
              .then(() => account.getState())
              .then((result) => {
                if (cancelled) return
                if (result && result.ok === true && result.value && result.value.links) setLinks(result.value.links)
              })
              .catch(() => {})
            return () => {
              cancelled = true
            }
          }, [])

          // 打开面板时补一次（超过 15s 未更新才请求）
          useEffect(() => {
            if (!open) return
            if (Date.now() - lastAttempt.current > STALE_MS) refresh()
          }, [open, refresh])

          // Escape 关闭 + 面板外点击关闭
          useEffect(() => {
            if (!open) return undefined
            const onPointerDown = (event) => {
              const root = rootRef.current
              const panel = panelRef.current
              if (root && root.contains(event.target)) return
              if (panel && panel.contains(event.target)) return
              setOpen(false)
            }
            const onKeyDown = (event) => {
              if (event.key === 'Escape') setOpen(false)
            }
            document.addEventListener('mousedown', onPointerDown, true)
            document.addEventListener('keydown', onKeyDown, true)
            return () => {
              document.removeEventListener('mousedown', onPointerDown, true)
              document.removeEventListener('keydown', onKeyDown, true)
            }
          }, [open])

          const total = state.status === 'ready' ? formatTotals(state.wallets) : ''
          let badgeText
          if (state.status === 'loading') badgeText = t('loading')
          else if (state.status === 'ready') badgeText = total || t('empty')
          else if (state.status === 'signed-out') badgeText = t('signedOut')
          else badgeText = t('unavailable')

          const title = t('title')

          const rows = []
          if (state.status === 'ready') {
            state.wallets.forEach((wallet, index) => {
              if (!wallet) return
              rows.push({
                key: 'recharge:' + String(wallet.currency) + ':' + index,
                label: t('toppedUp'),
                value: formatAmount(wallet.balance, wallet.currency),
              })
            })
            state.bonusWallets.forEach((wallet, index) => {
              if (!wallet) return
              const amount = Number(wallet.balance)
              if (!Number.isFinite(amount) || amount <= 0) return
              rows.push({
                key: 'bonus:' + String(wallet.currency) + ':' + index,
                label: t('bonus'),
                value: formatAmount(wallet.balance, wallet.currency),
              })
            })
          }

          const panelChildren = [
            h(
              'div',
              { key: 'title', className: 'dsb_title' },
              h('span', { className: 'dsb_titleLabel' }, icon(14), title),
              total ? h('span', { className: 'dsb_total' }, total) : null
            ),
            h('div', { key: 'rule', className: 'dsb_rule', 'aria-hidden': true }),
          ]

          if (state.status === 'ready' && rows.length > 0) {
            const cells = []
            for (const row of rows) {
              cells.push(h('dt', { key: row.key + ':dt' }, row.label))
              cells.push(h('dd', { key: row.key + ':dd' }, row.value))
            }
            panelChildren.push(h('dl', { key: 'details', className: 'dsb_details' }, cells))
          } else if (state.status === 'ready') {
            panelChildren.push(h('p', { key: 'empty', className: 'dsb_note' }, t('empty')))
          } else if (state.status === 'signed-out') {
            panelChildren.push(h('p', { key: 'signout', className: 'dsb_note' }, t('signedOutHint')))
          } else if (state.status === 'failed') {
            panelChildren.push(h('p', { key: 'failed', className: 'dsb_note' }, t('unavailableHint')))
            if (state.error) panelChildren.push(h('p', { key: 'error', className: 'dsb_hint' }, state.error))
          }

          const actions = []
          actions.push(
            h(
              'button',
              {
                key: 'refresh',
                type: 'button',
                className: 'dsb_action',
                'aria-disabled': state.refreshing ? 'true' : 'false',
                onClick: () => {
                  if (!state.refreshing) refresh()
                },
              },
              state.refreshing ? t('refreshing') : t('refresh')
            )
          )
          if (links && links.topUpUrl) {
            actions.push(
              h(
                'a',
                {
                  key: 'topup',
                  className: 'dsb_action',
                  href: links.topUpUrl,
                  target: '_blank',
                  rel: 'noreferrer',
                },
                t('topUp')
              )
            )
          }

          panelChildren.push(
            h(
              'div',
              { key: 'footer', className: 'dsb_footer' },
              h(
                'span',
                { className: 'dsb_updated' },
                state.updatedAt ? t('updated', { time: formatClock(state.updatedAt) }) : ''
              ),
              h('span', { className: 'dsb_actions' }, actions)
            )
          )

          const panel = h(
            'div',
            {
              ref: panelRef,
              className: 'dsb_panel',
              role: 'dialog',
              'aria-label': title,
              style: position ? { left: position.left + 'px', top: position.top + 'px' } : MEASURE_STYLE,
            },
            panelChildren
          )

          return h(
            React.Fragment,
            null,
            h('style', { key: 'styles', dangerouslySetInnerHTML: { __html: CSS } }),
            h(
              'span',
              { ref: rootRef, className: 'dsb_anchor', 'data-composer-stat': 'account-balance' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsb_pill',
                  'aria-haspopup': 'dialog',
                  'aria-expanded': open,
                  'aria-label': title + '：' + badgeText,
                  title: title + ' · ' + badgeText,
                  onClick: () => setOpen(!open),
                },
                icon(14),
                h('span', null, badgeText)
              )
            ),
            open ? (createPortal ? createPortal(panel, document.body) : panel) : null
          )
        }

        ctx.slots.inject(SLOT, () =>
          ctx.slots.register(
            {
              name: SLOT,
              id: 'account-balance',
              order: 2,
            },
            BalanceBadge
          )
        )
      },
    }
  },
})
