import { defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { giftService } from './frontend/preview-server/gifts'
import { relayService } from './frontend/preview-server/relay'
import { inviteService } from './frontend/preview-server/invites'

import siteConfiguration from './.figma/make/site.json'


// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // .figma/make/deploy-preview passes `--mode development` for cached-preview builds.
  const emitSourcemaps = mode === 'development'
  const frontendRoot = path.resolve(__dirname, 'frontend')
  const defaultOutDir = path.resolve(__dirname, 'dist')

  const { VITE_XIJIE_AUTH_MODE: authMode, XIJIE_IDENTITY_URL: identityUrl, XIJIE_PEOPLE_URL: peopleUrl, XIJIE_CONVERSATIONS_URL: conversationsUrl, XIJIE_MEMORIES_URL: memoriesUrl, XIJIE_SOCIAL_URL: socialUrl, XIJIE_MEDIA_URL: mediaUrl, XIJIE_GIFTS_URL: giftsUrl } = loadEnv(
    mode, __dirname, ['VITE_XIJIE_AUTH_MODE', 'XIJIE_IDENTITY_URL', 'XIJIE_PEOPLE_URL', 'XIJIE_CONVERSATIONS_URL', 'XIJIE_MEMORIES_URL', 'XIJIE_SOCIAL_URL', 'XIJIE_MEDIA_URL', 'XIJIE_GIFTS_URL'],
  )
  if ((authMode && authMode !== 'service' && authMode !== 'preview') || (authMode === 'service') !== !!identityUrl) {
    throw new Error('Set VITE_XIJIE_AUTH_MODE=service and XIJIE_IDENTITY_URL together to enable the identity service.')
  }
  if (peopleUrl && authMode !== 'service') throw new Error('XIJIE_PEOPLE_URL requires service mode.')
  if (conversationsUrl && authMode !== 'service') throw new Error('XIJIE_CONVERSATIONS_URL requires service mode.')
  if (memoriesUrl && authMode !== 'service') throw new Error('XIJIE_MEMORIES_URL requires service mode.')
  if (socialUrl && authMode !== 'service') throw new Error('XIJIE_SOCIAL_URL requires service mode.')
  if (mediaUrl && authMode !== 'service') throw new Error('XIJIE_MEDIA_URL requires service mode.')
  if (giftsUrl && authMode !== 'service') throw new Error('XIJIE_GIFTS_URL requires service mode.')
  const giftsTarget = proxyOrigin('XIJIE_GIFTS_URL', giftsUrl)
  const identityTarget = proxyOrigin('XIJIE_IDENTITY_URL', identityUrl)
  const peopleTarget = proxyOrigin('XIJIE_PEOPLE_URL', peopleUrl)
  const conversationsTarget = proxyOrigin('XIJIE_CONVERSATIONS_URL', conversationsUrl)
  const memoriesTarget = proxyOrigin('XIJIE_MEMORIES_URL', memoriesUrl)
  const socialTarget = proxyOrigin('XIJIE_SOCIAL_URL', socialUrl)
  const mediaTarget = proxyOrigin('XIJIE_MEDIA_URL', mediaUrl)
  const serviceProxy = {
    ...(giftsTarget ? { '^/v1/(gift-catalog|gift-deliveries|gift-delivery-photos|received-gifts|notifications|wallet|products|purchase-quotes|orders)([/?]|$)': { target: giftsTarget }, '^/v1/callbacks/(payments|refunds)/(jeepay|hyperswitch)([/?]|$)': {target:giftsTarget} } : {}),
    ...(identityTarget ? { '^/v1/(auth|sessions|accounts|policies|data-request-receipts|referrals|content-reports)([/?]|$)': { target: identityTarget }, '^/v1/public/referrals([/?]|$)': {target:identityTarget} } : {}),
    ...(conversationsTarget ? {
      '^/v1/search\\?(?:[^&]*&)*scope=conversations(?:&|$)': { target: conversationsTarget },
      '^/v1/persons/[^/]+/letters([/?]|$)': { target: conversationsTarget },
      '^/v1/persons/[^/]+/(story-branches|offline-life)([/?]|$)':{target:conversationsTarget},
      '^/v1/(story-branches|story-generation-jobs)([/?]|$)':{target:conversationsTarget},
    } : {}),
    ...(memoriesTarget ? {
      '^/v1/generation-jobs/[^?]+\\?(?:[^&]*&)*kind=memory_suggestion(?:&|$)': { target: memoriesTarget },
      '^/v1/persons/[^/]+/memory-candidates([/?]|$)': { target: memoriesTarget },
      '^/v1/persons/[^/]+/memories([/?]|$)': { target: memoriesTarget },
      '^/v1/persons/[^/]+/memory-imports([/?]|$)': { target: memoriesTarget },
      '^/v1/search([/?]|$)': { target: memoriesTarget },
    } : {}),
    ...(peopleTarget ? { '^/v1/(person-drafts|persons|worlds|person-reminders)([/?]|$)': { target: peopleTarget } } : {}),
    ...(conversationsTarget ? { '^/v1/(conversations|generation-jobs)([/?]|$)': { target: conversationsTarget },'^/v1/call-sessions([/?]|$)':{target:conversationsTarget,ws:true} } : {}),
    ...(socialTarget ? { '^/v1/(feed|posts|social-generation-jobs|shared-albums)([/?]|$)': { target: socialTarget },'^/v1/public/shared-albums([/?]|$)':{target:socialTarget} } : {}),
    ...(mediaTarget ? { '^/v1/(media|person-voices)([/?]|$)': { target: mediaTarget } } : {}),
  }

  return {
    root: frontendRoot,
    envDir: __dirname,
    base: process.env.FIGMA_PUBLIC_URL ? `${process.env.FIGMA_PUBLIC_URL}/` : '/',
    build: {
      outDir: defaultOutDir,
      sourcemap: emitSourcemaps ? 'inline' : false,
      minify: !emitSourcemaps,
    },
    plugins: [
      {
        name: 'elysium-workspace-build-output',
        config({ build }) {
          // Keep CLI output paths relative to the workspace and explicitly enable cleanup for dist.
          const outDir = path.resolve(__dirname, build?.outDir ?? defaultOutDir)
          const emptyOutDir = build?.emptyOutDir ?? (outDir === defaultOutDir ? true : undefined)
          return { build: { outDir, emptyOutDir } }
        },
      },
      react(),
      ...(authMode === 'service' ? [] : [giftService(), relayService(), inviteService()]),
      tailwindcss(),
      figmaSiteConfiguration(siteConfiguration),
      figmaErrorOverlayReplay(),
      figmaReactRefreshBoundaryFallback(),
      figmaMakeKitPlugin({ storiesGlob: '/src/**/*.stories.{ts,tsx,js,jsx}' }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(frontendRoot, 'src'),
      },
    },
    server: {
      host: process.env.FIGMA_DEV_SERVER_HOST || '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
      strictPort: true,
      proxy: serviceProxy,
      fs: { allow: [frontendRoot, path.resolve(__dirname, 'node_modules')] },
      watch: {
        ignored: [
          '**/.figma/**',
],
      },
    },
    preview: {
      proxy: serviceProxy,
      host: process.env.FIGMA_DEV_SERVER_HOST || '0.0.0.0',
      port: parseInt(process.env.PORT || '8443'),
    },
  }
})

function proxyOrigin(name: string, value: string | undefined) {
  if (!value) return undefined
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP or HTTPS origin.`)
  }
  return url.origin
}

type FigmaSiteConfiguration = {
  title?: string
  description?: string
  language?: string
  robots?: {
    index?: boolean
  }
  icons?: {
    icon?: string
  }
  openGraph?: {
    image?: string
  }
  analytics?: {
    googleAnalyticsId?: string
  }
  customScripts?: {
    headStart?: string
    headEnd?: string
    bodyStart?: string
    bodyEnd?: string
  }
  accessibility?: {
    addBypassLinks?: boolean
  }
}

/** Applies /.figma/make/site.json to the generated document shell. */
function figmaSiteConfiguration(config: FigmaSiteConfiguration): Plugin {
  function sanitizeHtmlValue(value: string | undefined): string {
    return value?.replace(/[^a-zA-Z0-9_-]/g, '') || ''
  }
  function escapeHtmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function replaceHtmlCommentSlot(html: string, slotName: string, content: string): string {
    return html.replace(`<!-- ${slotName} -->`, content)
  }

  const title = config.title ?? "Figma Make App"
  const description = config.description ?? ''
  const favicon = config.icons?.icon ?? ''
  const socialImage = config.openGraph?.image ?? ''
  const language = sanitizeHtmlValue(config.language) || 'en'
  const googleAnalyticsId = sanitizeHtmlValue(config.analytics?.googleAnalyticsId)
  const headStart = config.customScripts?.headStart ?? ''
  const headEnd = config.customScripts?.headEnd ?? ''
  const bodyStart = config.customScripts?.bodyStart ?? ''
  const bodyEnd = config.customScripts?.bodyEnd ?? ''
  const robotsTxt = config.robots?.index === false ? 'User-agent: *\nDisallow: /\n' : ''

  return {
    name: 'figma-site-configuration',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!robotsTxt || req.url?.split('?')[0] !== '/robots.txt') return next()

        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(robotsTxt)
      })
    },
    generateBundle() {
      if (!robotsTxt) return

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: robotsTxt,
      })
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let result = html
        result = replaceHtmlCommentSlot(result, 'figma:lang', language)
        result = replaceHtmlCommentSlot(result, 'figma:title', escapeHtmlText(title))
        result = replaceHtmlCommentSlot(result, 'figma:head-start', headStart)
        result = replaceHtmlCommentSlot(result, 'figma:head-end', headEnd)
        result = replaceHtmlCommentSlot(result, 'figma:body-start', bodyStart)
        result = replaceHtmlCommentSlot(result, 'figma:body-end', bodyEnd)

        const tags: HtmlTagDescriptor[] = []
        if (description) {
          tags.push({ tag: 'meta', attrs: { name: 'description', content: description }, injectTo: 'head' })
        }
        if (config.robots?.index === false) {
          tags.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' })
        }
        if (favicon) {
          tags.push({ tag: 'link', attrs: { rel: 'icon', href: favicon }, injectTo: 'head' })
        }
        if (title) {
          tags.push({ tag: 'meta', attrs: { property: 'og:title', content: title }, injectTo: 'head' })
        }
        if (description) {
          tags.push({ tag: 'meta', attrs: { property: 'og:description', content: description }, injectTo: 'head' })
        }
        if (socialImage) {
          tags.push(
            { tag: 'meta', attrs: { property: 'og:image', content: socialImage }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'twitter:image', content: socialImage }, injectTo: 'head' },
          )
        }

        if (googleAnalyticsId) {
          tags.push(
            {
              tag: 'script',
              attrs: {
                async: true,
                src: `https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`,
              },
              injectTo: 'head',
            },
            {
              tag: 'script',
              children: `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', ${JSON.stringify(googleAnalyticsId)});
`,
              injectTo: 'head',
            },
          )
        }

        if (config.accessibility?.addBypassLinks) {
          tags.push(
            {
              tag: 'style',
              children: `
  .figma-bypass-link {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 2147483647;
    transform: translateY(-150%);
    border-radius: 6px;
    background: #111827;
    color: #fff;
    padding: 8px 12px;
    font: 600 14px/1.2 system-ui, sans-serif;
    text-decoration: none;
  }
  .figma-bypass-link:focus {
    transform: translateY(0);
  }
`,
              injectTo: 'head',
            },
            {
              tag: 'a',
              attrs: { class: 'figma-bypass-link', href: '#root' },
              children: 'Skip to content',
              injectTo: 'body-prepend',
            },
          )
        }

        return {
          html: result,
          tags,
        }
      },
    },
  }
}

/**
 * Replay the most recent build error to clients that connect after
 * it was first broadcast. Vite buffers an error payload only while
 * no clients are connected and clears the buffer on the first
 * reconnect (see `bufferedMessage` in `createWebSocketServer`), so
 * if the preview iframe reloads after Vite already delivered an
 * error to a live socket, the new socket misses the payload and
 * the overlay stays hidden even though the build is still broken.
 * We intercept `ws.send` to remember the latest error and replay
 * it on every new connection; the cache clears on a successful
 * `update` or `full-reload` so a stale overlay can't survive a
 * fixed build.
 */
function figmaErrorOverlayReplay(): Plugin {
  return {
    name: 'figma-error-overlay-replay',
    apply: 'serve',
    configureServer(server) {
      let lastError: object | null = null

      const origSend = server.ws.send.bind(server.ws) as (...args: any[]) => void
      server.ws.send = ((...args: any[]) => {
        const payload = args[0]
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const type = (payload as { type?: string }).type
          if (type === 'error') {
            lastError = payload as object
          } else if (type === 'update' || type === 'full-reload') {
            lastError = null
          }
        }
        return origSend(...args)
      }) as typeof server.ws.send

      server.ws.on('connection', (socket) => {
        if (lastError !== null) {
          socket.send(JSON.stringify(lastError))
        }
      })
    },
  }
}

/**
 * Reload when a module that previously defined a React Refresh boundary stops
 * defining one. This happens when an agent moves a component into a new file
 * and replaces the old module with a re-export:
 *
 *   export { default } from './app/App'
 *
 * Vite otherwise accepts the update using the previous module's HMR boundary,
 * but the re-export-only transform no longer registers a replacement for the
 * mounted component family. React reports a successful refresh while leaving
 * the old tree mounted until the page is reloaded.
 */
function figmaReactRefreshBoundaryFallback(): Plugin {
  type ModuleNode = import('vite').ModuleNode
  const hadRefreshBoundary = new Map<string, boolean>()
  const lostRefreshBoundaries = new Set<string>()
  let sendFullReload: (() => void) | null = null

  return {
    name: 'figma-react-refresh-boundary-fallback',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      sendFullReload = () => server.ws.send({ type: 'full-reload', path: '*' })
    },
    handleHotUpdate({ modules, server, timestamp }) {
      if (lostRefreshBoundaries.size === 0) return

      const visited = new Set<ModuleNode>()
      const pending = [...modules]
      while (pending.length > 0) {
        const current = pending.pop()
        if (!current || visited.has(current)) continue
        visited.add(current)

        const moduleId = current.id?.split('?')[0]
        if (moduleId && lostRefreshBoundaries.has(moduleId)) {
          const invalidated = new Set<ModuleNode>()
          for (const updatedModule of modules) {
            server.moduleGraph.invalidateModule(updatedModule, invalidated, timestamp, true)
          }
          sendFullReload?.()
          return []
        }

        pending.push(...current.importers)
      }
    },
    transform(code, id) {
      if (!/\.[jt]sx?(?:\?|$)/.test(id) || id.includes('/node_modules/')) return null

      const moduleId = id.split('?')[0] ?? id
      const hasRefreshBoundary = code.includes('registerExportsForReactRefresh')
      const previousHadRefreshBoundary = hadRefreshBoundary.get(moduleId)
      hadRefreshBoundary.set(moduleId, hasRefreshBoundary)

      if (hasRefreshBoundary) lostRefreshBoundaries.delete(moduleId)
      if (previousHadRefreshBoundary && !hasRefreshBoundary) {
        lostRefreshBoundaries.add(moduleId)
        queueMicrotask(() => sendFullReload?.())
      }

      return null
    },
  }
}

/**
 * Serves a blank render-target page at /.figma/make/kit.html that
 * the Figma preview script drives directly. The page exposes a
 * registry of every file matching `storiesGlob` on
 * window.__FIGMA__.stories so the design surface can dynamically
 * import + mount each entry into its own grid view.
 *
 * Dev-only: `apply: 'serve'` gates the plugin to `vite dev`. Prod
 * builds (`vite build`) skip it entirely so the route doesn't leak
 * into shipped bundles.
 */
function figmaMakeKitPlugin(options: { storiesGlob: string | string[] }): Plugin {
  const storiesGlob = Array.isArray(options.storiesGlob) ? options.storiesGlob : [options.storiesGlob]
  const ROUTE = '/.figma/make/kit.html'
  const VIRTUAL_ID = 'virtual:figma-stories'
  const RESOLVED_ID = '\0' + VIRTUAL_ID
  const STORIES_MODULE = `export const stories = import.meta.glob(${JSON.stringify(storiesGlob)})`
  const HTML_BOOTSTRAP = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
<div id="figma-make-kit-root"></div>
<script type="module">
  import { stories } from 'virtual:figma-stories'
  window.__FIGMA__ = Object.assign(window.__FIGMA__ ?? {}, { stories })
  window.dispatchEvent(new CustomEvent('figma.ready'))
</script>
</body>
</html>`

  return {
    name: 'figma-make-kit',
    apply: 'serve',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      return STORIES_MODULE
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (url.split('?')[0] !== ROUTE) return next()

        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml(url, HTML_BOOTSTRAP))
        } catch (err) {
          next(err as Error)
        }
      })
    },
  }
}
