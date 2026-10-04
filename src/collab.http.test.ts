// HTTP 层集成验证：真实走一遍 fetch → MSW handlers → 协作协议
import { test } from 'node:test'
import assert from 'node:assert/strict'

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

const { setupServer } = await import('msw/node')
const { handlers } = await import('./api/handlers.ts')
const { resetDb } = await import('./api/db.ts')

resetDb()
const server = setupServer(...handlers)
server.listen({ onUnhandledRequest: 'error' })

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('GET /samples 返回修订号', async () => {
  const res = await fetch('http://localhost/api/samples')
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.revisions['SMP-26018'], 0)
  assert.ok(Array.isArray(data.samples))
})

test('sync 批处理：顺序提交两个操作，修订号递增', async () => {
  const id = 'SMP-26021'
  const res = await post(`http://localhost/api/samples/${id}/sync`, {
    operations: [
      { opId: 'h1', baseRev: 0, author: '供应商', createdAt: 1, kind: 'comment.add', comment: { id: 'hc1', author: '供应商', content: '第一条', date: '刚刚' } },
      { opId: 'h2', baseRev: 0, author: '供应商', createdAt: 2, kind: 'comment.add', comment: { id: 'hc2', author: '供应商', content: '第二条', date: '刚刚' } },
    ],
  })
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.revision, 2)
  assert.equal(data.applied.length, 2)
  assert.deepEqual(data.applied.map((a: { rev: number }) => a.rev), [1, 2])
})

test('冲突操作在同一批次中被逐条拒绝且不影响其他操作', async () => {
  const id = 'SMP-26021'
  // 他人先决定
  await post(`http://localhost/api/samples/${id}/simulate-remote`, { kind: 'decision' })
  // 批次里：一个可自动合并的留言 + 一个冲突决定
  const res = await post(`http://localhost/api/samples/${id}/sync`, {
    operations: [
      { opId: 'h3', baseRev: 2, author: '产品', createdAt: 3, kind: 'comment.add', comment: { id: 'hc3', author: '产品', content: '留言应合并', date: '刚刚' } },
      { opId: 'h4', baseRev: 2, author: '产品', createdAt: 4, kind: 'proposal.decide', decision: { proposalId: 'RV-11', decision: '未采纳', reason: '本地不同意见', decidedAt: 't', decidedBy: '产品' } },
    ],
  })
  const data = await res.json()
  assert.equal(data.applied.length, 1)
  assert.equal(data.applied[0].opId, 'h3')
  assert.equal(data.rejected.length, 1)
  assert.equal(data.rejected[0].opId, 'h4')
  assert.equal(data.rejected[0].code, 'conflict')
  assert.equal(data.rejected[0].remote.kind, 'decision')
  // 双方内容：服务端保留对方版本
  assert.equal(data.sample.proposals.find((p: { id: string }) => p.id === 'RV-11').status, '已采纳')
  assert.ok(data.sample.comments.some((c: { id: string }) => c.id === 'hc3'))

  // 冲突操作选择“以我的为准”重试
  const forced = await post(`http://localhost/api/samples/${id}/sync`, {
    operations: [
      { opId: 'h4', baseRev: data.revision, author: '产品', createdAt: 5, force: true, kind: 'proposal.decide', decision: { proposalId: 'RV-11', decision: '未采纳', reason: '本地不同意见', decidedAt: 't', decidedBy: '产品' } },
    ],
  })
  const forcedData = await forced.json()
  assert.equal(forcedData.applied.length, 1)
  assert.equal(forcedData.sample.proposals.find((p: { id: string }) => p.id === 'RV-11').status, '未采纳')
})

test('幂等：失败重试重复提交相同 opId 不会产生重复修订', async () => {
  const id = 'SMP-26021'
  const before = (await (await fetch(`http://localhost/api/samples/${id}`)).json()).revision
  await post(`http://localhost/api/samples/${id}/sync`, {
    operations: [
      { opId: 'h3', baseRev: before, author: '产品', createdAt: 3, kind: 'comment.add', comment: { id: 'hc3', author: '产品', content: '留言应合并', date: '刚刚' } },
    ],
  })
  const after = await (await fetch(`http://localhost/api/samples/${id}`)).json()
  assert.equal(after.revision, before) // 未新增修订
  assert.equal(after.sample.comments.filter((c: { id: string }) => c.id === 'hc3').length, 1)
})

test('锁定冻结 + 快照 + 解锁后可继续', async () => {
  resetDb()
  const id = 'SMP-26018'
  const lock = await post(`http://localhost/api/samples/${id}/sync`, {
    operations: [{ opId: 'lock1', baseRev: 0, author: '负责人', createdAt: 9, kind: 'review.lock', note: '冻结同次评审' }],
  })
  const lockData = await lock.json()
  assert.equal(lockData.revision, 1)
  assert.equal(lockData.locked, true)
  assert.equal(lockData.snapshot.rev, 1)
  assert.equal(lockData.snapshot.note, '冻结同次评审')
  assert.ok(lockData.snapshot.sample.annotations.length >= 2)

  // 冻结后新增被拒
  const blocked = await post(`http://localhost/api/samples/${id}/sync`, {
    operations: [{ opId: 'blocked1', baseRev: 1, author: '供应商', createdAt: 10, kind: 'comment.add', comment: { id: 'x', author: 'x', content: '不应进入', date: '' } }],
  })
  const blockedData = await blocked.json()
  assert.equal(blockedData.rejected[0].code, 'locked')
  assert.equal(blockedData.rejected[0].snapshotRev, 1)
  assert.equal(blockedData.sample.comments.some((c: { id: string }) => c.id === 'x'), false)

  // 快照接口可读
  const snap = await (await fetch(`http://localhost/api/samples/${id}/snapshots/1`)).json()
  assert.equal(snap.id, 'SNAP-SMP-26018-1')

  // 解锁不占修订号，之后可继续
  await post(`http://localhost/api/samples/${id}/unlock`, { note: '开新分支', author: '负责人' })
  const resumed = await post(`http://localhost/api/samples/${id}/sync`, {
    operations: [{ opId: 'after1', baseRev: 1, author: '供应商', createdAt: 11, kind: 'comment.add', comment: { id: 'y', author: 'x', content: '解锁后进入', date: '' } }],
  })
  const resumedData = await resumed.json()
  assert.equal(resumedData.revision, 2)
  assert.equal(resumedData.locked, false)
  assert.equal(resumedData.snapshots.length, 1)
})

test('服务端故障（503）：客户端能识别失败并保留操作', async () => {
  await post('http://localhost/api/debug/fail-next', { count: 1 })
  const res = await post('http://localhost/api/samples/SMP-26018/sync', {
    operations: [{ opId: 'fail1', baseRev: 2, author: 'x', createdAt: 12, kind: 'comment.add', comment: { id: 'f', author: 'x', content: '失败保留', date: '' } }],
  })
  assert.equal(res.status, 503)
  // 操作未进入服务端
  const doc = await (await fetch('http://localhost/api/samples/SMP-26018')).json()
  assert.equal(doc.sample.comments.some((c: { id: string }) => c.id === 'f'), false)
  // 下一次请求恢复正常，同操作可重试成功
  const retry = await post('http://localhost/api/samples/SMP-26018/sync', {
    operations: [{ opId: 'fail1', baseRev: 2, author: 'x', createdAt: 12, kind: 'comment.add', comment: { id: 'f', author: 'x', content: '失败保留', date: '' } }],
  })
  assert.equal(retry.status, 200)
  server.close()
})
