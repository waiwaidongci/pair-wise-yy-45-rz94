import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { Provider, useDispatch } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { store, type AppDispatch } from './app/store'
import App from './App'
import {
  flushOutbox,
  hydrateServerSamples,
  migrateOldDrafts,
  refreshAll,
  setOnline,
} from './features/collabSlice'
import { samplingApi } from './app/api'
import './styles.css'

const theme = createTheme({
  palette: {
    primary: { main: '#1d6d65' },
    secondary: { main: '#b65e35' },
    background: { default: '#f3f1ed', paper: '#ffffff' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
    button: { textTransform: 'none', fontWeight: 700 },
  },
})

function CollabBootstrap({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>()

  useEffect(() => {
    let cancelled = false
    async function boot() {
      // 1. 拉取服务器最新版本（失败则保留本地，离线排队）
      const result = await dispatch(samplingApi.endpoints.getSamples.initiate(undefined, { subscribe: false }))
      if (cancelled) return
      if (result.data) {
        dispatch(hydrateServerSamples({ samples: result.data }))
        dispatch(setOnline(true))
      } else {
        dispatch(setOnline(false))
      }
      // 2. 迁移旧草稿（转换为待提交操作，不丢失内容）
      await dispatch(migrateOldDrafts())
      // 3. 尝试提交迁移恢复的操作
      if (!cancelled) void dispatch(flushOutbox())
    }
    void boot()

    const goOnline = () => {
      dispatch(setOnline(true))
      void dispatch(flushOutbox())
    }
    const goOffline = () => dispatch(setOnline(false))
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    const interval = window.setInterval(() => {
      if (navigator.onLine) void dispatch(refreshAll())
    }, 20000)

    return () => {
      cancelled = true
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      window.clearInterval(interval)
    }
  }, [dispatch])

  return <>{children}</>
}

async function enableMocking() {
  if (!import.meta.env.DEV) return
  const { worker } = await import('./api/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

enableMocking().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>
            <CollabBootstrap>
              <App />
            </CollabBootstrap>
          </BrowserRouter>
        </ThemeProvider>
      </Provider>
    </React.StrictMode>,
  )
})
