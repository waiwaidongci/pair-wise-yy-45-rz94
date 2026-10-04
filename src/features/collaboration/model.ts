import type {
  Annotation,
  OperationEnvelope,
  OperationPayload,
  ProposalDecision,
  QueuedOperation,
  RemoteValue,
  Sample,
  ServerOp,
  ServerSample,
} from '../../api/types'

/** 当前浏览器里的操作者（真实系统里来自登录态）。 */
export const CURRENT_USER = '陈曼 / 产品'

/** 用于“模拟他人修改”的协作者。 */
export const REMOTE_USER = '周研 / 版师'

const REVISION_KINDS = new Set<OperationPayload['kind']>([
  'annotation.add',
  'annotation.resolve',
  'comment.add',
  'proposal.decide',
  'draft.save',
  'review.lock',
])

/** review.unlock 开启新分支但不占用修订号；其余已提交操作各占一个修订号。 */
export const bumpsRevision = (payload: OperationPayload) => REVISION_KINDS.has(payload.kind)

export const stripServerFields = (server: ServerSample): Sample => {
  const { revision: _r, locked: _l, oplog: _o, snapshots: _s, ...sample } = server
  return sample
}

/* ----------------------------- 操作应用 ----------------------------- */

/**
 * 把一条操作以不可变方式应用到样衣。
 * - 新增类操作幂等：相同 id 已存在则跳过。
 * - 不在这里做冲突判定，冲突由服务端在提交时计算。
 */
export function applyPayload(sample: Sample, payload: OperationPayload): Sample {
  const next: Sample = structuredClone(sample)
  switch (payload.kind) {
    case 'annotation.add':
      if (!next.annotations.some((item) => item.id === payload.annotation.id)) {
        next.annotations.push(payload.annotation)
      }
      break
    case 'annotation.resolve': {
      const target = next.annotations.find((item) => item.id === payload.annotationId)
      if (target) target.status = payload.status
      break
    }
    case 'comment.add':
      if (!next.comments.some((item) => item.id === payload.comment.id)) {
        next.comments.push(payload.comment)
      }
      break
    case 'proposal.decide': {
      const proposal = next.proposals.find((item) => item.id === payload.decision.proposalId)
      if (proposal) proposal.status = payload.decision.decision
      if (!next.decisions.some((item) => item.proposalId === payload.decision.proposalId)) {
        next.decisions.push(payload.decision)
      }
      break
    }
    case 'draft.save':
      next.drafts[payload.author] = payload.content
      break
    case 'review.lock':
      next.status = '已锁定'
      break
    case 'review.unlock':
      next.status = '待审核'
      break
  }
  return next
}

/** 按顺序重放操作日志，还原某次修订时的样衣内容（用于快照 / 差异基线）。 */
export function replay(base: Sample, ops: ServerOp[], upToRev?: number): Sample {
  return ops
    .filter((op) => upToRev === undefined || op.rev <= upToRev)
    .reduce((sample, op) => applyPayload(sample, op), base)
}

/* ----------------------------- 本地工作视图 ----------------------------- */

/**
 * 本地工作视图 = 服务端样衣 + 本地未提交操作（排队中 / 同步中 / 冲突）。
 * 冲突操作同样叠加，保证“保留本地未提交内容”，不会被服务端内容覆盖。
 */
export function buildWorkingView(sample: Sample | undefined, queue: QueuedOperation[], sampleId: string): Sample | undefined {
  if (!sample) return sample
  return queue
    .filter((op) => op.sampleId === sampleId)
    .reduce((current, op) => applyPayload(current, op), sample)
}

/* ----------------------------- 操作摘要 / 差异 ----------------------------- */

export const opKindLabel = (kind: OperationPayload['kind']): string => {
  switch (kind) {
    case 'annotation.add':
      return '新增批注'
    case 'annotation.resolve':
      return '批注状态'
    case 'comment.add':
      return '评审留言'
    case 'proposal.decide':
      return '方案决定'
    case 'draft.save':
      return '保存草稿'
    case 'review.lock':
      return '审核锁定'
    case 'review.unlock':
      return '解锁修订'
  }
}

export const opSummary = (op: OperationPayload): string => {
  switch (op.kind) {
    case 'annotation.add':
      return `${op.annotation.part}：${op.annotation.content}`
    case 'annotation.resolve':
      return `批注 ${op.annotationId} → ${op.status}`
    case 'comment.add':
      return op.comment.content
    case 'proposal.decide':
      return `方案 ${op.decision.proposalId}：${op.decision.decision}（${op.decision.reason}）`
    case 'draft.save':
      return `草稿（${op.author}）：${op.content || '（空）'}`
    case 'review.lock':
      return `锁定评审：${op.note}`
    case 'review.unlock':
      return `解锁评审：${op.note}`
  }
}

export type FieldDiff = { label: string; mine: string; theirs: string }

/** 逐项列出本地操作与服务端他人值的字段差异。 */
export function diffWithRemote(op: QueuedOperation, remote: RemoteValue | undefined): FieldDiff[] {
  if (!remote) return [{ label: '操作', mine: opSummary(op), theirs: '—（服务端无对照值）' }]
  switch (remote.kind) {
    case 'annotation': {
      const mine = op.kind === 'annotation.resolve' ? op.status : ''
      const theirs = remote.theirs?.status ?? '批注已被删除'
      return [
        { label: '批注编号', mine: op.kind === 'annotation.resolve' ? op.annotationId : '', theirs: op.kind === 'annotation.resolve' ? op.annotationId : '' },
        { label: '处理状态', mine, theirs },
        { label: '对方内容', mine: '—', theirs: remote.theirs ? `${remote.theirs.part}：${remote.theirs.content}` : '—' },
      ]
    }
    case 'decision': {
      const mine = op.kind === 'proposal.decide' ? op.decision : null
      return [
        { label: '方案', mine: mine?.proposalId ?? '', theirs: mine?.proposalId ?? '' },
        { label: '决定', mine: mine?.decision ?? '', theirs: remote.theirs?.decision ?? '仍待决定' },
        { label: '理由', mine: mine?.reason ?? '', theirs: remote.theirs?.reason ?? '—' },
        { label: '决定人', mine: mine?.decidedBy ?? '', theirs: remote.theirs?.decidedBy ?? '—' },
      ]
    }
    case 'draft':
      return [
        { label: '草稿内容', mine: op.kind === 'draft.save' ? op.content : '', theirs: remote.theirs || '（空）' },
      ]
  }
}

/* ----------------------------- 工厂函数 ----------------------------- */

let seqCounter = 0
export const nextSeq = () => ++seqCounter

export function makeOpId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `op-${crypto.randomUUID()}`
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

type QueueSeed = { sampleId: string; baseRev: number; author: string; seq: number }

export function makeQueuedOp(seed: QueueSeed, payload: OperationPayload, migrated = false): QueuedOperation {
  const envelope: OperationEnvelope = {
    opId: makeOpId(),
    baseRev: seed.baseRev,
    author: seed.author,
    createdAt: Date.now(),
  }
  if (migrated) envelope.migrated = true
  return { ...envelope, ...payload, sampleId: seed.sampleId, seq: seed.seq, state: 'queued', attempts: 0 }
}

export const newAnnotation = (x: number, y: number, part: string, content: string, author: string): Annotation => ({
  id: `AN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  x,
  y,
  part,
  content,
  author,
  status: '待处理',
})

export const newComment = (content: string, author: string, date: string) => ({
  id: `CM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  author,
  content,
  date,
})

export const newDecision = (
  proposalId: string,
  decision: ProposalDecision['decision'],
  reason: string,
  decidedBy: string,
): ProposalDecision => ({
  proposalId,
  decision,
  reason,
  decidedAt: new Date().toLocaleString('zh-CN'),
  decidedBy,
})

export const formatRevision = (rev: number) => `R${rev}`

export const formatOpSeq = (seq: number) => `#${String(seq).padStart(4, '0')}`

/** 操作提交时携带的信封 + 负载，正是 POST /sync 的请求体。 */
export const toSyncBody = (op: QueuedOperation) => {
  const { sampleId: _s, seq: _q, state: _st, error: _e, remote: _r, attempts: _a, ...rest } = op
  return rest
}
