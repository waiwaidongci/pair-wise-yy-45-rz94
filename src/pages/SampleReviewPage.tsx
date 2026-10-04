import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import PhotoCameraBackOutlinedIcon from '@mui/icons-material/PhotoCameraBackOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { setRounds, toggleAnnotation } from '../features/developmentSlice'
import { createOp } from '../features/collabSlice'

const rounds = ['第一轮', '第二轮', '第三轮'] as const

export default function SampleReviewPage() {
  const dispatch = useAppDispatch()
  const development = useAppSelector((root) => root.development)
  const collab = useAppSelector((root) => root.collab)
  const sample = collab.working[development.selectedId] ?? Object.values(collab.working)[0]
  const sampleId = sample?.id ?? development.selectedId

  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [decisionDialog, setDecisionDialog] = useState<string | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [annotationDraft, setAnnotationDraft] = useState({ x: 50, y: 42, part: '版型', content: '' })
  const [editingMeasurement, setEditingMeasurement] = useState<{ round: typeof rounds[number]; key: string; value: string } | null>(null)
  const [draftText, setDraftText] = useState('')
  const imageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sample) setDraftText(sample.draftNotes)
  }, [sample?.draftNotes])

  const locked = sample?.status === '已锁定'
  const hasConflict = Boolean(collab.conflicts[sampleId])

  const comparison = useMemo(() => {
    if (!sample) return []
    const a = sample.measurements[development.roundA]
    const b = sample.measurements[development.roundB]
    return a.map((item, index) => ({
      ...item,
      previous: item.actual,
      current: b[index].actual,
      delta: b[index].actual - item.actual,
      inTolerance: Math.abs(b[index].actual - b[index].spec) <= b[index].tolerance,
    }))
  }, [sample, development.roundA, development.roundB])

  if (!sample) {
    return (
      <Box className="page">
        <Alert severity="info">正在加载样衣协作数据…</Alert>
      </Box>
    )
  }

  const handleImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (locked) return
    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnnotationDraft((current) => ({
      ...current,
      x: Math.round(((event.clientX - rect.left) / rect.width) * 100),
      y: Math.round(((event.clientY - rect.top) / rect.height) * 100),
    }))
    setAnnotationOpen(true)
  }

  const submitDecision = (decision: '已采纳' | '未采纳') => {
    if (!decisionDialog || !decisionReason.trim()) return
    void dispatch(
      createOp({
        sampleId: sample.id,
        type: 'proposal.decide',
        opPayload: { proposalId: decisionDialog, decision, reason: decisionReason, decidedAt: new Date().toLocaleString('zh-CN') },
      }),
    )
    setDecisionDialog(null)
    setDecisionReason('')
  }

  const submitAnnotation = () => {
    const annotation = {
      id: `AN-${Date.now()}`,
      author: '当前用户',
      status: '待处理' as const,
      ...annotationDraft,
    }
    void dispatch(createOp({ sampleId: sample.id, type: 'annotation.add', opPayload: { annotation } }))
    setAnnotationDraft({ x: 50, y: 42, part: '版型', content: '' })
    setAnnotationOpen(false)
  }

  const saveDraft = () => {
    void dispatch(createOp({ sampleId: sample.id, type: 'draft.save', opPayload: { notes: draftText } }))
  }

  const commitMeasurement = () => {
    if (!editingMeasurement) return
    const actual = Number(editingMeasurement.value)
    if (Number.isFinite(actual)) {
      void dispatch(
        createOp({
          sampleId: sample.id,
          type: 'measurement.update',
          opPayload: { round: editingMeasurement.round, key: editingMeasurement.key, actual },
        }),
      )
    }
    setEditingMeasurement(null)
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">SAMPLE REVIEW / 样品评审</Typography>
          <Typography component="h1" fontWeight={800}>
            {sample.styleCode} · 轮次对比
            <Chip
              size="small"
              label={`修订 v${sample.revision}`}
              color="primary"
              variant="outlined"
              sx={{ ml: 1, fontWeight: 700 }}
            />
          </Typography>
          <Typography color="text.secondary">尺寸差异超过容差自动高亮；每次保存生成修订号与操作号，协作者修改逐项合并。</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<PhotoCameraBackOutlinedIcon />}>上传样衣照片</Button>
          <Button variant="contained" disabled={locked} onClick={saveDraft}>保存当前草稿</Button>
        </Stack>
      </Box>

      {hasConflict && <Alert severity="warning" sx={{ mb: 1.5 }}>检测到协作者已保存，请在下方冲突对话框中逐项合并。</Alert>}
      {locked && <Alert severity="success" sx={{ mb: 1.5 }}>该轮次已审核锁定并冻结快照。解锁后才能新增批注或采纳方案。</Alert>}
      {sample.annotations.some((item) => item.status === '待处理') && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          当前仍有 {sample.annotations.filter((item) => item.status === '待处理').length} 项待处理批注，审核锁定前必须逐项关闭。
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.15fr) minmax(340px,.85fr)' }, gap: 1.5 }}>
        <Box className="panel">
          <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography fontWeight={800}>尺寸实测差异</Typography>
            <Stack direction="row" spacing={1}>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>基准轮次</InputLabel>
                <Select label="基准轮次" value={development.roundA} onChange={(event) => dispatch(setRounds({ a: event.target.value as typeof development.roundA }))}>
                  {rounds.map((round) => <MenuItem key={round} value={round}>{round}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>对比轮次</InputLabel>
                <Select label="对比轮次" value={development.roundB} onChange={(event) => dispatch(setRounds({ b: event.target.value as typeof development.roundB }))}>
                  {rounds.map((round) => <MenuItem key={round} value={round}>{round}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 620 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: '#f6f5f2' }}>
                  <TableCell>部位</TableCell>
                  <TableCell>规格</TableCell>
                  <TableCell>±容差</TableCell>
                  <TableCell>{development.roundA}</TableCell>
                  <TableCell>{development.roundB}</TableCell>
                  <TableCell>变化</TableCell>
                  <TableCell>判定</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {comparison.map((item) => (
                  <TableRow key={item.key} sx={{ bgcolor: item.inTolerance ? 'transparent' : '#fff4ef' }}>
                    <TableCell sx={{ fontWeight: 750 }}>{item.name}</TableCell>
                    <TableCell>{item.spec} cm</TableCell>
                    <TableCell>±{item.tolerance}</TableCell>
                    <TableCell>{item.previous.toFixed(1)}</TableCell>
                    <TableCell sx={{ fontWeight: 800, color: item.inTolerance ? '#2d7665' : '#b44b2d' }}>
                      <Stack direction="row" alignItems="center" gap={0.5}>
                        {item.current.toFixed(1)}
                        {!locked && (
                          <Tooltip title="修改实测值">
                            <EditOutlinedIcon
                              sx={{ fontSize: 13, color: '#9aa6a3', cursor: 'pointer' }}
                              onClick={() => setEditingMeasurement({ round: development.roundB, key: item.key, value: String(item.current) })}
                            />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={`${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)}`} color={Math.abs(item.delta) > 0.5 ? 'warning' : 'default'} />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" icon={item.inTolerance ? <CheckCircleOutlineIcon /> : <CancelOutlinedIcon />} label={item.inTolerance ? '达标' : '超差'} color={item.inTolerance ? 'success' : 'error'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Box sx={{ p: 1.5, borderTop: '1px solid #ece9e4' }}>
            <TextField
              multiline
              minRows={2}
              fullWidth
              size="small"
              label="轮次评审草稿"
              value={draftText}
              disabled={locked}
              onChange={(event) => setDraftText(event.target.value)}
              onBlur={() => {
                if (sample && draftText !== sample.draftNotes) {
                  void dispatch(createOp({ sampleId: sample.id, type: 'draft.save', opPayload: { notes: draftText } }))
                }
              }}
            />
          </Box>
        </Box>

        <Box className="panel">
          <Box sx={{ px: 1.8, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between' }}>
            <Typography fontWeight={800}>样衣部位批注 · {development.roundB}</Typography>
            <Button size="small" startIcon={<AddLocationAltOutlinedIcon />} disabled={locked} onClick={() => setAnnotationOpen(true)}>添加批注</Button>
          </Box>
          <Box
            ref={imageRef}
            onClick={handleImageClick}
            sx={{
              position: 'relative',
              height: 420,
              m: 1.5,
              overflow: 'hidden',
              cursor: locked ? 'default' : 'crosshair',
              borderRadius: 1.5,
              background: 'linear-gradient(180deg,#dfe5e4 0%,#cbd4d1 100%)',
              backgroundImage: 'linear-gradient(180deg,#dce4e2 0%,#c7d2cf 100%), repeating-linear-gradient(90deg,transparent 0 39px,rgba(255,255,255,.18) 40px)',
            }}
          >
            <Box sx={{ position: 'absolute', left: '50%', top: 32, transform: 'translateX(-50%)', width: 170, height: 55, border: '3px solid #526a65', borderRadius: '50% 50% 22% 22%', bgcolor: '#657d77' }} />
            <Box sx={{ position: 'absolute', left: '50%', top: 80, transform: 'translateX(-50%)', width: 210, height: 230, border: '3px solid #526a65', borderRadius: '38px 38px 22px 22px', bgcolor: '#718983' }}>
              <Box sx={{ position: 'absolute', left: 50, top: 72, width: 110, height: 76, border: '1px dashed rgba(255,255,255,.6)', borderRadius: 2 }} />
              <Box sx={{ position: 'absolute', left: 35, top: 30, right: 35, borderTop: '2px solid rgba(255,255,255,.45)' }} />
              <Box sx={{ position: 'absolute', left: 38, top: 148, width: 34, height: 48, border: '2px solid #455c57', borderRadius: 1 }} />
              <Box sx={{ position: 'absolute', right: 38, top: 148, width: 34, height: 48, border: '2px solid #455c57', borderRadius: 1 }} />
            </Box>
            <Box sx={{ position: 'absolute', left: 50, top: 96, width: 52, height: 200, border: '3px solid #526a65', borderRadius: '25px 8px 12px 25px', bgcolor: '#657d77', transform: 'rotate(7deg)' }} />
            <Box sx={{ position: 'absolute', right: 50, top: 96, width: 52, height: 200, border: '3px solid #526a65', borderRadius: '8px 25px 25px 12px', bgcolor: '#657d77', transform: 'rotate(-7deg)' }} />
            {sample.annotations.map((annotation) => (
              <Tooltip key={annotation.id} title={`${annotation.part}：${annotation.content}`}>
                <Box
                  onClick={(event) => {
                    event.stopPropagation()
                    dispatch(toggleAnnotation(development.activeAnnotation === annotation.id ? null : annotation.id))
                  }}
                  sx={{
                    position: 'absolute',
                    left: `${annotation.x}%`,
                    top: `${annotation.y}%`,
                    width: 24,
                    height: 24,
                    display: 'grid',
                    placeItems: 'center',
                    transform: 'translate(-50%,-50%)',
                    borderRadius: '50%',
                    color: '#fff',
                    bgcolor: annotation.status === '待处理' ? '#cf6236' : '#397c69',
                    border: '3px solid rgba(255,255,255,.9)',
                    boxShadow: '0 3px 10px rgba(0,0,0,.25)',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {annotation.id.slice(-2)}
                </Box>
              </Tooltip>
            ))}
            <Chip label="点击样衣任意部位添加批注" size="small" sx={{ position: 'absolute', left: 12, bottom: 12, bgcolor: 'rgba(255,255,255,.9)' }} />
          </Box>
          <Stack spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
            {sample.annotations.map((annotation) => (
              <Box key={annotation.id} sx={{ p: 1.2, borderLeft: `3px solid ${annotation.status === '待处理' ? '#cf6236' : '#397c69'}`, bgcolor: '#f8f7f4', borderRadius: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={800} fontSize={12}>{annotation.part} · {annotation.author}</Typography>
                  <Button size="small" onClick={() => dispatch(toggleAnnotation(annotation.id))}>查看</Button>
                </Stack>
                <Typography color="text.secondary" fontSize={11} mt={0.4}>{annotation.content}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>

      <Box className="panel" sx={{ mt: 1.5 }}>
        <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4' }}>
          <Typography fontWeight={800}>替代修改方案与采纳决定</Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 1.5, p: 1.5 }}>
          {sample.proposals.map((proposal) => (
            <Box key={proposal.id} sx={{ p: 1.5, border: '1px solid #e2dfda', borderRadius: 1.2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800}>{proposal.affectedPart} · {proposal.role}</Typography>
                <Chip size="small" label={proposal.status} color={proposal.status === '已采纳' ? 'success' : proposal.status === '未采纳' ? 'default' : 'warning'} />
              </Stack>
              <Typography fontSize={13} mt={1}>{proposal.content}</Typography>
              <Typography color="text.secondary" fontSize={11} mt={0.7}>提交人：{proposal.author}</Typography>
              {proposal.status === '待决定' && (
                <Button size="small" variant="outlined" sx={{ mt: 1.2 }} onClick={() => setDecisionDialog(proposal.id)} disabled={locked}>
                  作出决定
                </Button>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      <Dialog open={annotationOpen} onClose={() => setAnnotationOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加部位批注</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField label="详细部位" value={annotationDraft.part} onChange={(event) => setAnnotationDraft({ ...annotationDraft, part: event.target.value })} />
            <TextField multiline minRows={3} label="批注内容" value={annotationDraft.content} onChange={(event) => setAnnotationDraft({ ...annotationDraft, content: event.target.value })} />
            <Typography color="text.secondary" fontSize={12}>批注锚点：{annotationDraft.x}% / {annotationDraft.y}% · 轮次 {development.roundB}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnotationOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!annotationDraft.part.trim() || !annotationDraft.content.trim()}
            onClick={submitAnnotation}
          >
            添加并标记待处理
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(decisionDialog)} onClose={() => setDecisionDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>填写采纳决定说明</DialogTitle>
        <DialogContent>
          <TextField autoFocus multiline minRows={3} fullWidth label="决定理由（必填）" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={!decisionReason.trim()} startIcon={<CancelOutlinedIcon />} onClick={() => submitDecision('未采纳')}>不采纳</Button>
          <Button variant="contained" disabled={!decisionReason.trim()} startIcon={<CheckCircleOutlineIcon />} onClick={() => submitDecision('已采纳')}>采纳方案</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(editingMeasurement)} onClose={() => setEditingMeasurement(null)} fullWidth maxWidth="xs">
        <DialogTitle>修改实测值</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            type="number"
            label={`${editingMeasurement?.round} 实测 (cm)`}
            value={editingMeasurement?.value ?? ''}
            onChange={(event) => setEditingMeasurement((current) => (current ? { ...current, value: event.target.value } : current))}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingMeasurement(null)}>取消</Button>
          <Button variant="contained" onClick={commitMeasurement}>保存为新修订</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
