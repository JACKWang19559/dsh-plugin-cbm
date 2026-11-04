import http from 'node:http';

/**
 * Host half of the CBM Lens bundle.
 *
 * 1. A system-prompt section makes every session in this profile default to
 *    graph-first code exploration through the codebase-memory-mcp tools
 *    (mcp__cbm__*): fewer file reads, exact symbols and relationships.
 * 2. A loopback reverse proxy serves CBM Lens without its `frame-ancestors
 *    'none'` CSP directive. The Lens server deliberately refuses embedding,
 *    so the Web UI panel frames a transparent 1:1 copy on 127.0.0.1:9750
 *    instead: no content rewriting, so Lens upgrades keep working. Lens
 *    itself stays untouched on 127.0.0.1:9749.
 */
export const inject = ['systemPrompt'];

const LENS_HOST = '127.0.0.1';
const LENS_PORT = 9749;
const PROXY_HOST = '127.0.0.1';
// v1.3.0 moved here from 9750: a leaked listener from an earlier module
// generation can keep 9750 bound until the next app restart, so each Host
// rewrite takes the next port to stay side-by-side safe.
const PROXY_PORT = 9751;

// Compact-chrome stylesheet for the session-tab embed. Hides Lens's global
// navigation, sub-tabs, breadcrumb, status bar, and hints so the Architecture
// plan map plus the Browse-map tree fill the tab. All selectors target Lens's
// data-testid attributes (stable within the beta, version-tolerant enough);
// misses degrade to the full UI.
const EMBED_CSS = [
  '[data-testid="atlas-header"]{display:none!important}',
  '[data-testid="atlas-tabs-bar"]{display:none!important}',
  '[data-testid="atlas-statusbar"]{display:none!important}',
  '[data-testid="atlas-breadcrumb"]{display:none!important}',
  '[data-testid="atlas-hint"]{display:none!important}',
  '[data-testid="atlas-coverage-note"]{display:none!important}',
  'html,body{height:100%!important;margin:0!important;overflow:hidden!important}',
].join('\n');

// One-shot Plan-projection switcher for the embed. Lens persists the planar
// choice per project itself once switched, so this only bridges the first
// load. Bounded (≈16s), idempotent, and re-dispatches resize so the canvas
// fits the iframe after the chrome is hidden.
const EMBED_JS = [
  '(function(){',
  '  function fit(){try{window.dispatchEvent(new Event("resize"))}catch(e){}}',
  '  var tries=0,done=false;',
  '  var timer=setInterval(function(){',
  '    if(done)return;tries++;fit();',
  '    var s=document.querySelector(\'[data-testid="architecture-scene"]\');',
  '    if(!s)return;',
  '    if(s.getAttribute("data-projection")==="3d"){',
  '      var b=document.querySelectorAll("button");',
  '      for(var i=0;i<b.length;i++){',
  '        if((b[i].textContent||"").trim()==="Plan"){b[i].click();break}',
  '      }',
  '    }else if(s.getAttribute("data-projection")==="plan"){done=true;clearInterval(timer);fit()}',
  '    if(tries>40)clearInterval(timer);',
  '  },400);',
  '})();',
].join('\n');

function startLensProxy(log) {
  const server = http.createServer((req, res) => {
    // Private Network Access preflight. The Desktop loads the GUI from the
    // privileged dsh-app:// scheme, which Chromium treats as a public
    // address space; its fetches to loopback must pass a PNA preflight
    // first or the renderer rejects the request before it reaches us.
    const reqH = req.headers;
    if (req.method === 'OPTIONS' &&
        (reqH['access-control-request-private-network'] || reqH['access-control-request-method'])) {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': reqH['access-control-request-method'] || 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': reqH['access-control-request-headers'] || 'content-type',
        'access-control-max-age': '86400',
        ...(reqH['access-control-request-private-network']
          ? { 'access-control-allow-private-network': 'true' }
          : {}),
      });
      res.end();
      return;
    }

    const fwdHeaders = { ...req.headers, host: `${LENS_HOST}:${LENS_PORT}` };
    // cbm's UI server answers any request carrying a foreign Origin header
    // with 403 (its CSRF posture). The browser's CORS probe always sends
    // Origin; strip it — the proxy itself is the local same-host caller.
    delete fwdHeaders.origin;
    const upstream = http.request(
      {
        protocol: 'http:',
        host: LENS_HOST,
        port: LENS_PORT,
        method: req.method,
        path: req.url,
        headers: fwdHeaders,
      },
      (up) => {
        const headers = { ...up.headers };
        // The only intentional change: allow this copy to be framed by the
        // Harness Web UI. Every other CSP directive is preserved.
        const csp = headers['content-security-policy'];
        if (csp) {
          const merged = Array.isArray(csp) ? csp.join(', ') : csp;
          const rewritten = merged
            .split(';')
            .map((d) => d.trim())
            .filter((d) => d && !/^frame-ancestors\b/i.test(d))
            .join('; ');
          if (rewritten) headers['content-security-policy'] = rewritten;
          else delete headers['content-security-policy'];
        }
        // Real statuses for the panel's CORS health probe, plus PNA consent.
        headers['access-control-allow-origin'] = '*';
        headers['access-control-allow-private-network'] = 'true';

        // Session-tab "project pulse" embed: HTML documents requested with
        // the dshembed marker get a compact-chrome stylesheet plus a one-shot
        // Plan-projection switcher injected. Selectors use Lens's stable
        // data-testid attributes; a Lens upgrade that renames them simply
        // falls back to the full UI.
        const wantsEmbed = /(?:^|[?&])dshembed=1(?:&|$)/.test(String(req.url || ''));
        const isHtml = /text\/html/i.test(String(headers['content-type'] || ''));
        if (wantsEmbed && isHtml && (up.statusCode ?? 200) === 200) {
          const chunks = [];
          up.on('data', (c) => chunks.push(c));
          up.on('end', () => {
            let body = Buffer.concat(chunks).toString('utf8');
            const injection =
              '<style id="dsh-embed-css">' + EMBED_CSS + '</style>' +
              '<script id="dsh-embed-js">' + EMBED_JS + '</' + 'script>';
            if (body.includes('</head>')) body = body.replace('</head>', injection + '</head>');
            else body = injection + body;
            headers['content-length'] = String(Buffer.byteLength(body, 'utf8'));
            res.writeHead(up.statusCode ?? 200, headers);
            res.end(body);
          });
          return;
        }

        res.writeHead(up.statusCode ?? 502, headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, {
          'content-type': 'text/plain; charset=utf-8',
          'access-control-allow-origin': '*',
          'access-control-allow-private-network': 'true',
        });
      }
      res.end('CBM Lens upstream unavailable: ' + err.message);
    });
    req.pipe(upstream);
  });

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PROXY_PORT, PROXY_HOST, () => resolve());
  });
  ready.catch((err) => log(`lens proxy not listening on ${PROXY_HOST}:${PROXY_PORT}: ${err.message}`));
  return { ready, close: () => server.close() };
}

export function apply(ctx) {
  const disposers = [];

  disposers.push(ctx.systemPrompt.section({
    name: 'cbm:code-exploration-policy',
    // Right after MCP_SERVERS (3100), so it reinforces the cbm server instructions.
    order: 3150,
    interpolate: false,
    text: [
      'Codebase exploration policy (codebase-memory-mcp).',
      'When mcp__cbm__ tools are available, prefer the code knowledge graph over grep/glob/read for code questions in an indexed project: it returns exact symbols and relationships with far fewer tokens and repeated file reads.',
      '',
      '- Locate symbols, functions, types: mcp__cbm__search_graph (regex, BM25, or semantic_query). Read a symbol: get_code_snippet; a file outline: get_file_outline.',
      '- Callers/callees/data flow: mcp__cbm__trace_path. Change blast radius: detect_changes. Multi-hop/aggregation: query_graph. Text search over indexed files: search_code.',
      '- Project state: list_projects lists indexes; index_status reports freshness and watch state; check_index_coverage verifies that paths you cite are indexed and fresh.',
      '- If the session project is not indexed yet, index it once with index_repository (large repositories: async true, then poll with status true), then continue. Ask the user when in doubt about indexing.',
      '- Absence claims: a missing graph result is not proof the code does not exist. Check check_index_coverage first; fall back to grep/glob/read when coverage reports the path as skipped, excluded, or stale, or when byte-exact raw content is required.',
      '- After locating code through the graph, verify the exact source (get_code_snippet or read) before editing or quoting it.',
      '- The graph reflects the last index. Watched session projects auto-refresh; otherwise re-run index_repository before trusting structure after many edits.',
    ].join('\n'),
  }));

  const proxy = startLensProxy((m) => console.error('[dsh-plugin-cbm] ' + m));
  disposers.push(() => proxy.close());

  return () => {
    for (const d of disposers) {
      try { d && d(); } catch (_) { /* best effort */ }
    }
  };
}
