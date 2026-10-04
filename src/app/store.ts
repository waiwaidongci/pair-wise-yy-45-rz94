import { configureStore } from '@reduxjs/toolkit'
import { collaborationReducer } from '../features/collaboration/collaborationSlice'

const persistedKey = 'garment-sampling-collab-v2'

export const store = configureStore({
  reducer: {
    collaboration: collaborationReducer,
  },
})

// 协作状态整体持久化：断网刷新页面后队列、修订号、冲突操作都能恢复。
store.subscribe(() => {
  const state = store.getState().collaboration
  const persisted = {
    docs: state.docs,
    queue: state.queue,
    lastSyncAt: state.lastSyncAt,
    migrations: state.migrations,
    migrationSeen: state.migrationSeen,
    selectedId: state.selectedId,
    roundA: state.roundA,
    roundB: state.roundB,
  }
  try {
    localStorage.setItem(persistedKey, JSON.stringify(persisted))
  } catch {
    // 配额受限时至少保证内存可用
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
