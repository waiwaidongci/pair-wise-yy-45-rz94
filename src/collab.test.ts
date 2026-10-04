// 临时验证脚本：用 node:test 跑服务端协议（revision/冲突/锁定快照/迁移/离线顺序）
import { test } from 'node:test'
import assert from 'node:assert/strict'

// localStorage shim
const mem = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
}

const { commitInternal, getDb, resetDb, serverStorageKey } = await import('./api/db.ts')

test('每次提交修订号递增，解锁不占修订号', () => {
  resetDb()
  const db = getDb()
  const id = 'SMP-26021'
  const r0 = db.samples[id].revision
  assert.equal(r0, 0)

  const r1 = commitInternal(db, id, { kind: 'comment.add', comment: { id: 'c1', author: '供应商', content: 'A', date: 'x' } }, { opId: 'o1', baseRev: 0, author: '供应商', createdAt: 1 })
  assert.equal(r1.ok, true)
  assert.equal(db.samples[id].revision, 1)

  const lock = commitInternal(db, id, { kind: 'review.lock', note: '锁' }, { opId: 'o2', baseRev: 1, author: '负责人', createdAt: 2 })
  assert.equal(lock.ok, true)
  assert.equal(db.samples[id].revision, 2)
  assert.equal(db.samples[id].snapshots.length, 1)
  assert.equal(db.samples[id].snapshots[0].sample.comments.some((c) => c.id === 'c1'), true)

  // 冻结后写操作被拒
  const blocked = commitInternal(db, id, { kind: 'comment.add', comment: { id: 'c2', author: 'x', content: 'B', date: 'x' } }, { opId: 'o3', baseRev: 2, author: 'x', createdAt: 3 })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'locked')
  assert.equal(blocked.snapshotRev, 2)

  // 解锁不占修订号
  const unlock = commitInternal(db, id, { kind: 'review.unlock', note: '继续' }, { opId: 'o4', baseRev: 2, author: '负责人', createdAt: 4 })
  assert.equal(unlock.ok, true)
  assert.equal(db.samples[id].revision, 2)
  assert.equal(db.samples[id].locked, false)
  assert.equal(db.samples[id].snapshots.length, 1)
})

test('stale 修订号 + 不同决定 -> 冲突，双方内容保留', () => {
  resetDb()
  const db = getDb()
  const id = 'SMP-26021'
  // 他人先采纳
  commitInternal(db, id, { kind: 'proposal.decide', decision: { proposalId: 'RV-11', decision: '已采纳', reason: '远程', decidedAt: 't', decidedBy: '版师' } }, { opId: 'r1', baseRev: 0, author: '版师', createdAt: 10 })
  assert.equal(db.samples[id].revision, 1)

  // 本地基于 R0 提交不同决定
  const mine = commitInternal(db, id, { kind: 'proposal.decide', decision: { proposalId: 'RV-11', decision: '未采纳', reason: '本地', decidedAt: 't', decidedBy: '产品' } }, { opId: 'l1', baseRev: 0, author: '产品', createdAt: 11 })
  assert.equal(mine.ok, false)
  assert.equal(mine.code, 'conflict')
  assert.equal(mine.remote?.kind, 'decision')
  if (mine.remote?.kind === 'decision') assert.equal(mine.remote.theirs?.decision, '已采纳')
  // 服务端仍是对方版本（未被覆盖）
  assert.equal(db.samples[id].proposals[0].status, '已采纳')

  // 本地重试不 force 仍冲突；force 后覆盖
  const retryNoForce = commitInternal(db, id, { kind: 'proposal.decide', decision: { proposalId: 'RV-11', decision: '未采纳', reason: '本地', decidedAt: 't', decidedBy: '产品' } }, { opId: 'l1', baseRev: 0, author: '产品', createdAt: 12 })
  assert.equal(retryNoForce.ok, false)
  const forced = commitInternal(db, id, { kind: 'proposal.decide', decision: { proposalId: 'RV-11', decision: '未采纳', reason: '本地', decidedAt: 't', decidedBy: '产品' } }, { opId: 'l2', baseRev: 1, author: '产品', createdAt: 13, force: true })
  assert.equal(forced.ok, true)
  assert.equal(db.samples[id].proposals[0].status, '未采纳')
})

test('新增类操作在 stale 时也自动合并（并行追加）', () => {
  resetDb()
  const db = getDb()
  const id = 'SMP-26021'
  commitInternal(db, id, { kind: 'comment.add', comment: { id: 'a', author: '版师', content: 'A', date: '' } }, { opId: 'a', baseRev: 0, author: '版师', createdAt: 1 })
  const mine = commitInternal(db, id, { kind: 'comment.add', comment: { id: 'b', author: '供应商', content: 'B', date: '' } }, { opId: 'b', baseRev: 0, author: '供应商', createdAt: 2 })
  assert.equal(mine.ok, true)
  assert.equal(db.samples[id].comments.length, 2)
  // 幂等重放
  const again = commitInternal(db, id, { kind: 'comment.add', comment: { id: 'b', author: '供应商', content: 'B', date: '' } }, { opId: 'b', baseRev: 2, author: '供应商', createdAt: 2 })
  assert.equal(again.ok, true)
  assert.equal(again.duplicated, true)
  assert.equal(db.samples[id].comments.length, 2)
})

test('旧 v1 草稿迁移不丢数据：批注/留言/决定/锁定快照', () => {
  resetDb()
  const legacy = {
    samples: [
      {
        id: 'SMP-26018',
        annotations: [
          { id: 'AN-01', x: 1, y: 1, part: '领口', content: 'seed', author: '陈曼', status: '待处理' },
          { id: 'AN-99', x: 2, y: 2, part: '袖口', content: '本地新增批注不能丢', author: '陈曼', status: '待处理' },
        ],
        comments: [{ id: 'CM-99', author: '陈曼', content: '本地留言不能丢', date: 'x' }],
        proposals: [{ id: 'RV-01', status: '待决定' }],
      },
    ],
    selectedId: 'SMP-26018',
    decisions: [{ proposalId: 'RV-01', decision: '已采纳', reason: '本地决定不能丢', decidedAt: 't' }],
    draftNotes: { 'SMP-26018': '本地草稿正文不能丢' },
    locked: true,
  }
  localStorage.setItem('garment-sampling-draft-v1', JSON.stringify(legacy))
  const db = getDb()
  const server = db.samples['SMP-26018']
  assert.ok(server.annotations.some((a) => a.id === 'AN-99'))
  assert.ok(server.comments.some((c) => c.id === 'CM-99'))
  assert.ok(server.decisions.some((d) => d.proposalId === 'RV-01'))
  assert.equal(server.drafts['陈曼 / 产品'], '本地草稿正文不能丢')
  assert.equal(server.locked, true)
  assert.equal(server.snapshots.length, 1)
  assert.ok(server.oplog.every((op) => op.migrated || op.rev === 0))
  assert.ok(db.migrations[0].migratedOps.length >= 5)
  // 旧键被备份
  assert.ok(localStorage.getItem('garment-sampling-draft-v1-backup'))
  assert.equal(localStorage.getItem('garment-sampling-draft-v1'), null)
  // 服务端落库
  assert.ok(localStorage.getItem(serverStorageKey))

  // 再次初始化不重复迁移
  const before = server.oplog.length
  const db2 = getDb()
  assert.equal(db2.samples['SMP-26018'].oplog.length, before)
})

test('客户端工作视图：本地未提交内容在冲突期间仍可见', async () => {
  const { buildWorkingView } = await import('./features/collaboration/model.ts')
  const db = getDb()
  const server = db.samples['SMP-26018']
  const { stripServerFields } = await import('./features/collaboration/model.ts')
  const base = stripServerFields(server)
  const queue = [
    {
      opId: 'q1', baseRev: server.revision, author: '产品', createdAt: 1, seq: 1, sampleId: server.id, state: 'conflict', attempts: 1,
      kind: 'comment.add', comment: { id: 'q1c', author: '产品', content: '本地未提交内容', date: '' },
    },
  ]
  const view = buildWorkingView(base, queue, server.id)!
  assert.ok(view.comments.some((c) => c.id === 'q1c'))
})
