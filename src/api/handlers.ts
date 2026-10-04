import { http, HttpResponse } from 'msw'
import { seedSamples } from './seed'
import type { Op, Sample, Snapshot } from './types'

type ServerRecord = {
  sample: Sample
  revision: number
  ops: Op[]
  snapshots: Snapshot[]
}

const store = new Map<string, ServerRecord>()

function init() {
  store.clear()
  for (const sample of seedSamples) {
    store.set(sample.id, {
      sample: structuredClone(sample),
      revision: sample.revision,
      ops: [],
      snapshots: [],
    })
  }
}
init()

/** 离线模拟开关：localStorage 置 1 后所有请求按网络失败处理 */
function isOffline() {
  try {
    return localStorage.getItem('garment-sampling-offline') === '1'
  } catch {
    return false
  }
}

function offlineResponse() {
  return HttpResponse.error()
}

function applyOp(record: ServerRecord, op: Op): { ok: true } | { ok: false; error: string } {
  const { sample } = record
  switch (op.type) {
    case 'measurement.update': {
      const round = op.payload.round as keyof Sample['measurements']
      const key = op.payload.key as string
      const actual = Number(op.payload.actual)
      const target = sample.measurements[round]?.find((item) => item.key === key)
      if (!target) return { ok: false, error: 'measurement-not-found' }
      target.actual = actual
      return { ok: true }
    }
    case 'annotation.add': {
      const annotation = op.payload.annotation as Sample['annotations'][number]
      if (sample.annotations.some((item) => item.id === annotation.id)) return { ok: false, error: 'annotation-exists' }
      sample.annotations.push(structuredClone(annotation))
      return { ok: true }
    }
    case 'annotation.resolve': {
      const annotationId = op.payload.annotationId as string
      const target = sample.annotations.find((item) => item.id === annotationId)
      if (!target) return { ok: false, error: 'annotation-not-found' }
      target.status = target.status === '待处理' ? '已解决' : '待处理'
      return { ok: true }
    }
    case 'proposal.decide': {
      const proposalId = op.payload.proposalId as string
      const decision = op.payload.decision as '已采纳' | '未采纳'
      const target = sample.proposals.find((item) => item.id === proposalId)
      if (!target) return { ok: false, error: 'proposal-not-found' }
      target.status = decision
      sample.decisions.push({
        proposalId,
        decision,
        reason: op.payload.reason as string,
        decidedAt: op.payload.decidedAt as string,
      })
      return { ok: true }
    }
    case 'draft.save': {
      sample.draftNotes = op.payload.notes as string
      return { ok: true }
    }
    case 'review.lock': {
      sample.status = '已锁定'
      sample.proposals.forEach((proposal) => {
        if (proposal.status === '待决定') proposal.status = '未采纳'
      })
      return { ok: true }
    }
    case 'review.unlock': {
      sample.status = '待审核'
      return { ok: true }
    }
    default:
      return { ok: false, error: 'unknown-op' }
  }
}

export const handlers = [
  http.get('/api/samples', () => {
    if (isOffline()) return offlineResponse()
    const list = Array.from(store.values()).map((record) => ({ ...record.sample, revision: record.revision }))
    return HttpResponse.json(list)
  }),

  http.get('/api/samples/:id', ({ params }) => {
    if (isOffline()) return offlineResponse()
    const record = store.get(params.id as string)
    if (!record) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json({ ...record.sample, revision: record.revision })
  }),

  /** 批量提交操作：按顺序应用；基准修订号不匹配则返回 409 冲突 */
  http.post('/api/samples/:id/ops', async ({ params, request }) => {
    if (isOffline()) return offlineResponse()
    const record = store.get(params.id as string)
    if (!record) return new HttpResponse(null, { status: 404 })

    const body = (await request.json()) as { ops: Op[] }
    const ops = Array.isArray(body.ops) ? body.ops : []

    // 冲突检测：任一操作的基准修订号与服务器当前修订号不一致
    const conflict = ops.find((op) => op.baseRevision !== record.revision)
    if (conflict) {
      const sinceOps = record.ops.filter((op) => {
        const opRevision = (op as Op & { _appliedAtRevision?: number })._appliedAtRevision
        return typeof opRevision === 'number' && opRevision > conflict.baseRevision
      })
      return HttpResponse.json(
        {
          error: 'conflict',
          currentRevision: record.revision,
          baseRevision: conflict.baseRevision,
          currentState: { ...record.sample, revision: record.revision },
          sinceOps,
        },
        { status: 409 },
      )
    }

    const appliedOpIds: string[] = []
    for (const op of ops) {
      const result = applyOp(record, op)
      if (!result.ok) {
        return HttpResponse.json({ error: result.error, opId: op.opId }, { status: 422 })
      }
      record.revision += 1
      record.ops.push({ ...op, status: 'applied' })
      appliedOpIds.push(op.opId)

      // 锁定操作：生成不可变快照
      if (op.type === 'review.lock') {
        const snapshot: Snapshot = {
          sampleId: record.sample.id,
          revision: record.revision,
          frozenAt: (op.payload.frozenAt as string) ?? new Date().toISOString(),
          frozenBy: (op.payload.frozenBy as string) ?? '当前用户',
          reason: (op.payload.reason as string) ?? '',
          state: structuredClone({ ...record.sample, revision: record.revision }),
        }
        record.snapshots.push(snapshot)
      }
    }

    return HttpResponse.json({
      ok: true,
      revision: record.revision,
      sample: { ...record.sample, revision: record.revision },
      appliedOpIds,
    })
  }),

  http.get('/api/samples/:id/snapshots', ({ params }) => {
    if (isOffline()) return offlineResponse()
    const record = store.get(params.id as string)
    if (!record) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json(record.snapshots)
  }),

  http.post('/api/samples/:id/lock', async ({ params, request }) => {
    if (isOffline()) return offlineResponse()
    const record = store.get(params.id as string)
    if (!record) return new HttpResponse(null, { status: 404 })
    const body = (await request.json().catch(() => ({}))) as { reason?: string }
    const op: Op = {
      opId: `OP-LOCK-${Date.now()}`,
      sampleId: record.sample.id,
      type: 'review.lock',
      baseRevision: record.revision,
      payload: { reason: body.reason ?? '', frozenBy: '当前用户', frozenAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
    }
    const result = applyOp(record, op)
    if (!result.ok) return HttpResponse.json({ error: result.error }, { status: 422 })
    record.revision += 1
    record.ops.push({ ...op, status: 'applied' })
    const snapshot: Snapshot = {
      sampleId: record.sample.id,
      revision: record.revision,
      frozenAt: op.payload.frozenAt as string,
      frozenBy: op.payload.frozenBy as string,
      reason: op.payload.reason as string,
      state: structuredClone({ ...record.sample, revision: record.revision }),
    }
    record.snapshots.push(snapshot)
    return HttpResponse.json({ ok: true, revision: record.revision, sample: { ...record.sample, revision: record.revision }, snapshot })
  }),

  http.post('/api/samples/:id/unlock', ({ params }) => {
    if (isOffline()) return offlineResponse()
    const record = store.get(params.id as string)
    if (!record) return new HttpResponse(null, { status: 404 })
    record.sample.status = '待审核'
    record.revision += 1
    return HttpResponse.json({ ok: true, revision: record.revision, sample: { ...record.sample, revision: record.revision } })
  }),
]
