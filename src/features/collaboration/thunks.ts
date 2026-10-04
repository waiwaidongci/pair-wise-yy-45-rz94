import type { AppDispatch, RootState } from '../../app/store'
import { api } from './service'
import {
  remotePolled,
  sampleLoaded,
  syncFailed,
  syncStarted,
  syncSucceeded,
} from './collaborationSlice'

/** 首次加载：列表 + 当前样衣（带修订号、操作日志、迁移报告）。 */
export function bootstrap() {
  return async (dispatch: AppDispatch, getState: () => RootState) => {
    const list = await api.listSamples()
    const selectedId = getState().collaboration.selectedId
    const id = list.samples.some((item) => item.id === selectedId) ? selectedId : list.samples[0]?.id
    if (!id) return
    const envelope = await api.getSample(id)
    dispatch(
      sampleLoaded({
        sample: envelope.sample,
        revision: envelope.revision,
        locked: envelope.locked,
        oplog: envelope.oplog,
        snapshots: envelope.snapshots,
        migrations: list.migrations,
      }),
    )
  }
}

export function loadSample(id: string) {
  return async (dispatch: AppDispatch) => {
    const envelope = await api.getSample(id)
    dispatch(
      sampleLoaded({
        sample: envelope.sample,
        revision: envelope.revision,
        locked: envelope.locked,
        oplog: envelope.oplog,
        snapshots: envelope.snapshots,
        migrations: [],
      }),
    )
  }
}

/**
 * 按操作顺序把本地队列同步到服务端：
 * - 断网：直接失败并保留队列（调用方通常在恢复后自动重试）。
 * - 服务端故障：同样保留全部未完成操作。
 * - 冲突 / 锁定：服务端在响应里逐条指出，reducer 把这些操作标为 conflict 并保留。
 */
export function flushQueue(sampleId?: string) {
  return async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState().collaboration
    if (state.flushInFlight) return

    const pending = state.queue.filter(
      (op) => (!sampleId || op.sampleId === sampleId) && op.state === 'queued',
    )
    if (pending.length === 0) return

    // 冲突面板选择“以我的为准”的操作，下一次同步携带 force 覆盖冲突。
    const forceIds = new Set(state.queue.filter((op) => op.force).map((op) => op.opId))

    const bySample = new Map<string, typeof pending>()
    pending.forEach((op) => {
      const list = bySample.get(op.sampleId) ?? []
      list.push(op)
      bySample.set(op.sampleId, list)
    })

    dispatch(syncStarted(pending.map((op) => op.opId)))

    for (const [id, ops] of bySample) {
      try {
        const response = await api.syncOperations(id, ops, forceIds)
        dispatch(syncSucceeded(response))
      } catch (error) {
        dispatch(
          syncFailed({
            message: error instanceof Error ? error.message : '同步失败',
            opIds: ops.map((op) => op.opId),
          }),
        )
      }
    }
  }
}

/** 轮询：只拉取修订号变化，发现他人修改后保留本地未提交操作，差异由 UI 逐项展示。 */
export function pollSample(id: string) {
  return async (dispatch: AppDispatch, getState: () => RootState) => {
    if (!navigator.onLine) return
    try {
      const envelope = await api.getSample(id)
      const known = getState().collaboration.docs[id]
      if (known && known.revision === envelope.revision) return
      dispatch(
        remotePolled({
          sample: envelope.sample,
          revision: envelope.revision,
          locked: envelope.locked,
          oplog: envelope.oplog,
          snapshots: envelope.snapshots,
        }),
      )
    } catch {
      // 轮询失败静默，等待下一个周期
    }
  }
}
