export type Measurement = {
  key: string
  name: string
  spec: number
  actual: number
  tolerance: number
}

export type Annotation = {
  id: string
  x: number
  y: number
  part: string
  content: string
  author: string
  status: '待处理' | '已解决'
}

export type ProposalDecision = {
  proposalId: string
  decision: '已采纳' | '未采纳'
  reason: string
  decidedAt: string
  decidedBy: string
}

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
}

export type SampleComment = {
  id: string
  author: string
  content: string
  date: string
}

export type Sample = {
  id: string
  styleCode: string
  styleName: string
  category: string
  developmentSeason: string
  supplier: string
  dueDate: string
  owner: string
  status: '开发中' | '待审核' | '已锁定'
  fabric: string
  colorway: string
  craft: string[]
  measurements: Record<'第一轮' | '第二轮' | '第三轮', Measurement[]>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  /** 评审草稿，按作者存储；协作双方各自保留各自的草稿，互不覆盖。 */
  drafts: Record<string, string>
  /** 已经作出的采纳决定，服务端为事实来源。 */
  decisions: ProposalDecision[]
  attachments: Array<{ name: string; type: string; owner: string }>
  comments: SampleComment[]
}

/* ------------------------------------------------------------------ */
/* 协作协议：修订号 revision / 操作号 seq / 操作日志 oplog              */
/* ------------------------------------------------------------------ */

export type OperationKind =
  | 'annotation.add'
  | 'annotation.resolve'
  | 'comment.add'
  | 'proposal.decide'
  | 'draft.save'
  | 'review.lock'
  | 'review.unlock'

export type OperationPayload =
  | { kind: 'annotation.add'; annotation: Annotation }
  | { kind: 'annotation.resolve'; annotationId: string; status: Annotation['status'] }
  | { kind: 'comment.add'; comment: SampleComment }
  | { kind: 'proposal.decide'; decision: ProposalDecision }
  | { kind: 'draft.save'; author: string; content: string }
  | { kind: 'review.lock'; note: string }
  | { kind: 'review.unlock'; note: string }

export type OperationEnvelope = {
  /** 客户端生成的操作号（队列顺序），同时作为幂等键。 */
  opId: string
  /** 本次保存的修订号，即操作所基于的服务端 revision。 */
  baseRev: number
  author: string
  createdAt: number
  /** 迁移自旧草稿的操作带此标记，UI 会提示数据来源。 */
  migrated?: boolean
}

export type QueuedOperation = OperationEnvelope &
  OperationPayload & {
    sampleId: string
    /** 本地单调递增的操作号，用于显示顺序。 */
    seq: number
    state: 'queued' | 'syncing' | 'conflict' | 'blocked'
    error?: string
    /** 冲突时服务端返回的“他人版本”，用于逐项对比。 */
    remote?: RemoteValue
    attempts: number
    /** 冲突面板选择“以我的为准”后，下一次同步携带 force。 */
    force?: boolean
  }

export type RemoteValue =
  | { kind: 'annotation'; theirs: Annotation | null }
  | { kind: 'decision'; theirs: ProposalDecision | null }
  | { kind: 'draft'; theirs: string }

/** 服务端操作日志中的一条已提交操作（事实来源）。 */
export type ServerOp = OperationEnvelope &
  OperationPayload & {
    /** 提交后该样衣所处的修订号（review.unlock 不占用修订号）。 */
    rev: number
  }

/** 审核锁定时冻结的同次评审快照。 */
export type ReviewSnapshot = {
  id: string
  rev: number
  lockedAt: string
  lockedBy: string
  note: string
  sample: Sample
}

export type ServerSample = Sample & {
  revision: number
  locked: boolean
  oplog: ServerOp[]
  snapshots: ReviewSnapshot[]
}

export type AppliedResult = {
  opId: string
  rev: number
  /** true 表示该操作此前已提交过（幂等重放）。 */
  duplicated?: boolean
}

export type RejectedResult = {
  opId: string
  code: 'conflict' | 'locked' | 'not-found'
  message: string
  /** 冲突时的他人值；锁定时附带快照修订号。 */
  remote?: RemoteValue
  snapshotRev?: number
}

export type SyncResponse = {
  sampleId: string
  revision: number
  locked: boolean
  applied: AppliedResult[]
  rejected: RejectedResult[]
  /** 本批次之后完整的服务端操作日志，客户端据此重放他人修改。 */
  oplog: ServerOp[]
  sample: Sample
  /** 最新一份快照（本次批次包含锁定时即为新冻结快照）。 */
  snapshot?: ReviewSnapshot
  /** 当前全部冻结快照。 */
  snapshots: ReviewSnapshot[]
}

export type MigrationReport = {
  sampleId: string
  migratedOps: string[]
  lockedAtRev?: number
}
