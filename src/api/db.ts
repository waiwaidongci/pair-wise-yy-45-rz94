import { seedSamples } from './seed'
import type {
  Annotation,
  MigrationReport,
  OperationPayload,
  RemoteValue,
  ReviewSnapshot,
  Sample,
  SampleComment,
  ServerOp,
  ServerSample,
} from './types'
import { bumpsRevision } from '../features/collaboration/model'

const SERVER_DB_KEY = 'garment-sampling-server-v2'
const LEGACY_DRAFT_KEY = 'garment-sampling-draft-v1'
const LEGACY_BACKUP_KEY = 'garment-sampling-draft-v1-backup'

type ServerDB = {
  samples: Record<string, ServerSample>
  migrations: MigrationReport[]
}

/* --------------------------- 基线（种子）构造 --------------------------- */

const SEED_BASE_TIME = new Date('2026-09-27T09:00:00+08:00').getTime()

function buildBaselineOps(sample: Sample): ServerOp[] {
  const ops: ServerOp[] = []
  let index = 0
  const envelope = (author: string, offsetMin: number) => ({
    opId: `seed-${sample.id}-${index++}`,
    baseRev: 0,
    author,
    createdAt: SEED_BASE_TIME + offsetMin * 60_000,
  })
  sample.annotations.forEach((annotation, i) => {
    const payload: OperationPayload = { kind: 'annotation.add', annotation }
    ops.push({ ...payload, ...envelope(annotation.author, i * 13), rev: 0 })
  })
  sample.comments.forEach((comment, i) => {
    const payload: OperationPayload = { kind: 'comment.add', comment }
    ops.push({ ...payload, ...envelope(comment.author, 60 + i * 45), rev: 0 })
  })
  return ops
}

function freshServerSample(sample: Sample): ServerSample {
  return {
    ...structuredClone(sample),
    revision: 0,
    locked: false,
    oplog: buildBaselineOps(sample),
    snapshots: [],
  }
}

function freshDb(): ServerDB {
  const samples: Record<string, ServerSample> = {}
  seedSamples.forEach((sample) => {
    samples[sample.id] = freshServerSample(sample)
  })
  return { samples, migrations: [] }
}

/* --------------------------- 旧版 v1 草稿迁移 --------------------------- */

type LegacyDecision = { proposalId: string; decision: '已采纳' | '未采纳'; reason: string; decidedAt: string }
type LegacyState = {
  samples: Array<
    Omit<Sample, 'drafts' | 'decisions'> & {
      annotations: Annotation[]
      comments: SampleComment[]
      proposals: Sample['proposals']
    }
  >
  selectedId: string
  decisions: LegacyDecision[]
  draftNotes: Record<string, string>
  locked: boolean
}

function readLegacy(): LegacyState | null {
  const raw = localStorage.getItem(LEGACY_DRAFT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LegacyState
  } catch {
    return null
  }
}

/**
 * 把旧版（只存在浏览器 localStorage 的 v1 草稿）逐条翻译成带修订号的操作，
 * 提交到新服务端。迁移后旧数据备份但不删除引用，任何一条旧草稿都不会丢：
 * 新增批注/留言、方案决定、草稿正文、锁定状态全部进入操作日志与快照。
 */
function migrateLegacy(db: ServerDB, legacy: LegacyState): void {
  for (const oldSample of legacy.samples) {
    const server = db.samples[oldSample.id]
    if (!server) continue
    const payloads: OperationPayload[] = []

    oldSample.annotations.forEach((annotation) => {
      const baseline = server.annotations.find((item) => item.id === annotation.id)
      if (!baseline) {
        payloads.push({ kind: 'annotation.add', annotation })
      } else if (baseline.status !== annotation.status) {
        payloads.push({ kind: 'annotation.resolve', annotationId: annotation.id, status: annotation.status })
      }
    })

    oldSample.comments.forEach((comment) => {
      if (!server.comments.some((item) => item.id === comment.id)) {
        payloads.push({ kind: 'comment.add', comment })
      }
    })

    legacy.decisions.forEach((decision) => {
      if (!oldSample.proposals.some((proposal) => proposal.id === decision.proposalId)) return
      if (server.decisions.some((item) => item.proposalId === decision.proposalId)) return
      payloads.push({
        kind: 'proposal.decide',
        decision: { ...decision, decidedBy: '陈曼 / 产品（旧草稿迁移）' },
      })
    })

    const draft = legacy.draftNotes[oldSample.id]
    if (draft && draft.trim() && draft !== '评审草稿已保存') {
      payloads.push({ kind: 'draft.save', author: '陈曼 / 产品', content: draft })
    }

    const migratedOps: string[] = []
    payloads.forEach((payload) => {
      const result = commitInternal(db, oldSample.id, payload, {
        opId: `migrate-${oldSample.id}-${migratedOps.length}`,
        baseRev: db.samples[oldSample.id].revision,
        author: '系统迁移',
        migrated: true,
        createdAt: Date.now(),
        force: true,
      })
      if (result.ok) migratedOps.push(result.opId)
    })

    // 旧版全局 locked 只对当时选中的样衣生效；锁定时冻结同次评审快照。
    if (legacy.locked && oldSample.id === legacy.selectedId && !db.samples[oldSample.id].locked) {
      const note = '旧版草稿迁移：恢复审核锁定状态'
      const result = commitInternal(db, oldSample.id, { kind: 'review.lock', note }, {
        opId: `migrate-${oldSample.id}-lock`,
        baseRev: db.samples[oldSample.id].revision,
        author: '系统迁移',
        migrated: true,
        createdAt: Date.now(),
        force: true,
      })
      if (result.ok) migratedOps.push(result.opId)
      const current = db.samples[oldSample.id]
      db.migrations.push({
        sampleId: oldSample.id,
        migratedOps,
        lockedAtRev: current.locked ? current.revision : undefined,
      })
    } else if (migratedOps.length) {
      db.migrations.push({ sampleId: oldSample.id, migratedOps })
    }
  }
}

/* ------------------------------ 提交核心 ------------------------------ */

type CommitMeta = {
  opId: string
  baseRev: number
  author: string
  createdAt: number
  migrated?: boolean
  /** 用户在冲突面板明确选择“以我的为准”后携带。 */
  force?: boolean
}
type CommitResult =
  | { ok: true; opId: string; rev: number; duplicated?: boolean }
  | { ok: false; code: 'locked' | 'conflict' | 'not-found'; message: string; remote?: RemoteValue; snapshotRev?: number }

function snapshotOf(server: ServerSample, note: string, lockedBy: string): ReviewSnapshot {
  const { revision: _r, locked: _l, oplog: _o, snapshots: _s, ...sample } = server
  return {
    id: `SNAP-${server.id}-${server.revision}`,
    rev: server.revision,
    lockedAt: new Date().toLocaleString('zh-CN'),
    lockedBy,
    note,
    sample: structuredClone(sample),
  }
}

export function commitInternal(
  db: ServerDB,
  sampleId: string,
  payload: OperationPayload,
  meta: CommitMeta,
): CommitResult {
  const server = db.samples[sampleId]
  if (!server) return { ok: false, code: 'not-found', message: '样衣不存在' }

  // 幂等：同一操作号重放直接返回，不产生第二个修订号。
  const known = server.oplog.find((op) => op.opId === meta.opId)
  if (known) {
    return { ok: true, opId: meta.opId, rev: known.rev, duplicated: true }
  }

  // 审核锁定后冻结：除解锁外任何写操作都被拒绝，返回锁定修订号。
  if (server.locked && payload.kind !== 'review.unlock') {
    return {
      ok: false,
      code: 'locked',
      message: `评审已在 R${server.revision} 锁定，快照冻结后禁止修改，请先解锁并开启新修订分支。`,
      snapshotRev: server.revision,
    }
  }

  // 服务端已经领先于本操作所基于的修订号时，逐项检查是否与他人修改冲突。
  const stale = server.revision > meta.baseRev
  if (stale && !meta.force) {
    switch (payload.kind) {
      case 'annotation.resolve': {
        const theirs = server.annotations.find((item) => item.id === payload.annotationId)
        if (theirs && theirs.status !== payload.status) {
          return {
            ok: false,
            code: 'conflict',
            message: `批注已被他人标记为「${theirs.status}」，本地仍保留为「${payload.status}」。`,
            remote: { kind: 'annotation', theirs },
          }
        }
        break
      }
      case 'proposal.decide': {
        const theirs = server.decisions.find((item) => item.proposalId === payload.decision.proposalId)
        if (theirs && theirs.decision !== payload.decision.decision) {
          return {
            ok: false,
            code: 'conflict',
            message: `方案已被 ${theirs.decidedBy} 决定为「${theirs.decision}」，与本地选择不同。`,
            remote: { kind: 'decision', theirs },
          }
        }
        break
      }
      case 'draft.save': {
        const theirs = server.drafts[payload.author]
        if (theirs !== undefined && theirs !== payload.content) {
          return {
            ok: false,
            code: 'conflict',
            message: '该作者的草稿在另一会话中已保存，服务端保留对方版本，本地版本未覆盖。',
            remote: { kind: 'draft', theirs },
          }
        }
        break
      }
      // 新增批注、新增留言天然可并行追加，不冲突。
      default:
        break
    }
  }

  // 应用到样衣本体
  applyToServer(server, payload)

  let rev = server.revision
  if (payload.kind === 'review.lock') {
    rev = server.revision + 1
    server.revision = rev
    server.locked = true
    const snapshot = snapshotOf(server, payload.note, meta.author)
    server.snapshots.push(snapshot)
  } else if (payload.kind === 'review.unlock') {
    server.locked = false
    // 解锁不占用修订号，但日志保留，形成新的修订分支起点。
  } else if (bumpsRevision(payload)) {
    rev = server.revision + 1
    server.revision = rev
  }

  const op: ServerOp = {
    ...payload,
    opId: meta.opId,
    baseRev: meta.baseRev,
    author: meta.author,
    createdAt: meta.createdAt,
    rev,
  }
  if (meta.migrated) op.migrated = true
  server.oplog.push(op)

  persist(db)
  return { ok: true, opId: meta.opId, rev }
}

function applyToServer(server: ServerSample, payload: OperationPayload): void {
  switch (payload.kind) {
    case 'annotation.add':
      if (!server.annotations.some((item) => item.id === payload.annotation.id)) server.annotations.push(payload.annotation)
      break
    case 'annotation.resolve': {
      const target = server.annotations.find((item) => item.id === payload.annotationId)
      if (target) target.status = payload.status
      break
    }
    case 'comment.add':
      if (!server.comments.some((item) => item.id === payload.comment.id)) server.comments.push(payload.comment)
      break
    case 'proposal.decide': {
      const proposal = server.proposals.find((item) => item.id === payload.decision.proposalId)
      if (proposal) proposal.status = payload.decision.decision
      if (!server.decisions.some((item) => item.proposalId === payload.decision.proposalId)) {
        server.decisions.push(payload.decision)
      }
      break
    }
    case 'draft.save':
      server.drafts[payload.author] = payload.content
      break
    case 'review.lock':
      server.status = '已锁定'
      break
    case 'review.unlock':
      server.status = '待审核'
      break
  }
}

/* ------------------------------ 初始化 / 持久化 ------------------------------ */

let dbInstance: ServerDB | null = null

function persist(db: ServerDB): void {
  try {
    localStorage.setItem(SERVER_DB_KEY, JSON.stringify(db))
  } catch {
    // 存储不可用时仅保留内存态
  }
}

export function getDb(): ServerDB {
  if (dbInstance) return dbInstance

  const saved = localStorage.getItem(SERVER_DB_KEY)
  if (saved) {
    try {
      dbInstance = JSON.parse(saved) as ServerDB
      return dbInstance
    } catch {
      // 落库损坏时回落为重新迁移 / 种子
    }
  }

  const db = freshDb()
  const legacy = readLegacy()
  if (legacy) {
    migrateLegacy(db, legacy)
    // 迁移完成后备份旧草稿，原键保留一个备份周期（不物理删除用户数据）。
    try {
      localStorage.setItem(LEGACY_BACKUP_KEY, JSON.stringify(legacy))
      localStorage.removeItem(LEGACY_DRAFT_KEY)
    } catch {
      // ignore
    }
  }
  persist(db)
  dbInstance = db
  return db
}

/** 重置内存态与持久化态：下次 getDb 会重新播种 / 迁移（供调试与测试使用）。 */
export function resetDb(): void {
  dbInstance = null
  try {
    localStorage.removeItem(SERVER_DB_KEY)
  } catch {
    // ignore
  }
}

/** 测试 / 模拟他人修改时重置内存态。 */
export function saveDb(db: ServerDB): void {
  dbInstance = db
  persist(db)
}

export const serverStorageKey = SERVER_DB_KEY
