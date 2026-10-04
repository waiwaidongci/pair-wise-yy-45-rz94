import { useEffect, useState } from 'react'
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
import PhotoOutlinedIcon from '@mui/icons-material/PhotoOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { createOp, fetchSnapshots } from '../features/collabSlice'
import SnapshotDialog from '../components/SnapshotDialog'
import type { Snapshot } from '../api/types'

export default function HistoryPage() {
  const dispatch = useAppDispatch()
  const development = useAppSelector((root) => root.development)
  const collab = useAppSelector((root) => root.collab)
  const sample = collab.working[development.selectedId] ?? Object.values(collab.working)[0]
  const snapshots = collab.snapshots[sample?.id ?? ''] ?? []
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lockReason, setLockReason] = useState('')
  const [viewingSnapshot, setViewingSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    if (sample) void dispatch(fetchSnapshots(sample.id))
  }, [sample?.id, dispatch])

  if (!sample) {
    return (
      <Box className="page">
        <Alert severity="info">正在加载修订历史…</Alert>
      </Box>
    )
  }

  const pendingAnnotations = sample.annotations.filter((item) => item.status === '待处理').length
  const pendingProposals = sample.proposals.filter((item) => item.status === '待决定').length
  const canLock = pendingAnnotations === 0 && pendingProposals === 0
  const locked = sample.status === '已锁定'

  const events = [
    ...sample.annotations.map((item) => ({ date: '2026-09-27', title: `${item.part}批注`, owner: item.author, detail: item.content, status: item.status })),
    ...sample.proposals.map((item) => ({ date: '2026-09-27', title: `${item.affectedPart}改版方案`, owner: item.author, detail: item.content, status: item.status })),
    ...sample.decisions.map((item) => ({ date: '今天', title: `方案 ${item.proposalId} ${item.decision}`, owner: '品类负责人', detail: item.reason, status: '已记录' })),
    { date: '2026-09-26', title: '第三轮尺寸实测导入', owner: '苏州明裁制衣', detail: '导入 6 个部位实测值，系统发现 2 项超过容差。', status: '已同步' },
    { date: '2026-09-22', title: '第二轮试穿评审', owner: '陈曼', detail: '完成动态试穿记录，肩袖活动量改善。', status: '已归档' },
  ]

  const confirmLock = () => {
    void dispatch(createOp({ sampleId: sample.id, type: 'review.lock', opPayload: { reason: lockReason || `确认 ${development.roundB} 版型与工艺资料完整，可进入下一阶段。`, frozenBy: '当前用户' } }))
    setConfirmOpen(false)
    setLockReason('')
  }

  const unlock = () => {
    void dispatch(createOp({ sampleId: sample.id, type: 'review.unlock', opPayload: {} }))
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>
            {sample.styleCode} · 审核与锁定
            <Chip size="small" label={`修订 v${sample.revision}`} color="primary" variant="outlined" sx={{ ml: 1, fontWeight: 700 }} />
          </Typography>
          <Typography color="text.secondary">每次尺寸调整、批注和替代方案均保留修订号、操作号与决定理由；锁定即冻结快照。</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined">导出修订记录</Button>
          {locked ? (
            <Button variant="outlined" startIcon={<LockOpenOutlinedIcon />} onClick={unlock}>解锁修订</Button>
          ) : (
            <Button variant="contained" startIcon={<LockOutlineIcon />} onClick={() => setConfirmOpen(true)} disabled={!canLock}>审核锁定</Button>
          )}
        </Stack>
      </Box>

      {!canLock && !locked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {pendingAnnotations} 项待处理批注和 {pendingProposals} 项待决定改版方案。
        </Alert>
      )}
      {locked && <Alert severity="success" sx={{ mb: 1.5 }}>当前轮次已锁定，只能查看历史。解锁后将新增一个修订分支，已冻结快照不可覆盖。</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 310px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>完整审计时间线</Typography>
          </Stack>
          <Box>
            {events.map((event, index) => (
              <Box key={`${event.title}-${index}`} sx={{ display: 'grid', gridTemplateColumns: '92px 24px 1fr', gap: 1 }}>
                <Typography color="text.secondary" fontSize={11} pt={0.6}>{event.date}</Typography>
                <Box sx={{ position: 'relative', '&:before': { content: '""', position: 'absolute', left: 8, top: 8, bottom: -8, width: 1, bgcolor: '#d5ddd9' }, '&:after': { content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7, bgcolor: '#25756d', border: '2px solid #fff', borderRadius: '50%', boxShadow: '0 0 0 1px #25756d' } }} />
                <Box sx={{ pb: 2.2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={800} fontSize={13}>{event.title}</Typography>
                    <Chip size="small" label={event.status} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={12} mt={0.5}>{event.detail}</Typography>
                  <Typography color="#8a918d" fontSize={10} mt={0.5}>操作者：{event.owner}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Stack spacing={1.5}>
          <Box className="panel" sx={{ p: 1.6 }}>
            <Typography fontWeight={800} mb={1}>冻结快照</Typography>
            {snapshots.length === 0 ? (
              <Typography color="text.secondary" fontSize={12}>尚未生成冻结快照。审核锁定后将在此保留不可覆盖的评审版本。</Typography>
            ) : (
              <Stack spacing={1}>
                {snapshots.map((snapshot) => (
                  <Box key={`${snapshot.revision}-${snapshot.frozenAt}`} sx={{ p: 1.2, border: '1px solid #e4e1dc', borderRadius: 1, bgcolor: '#f4f8f6' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography fontWeight={800} fontSize={12}>修订 v{snapshot.revision}</Typography>
                      <Chip size="small" icon={<LockOutlineIcon sx={{ fontSize: 12 }} />} label="已冻结" color="success" sx={{ height: 20, fontSize: 10 }} />
                    </Stack>
                    <Typography color="text.secondary" fontSize={11} mt={0.4}>
                      {new Date(snapshot.frozenAt).toLocaleString('zh-CN')} · {snapshot.frozenBy}
                    </Typography>
                    <Button size="small" startIcon={<PhotoOutlinedIcon />} sx={{ mt: 0.6, fontSize: 11 }} onClick={() => setViewingSnapshot(snapshot)}>
                      查看冻结快照
                    </Button>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          <Box className="panel" sx={{ p: 1.6 }}>
            <Typography fontWeight={800} mb={1}>轮次摘要</Typography>
            <Stack spacing={1.5}>
              {(['第一轮', '第二轮', '第三轮'] as const).map((round, index) => (
                <Box key={round} sx={{ p: 1.3, border: '1px solid #e4e1dc', borderRadius: 1, bgcolor: round === development.roundB ? '#edf5f2' : '#fff' }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                    <Chip size="small" label={index === 2 ? sample.status : '已归档'} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={11} mt={0.8}>
                    {sample.measurements[round].length} 项实测 · {index === 2 ? sample.annotations.length : index + 2} 条评审记录
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        </Stack>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {development.roundB}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>锁定后本轮尺寸、批注和采纳方案将变为只读，并生成不可覆盖的审核快照（修订 v{sample.revision + 1}）。</Typography>
          <TextField fullWidth label="锁定说明" value={lockReason} onChange={(event) => setLockReason(event.target.value)} placeholder={`确认 ${development.roundB} 版型与工艺资料完整，可进入下一阶段。`} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="contained" onClick={confirmLock}>确认锁定</Button>
        </DialogActions>
      </Dialog>

      <SnapshotDialog snapshot={viewingSnapshot} onClose={() => setViewingSnapshot(null)} />
    </Box>
  )
}
