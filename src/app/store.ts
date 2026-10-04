import { configureStore } from '@reduxjs/toolkit'
import { samplingApi } from './api'
import { developmentReducer, viewStorageKey } from '../features/developmentSlice'
import { collabReducer, collabStorageKey } from '../features/collabSlice'

export const store = configureStore({
  reducer: {
    development: developmentReducer,
    collab: collabReducer,
    [samplingApi.reducerPath]: samplingApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(samplingApi.middleware),
})

store.subscribe(() => {
  const state = store.getState()
  try {
    localStorage.setItem(viewStorageKey, JSON.stringify(state.development))
    localStorage.setItem(collabStorageKey, JSON.stringify(state.collab))
  } catch {
    /* storage unavailable */
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
