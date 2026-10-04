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

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
}

export type Decision = {
  proposalId: string
  decision: '已采纳' | '未采纳'
  reason: string
  decidedAt: string
}

export type SampleStatus = '开发中' | '待审核' | '已锁定'

export type Sample = {
  id: string
  styleCode: string
  styleName: string
  category: string
  developmentSeason: string
  supplier: string
  dueDate: string
  owner: string
  status: SampleStatus
  fabric: string
  colorway: string
  craft: string[]
  measurements: Record<'第一轮' | '第二轮' | '第三轮', Measurement[]>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  attachments: Array<{ name: string; type: string; owner: string }>
  comments: Array<{ id: string; author: string; content: string; date: string }>
  /** 服务器修订号：每次成功保存自增 1 */
  revision: number
  /** 本轮评审草稿（随协作同步） */
  draftNotes: string
  /** 采纳/未采纳决定记录 */
  decisions: Decision[]
}

/** 操作类型：尺寸、批注、方案、草稿、锁定/解锁 */
export type OpType =
  | 'measurement.update'
  | 'annotation.add'
  | 'annotation.resolve'
  | 'proposal.decide'
  | 'draft.save'
  | 'review.lock'
  | 'review.unlock'

export type OpStatus = 'pending' | 'failed' | 'applied'

/** 一次本地操作：带操作号与基准修订号 */
export type Op = {
  opId: string
  sampleId: string
  type: OpType
  baseRevision: number
  payload: Record<string, unknown>
  createdAt: string
  status: OpStatus
  attempts: number
  lastError?: string
}

/** 逐项差异（用于冲突解决对话框） */
export type DiffItem = {
  type: 'annotation' | 'proposal' | 'draft' | 'measurement' | 'status'
  key: string
  label: string
  serverValue: string
  localValue: string
  /** 仅本地存在（他人未改动） */
  localOnly?: boolean
  /** 仅服务器存在（协作者新增） */
  serverOnly?: boolean
  /** 双方都改了同一处 */
  bothChanged?: boolean
  /** 本地侧对应的操作类型（用于保留本地时重建操作） */
  opKind?: OpType
  opPayload?: Record<string, unknown>
}

export type Conflict = {
  sampleId: string
  serverRevision: number
  baseRevision: number
  detectedAt: string
  diffs: DiffItem[]
}

/** 冻结的评审快照：锁定时生成，不可变 */
export type Snapshot = {
  sampleId: string
  revision: number
  frozenAt: string
  frozenBy: string
  reason: string
  state: Sample
}
