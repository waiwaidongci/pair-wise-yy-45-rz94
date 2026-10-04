import { http, HttpResponse } from 'msw'
import { commitInternal, getDb, resetDb } from './db'
import type {
  AppliedResult,
  OperationEnvelope,
  OperationPayload,
  RejectedResult,
  Sample,
  SyncResponse,
} from './types'
import { newComment } from '../features/collaboration/model'

type SyncRequestBody = OperationEnvelope &
  OperationPayload & {
    /** 冲突后用户明确选择覆盖时携带。 */
    force?: boolean
  }

const publicSample = (id: string): Sample | undefined => {
  const server = getDb().samples[id]
  if (!server) return undefined
  const { revision: _r, locked: _l, oplog: _o, snapshots: _s, ...sample } = server
  return sample
}

const buildSyncResponse = (sampleId: string): SyncResponse | null => {
  const server = getDb().samples[sampleId]
  if (!server) return null
  const { revision: _r, locked: _l, oplog: _o, snapshots: _s, ...sample } = server
  return {
    sampleId,
    revision: server.revision,
    locked: server.locked,
    applied: [],
    rejected: [],
    oplog: server.oplog,
    sample,
    snapshot: server.snapshots[server.snapshots.length - 1],
    snapshots: server.snapshots,
  }
}

/** 下一批“模拟服务端故障”的次数，由调试接口写入。 */
let failureBudget = 0

export const handlers = [
  http.get('*/api/samples', () => {
    const db = getDb()
    const servers = Object.values(db.samples)
    return HttpResponse.json({
      samples: servers.map((server) => publicSample(server.id)!),
      revisions: Object.fromEntries(servers.map((item) => [item.id, item.revision])),
      migrations: db.migrations,
    })
  }),

  http.get('*/api/samples/:id', ({ params }) => {
    const db = getDb()
    const server = db.samples[params.id as string]
    if (!server) return new HttpResponse(null, { status: 404 })
    const { revision: _r, locked: _l, oplog: _o, snapshots: _s, ...sample } = server
    return HttpResponse.json({
      sample,
      revision: server.revision,
      locked: server.locked,
      oplog: server.oplog,
      snapshots: server.snapshots,
    })
  }),

  /* 协作同步：一个或多个操作按操作号顺序提交，服务端逐个给出结果。 */
  http.post('*/api/samples/:id/sync', async ({ params, request }) => {
    if (failureBudget > 0) {
      failureBudget -= 1
      return new HttpResponse(JSON.stringify({ message: '服务端暂时不可用（模拟故障，本地操作已保留，可重试）' }), { status: 503 })
    }

    const sampleId = params.id as string
    const body = (await request.json()) as { operations: SyncRequestBody[] }
    const db = getDb()
    if (!db.samples[sampleId]) return new HttpResponse(null, { status: 404 })

    const applied: AppliedResult[] = []
    const rejected: RejectedResult[] = []

    // 按数组顺序（即操作号顺序）逐个提交，前一个成功后修订号推进，后一个自然基于新修订。
    for (const op of body.operations) {
      const { force, ...payload } = op
      const result = commitInternal(db, sampleId, payload, {
        opId: op.opId,
        baseRev: op.baseRev,
        author: op.author,
        createdAt: op.createdAt,
        migrated: op.migrated,
        force,
      })
      if (result.ok) {
        applied.push({ opId: result.opId, rev: result.rev, duplicated: result.duplicated })
      } else {
        rejected.push({
          opId: op.opId,
          code: result.code,
          message: result.message,
          remote: result.remote,
          snapshotRev: result.snapshotRev,
        })
      }
    }

    const server = db.samples[sampleId]
    const { revision: _r, locked: _l, oplog: _o, snapshots: _s, ...sample } = server
    const response: SyncResponse = {
      sampleId,
      revision: server.revision,
      locked: server.locked,
      applied,
      rejected,
      oplog: server.oplog,
      sample,
      snapshot: server.snapshots[server.snapshots.length - 1],
      snapshots: server.snapshots,
    }
    return HttpResponse.json(response, { status: 200 })
  }),

  /* 解锁：开启新的修订分支（不占用修订号），冻结快照仍保留。 */
  http.post('*/api/samples/:id/unlock', async ({ params, request }) => {
    const sampleId = params.id as string
    const body = (await request.json().catch(() => ({}))) as { note?: string; author?: string }
    const db = getDb()
    const result = commitInternal(
      db,
      sampleId,
      { kind: 'review.unlock', note: body.note ?? '解锁后继续修订' },
      {
        opId: `unlock-${Date.now()}`,
        baseRev: db.samples[sampleId]?.revision ?? 0,
        author: body.author ?? '当前用户',
        createdAt: Date.now(),
      },
    )
    if (!result.ok) return HttpResponse.json({ message: result.message }, { status: 409 })
    return HttpResponse.json(buildSyncResponse(sampleId))
  }),

  /* 只读：取回审核锁定时冻结的快照。 */
  http.get('*/api/samples/:id/snapshots/:rev', ({ params }) => {
    const server = getDb().samples[params.id as string]
    const snapshot = server?.snapshots.find((item) => item.rev === Number(params.rev))
    return snapshot ? HttpResponse.json(snapshot) : new HttpResponse(null, { status: 404 })
  }),

  /* ----------------------------------------------------------------
     协作者模拟：产品 / 版师 / 供应商同时编辑同一件样衣。
     以他人身份直接在服务端提交一个操作（不经过当前浏览器队列），
     下一次轮询时当前用户就会看到服务端领先并出现逐项差异。
  ----------------------------------------------------------------- */
  http.post('*/api/samples/:id/simulate-remote', async ({ params, request }) => {
    const sampleId = params.id as string
    const body = (await request.json().catch(() => ({}))) as { kind?: string }
    const db = getDb()
    const server = db.samples[sampleId]
    if (!server) return new HttpResponse(null, { status: 404 })

    const author = server.id === 'SMP-26018' ? '周研 / 版师' : '宁波原野 / 供应商'
    let payload: OperationPayload
    if (body.kind === 'comment') {
      payload = {
        kind: 'comment.add',
        comment: newComment('侧缝对位标记建议上移 0.5cm，大货更易操作。', author, '刚刚'),
      }
    } else if (body.kind === 'decision') {
      const pending = server.proposals.find((item) => item.status === '待决定')
      if (!pending) return HttpResponse.json({ message: '没有待决定方案可模拟' }, { status: 400 })
      payload = {
        kind: 'proposal.decide',
        decision: {
          proposalId: pending.id,
          decision: '已采纳',
          reason: '远程协作者先一步采纳：优先保证活动量，第三轮复核。',
          decidedAt: new Date().toLocaleString('zh-CN'),
          decidedBy: author,
        },
      }
    } else if (body.kind === 'draft') {
      payload = {
        kind: 'draft.save',
        author: '陈曼 / 产品',
        content: '（他人会话）肩线修正先落地，袖长维持，注意核对领底衬克重。',
      }
    } else {
      const pending = server.annotations.find((item) => item.status === '待处理')
      payload = {
        kind: 'annotation.resolve',
        annotationId: pending?.id ?? server.annotations[0].id,
        status: '已解决',
      }
    }

    const now = Date.now()
    const result = commitInternal(db, sampleId, payload, {
      opId: `remote-${now}-${Math.random().toString(36).slice(2, 7)}`,
      baseRev: server.revision,
      author,
      createdAt: now,
    })
    if (!result.ok) return HttpResponse.json({ message: result.message }, { status: 409 })
    return HttpResponse.json({ ok: true, revision: db.samples[sampleId].revision })
  }),

  /* 调试：让接下来的 N 次 sync 返回 503，用于演示“失败保留 + 重试”。 */
  http.post('*/api/debug/fail-next', async ({ request }) => {
    const body = (await request.json().catch(() => ({ count: 1 }))) as { count?: number }
    failureBudget = body.count ?? 1
    return HttpResponse.json({ ok: true, failureBudget })
  }),

  /* 调试：清空服务端持久化数据（重新迁移旧草稿）。 */
  http.post('*/api/debug/reset', () => {
    resetDb()
    getDb()
    return HttpResponse.json({ ok: true })
  }),
]

export type { SyncResponse }
