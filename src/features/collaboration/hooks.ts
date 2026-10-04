import { useMemo } from 'react'
import { useAppSelector } from '../../app/hooks'
import type { Sample } from '../../api/types'
import { buildWorkingView } from './model'
import type { DocState } from './collaborationSlice'

/**
 * 当前样衣的工作视图：服务端事实 + 本地未提交操作叠加。
 * 排队、同步中、冲突的操作都包含在内，因此本地未提交内容始终可见、不被覆盖。
 */
export function useWorkingSample(sampleId: string): {
  doc: DocState | undefined
  sample: Sample | undefined
} {
  const doc = useAppSelector((state) => state.collaboration.docs[sampleId])
  const queue = useAppSelector((state) => state.collaboration.queue)
  const sample = useMemo(() => buildWorkingView(doc?.sample, queue, sampleId), [doc?.sample, queue, sampleId])
  return { doc, sample }
}

/** 样衣维度的待提交操作。 */
export function useSampleQueue(sampleId: string) {
  return useAppSelector((state) => state.collaboration.queue.filter((op) => op.sampleId === sampleId))
}
