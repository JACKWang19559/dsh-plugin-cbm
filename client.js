// Client half of @local/dsh-plugin-cbm.
//
// Registers the "CBM Lens" sidebar panel entry plus the matching central
// panel. The panel embeds the CBM Lens visualization through the Host
// plugin's loopback proxy (127.0.0.1:9750), which serves the binary's own
// frontend without its `frame-ancestors 'none'` directive and answers
// Private Network Access preflights (the Desktop GUI runs on the privileged
// dsh-app:// scheme). Lens itself stays untouched on 127.0.0.1:9749.
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-cbm',
  factory(require) {
    const React = require('react');
    const { useEffect, useState } = React;
    const h = React.createElement;

    const PROXY_URL = 'http://127.0.0.1:9751'; // framed copy (plugin Host half)
    const DIRECT_URL = 'http://127.0.0.1:9749'; // standalone Lens
    const NS = 'cbm-lens';
    const OPTIMISTIC_AFTER = 4; // failed attempts before rendering anyway

    // Inline dictionaries double as the host-locale registration payload and
    // the fallback when the locale service is unavailable or rejects a key.
    const DICTS = {
      en: {
        title: 'CBM Lens',
        'status.checking': 'Connecting to CBM Lens…',
        'status.down': 'CBM Lens is not reachable',
        'status.down.hint':
          'The visualization is served by the codebase-memory-mcp MCP server that starts with this app, and embedded through the local proxy at ' +
          PROXY_URL +
          '. If it stays offline, open the standalone UI in your browser or start it manually:',
        'status.down.command': 'codebase-memory-mcp daemon start --open --port=9749',
        'status.down.diag': 'Probe result',
        'action.open': 'Open in browser',
        'action.retry': 'Retry',
        'view.lens': 'CBM Lens',
        'tab.loading': 'Loading project graph…',
        'tab.noproject': 'This workspace has no code-graph index yet',
        'tab.noproject.hint':
          'Ask the agent to index it (say "index <path>"), or add it from the CBM Lens panel in the sidebar (Alt+P → Add project index).',
        'tab.nocwd': 'This session has no workspace directory',
        'tab.refresh': 'Refresh',
        'tab.openFull': 'Full view',
        'tab.counts': '{n} nodes · {e} edges',
        'tab.indexedAt': 'indexed',
      },
      zh: {
        title: 'CBM Lens',
        'status.checking': '正在连接 CBM Lens…',
        'status.down': 'CBM Lens 暂不可达',
        'status.down.hint':
          '可视化界面由随本应用启动的 codebase-memory-mcp 服务提供，并经本地代理（' + PROXY_URL +
          '）嵌入；若持续离线，可在浏览器中打开独立界面，或手动启动：',
        'status.down.command': 'codebase-memory-mcp daemon start --open --port=9749',
        'status.down.diag': '探测结果',
        'action.open': '在浏览器中打开',
        'action.retry': '重试',
        'view.lens': 'CBM Lens',
        'tab.loading': '正在加载项目图谱…',
        'tab.noproject': '当前工作区还没有代码图谱索引',
        'tab.noproject.hint':
          '让助手索引它（对我说"索引一下这个目录"），或在侧栏 CBM Lens 面板中添加（Alt+P → Add project index）。',
        'tab.nocwd': '此会话没有工作区目录',
        'tab.refresh': '刷新',
        'tab.openFull': '完整版',
        'tab.counts': '{n} 节点 · {e} 边',
        'tab.indexedAt': '索引于',
      },
    };

    function detectZh(ctx) {
      try {
        const snap = ctx.locale && ctx.locale.getLocale();
        const id = snap && typeof snap === 'object' && (snap.id || snap.locale);
        if (typeof id === 'string') return id.toLowerCase().startsWith('zh');
      } catch (_) { /* fall through */ }
      try {
        return String(navigator.language || 'en').toLowerCase().startsWith('zh');
      } catch (_) {
        return false;
      }
    }

    // t(key): host locale service first (registered below), inline dict as
    // fallback. Never throws — a broken locale entry must not blank the panel.
    function makeT(ctx) {
      const lang = detectZh(ctx) ? 'zh' : 'en';
      const inline = (key) => DICTS[lang][key] || key;
      try {
        if (ctx.locale && typeof ctx.locale.bind === 'function') {
          const bound = ctx.locale.bind(NS);
          if (typeof bound === 'function') {
            return (key) => {
              try {
                const s = bound(key);
                if (typeof s === 'string' && s) return s;
              } catch (_) { /* fall through */ }
              return inline(key);
            };
          }
        }
      } catch (_) { /* fall through */ }
      return inline;
    }

    // Probe the framed copy.
    // 1) CORS fetch — the proxy answers PNA preflights and sends ACAO, so a
    //    pass here also proves the app is genuinely up (res.ok).
    // 2) no-cors fetch — reachability even if a CORS/PNA quirk rejects mode
    //    'cors'. Framing needs no CORS, so a pass here is still good enough
    //    to render the iframe.
    function probeLens(signal) {
      return fetch(PROXY_URL + '/', { mode: 'cors', cache: 'no-store', signal })
        .then(
          (res) => ({ up: !!(res && res.ok), via: 'cors', status: (res && res.status) || 0 }),
          (corsErr) => fetch(PROXY_URL + '/', { mode: 'no-cors', cache: 'no-store', signal })
            .then(
              () => ({ up: true, via: 'no-cors', status: 0 }),
              (noCorsErr) => ({
                up: false,
                via: 'none',
                status: 0,
                err: [
                  String((corsErr && corsErr.message) || corsErr),
                  String((noCorsErr && noCorsErr.message) || noCorsErr),
                ].filter(Boolean).join(' | '),
              }),
            ),
        );
    }

    const buttonStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '6px 14px',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 13,
      color: 'var(--dsw-alias-label-primary)',
      backgroundColor: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l1)',
      textDecoration: 'none',
    };

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const t = makeT(ctx);

        function LensIcon() {
          return h('svg', {
            viewBox: '0 0 24 24', width: 20, height: 20,
            'aria-hidden': true, style: { display: 'block' },
          },
            h('path', {
              d: 'M6.5 5.5 L17.5 7.5 M6.5 5.5 L9 18 M17.5 7.5 L9 18 M17.5 7.5 L18.5 15.5 M9 18 L18.5 15.5',
              fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
            }),
            h('circle', { cx: 6.5, cy: 5.5, r: 2.3, fill: 'currentColor' }),
            h('circle', { cx: 17.5, cy: 7.5, r: 2.0, fill: 'currentColor' }),
            h('circle', { cx: 9, cy: 18, r: 2.0, fill: 'currentColor' }),
            h('circle', { cx: 18.5, cy: 15.5, r: 1.7, fill: 'currentColor' }));
        }

        function LensPanel() {
          // checking | up | down | optimistic (render the frame anyway + escape hatch)
          const [state, setState] = useState('checking');
          const [diag, setDiag] = useState('');
          const [frameNonce, setFrameNonce] = useState(0);
          const [nonce, setNonce] = useState(0);

          useEffect(() => {
            const controller = new AbortController();
            let cancelled = false;
            let timer = null;
            let attempt = 0;
            let optimisticSeen = false;
            const check = () => probeLens(controller.signal).then((r) => {
              if (cancelled) return;
              if (r.up) {
                // A fresh pass after optimistic mode must reload the frame:
                // it may still be showing the 502 page it loaded at boot.
                if (optimisticSeen) setFrameNonce((n) => n + 1);
                setState('up');
                return; // healthy: stop probing
              }
              attempt += 1;
              setDiag(r.via + ': ' + (r.err || ('HTTP ' + r.status)));
              if (attempt >= OPTIMISTIC_AFTER) {
                // Probes keep failing but the frame itself may still load
                // (framing is not subject to CORS/PNA). Render it anyway
                // with an escape hatch instead of a dead-end card — and
                // KEEP probing: the moment Lens comes up, the frame reloads.
                optimisticSeen = true;
                setState('optimistic');
              } else {
                setState('down');
              }
              const delay = attempt === 1 ? 1000 : attempt === 2 ? 3000 : attempt === 3 ? 7000 : 10000;
              timer = setTimeout(check, delay);
            });
            check();
            return () => {
              cancelled = true;
              controller.abort();
              if (timer) clearTimeout(timer);
            };
          }, [nonce]);

          if (state === 'up' || state === 'optimistic') {
            const escape = state === 'optimistic'
              ? [h('a', {
                  key: 'escape',
                  href: DIRECT_URL + '/', target: '_blank', rel: 'noopener noreferrer',
                  style: {
                    position: 'absolute', right: 10, bottom: 10, padding: '4px 10px',
                    borderRadius: 6, fontSize: 12,
                    color: 'var(--dsw-alias-label-primary)',
                    backgroundColor: 'var(--dsw-alias-bg-overlay)',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    textDecoration: 'none', opacity: 0.85,
                  },
                }, t('action.open') + ' ↗')]
              : [];
            return h('div', {
              style: { position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' },
            },
              h('iframe', {
                key: 'frame-' + frameNonce,
                src: PROXY_URL + '/',
                title: t('title'),
                allow: 'fullscreen',
                style: {
                  width: '100%', height: '100%', flex: 1, border: 'none',
                  display: 'block', backgroundColor: 'var(--dsw-alias-bg-base)',
                  minHeight: 0,
                },
              }),
              ...escape);
          }

          const children = [
            h('div', { key: 'head', style: { fontSize: 15, fontWeight: 600 } },
              t(state === 'checking' ? 'status.checking' : 'status.down')),
          ];
          if (state === 'down') {
            children.push(
              h('div', {
                key: 'hint',
                style: {
                  fontSize: 13, lineHeight: 1.7, maxWidth: 520,
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
                t('status.down.hint')),
              h('code', {
                key: 'cmd',
                style: {
                  fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace',
                  padding: '6px 10px', borderRadius: 6,
                  color: 'var(--dsw-alias-label-primary)',
                  backgroundColor: 'var(--dsw-alias-bg-layer-2)',
                  border: '1px solid var(--dsw-alias-border-l1)',
                },
              }, t('status.down.command')),
              diag && h('div', {
                key: 'diag',
                style: {
                  fontSize: 11, maxWidth: 560, wordBreak: 'break-all',
                  color: 'var(--dsw-alias-label-secondary)', direction: 'ltr',
                },
              }, t('status.down.diag') + ': ' + diag),
              h('div', {
                key: 'actions', style: { display: 'flex', gap: 8, marginTop: 4 },
              },
                h('a', {
                  href: DIRECT_URL + '/', target: '_blank', rel: 'noopener noreferrer',
                  style: buttonStyle,
                }, t('action.open')),
                h('button', {
                  type: 'button', style: buttonStyle,
                  onClick: () => { setState('checking'); setDiag(''); setNonce((n) => n + 1); },
                }, t('action.retry'))));
          }
          return h('div', {
            style: {
              width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              backgroundColor: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              padding: 24, boxSizing: 'border-box', textAlign: 'center',
            },
          }, children);
        }

        ctx.slots.inject('sidebar.panellist', () => {
          const disposers = [];
          try {
            if (ctx.locale && typeof ctx.locale.register === 'function') {
              disposers.push(ctx.locale.register(NS, 'en', DICTS.en));
              disposers.push(ctx.locale.register(NS, 'zh', DICTS.zh));
            }
          } catch (_) { /* inline fallback still applies */ }
          const reg = ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'cbm-lens',
            order: 50,
            label: () => t('title'),
          }, LensIcon);
          return () => {
            if (typeof reg === 'function') reg();
            for (const d of disposers) { try { d && d(); } catch (_) { /* best effort */ } }
          };
        });

        ctx.slots.inject('main', () => {
          const reg = ctx.slots.register({ name: 'main', key: 'cbm-lens' }, LensPanel);
          return () => { if (typeof reg === 'function') reg(); };
        });

        // Normalize a filesystem path for matching: forward slashes, no
        // trailing slash, case-insensitive (Windows-friendly).
        function normPath(p) {
          return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        }

        // POST one MCP tool call through the proxy's /rpc endpoint.
        function rpcCall(name, args, signal) {
          return fetch(PROXY_URL + '/rpc', {
            method: 'POST',
            mode: 'cors',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            signal,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name, arguments: args || {} },
            }),
          }).then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          });
        }

        function structOf(rpcResult) {
          return (rpcResult && rpcResult.result && rpcResult.result.structuredContent) || null;
        }

        // Resolve the session workspace (cwd) to a cbm project via the
        // proxy's MCP-over-HTTP endpoint, then deep-link Lens to it.
        function LensTabView(props) {
          const sessionId = props && props.sessionId;
          const useSessions = props && props.useSessions;
          // Selector hook when the view system provides it; snapshot otherwise.
          // (Same pattern as shipped ui-chat / ui-open-in-app views.)
          const hookedCwd = useSessions
            ? useSessions((s) => { const row = s.byId[sessionId]; return row ? row.cwd : undefined; })
            : undefined;
          let cwd = hookedCwd;
          if (cwd === undefined) {
            try {
              const snap = ctx.sessions && ctx.sessions.list && ctx.sessions.list.getSnapshot();
              const row = snap && snap.byId[sessionId];
              cwd = row ? row.cwd : undefined;
            } catch (_) { /* leave undefined */ }
          }

          // loading | ready | noproject | nocwd | down
          const [state, setState] = useState('loading');
          const [project, setProject] = useState(null);
          const [diag, setDiag] = useState('');
          const [status, setStatus] = useState(null); // index_status structured content
          const [statusNonce, setStatusNonce] = useState(0); // refresh button
          const [frameNonce, setFrameNonce] = useState(0); // iframe reload

          useEffect(() => {
            const controller = new AbortController();
            if (cwd === undefined) { setState('nocwd'); return () => controller.abort(); }
            const run = async () => {
              try {
                const data = structOf(await rpcCall('list_projects', { format: 'json' }, controller.signal));
                const projects = (data && data.projects) || [];
                const target = normPath(cwd);
                // Bidirectional match between the session workspace (cwd) and
                // indexed project roots. A workspace often IS the repo root,
                // but can also be a parent of it (workspace = folder holding
                // the repo) or live inside one.
                // kind 3: exact; 2: cwd inside project (deepest root wins);
                // 1: project inside cwd (shallowest root wins).
                let best = null;
                let bestKind = 0;
                let bestLen = -1;
                for (const p of projects) {
                  const root = normPath(p.root_path);
                  if (!root) continue;
                  if (root === target) { best = p; bestKind = 3; break; }
                  if (target.startsWith(root + '/')) {
                    if (bestKind < 2) { best = p; bestKind = 2; bestLen = root.length; }
                    else if (bestKind === 2 && root.length > bestLen) { best = p; bestLen = root.length; }
                  } else if (root.startsWith(target + '/')) {
                    if (bestKind === 0) { best = p; bestKind = 1; bestLen = root.length; }
                    else if (bestKind === 1 && root.length < bestLen) { best = p; bestLen = root.length; }
                  }
                }
                if (best) { setProject(best); setState('ready'); }
                else setState('noproject');
              } catch (e) {
                if (controller.signal.aborted) return;
                setDiag(String((e && e.message) || e));
                setState('down');
              }
            };
            run();
            return () => controller.abort();
          }, [cwd]);

          // Header-strip facts for the matched project.
          useEffect(() => {
            if (!project) return;
            const controller = new AbortController();
            rpcCall('index_status', { project: project.name, format: 'json' }, controller.signal)
              .then((r) => { setStatus(structOf(r)); })
              .catch(() => { if (!controller.signal.aborted) setStatus(null); });
            return () => controller.abort();
          }, [project && project.name, statusNonce]);

          const stripButtonStyle = {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '2px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            color: 'var(--dsw-alias-label-primary)',
            backgroundColor: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l1)',
            textDecoration: 'none', whiteSpace: 'nowrap',
          };
          const secondary = { color: 'var(--dsw-alias-label-secondary)' };

          if (state === 'ready' && project) {
            const ok = !status || status.status === 'ready';
            const indexedAt = status && status.indexed_at
              ? new Date(status.indexed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';
            const counts = status && typeof status.nodes === 'number'
              ? t('tab.counts').replace('{n}', String(status.nodes)).replace('{e}', String(status.edges))
              : '';
            const openFull = () => {
              try {
                if (ctx.layout && typeof ctx.layout.selectPanel === 'function') {
                  ctx.layout.selectPanel('cbm-lens');
                  return;
                }
              } catch (_) { /* fall through */ }
              window.open(DIRECT_URL + '/?project=' + encodeURIComponent(project.name), '_blank', 'noopener');
            };
            return h('div', {
              style: {
                width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                backgroundColor: 'var(--dsw-alias-bg-base)',
              },
            },
              h('div', {
                style: {
                  display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto',
                  height: 36, padding: '0 12px', boxSizing: 'border-box',
                  borderBottom: '1px solid var(--dsw-alias-border-l1)',
                  fontSize: 12, color: 'var(--dsw-alias-label-primary)',
                  overflow: 'hidden', whiteSpace: 'nowrap',
                },
              },
                h('span', { key: 'name', style: { fontWeight: 600 } }, project.name),
                project.branch && h('span', { key: 'branch', style: secondary }, project.branch),
                h('span', {
                  key: 'dot',
                  title: status ? String(status.status) : '',
                  style: {
                    width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto',
                    backgroundColor: ok
                      ? 'var(--dsw-alias-state-success-primary)'
                      : 'var(--dsw-alias-state-warn-primary)',
                  },
                }),
                counts && h('span', { key: 'counts', style: secondary }, counts),
                indexedAt && h('span', { key: 'at', style: secondary }, t('tab.indexedAt') + ' ' + indexedAt),
                h('span', { key: 'spacer', style: { flex: 1 } }),
                h('button', {
                  key: 'refresh', type: 'button', style: stripButtonStyle,
                  onClick: () => { setStatusNonce((n) => n + 1); setFrameNonce((n) => n + 1); },
                }, t('tab.refresh')),
                h('button', { key: 'full', type: 'button', style: stripButtonStyle, onClick: openFull },
                  t('tab.openFull') + ' ↗')),
              h('iframe', {
                key: 'frame-' + frameNonce,
                src: PROXY_URL + '/?project=' + encodeURIComponent(project.name) +
                  '&workspace=architecture&dshembed=1',
                title: t('title'),
                allow: 'fullscreen',
                style: {
                  width: '100%', flex: 1, minHeight: 0, border: 'none', display: 'block',
                  backgroundColor: 'var(--dsw-alias-bg-base)',
                },
              }));
          }

          const head =
            state === 'nocwd' ? t('tab.nocwd') :
            state === 'noproject' ? t('tab.noproject') :
            state === 'down' ? t('status.down') :
            t('tab.loading');
          const children = [h('div', { key: 'head', style: { fontSize: 15, fontWeight: 600 } }, head)];
          if (state === 'noproject') {
            children.push(
              h('div', {
                key: 'path',
                style: {
                  fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace',
                  padding: '4px 10px', borderRadius: 6, maxWidth: '80%',
                  color: 'var(--dsw-alias-label-secondary)',
                  backgroundColor: 'var(--dsw-alias-bg-layer-2)',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  wordBreak: 'break-all',
                },
              }, cwd),
              h('div', {
                key: 'hint',
                style: { fontSize: 13, lineHeight: 1.7, maxWidth: 520, color: 'var(--dsw-alias-label-secondary)' },
              }, t('tab.noproject.hint')));
          }
          if (state === 'down') {
            children.push(
              h('div', {
                key: 'hint',
                style: { fontSize: 13, lineHeight: 1.7, maxWidth: 520, color: 'var(--dsw-alias-label-secondary)' },
              }, t('status.down.hint')),
              diag && h('div', {
                key: 'diag',
                style: {
                  fontSize: 11, maxWidth: 560, wordBreak: 'break-all',
                  color: 'var(--dsw-alias-label-secondary)', direction: 'ltr',
                },
              }, t('status.down.diag') + ': ' + diag),
              h('a', {
                key: 'open', href: DIRECT_URL + '/', target: '_blank', rel: 'noopener noreferrer',
                style: buttonStyle,
              }, t('action.open')));
          }
          return h('div', {
            style: {
              width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              backgroundColor: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              padding: 24, boxSizing: 'border-box', textAlign: 'center',
            },
          }, children);
        }

        // A per-session "CBM Lens" tab right after 轨迹 (Trajectory, order 10).
        ctx.slots.inject('conversation.view', () => {
          const reg = ctx.slots.register({
            name: 'conversation.view',
            id: 'cbm-lens',
            order: 15,
            locale: NS,
            label: () => t('view.lens'),
          }, LensTabView);
          return () => { if (typeof reg === 'function') reg(); };
        });
      },
    };
  },
});
