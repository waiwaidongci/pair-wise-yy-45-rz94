import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { Op, Sample, Snapshot } from '../api/types'

export type ApplyOpsResult = {
  ok: true
  revision: number
  sample: Sample
  appliedOpIds: string[]
}

export type ConflictResult = {
  error: 'conflict'
  currentRevision: number
  baseRevision: number
  currentState: Sample
  sinceOps: Op[]
}

export const samplingApi = createApi({
  reducerPath: 'samplingApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Sample', 'Samples', 'Snapshots'],
  endpoints: (builder) => ({
    getSamples: builder.query<Sample[], void>({
      query: () => 'api/samples',
      providesTags: ['Samples'],
    }),
    getSample: builder.query<Sample, string>({
      query: (id) => `api/samples/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Sample', id }],
    }),
    applyOps: builder.mutation<ApplyOpsResult, { sampleId: string; ops: Op[] }>({
      query: ({ sampleId, ops }) => ({
        url: `api/samples/${sampleId}/ops`,
        method: 'POST',
        body: { ops },
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }],
    }),
    lockSample: builder.mutation<{ ok: true; revision: number; sample: Sample; snapshot: Snapshot }, { sampleId: string; reason: string }>({
      query: ({ sampleId, reason }) => ({
        url: `api/samples/${sampleId}/lock`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: (_result, _error, { sampleId }) => [{ type: 'Sample', id: sampleId }, { type: 'Snapshots', id: sampleId }],
    }),
    unlockSample: builder.mutation<{ ok: true; revision: number; sample: Sample }, string>({
      query: (sampleId) => ({ url: `api/samples/${sampleId}/unlock`, method: 'POST' }),
      invalidatesTags: (_result, _error, sampleId) => [{ type: 'Sample', id: sampleId }],
    }),
    getSnapshots: builder.query<Snapshot[], string>({
      query: (sampleId) => `api/samples/${sampleId}/snapshots`,
      providesTags: (_result, _error, sampleId) => [{ type: 'Snapshots', id: sampleId }],
    }),
  }),
})

export const {
  useGetSamplesQuery,
  useGetSampleQuery,
  useApplyOpsMutation,
  useLockSampleMutation,
  useUnlockSampleMutation,
  useGetSnapshotsQuery,
} = samplingApi
