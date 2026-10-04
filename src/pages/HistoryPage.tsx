import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import LockOutlineIcon from '@mui/icons-material/LockOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { enqueue } from '../features/collaboration/collaborationSlice'
import { useWorkingSample } from '../features/collaboration/hooks'
import { api } from '../features/collaboration/service'
import { flushQueue, loadSample } from '../features/collaboration/thunks'
import { CURRENT_USER, formatOpSeq, formatRevision, opKindLabel, opSummary } from '../features/collaboration/model'
import type { ReviewSnapshot } from '../api/types'

export default function HistoryPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.collaboration)
  const { doc, sample } = useWorkingSample(state.selectedId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lockNote, setLockNote] = useState('')
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null)

  const queue = useMemo(
    () => state.queue.filter((op) => op.sampleId === state.selectedId).sort((a, b) => a.seq - b.seq),
    [state.queue, state.selectedId],
  )

  if (!sample || !doc) {
    return <Box className="page"><Alert severity="info">正在从协作服务读取修订历史…</Alert></Box>
  }

  const pendingAnnotations = sample.annotations.filter((item) => item.status === '待处理').length
  const pendingProposals = sample.proposals.filter((item) => item.status === '待决定').length
  const localPending = queue.length
  const canLock = pendingAnnotations === 0 && pendingProposals === 0 && localPending === 0

  const events = [...doc.oplog].sort((a, b) => a.createdAt - b.createdAt)

  const confirmLock = () => {
    dispatch(enqueue({ sampleId: sample.id, payload: { kind: 'review.lock', note: lockNote || `确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。` } }))
    setConfirmOpen(false)
    setLockNote('')
    window.setTimeout(() => void dispatch(flushQueue(sample.id)), 300)
  }

  const unlock = async () => {
    await api.unlock(sample.id, '解锁修订，开启新修订分支', CURRENT_USER)
    void dispatch(loadSample(sample.id))
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 审核与锁定</Typography>
          <Typography color="text.secondary">
            服务端修订 {formatRevision(doc.revision)} · 操作日志 {doc.oplog.length} 条 · 冻结快照 {doc.snapshots.length} 份。锁定后同次评审快照不可覆盖。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined">导出修订记录</Button>
          {doc.locked ? (
            <Button variant="outlined" startIcon={<LockOpenOutlinedIcon />} onClick={() => void unlock()}>解锁修订（新分支）</Button>
          ) : (
            <Button variant="contained" startIcon={<LockOutlineIcon />} onClick={() => setConfirmOpen(true)} disabled={!canLock}>审核锁定</Button>
          )}
        </Stack>
      </Box>

      {!canLock && !doc.locked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {pendingAnnotations} 项待处理批注、{pendingProposals} 项待决定改版方案
          {localPending > 0 && `，并等待 ${localPending} 项本地操作同步完成`}
          。
        </Alert>
      )}
      {doc.locked && <Alert severity="success" sx={{ mb: 1.5 }}>当前评审已在 {formatRevision(doc.revision)} 锁定，快照冻结；除解锁外任何写操作都会被服务端拒绝。</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 320px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>操作日志（含修订号 / 操作人 / 时间）</Typography>
          </Stack>
          <Box>
            {events.map((op) => (
              <Box key={op.opId} sx={{ display: 'grid', gridTemplateColumns: { xs: '72px 24px 1fr', sm: '92px 24px 1fr' }, gap: 1 }}>
                <Typography color="text.secondary" fontSize={11} pt={0.6}>
                  {new Date(op.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                </Typography>
                <Box sx={{ position: 'relative', '&:before': { content: '""', position: 'absolute', left: 8, top: 8, bottom: -8, width: 1, bgcolor: '#d5ddd9' }, '&:after': { content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7, bgcolor: '#25756d', border: '2px solid #fff', borderRadius: '50%', boxShadow: '0 0 0 1px #25756d' } }} />
                <Box sx={{ pb: 2.2 }}>
                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={800} fontSize={13}>{opKindLabel(op.kind)}</Typography>
                    <Chip size="small" label={formatRevision(op.rev)} variant={op.rev === 0 ? 'outlined' : 'filled'} />
                    {op.migrated && <Chip size="small" color="secondary" label="旧草稿迁移" />}
                    {op.kind === 'review.lock' && <Chip size="small" color="success" label="已冻结快照" />}
                  </Stack>
                  <Typography color="text.secondary" fontSize={12} mt={0.5}>{opSummary(op)}</Typography>
                  <Typography color="#8a918d" fontSize={10} mt={0.5}>操作者：{op.author}</Typography>
                </Box>
              </Box>
            ))}

            {/* 本地未提交操作单独列在日志底部：可恢复，刷新 / 断网都不丢 */}
            {queue.map((op) => (
              <Box key={op.opId} sx={{ display: 'grid', gridTemplateColumns: { xs: '72px 24px 1fr', sm: '92px 24px 1fr' }, gap: 1, opacity: 0.85 }}>
                <Typography fontSize={11} pt={0.6} color="#8a6a2e">未提交</Typography>
                <Box sx={{ position: 'relative', '&:after': { content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7, bgcolor: '#d49a3d', border: '2px dashed #fff', borderRadius: '50%' } }} />
                <Box sx={{ pb: 2.2 }}>
                  <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={800} fontSize={13}>{opKindLabel(op.kind)}</Typography>
                    <Chip size="small" label={formatOpSeq(op.seq)} />
                    <Chip size="small" variant="outlined" label={`基于 ${formatRevision(op.baseRev)}`} />
                    <Chip size="small" color={op.state === 'conflict' ? 'error' : op.state === 'blocked' ? 'warning' : op.state === 'syncing' ? 'info' : 'warning'} label={op.state === 'conflict' ? '冲突待处理' : op.state === 'blocked' ? '评审已冻结' : op.state === 'syncing' ? '同步中' : state.online ? '排队中' : '离线排队'} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={12} mt={0.5}>{opSummary(op)}</Typography>
                  {op.error && <Typography color="#a64a26" fontSize={11} mt={0.4}>{op.error}</Typography>}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box className="panel" sx={{ alignSelf: 'start' }}>
          <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4' }}>
            <Typography fontWeight={800}>锁定快照</Typography>
          </Box>
          <Stack spacing={1.3} p={1.6}>
            {doc.snapshots.length === 0 && (
              <Typography color="text.secondary" fontSize={12}>还没有锁定快照。审核锁定时会完整冻结当次评审的尺寸、批注、方案与决定。</Typography>
            )}
            {doc.snapshots.map((snap) => (
              <Box key={snap.id} sx={{ p: 1.3, border: '1px solid #d7e2de', borderRadius: 1, bgcolor: '#f1f7f5' }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={800} fontSize={13}>{formatRevision(snap.rev)} 冻结快照</Typography>
                  <Button size="small" onClick={() => setSnapshot(snap)}>查看</Button>
                </Stack>
                <Typography color="text.secondary" fontSize={11} mt={0.6}>{snap.lockedBy} · {snap.lockedAt}</Typography>
                <Typography color="text.secondary" fontSize={11} mt={0.3}>{snap.note}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {state.roundB}（将冻结 R{doc.revision + 1} 快照）</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>锁定后本轮尺寸、批注和采纳方案变为只读；服务端拒绝一切后续修改直到解锁，解锁会开启新的修订分支。</Typography>
          <TextField fullWidth label="锁定说明" value={lockNote} onChange={(event) => setLockNote(event.target.value)} placeholder={`确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="contained" onClick={confirmLock}>确认锁定</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(snapshot)} onClose={() => setSnapshot(null)} fullWidth maxWidth="md">
        <DialogTitle>{snapshot ? `${sample.styleCode} · ${formatRevision(snapshot.rev)} 评审冻结快照` : ''}</DialogTitle>
        <DialogContent>
          {snapshot && (
            <Stack spacing={1.5}>
              <Typography color="text.secondary" fontSize={12}>{snapshot.lockedBy} 于 {snapshot.lockedAt} 锁定 · {snapshot.note}</Typography>
              <Box>
                <Typography fontWeight={800} fontSize={13} mb={0.6}>批注（{snapshot.sample.annotations.length}）</Typography>
                {snapshot.sample.annotations.map((item) => (
                  <Typography key={item.id} fontSize={12} color="text.secondary">· {item.part} · {item.author} · {item.status}：{item.content}</Typography>
                ))}
              </Box>
              <Box>
                <Typography fontWeight={800} fontSize={13} mb={0.6}>方案决定（{snapshot.sample.decisions.length}）</Typography>
                {snapshot.sample.proposals.map((item) => (
                  <Typography key={item.id} fontSize={12} color="text.secondary">· {item.id}（{item.affectedPart}）→ {item.status}</Typography>
                ))}
              </Box>
              <Box>
                <Typography fontWeight={800} fontSize={13} mb={0.6}>第三轮尺寸</Typography>
                {snapshot.sample.measurements['第三轮'].map((item) => (
                  <Chip key={item.key} size="small" sx={{ mr: 0.6, mb: 0.4 }} label={`${item.name} ${item.actual}（规格 ${item.spec}±${item.tolerance}）`} />
                ))}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSnapshot(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
