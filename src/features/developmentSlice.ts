import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

type Round = '第一轮' | '第二轮' | '第三轮'

type DevelopmentState = {
  selectedId: string
  roundA: Round
  roundB: Round
  activeAnnotation: string | null
}

const viewKey = 'garment-sampling-view-v1'

function loadView(): DevelopmentState {
  const fallback: DevelopmentState = {
    selectedId: 'SMP-26018',
    roundA: '第二轮',
    roundB: '第三轮',
    activeAnnotation: null,
  }
  try {
    const raw = localStorage.getItem(viewKey)
    if (!raw) return fallback
    return { ...fallback, ...(JSON.parse(raw) as Partial<DevelopmentState>) }
  } catch {
    return fallback
  }
}

const initialState: DevelopmentState = loadView()

const slice = createSlice({
  name: 'development',
  initialState,
  reducers: {
    selectSample(state, action: PayloadAction<string>) {
      state.selectedId = action.payload
      state.activeAnnotation = null
    },
    setRounds(state, action: PayloadAction<{ a?: Round; b?: Round }>) {
      if (action.payload.a) state.roundA = action.payload.a
      if (action.payload.b) state.roundB = action.payload.b
    },
    toggleAnnotation(state, action: PayloadAction<string | null>) {
      state.activeAnnotation = action.payload
    },
  },
})

export const { selectSample, setRounds, toggleAnnotation } = slice.actions
export const developmentReducer = slice.reducer

export { viewKey as viewStorageKey }
