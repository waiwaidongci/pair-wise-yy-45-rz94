import type {
  MigrationReport,
  ReviewSnapshot,
  Sample,
  ServerOp,
  SyncResponse,
} from '../../api/types'
import type { QueuedOperation } from '../../api/types'
import { toSyncBody } from './model'

export type SampleEnvelope = {
  sample: Sample
  revision: number
  locked: boolean
  oplog: ServerOp[]
  snapshots: ReviewSnapshot[]
}

export type SamplesListResponse = {
  samples: Sample[]
  revisions: Record<string, number>
  migrations: MigrationReport[]
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    try {
      const data = (await response.json()) as { message?: string }
      if (data.message) message = data.message
    } catch {
      // ignore empty body
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export const api = {
  async listSamples(signal?: AbortSignal): Promise<SamplesListResponse> {
    return parseJson<SamplesListResponse>(await fetch('/api/samples', { signal }))
  },

  async getSample(id: string, signal?: AbortSignal): Promise<SampleEnvelope> {
    return parseJson<SampleEnvelope>(await fetch(`/api/samples/${id}`, { signal }))
  },

  /**
   * 按操作号顺序提交一个样衣的一批操作。
   * resolveForceIds 中的操作（用户在冲突面板选了“以我的为准”）携带 force。
   */
  async syncOperations(
    sampleId: string,
    ops: QueuedOperation[],
    forceIds: Set<string>,
  ): Promise<SyncResponse> {
    const operations = ops.map((op) => {
      const body = toSyncBody(op)
      return forceIds.has(op.opId) ? { ...body, force: true } : body
    })
    return parseJson<SyncResponse>(
      await fetch(`/api/samples/${sampleId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations }),
      }),
    )
  },

  async unlock(sampleId: string, note: string, author: string): Promise<SyncResponse> {
    return parseJson<SyncResponse>(
      await fetch(`/api/samples/${sampleId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, author }),
      }),
    )
  },

  async simulateRemote(sampleId: string, kind: 'annotation' | 'decision' | 'draft' | 'comment'): Promise<void> {
    await fetch(`/api/samples/${sampleId}/simulate-remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
  },

  async failNext(count = 1): Promise<void> {
    await fetch('/api/debug/fail-next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    })
  },
}
