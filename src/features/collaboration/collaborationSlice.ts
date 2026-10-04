import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type {
  MigrationReport,
  OperationPayload,
  QueuedOperation,
  RejectedResult,
  ReviewSnapshot,
  Sample,
  ServerOp,
  SyncResponse,
} from '../../api/types'
import { CURRENT_USER, makeQueuedOp, nextSeq, stripServerFields } from './model'

export type SyncState = 'online' | 'offline' | 'flushing' | 'error'

type DocState = {
  sample: Sample
  revision: number
  locked: boolean
  oplog: ServerOp[]
  snapshots: ReviewSnapshot[]
  /** 已通过 GET/sync 同步到的最高他人操作时间戳，用于“他人修改”提示。 */
  lastSeenOpAt: number
  /** 尚未查看的他人操作（非当前用户，且晚于上次打开时基线）。 */
  remoteNotice: ServerOp[]
  loadedAt: number
}

type CollabState = {
  docs: Record<string, DocState>
  queue: QueuedOperation[]
  online: boolean
  flushInFlight: boolean
  lastError: string | null
  lastSyncAt: number | null
  migrations: MigrationReport[]
  migrationSeen: boolean
  selectedId: string
  roundA: '第一轮' | '第二轮' | '第三轮'
  roundB: '第一轮' | '第二轮' | '第三轮'
  activeAnnotation: string | null
}

const storageKey = 'garment-sampling-collab-v2'
const seqKey = 'garment-sampling-seq'

const bootSeq = Number(localStorage.getItem(seqKey) ?? 0)
if (bootSeq > 0) {
  for (let i = 0; i < bootSeq; i += 1) nextSeq()
}

/** 旧版 UI 偏好（轮次选择 / 选中样衣）迁移到新状态，业务草稿由服务端迁移。 */
function readPersisted(): Partial<CollabState> | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Partial<CollabState>
  } catch {
    return null
  }
}

const persisted = readPersisted()

const initialState: CollabState = {
  docs: persisted?.docs ?? {},
  queue: persisted?.queue ?? [],
  online: navigator.onLine,
  flushInFlight: false,
  lastError: null,
  lastSyncAt: persisted?.lastSyncAt ?? null,
  migrations: persisted?.migrations ?? [],
  migrationSeen: persisted?.migrationSeen ?? false,
  selectedId: persisted?.selectedId ?? 'SMP-26018',
  roundA: persisted?.roundA ?? '第二轮',
  roundB: persisted?.roundB ?? '第三轮',
  activeAnnotation: null,
}

/* ----------------------------- 纯 reducer 片段 ----------------------------- */

function upsertDocFromSync(state: CollabState, data: {
  sampleId: string
  sample: Sample
  revision: number
  locked: boolean
  oplog: ServerOp[]
  snapshots?: ReviewSnapshot[]
}): DocState {
  const previous = state.docs[data.sampleId]
  const remoteNotice = previous
    ? data.oplog.filter((op) => op.author !== CURRENT_USER && op.createdAt > previous.lastSeenOpAt && !op.migrated)
    : []
  const doc: DocState = {
    sample: data.sample,
    revision: data.revision,
    locked: data.locked,
    oplog: data.oplog,
    snapshots: data.snapshots ?? previous?.snapshots ?? [],
    lastSeenOpAt: previous?.lastSeenOpAt ?? data.oplog.reduce((max, op) => Math.max(max, op.createdAt), 0),
    remoteNotice: [...(previous?.remoteNotice ?? []), ...remoteNotice],
    loadedAt: Date.now(),
  }
  state.docs[data.sampleId] = doc
  return doc
}

/** 依据 sync 结果从队列移除已应用操作，冲突 / 锁定的操作保留。 */
function reconcileQueue(state: CollabState, response: SyncResponse): void {
  const appliedIds = new Set(response.applied.map((item) => item.opId))
  const rejectedByOp = new Map(response.rejected.map((item) => [item.opId, item]))
  state.queue = state.queue.filter((op) => {
    if (appliedIds.has(op.opId)) return false
    const rejected = rejectedByOp.get(op.opId)
    if (!rejected) return true
    return rejected.code === 'conflict' || rejected.code === 'locked'
  })
  state.queue.forEach((op) => {
    const rejected = rejectedByOp.get(op.opId)
    if (!rejected) return
    if (rejected.code === 'locked') {
      // 锁定冻结：操作保留但不自动重试，等解锁新分支后由用户手动重试。
      op.state = 'blocked'
      op.attempts += 1
      op.error = rejected.message
      return
    }
    op.state = rejected.code === 'conflict' ? 'conflict' : 'queued'
    op.error = rejected.message
    op.remote = rejected.remote
    op.attempts += 1
  })
}

const slice = createSlice({
  name: 'collaboration',
  initialState,
  reducers: {
    selectSample(state, action: PayloadAction<string>) {
      state.selectedId = action.payload
      state.activeAnnotation = null
    },
    setRounds(state, action: PayloadAction<{ a?: CollabState['roundA']; b?: CollabState['roundB'] }>) {
      if (action.payload.a) state.roundA = action.payload.a
      if (action.payload.b) state.roundB = action.payload.b
    },
    toggleAnnotation(state, action: PayloadAction<string | null>) {
      state.activeAnnotation = action.payload
    },
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload
      if (action.payload) state.lastError = null
    },

    enqueue(state, action: PayloadAction<{ sampleId: string; payload: OperationPayload }>) {
      const doc = state.docs[action.payload.sampleId]
      const seq = nextSeq()
      localStorage.setItem(seqKey, String(seq))
      const op = makeQueuedOp(
        { sampleId: action.payload.sampleId, baseRev: doc?.revision ?? 0, author: CURRENT_USER, seq },
        action.payload.payload,
      )
      state.queue.push(op)
      state.lastError = null
    },

    sampleLoaded(state, action: PayloadAction<{
      sample: Sample
      revision: number
      locked: boolean
      oplog: ServerOp[]
      snapshots: ReviewSnapshot[]
      migrations: MigrationReport[]
    }>) {
      const { sample, revision, locked, oplog, snapshots, migrations } = action.payload
      upsertDocFromSync(state, { sampleId: sample.id, sample, revision, locked, oplog, snapshots })
      if (migrations.length > 0) state.migrations = migrations
    },

    syncStarted(state, action: PayloadAction<string[]>) {
      state.flushInFlight = true
      action.payload.forEach((opId) => {
        const op = state.queue.find((item) => item.opId === opId)
        if (op) op.state = 'syncing'
      })
    },

    syncSucceeded(state, action: PayloadAction<SyncResponse>) {
      const response = action.payload
      // 先重算队列（应用 / 拒绝），再落服务端快照。
      reconcileQueue(state, response)
      // 快照以服务端返回为准：锁定快照不可覆盖、解锁后仍保留。
      const doc = upsertDocFromSync(state, {
        sampleId: response.sampleId,
        sample: response.sample,
        revision: response.revision,
        locked: response.locked,
        oplog: response.oplog,
        snapshots: response.snapshots ?? [],
      })
      const seen = new Set<string>()
      doc.snapshots = doc.snapshots.filter((snap) => (seen.has(snap.id) ? false : (seen.add(snap.id), true)))
      state.flushInFlight = false
      state.lastError = null
      state.lastSyncAt = Date.now()
    },

    syncFailed(state, action: PayloadAction<{ message: string; opIds: string[] }>) {
      state.flushInFlight = false
      // 服务端故障不等于断网：online 只由浏览器 online/offline 事件维护。
      state.lastError = action.payload.message
      // 失败后保留全部未完成操作，回到排队状态等待手动 / 恢复后重试。
      action.payload.opIds.forEach((opId) => {
        const op = state.queue.find((item) => item.opId === opId)
        if (op && op.state === 'syncing') {
          op.state = 'queued'
          op.attempts += 1
        }
      })
    },

    retryOp(state, action: PayloadAction<string>) {
      const op = state.queue.find((item) => item.opId === action.payload)
      if (op) {
        // 冲突 / 冻结操作可通过此动作回到排队；冲突方若未选择解决方式，仍会被服务端再次拒绝。
        op.state = 'queued'
        op.error = undefined
      }
    },

    /** 冲突解决：mine = 以本地版本强制覆盖；theirs = 放弃本地采用服务端。 */
    resolveConflict(state, action: PayloadAction<{ opId: string; resolution: 'mine' | 'theirs' }>) {
      const op = state.queue.find((item) => item.opId === action.payload.opId)
      if (!op) return
      if (action.payload.resolution === 'theirs') {
        state.queue = state.queue.filter((item) => item.opId !== op.opId)
        return
      }
      // 以我的为准：更新 baseRev 到当前修订，保留原操作号与操作号顺序，下次提交带 force。
      const doc = state.docs[op.sampleId]
      if (doc) op.baseRev = doc.revision
      op.state = 'queued'
      op.error = undefined
      op.remote = undefined
      op.force = true
    },

    dismissRemoteNotice(state, action: PayloadAction<string>) {
      const doc = state.docs[action.payload]
      if (!doc) return
      doc.lastSeenOpAt = doc.oplog.reduce((max, op) => Math.max(max, op.createdAt), doc.lastSeenOpAt)
      doc.remoteNotice = []
    },

    acknowledgeMigration(state) {
      state.migrationSeen = true
    },

    remotePolled(state, action: PayloadAction<{ sample: Sample; revision: number; locked: boolean; oplog: ServerOp[]; snapshots: ReviewSnapshot[] }>) {
      const data = action.payload
      const previous = state.docs[data.sample.id]
      // 仅当服务端确实前进时更新，避免无谓重渲染。
      if (previous && previous.revision === data.revision) return
      // 合并轮询返回的快照（其他客户端锁定时也能看到冻结快照）。
      const merged = [...(previous?.snapshots ?? [])]
      data.snapshots.forEach((snap) => {
        if (!merged.some((item) => item.id === snap.id)) merged.push(snap)
      })
      upsertDocFromSync(state, {
        sampleId: data.sample.id,
        sample: data.sample,
        revision: data.revision,
        locked: data.locked,
        oplog: data.oplog,
        snapshots: merged,
      })
    },
  },
})

export const {
  selectSample,
  setRounds,
  toggleAnnotation,
  setOnline,
  enqueue,
  sampleLoaded,
  syncStarted,
  syncSucceeded,
  syncFailed,
  retryOp,
  resolveConflict,
  dismissRemoteNotice,
  acknowledgeMigration,
  remotePolled,
} = slice.actions

export const collaborationReducer = slice.reducer

export type { DocState }

export { stripServerFields }
