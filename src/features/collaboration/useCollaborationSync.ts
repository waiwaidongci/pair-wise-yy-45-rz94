import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { flushQueue, pollSample } from './thunks'
import { setOnline } from './collaborationSlice'

/**
 * 网络与同步编排：
 * - 断网：操作继续进入本地队列（enqueue 本身不改 online 之外的状态）。
 * - 恢复联网：按操作顺序自动 flush 队列；失败后操作保留，下一轮 / 手动重试。
 * - 在线轮询：周期拉取当前样衣修订号，发现他人修改时更新差异提示。
 */
export function useCollaborationSync() {
  const dispatch = useAppDispatch()
  const online = useAppSelector((state) => state.collaboration.online)
  const queueLength = useAppSelector((state) => state.collaboration.queue.length)
  const flushInFlight = useAppSelector((state) => state.collaboration.flushInFlight)
  const selectedId = useAppSelector((state) => state.collaboration.selectedId)

  useEffect(() => {
    const goOnline = () => dispatch(setOnline(true))
    const goOffline = () => dispatch(setOnline(false))
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [dispatch])

  // 仅在真正断网时才自动排队；服务端故障时由用户手动重试或等下一个队列变化触发。
  useEffect(() => {
    if (online && queueLength > 0 && !flushInFlight) {
      // 3 秒退避，避免服务端持续故障时高频重试；仍可通过面板按钮立即重试。
      const timer = window.setTimeout(() => void dispatch(flushQueue()), 3000)
      return () => window.clearTimeout(timer)
    }
  }, [online, queueLength, flushInFlight, dispatch])

  // 轮询他人修改
  useEffect(() => {
    if (!online) return
    const timer = window.setInterval(() => void dispatch(pollSample(selectedId)), 12_000)
    return () => window.clearInterval(timer)
  }, [online, selectedId, dispatch])

  return { online }
}
