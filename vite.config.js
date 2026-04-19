import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const devHost = process.env.VITE_DEV_HOST || 'localhost'
const devPort = Number(process.env.VITE_DEV_PORT || 5173)
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001'
const webkitCompatibilityTarget = 'es2019'
const telegramMiniAppHtmlPath = resolve(__dirname, 'telegram-mini-app.html')
const telegramMiniAppEntryPlaceholder = '__TELEGRAM_MINI_APP_ENTRY_URL__'
const telegramMiniAppBuildMarkerPlaceholder = '__TELEGRAM_MINI_APP_BUILD_MARKER__'
const telegramMiniAppRuntimeEntryPath = resolve(__dirname, 'src', 'main.jsx')
const telegramMiniAppDevEntryUrl = '/src/main.jsx'
const telegramMiniAppDevBuildMarker = 'dev-src-main'
const telegramMiniAppBuildEntryUrlPrefix = '/telegram/'
const telegramMiniAppPathPattern = /^\/telegram\/mini-app(?:\/.*)?$/

function telegramMiniAppDevHtmlPlugin() {
  return {
    name: 'telegram-mini-app-dev-html-route',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.originalUrl || req.url || ''
        const pathname = requestUrl.split('?')[0]
        if (!telegramMiniAppPathPattern.test(pathname)) {
          return next()
        }

        try {
          const html = readFileSync(telegramMiniAppHtmlPath, 'utf8')
          const transformedHtml = await server.transformIndexHtml(pathname, html, req.originalUrl)
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(transformedHtml)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

function resolveTelegramMiniAppBuildEntryUrl(bundle) {
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk' || !output.facadeModuleId) {
      continue
    }

    if (resolve(output.facadeModuleId) !== telegramMiniAppRuntimeEntryPath) {
      continue
    }

    return `${telegramMiniAppBuildEntryUrlPrefix}${output.fileName}`
  }

  return ''
}

function replaceTelegramMiniAppHtmlPlaceholders(
  htmlSource,
  { entryUrl, buildMarker }
) {
  let replacedHtml = htmlSource
  if (replacedHtml.includes(telegramMiniAppEntryPlaceholder)) {
    replacedHtml = replacedHtml.replaceAll(
      telegramMiniAppEntryPlaceholder,
      entryUrl
    )
  }
  if (replacedHtml.includes(telegramMiniAppBuildMarkerPlaceholder)) {
    replacedHtml = replacedHtml.replaceAll(
      telegramMiniAppBuildMarkerPlaceholder,
      buildMarker
    )
  }
  return replacedHtml
}

function telegramMiniAppEntryUrlPlugin() {
  let command = 'serve'

  return {
    name: 'telegram-mini-app-entry-url',
    configResolved(config) {
      command = config.command
    },
    transformIndexHtml(html) {
      if (
        !html.includes(telegramMiniAppEntryPlaceholder) &&
        !html.includes(telegramMiniAppBuildMarkerPlaceholder)
      ) {
        return html
      }

      if (command !== 'serve') {
        return html
      }

      return replaceTelegramMiniAppHtmlPlaceholders(html, {
        entryUrl: telegramMiniAppDevEntryUrl,
        buildMarker: telegramMiniAppDevBuildMarker,
      })
    },
    writeBundle(options, bundle) {
      const entryUrl = resolveTelegramMiniAppBuildEntryUrl(bundle)
      if (!entryUrl) {
        this.error(
          'Unable to resolve the telegram mini app runtime entry chunk for /src/main.jsx.'
        )
      }

      const outputDirectory = resolve(options.dir || resolve(__dirname, 'dist'))
      const htmlOutputPath = resolve(outputDirectory, 'telegram-mini-app.html')
      if (!existsSync(htmlOutputPath)) {
        this.error(`Unable to find emitted telegram mini app HTML at ${htmlOutputPath}.`)
      }

      const htmlSource = readFileSync(htmlOutputPath, 'utf8')
      const buildMarker = entryUrl
      writeFileSync(
        htmlOutputPath,
        replaceTelegramMiniAppHtmlPlaceholders(htmlSource, {
          entryUrl,
          buildMarker,
        }),
        'utf8'
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), telegramMiniAppDevHtmlPlugin(), telegramMiniAppEntryUrlPlugin()],
  esbuild: {
    target: webkitCompatibilityTarget,
  },
  build: {
    target: webkitCompatibilityTarget,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        telegramMiniApp: telegramMiniAppHtmlPath,
        telegramMiniAppRuntimeEntry: telegramMiniAppRuntimeEntryPath,
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: webkitCompatibilityTarget,
    },
  },
  server: {
    host: devHost,
    port: devPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const auth = req.headers['authorization']
            if (auth) proxyReq.setHeader('authorization', auth)
          })
        },
      },
    },
  },
})
