import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { samplingApi, type ConflictResult } from '../app/api'
import type { RootState, AppDispatch } from '../app/store'
import type {
  Conflict,
  DiffItem,
  Op,
  OpType,
  Sample,
  Snapshot,
} from '../api/types'

const OLD_DRAFT_KEY = 'garment-sampling-draft-v1'
const COLLAB_KEY = 'garment-sampling-collab-v1'

const createAppThunk = createAsyncThunk.withTypes<{ state: RootState; dispatch: AppDispatch }>()

/* ------------------------------------------------------------------ */
/* pure helpers                                                        */
/* ------------------------------------------------------------------ */

function applyOpToSample(sample: Sample, op: Op): Sample {
  const next = structuredClone(sample)
  switch (op.type) {
    case 'measurement.update': {
      const round = op.payload.round as keyof Sample['measurements']
      const key = op.payload.key as string
      const target = next.measurements[round]?.find((item) => item.key === key)
      if (target) target.actual = Number(op.payload.actual)
      return next
    }
    case 'annotation.add': {
      const annotation = op.payload.annotation as Sample['annotations'][number]
      if (!next.annotations.some((item) => item.id === annotation.id)) {
        next.annotations.push(structuredClone(annotation))
      }
      return next
    }
    case 'annotation.resolve': {
      const target = next.annotations.find((item) => item.id === op.payload.annotationId)
      if (target) target.status = target.status === '待处理' ? '已解决' : '待处理'
      return next
    }
    case 'proposal.decide': {
      const target = next.proposals.find((item) => item.id === op.payload.proposalId)
      if (target) target.status = op.payload.decision as '已采纳' | '未采纳'
      next.decisions.push({
        proposalId: op.payload.proposalId as string,
        decision: op.payload.decision as '已采纳' | '未采纳',
        reason: op.payload.reason as string,
        decidedAt: op.payload.decidedAt as string,
      })
      return next
    }
    case 'draft.save': {
      next.draftNotes = op.payload.notes as string
      return next
    }
    case 'review.lock': {
      next.status = '已锁定'
      next.proposals.forEach((proposal) => {
        if (proposal.status === '待决定') proposal.status = '未采纳'
      })
      return next
    }
    case 'review.unlock': {
      next.status = '待审核'
      return next
    }
  }
}

function applyOpsToSample(sample: Sample, ops: Op[]): Sample {
  return ops.reduce((acc, op) => applyOpToSample(acc, op), sample)
}

/** 逐项比较服务器版本与本地工作副本，返回差异列表 */
function computeDiffs(server: Sample, local: Sample): DiffItem[] {
  const diffs: DiffItem[] = []

  const serverAnnIds = new Set(server.annotations.map((item) => item.id))
  const localAnnIds = new Set(local.annotations.map((item) => item.id))

  for (const ann of local.annotations) {
    if (!serverAnnIds.has(ann.id)) {
      diffs.push({
        type: 'annotation',
        key: ann.id,
        label: `批注 · ${ann.part}`,
        serverValue: '（服务器无此批注）',
        localValue: `${ann.part}：${ann.content}`,
        localOnly: true,
        opKind: 'annotation.add',
        opPayload: { annotation: ann },
      })
    } else {
      const serverAnn = server.annotations.find((item) => item.id === ann.id)!
      if (serverAnn.status !== ann.status || serverAnn.content !== ann.content || serverAnn.part !== ann.part) {
        diffs.push({
          type: 'annotation',
          key: ann.id,
          label: `批注 · ${ann.part}`,
          serverValue: serverAnn.status,
          localValue: ann.status,
          bothChanged: true,
          opKind: 'annotation.resolve',
          opPayload: { annotationId: ann.id, status: ann.status },
        })
      }
    }
  }

  for (const ann of server.annotations) {
    if (!localAnnIds.has(ann.id)) {
      diffs.push({
        type: 'annotation',
        key: ann.id,
        label: `批注 · ${ann.part}`,
        serverValue: `${ann.part}：${ann.content}`,
        localValue: '（本地无此批注）',
        serverOnly: true,
      })
    }
  }

  for (const prop of local.proposals) {
    const serverProp = server.proposals.find((item) => item.id === prop.id)
    if (serverProp && serverProp.status !== prop.status) {
      diffs.push({
        type: 'proposal',
        key: prop.id,
        label: `方案 · ${prop.affectedPart}`,
        serverValue: serverProp.status,
        localValue: prop.status,
        bothChanged: true,
        opKind: 'proposal.decide',
        opPayload: { proposalId: prop.id, decision: prop.status, reason: '', decidedAt: '' },
      })
    }
  }

  for (const round of ['第一轮', '第二轮', '第三轮'] as const) {
    for (const measurement of local.measurements[round]) {
      const serverMeasurement = server.measurements[round]?.find((item) => item.key === measurement.key)
      if (serverMeasurement && serverMeasurement.actual !== measurement.actual) {
        diffs.push({
          type: 'measurement',
          key: `${round}:${measurement.key}`,
          label: `尺寸 · ${measurement.name}（${round}）`,
          serverValue: `${serverMeasurement.actual} cm`,
          localValue: `${measurement.actual} cm`,
          bothChanged: true,
          opKind: 'measurement.update',
          opPayload: { round, key: measurement.key, actual: measurement.actual },
        })
      }
    }
  }

  if (server.draftNotes !== local.draftNotes) {
    diffs.push({
      type: 'draft',
      key: 'draft',
      label: '轮次评审草稿',
      serverValue: server.draftNotes || '（空）',
      localValue: local.draftNotes || '（空）',
      bothChanged: true,
      opKind: 'draft.save',
      opPayload: { notes: local.draftNotes },
    })
  }

  if (server.status !== local.status) {
    diffs.push({
      type: 'status',
      key: 'status',
      label: '评审状态',
      serverValue: server.status,
      localValue: local.status,
      bothChanged: true,
      opKind: local.status === '已锁定' ? 'review.lock' : 'review.unlock',
      opPayload: local.status === '已锁定' ? { reason: '' } : {},
    })
  }

  return diffs
}

/** 为冲突项找到对应的本地待提交操作（取最近一条，覆盖多次保存的场景） */
function findOpForDiff(outbox: Op[], diff: DiffItem, sampleId: string): Op | undefined {
  const matches = outbox.filter((op) => {
    if (op.sampleId !== sampleId || op.status === 'applied') return false
    switch (diff.type) {
      case 'annotation':
        if (diff.opKind === 'annotation.add') {
          return op.type === 'annotation.add' && (op.payload.annotation as { id: string })?.id === diff.key
        }
        return op.type === 'annotation.resolve' && op.payload.annotationId === diff.key
      case 'proposal':
        return op.type === 'proposal.decide' && op.payload.proposalId === diff.key
      case 'measurement':
        return op.type === 'measurement.update' && op.payload.round === diff.key.split(':')[0] && op.payload.key === diff.key.split(':')[1]
      case 'draft':
        return op.type === 'draft.save'
      case 'status':
        return op.type === 'review.lock' || op.type === 'review.unlock'
      default:
        return false
    }
  })
  return matches[matches.length - 1]
}

function rebaseOps(ops: Op[], newBaseRevision: number): Op[] {
  return ops.map((op) => ({
    ...op,
    baseRevision: newBaseRevision,
    status: 'pending' as const,
    attempts: 0,
    lastError: undefined,
  }))
}

function groupBySample(ops: Op[]): Record<string, Op[]> {
  return ops.reduce<Record<string, Op[]>>((acc, op) => {
    ;(acc[op.sampleId] ??= []).push(op)
    return acc
  }, {})
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

type CollabState = {
  working: Record<string, Sample>
  serverSamples: Record<string, Sample>
  revisions: Record<string, number>
  baseRevisions: Record<string, number>
  outbox: Op[]
  conflicts: Record<string, Conflict>
  snapshots: Record<string, Snapshot[]>
  online: boolean
  syncing: boolean
  lastSyncedAt: string | null
  migration: { status: 'idle' | 'done' | 'skipped'; recoveredOps: number }
  opSeq: number
}

function loadState(): CollabState {
  const fallback: CollabState = {
    working: {},
    serverSamples: {},
    revisions: {},
    baseRevisions: {},
    outbox: [],
    conflicts: {},
    snapshots: {},
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    syncing: false,
    lastSyncedAt: null,
    migration: { status: 'idle', recoveredOps: 0 },
    opSeq: 0,
  }
  try {
    const raw = localStorage.getItem(COLLAB_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<CollabState>
    return {
      ...fallback,
      ...parsed,
      syncing: false,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
      conflicts: parsed.conflicts ?? {},
      snapshots: parsed.snapshots ?? {},
      migration: parsed.migration ?? fallback.migration,
    }
  } catch {
    return fallback
  }
}

const initialState: CollabState = loadState()

/* ------------------------------------------------------------------ */
/* thunks                                                              */
/* ------------------------------------------------------------------ */

export const createOp = createAppThunk(
  'collab/createOp',
  async (payload: { sampleId: string; type: OpType; opPayload: Record<string, unknown> }, { getState, dispatch }) => {
    const state = (getState() as RootState).collab
    const seq = state.opSeq + 1
    const op: Op = {
      opId: `OP-${String(seq).padStart(4, '0')}`,
      sampleId: payload.sampleId,
      type: payload.type,
      baseRevision: state.baseRevisions[payload.sampleId] ?? state.revisions[payload.sampleId] ?? 1,
      payload: payload.opPayload,
      createdAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
    }
    dispatch(opCreated({ op }))
    void dispatch(flushOutbox())
    return op
  },
)

let flushInFlight = false
let flushQueued = false

export const flushOutbox = createAppThunk('collab/flushOutbox', async (_arg, { getState, dispatch }) => {
  if (flushInFlight) {
    flushQueued = true
    return
  }
  flushInFlight = true
  try {
    await doFlush(getState as () => RootState, dispatch)
  } finally {
    flushInFlight = false
    if (flushQueued) {
      flushQueued = false
      void dispatch(flushOutbox())
    }
  }
})

async function doFlush(getState: () => RootState, dispatch: AppDispatch) {
  const state = getState().collab
  const pending = state.outbox.filter((op) => op.status !== 'applied')
  if (pending.length === 0) return
  dispatch(setSyncing(true))
  try {
    const bySample = groupBySample(pending)
    for (const [sampleId, ops] of Object.entries(bySample)) {
      const result = await dispatch(
        samplingApi.endpoints.applyOps.initiate({ sampleId, ops }, { track: false }),
      )
      if (result.data?.ok) {
        dispatch(
          opsApplied({
            sampleId,
            revision: result.data.revision,
            sample: result.data.sample,
            opIds: ops.map((op) => op.opId),
          }),
        )
        dispatch(setOnline(true))
        dispatch(setLastSyncedAt(new Date().toISOString()))
        if (ops.some((op) => op.type === 'review.lock')) {
          void dispatch(fetchSnapshots(sampleId))
        }
      } else if (result.error) {
        const err = result.error as { status?: number; data?: unknown; error?: string }
        if (err.status === 409 && err.data) {
          const conflictData = err.data as ConflictResult
          const working = getState().collab.working[sampleId]
          const diffs = computeDiffs(conflictData.currentState, working)
          dispatch(
            conflictSet({
              sampleId,
              conflict: {
                sampleId,
                serverRevision: conflictData.currentRevision,
                baseRevision: conflictData.baseRevision,
                detectedAt: new Date().toISOString(),
                diffs,
              },
            }),
          )
          return
        }
        const message = err.error ?? `HTTP ${err.status ?? '?'}`
        dispatch(opsFailed({ opIds: ops.map((op) => op.opId), error: message }))
        dispatch(setOnline(false))
        return
      }
    }
  } finally {
    dispatch(setSyncing(false))
  }
}

export const refreshSample = createAppThunk(
  'collab/refreshSample',
  async (sampleId: string, { getState, dispatch }) => {
    const result = await dispatch(samplingApi.endpoints.getSample.initiate(sampleId, { subscribe: false }))
    if (result.data) {
      const serverSample = result.data
      const state = getState().collab
      const localRev = state.revisions[sampleId] ?? 0
      const hasPending = state.outbox.some((op) => op.sampleId === sampleId && op.status !== 'applied')
      if (serverSample.revision > localRev) {
        if (hasPending) {
          const diffs = computeDiffs(serverSample, state.working[sampleId])
          dispatch(
            conflictSet({
              sampleId,
              conflict: {
                sampleId,
                serverRevision: serverSample.revision,
                baseRevision: localRev,
                detectedAt: new Date().toISOString(),
                diffs,
              },
            }),
          )
        } else {
          dispatch(fastForward({ sampleId, sample: serverSample }))
        }
      }
    } else if (result.error) {
      dispatch(setOnline(false))
    }
  },
)

export const refreshAll = createAppThunk('collab/refreshAll', async (_arg, { getState, dispatch }) => {
  const result = await dispatch(samplingApi.endpoints.getSamples.initiate(undefined, { subscribe: false }))
  if (result.data) {
    dispatch(hydrateServerSamples({ samples: result.data }))
    dispatch(setOnline(true))
    const state = getState().collab
    for (const serverSample of result.data) {
      const localRev = state.revisions[serverSample.id] ?? 0
      const hasPending = state.outbox.some((op) => op.sampleId === serverSample.id && op.status !== 'applied')
      if (serverSample.revision > localRev && hasPending) {
        const diffs = computeDiffs(serverSample, state.working[serverSample.id])
        dispatch(
          conflictSet({
            sampleId: serverSample.id,
            conflict: {
              sampleId: serverSample.id,
              serverRevision: serverSample.revision,
              baseRevision: localRev,
              detectedAt: new Date().toISOString(),
              diffs,
            },
          }),
        )
      }
    }
  } else if (result.error) {
    dispatch(setOnline(false))
  }
})

export const resolveConflict = createAppThunk(
  'collab/resolveConflict',
  async (
    payload: { sampleId: string; resolutions: Record<string, 'local' | 'server'> },
    { getState, dispatch },
  ) => {
    const state = getState().collab
    const conflict = state.conflicts[payload.sampleId]
    if (!conflict) return
    const serverSample = state.serverSamples[payload.sampleId]

    const keptOps: Op[] = []
    for (const diff of conflict.diffs) {
      const resolution =
        payload.resolutions[diff.key] ?? (diff.localOnly ? 'local' : diff.serverOnly ? 'server' : 'local')
      if (resolution !== 'local') continue
      const op = findOpForDiff(state.outbox, diff, payload.sampleId)
      if (op) keptOps.push(op)
    }

    const merged = applyOpsToSample(structuredClone(serverSample), keptOps)
    const rebased = rebaseOps(keptOps, conflict.serverRevision)

    dispatch(
      rebaseAfterConflict({
        sampleId: payload.sampleId,
        baseRevision: conflict.serverRevision,
        working: merged,
        keptOps: rebased,
      }),
    )
    dispatch(conflictClear({ sampleId: payload.sampleId }))
    void dispatch(flushOutbox())
  },
)

export const retryOp = createAppThunk(
  'collab/retryOp',
  async (opId: string, { dispatch }) => {
    dispatch(opRetried({ opId }))
    void dispatch(flushOutbox())
  },
)

export const retryAll = createAppThunk('collab/retryAll', async (_arg, { dispatch }) => {
  dispatch(allRetried())
  void dispatch(flushOutbox())
})

export const fetchSnapshots = createAppThunk(
  'collab/fetchSnapshots',
  async (sampleId: string, { dispatch }) => {
    const result = await dispatch(
      samplingApi.endpoints.getSnapshots.initiate(sampleId, { subscribe: false }),
    )
    if (result.data) {
      dispatch(snapshotsSet({ sampleId, snapshots: result.data }))
    }
  },
)

/* ------------------------------------------------------------------ */
/* migration                                                           */
/* ------------------------------------------------------------------ */

export const migrateOldDrafts = createAppThunk(
  'collab/migrateOldDrafts',
  async (_arg, { getState, dispatch }) => {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(OLD_DRAFT_KEY)
    } catch {
      raw = null
    }
    if (!raw) {
      dispatch(migrationDone({ recoveredOps: 0 }))
      return
    }

    let old: {
      samples?: Sample[]
      draftNotes?: Record<string, string>
      decisions?: Array<{ proposalId: string; decision: '已采纳' | '未采纳'; reason: string; decidedAt: string }>
      locked?: boolean
    }
    try {
      old = JSON.parse(raw)
    } catch {
      dispatch(migrationDone({ recoveredOps: 0 }))
      return
    }

    const state = getState().collab
    let recoveredOps = 0

    for (const oldSample of old.samples ?? []) {
      const serverSample = state.serverSamples[oldSample.id]
      const baseRevision = serverSample?.revision ?? 1
      const working: Sample = {
        ...structuredClone(oldSample),
        revision: baseRevision,
        draftNotes: old.draftNotes?.[oldSample.id] ?? oldSample.draftNotes ?? '',
        decisions: oldSample.decisions ?? [],
      }
      dispatch(setWorkingFromMigration({ sampleId: oldSample.id, working }))

      // 操作基准号置 0，强制服务器在首次提交时返回冲突，弹出逐项合并对话框
      const ops = buildMigrationOps(working, serverSample, 0, old)
      for (const op of ops) {
        dispatch(enqueueOp({ op }))
        recoveredOps += 1
      }
    }

    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      localStorage.setItem(`${OLD_DRAFT_KEY}-recovered-${stamp}`, raw)
      localStorage.removeItem(OLD_DRAFT_KEY)
    } catch {
      /* ignore */
    }

    dispatch(migrationDone({ recoveredOps }))
    void dispatch(flushOutbox())
  },
)

function buildMigrationOps(
  working: Sample,
  server: Sample | undefined,
  baseRevision: number,
  old: {
    draftNotes?: Record<string, string>
    decisions?: Array<{ proposalId: string; decision: '已采纳' | '未采纳'; reason: string; decidedAt: string }>
    locked?: boolean
  },
): Op[] {
  const ops: Op[] = []
  const seqBase = Date.now()

  const makeOp = (index: number, type: OpType, payload: Record<string, unknown>): Op => ({
    opId: `OP-MIG-${seqBase}-${index}`,
    sampleId: working.id,
    type,
    baseRevision,
    payload,
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  })

  let i = 0
  const diffs = server ? computeDiffs(server, working) : []
  for (const diff of diffs) {
    if (!diff.opKind) continue
    if (diff.type === 'proposal') continue // 决定由 decisions 数组单独生成
    if (diff.opKind === 'annotation.add') {
      ops.push(makeOp(i++, 'annotation.add', diff.opPayload ?? {}))
    } else if (diff.opKind === 'annotation.resolve') {
      ops.push(makeOp(i++, 'annotation.resolve', diff.opPayload ?? {}))
    } else if (diff.opKind === 'measurement.update') {
      ops.push(makeOp(i++, 'measurement.update', diff.opPayload ?? {}))
    } else if (diff.opKind === 'draft.save') {
      ops.push(makeOp(i++, 'draft.save', diff.opPayload ?? {}))
    } else if (diff.opKind === 'review.lock' || diff.opKind === 'review.unlock') {
      ops.push(makeOp(i++, diff.opKind, diff.opPayload ?? {}))
    }
  }

  for (const decision of old.decisions ?? []) {
    ops.push(
      makeOp(i++, 'proposal.decide', {
        proposalId: decision.proposalId,
        decision: decision.decision,
        reason: decision.reason,
        decidedAt: decision.decidedAt,
      }),
    )
  }

  if (old.locked) {
    ops.push(makeOp(i++, 'review.lock', { reason: '迁移前已锁定', frozenBy: '当前用户' }))
  }

  return ops
}

/* ------------------------------------------------------------------ */
/* slice                                                               */
/* ------------------------------------------------------------------ */

const collabSlice = createSlice({
  name: 'collab',
  initialState,
  reducers: {
    hydrateServerSamples(state, action: PayloadAction<{ samples: Sample[] }>) {
      for (const sample of action.payload.samples) {
        state.serverSamples[sample.id] = sample
        state.revisions[sample.id] = sample.revision
        if (state.baseRevisions[sample.id] === undefined) state.baseRevisions[sample.id] = sample.revision
        if (!state.working[sample.id]) state.working[sample.id] = structuredClone(sample)
      }
    },
    setWorkingFromMigration(state, action: PayloadAction<{ sampleId: string; working: Sample }>) {
      state.working[action.payload.sampleId] = action.payload.working
      if (state.baseRevisions[action.payload.sampleId] === undefined) {
        state.baseRevisions[action.payload.sampleId] = action.payload.working.revision
      }
    },
    opCreated(state, action: PayloadAction<{ op: Op }>) {
      const { op } = action.payload
      state.working[op.sampleId] = applyOpToSample(state.working[op.sampleId], op)
      state.outbox.push(op)
      state.opSeq += 1
    },
    enqueueOp(state, action: PayloadAction<{ op: Op }>) {
      state.outbox.push(action.payload.op)
    },
    opsApplied(
      state,
      action: PayloadAction<{ sampleId: string; revision: number; sample: Sample; opIds: string[] }>,
    ) {
      const { sampleId, revision, sample, opIds } = action.payload
      state.serverSamples[sampleId] = sample
      state.revisions[sampleId] = revision
      state.baseRevisions[sampleId] = revision
      state.outbox = state.outbox.filter((op) => !opIds.includes(op.opId))
      // 剩余同一样本的待提交操作基准号前移到最新修订号
      for (const op of state.outbox) {
        if (op.sampleId === sampleId) op.baseRevision = revision
      }
    },
    opsFailed(state, action: PayloadAction<{ opIds: string[]; error: string }>) {
      for (const op of state.outbox) {
        if (action.payload.opIds.includes(op.opId)) {
          op.status = 'failed'
          op.attempts += 1
          op.lastError = action.payload.error
        }
      }
    },
    opRetried(state, action: PayloadAction<{ opId: string }>) {
      const op = state.outbox.find((item) => item.opId === action.payload.opId)
      if (op) {
        op.status = 'pending'
        op.attempts = 0
        op.lastError = undefined
      }
    },
    allRetried(state) {
      for (const op of state.outbox) {
        if (op.status === 'failed') {
          op.status = 'pending'
          op.attempts = 0
          op.lastError = undefined
        }
      }
    },
    conflictSet(state, action: PayloadAction<{ sampleId: string; conflict: Conflict }>) {
      state.conflicts[action.payload.sampleId] = action.payload.conflict
    },
    conflictClear(state, action: PayloadAction<{ sampleId: string }>) {
      delete state.conflicts[action.payload.sampleId]
    },
    snapshotsSet(state, action: PayloadAction<{ sampleId: string; snapshots: Snapshot[] }>) {
      state.snapshots[action.payload.sampleId] = action.payload.snapshots
    },
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload
    },
    setSyncing(state, action: PayloadAction<boolean>) {
      state.syncing = action.payload
    },
    setLastSyncedAt(state, action: PayloadAction<string>) {
      state.lastSyncedAt = action.payload
    },
    migrationDone(state, action: PayloadAction<{ recoveredOps: number }>) {
      state.migration = { status: 'done', recoveredOps: action.payload.recoveredOps }
    },
    rebaseAfterConflict(
      state,
      action: PayloadAction<{ sampleId: string; baseRevision: number; working: Sample; keptOps: Op[] }>,
    ) {
      const { sampleId, baseRevision, working, keptOps } = action.payload
      state.working[sampleId] = working
      state.baseRevisions[sampleId] = baseRevision
      state.outbox = [
        ...state.outbox.filter((op) => op.sampleId !== sampleId || op.status === 'applied'),
        ...keptOps,
      ]
    },
    fastForward(state, action: PayloadAction<{ sampleId: string; sample: Sample }>) {
      const { sampleId, sample } = action.payload
      state.working[sampleId] = structuredClone(sample)
      state.serverSamples[sampleId] = sample
      state.revisions[sampleId] = sample.revision
      state.baseRevisions[sampleId] = sample.revision
    },
  },
})

export const {
  hydrateServerSamples,
  setWorkingFromMigration,
  opCreated,
  enqueueOp,
  opsApplied,
  opsFailed,
  opRetried,
  allRetried,
  conflictSet,
  conflictClear,
  snapshotsSet,
  setOnline,
  setSyncing,
  setLastSyncedAt,
  migrationDone,
  rebaseAfterConflict,
  fastForward,
} = collabSlice.actions

export const collabReducer = collabSlice.reducer

/* ------------------------------------------------------------------ */
/* selectors                                                           */
/* ------------------------------------------------------------------ */

export const selectWorkingSample = (state: RootState, sampleId: string): Sample | undefined =>
  state.collab.working[sampleId]

export const selectOutboxForSample = (state: RootState, sampleId: string): Op[] =>
  state.collab.outbox.filter((op) => op.sampleId === sampleId && op.status !== 'applied')

export const selectPendingCount = (state: RootState): number =>
  state.collab.outbox.filter((op) => op.status === 'pending').length

export const selectFailedCount = (state: RootState): number =>
  state.collab.outbox.filter((op) => op.status === 'failed').length

export const selectHasConflict = (state: RootState, sampleId: string): boolean =>
  Boolean(state.collab.conflicts[sampleId])

export { COLLAB_KEY as collabStorageKey }
