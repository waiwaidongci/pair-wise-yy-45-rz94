import { useMemo, useRef, useState } from 'react'
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
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { acknowledgeMigration, dismissRemoteNotice, enqueue, setRounds, toggleAnnotation } from '../features/collaboration/collaborationSlice'
import { useSampleQueue, useWorkingSample } from '../features/collaboration/hooks'
import {
  CURRENT_USER,
  formatOpSeq,
  formatRevision,
  newAnnotation,
  newComment,
  newDecision,
  opKindLabel,
  opSummary,
} from '../features/collaboration/model'
import { api } from '../features/collaboration/service'
import { pollSample } from '../features/collaboration/thunks'

const rounds = ['第一轮', '第二轮', '第三轮'] as const

export default function SampleReviewPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.collaboration)
  const selectedId = state.selectedId
  const { doc, sample } = useWorkingSample(selectedId)
  const queue = useSampleQueue(selectedId)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [decisionDialog, setDecisionDialog] = useState<string | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [annotationDraft, setAnnotationDraft] = useState({ x: 50, y: 42, part: '版型', content: '' })
  const [comment, setComment] = useState('')
  const [draftText, setDraftText] = useState('')
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const imageRef = useRef<HTMLDivElement>(null)

  const locked = doc?.locked ?? false

  const comparison = useMemo(() => {
    if (!sample) return []
    const a = sample.measurements[state.roundA]
    const b = sample.measurements[state.roundB]
    return a.map((item, index) => ({
      ...item,
      previous: item.actual,
      current: b[index].actual,
      delta: b[index].actual - item.actual,
      inTolerance: Math.abs(b[index].actual - b[index].spec) <= b[index].tolerance,
    }))
  }, [sample, state.roundA, state.roundB])

  if (!sample || !doc) {
    return <Box className="page"><Alert severity="info">正在从协作服务读取样衣与修订号…</Alert></Box>
  }

  const myDraft = sample.drafts[CURRENT_USER] ?? ''

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

  const addAnnotation = () => {
    const annotation = newAnnotation(annotationDraft.x, annotationDraft.y, annotationDraft.part, annotationDraft.content, CURRENT_USER)
    dispatch(enqueue({ sampleId: sample.id, payload: { kind: 'annotation.add', annotation } }))
    setAnnotationDraft({ x: 50, y: 42, part: '版型', content: '' })
    setAnnotationOpen(false)
  }

  const saveDraft = () => {
    dispatch(enqueue({ sampleId: sample.id, payload: { kind: 'draft.save', author: CURRENT_USER, content: draftText } }))
    setDraftSavedAt(new Date().toLocaleTimeString('zh-CN'))
    setDraftText('')
  }

  const submitDecision = (decision: '已采纳' | '未采纳') => {
    if (!decisionDialog || !decisionReason.trim()) return
    dispatch(
      enqueue({
        sampleId: sample.id,
        payload: { kind: 'proposal.decide', decision: newDecision(decisionDialog, decision, decisionReason, CURRENT_USER) },
      }),
    )
    setDecisionDialog(null)
    setDecisionReason('')
  }

  const toggleResolve = (annotationId: string, currentStatus: '待处理' | '已解决') => {
    dispatch(
      enqueue({
        sampleId: sample.id,
        payload: { kind: 'annotation.resolve', annotationId, status: currentStatus === '待处理' ? '已解决' : '待处理' },
      }),
    )
  }

  const pendingForAnnotation = (id: string) => queue.some((op) => op.kind === 'annotation.resolve' && op.annotationId === id)

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">SAMPLE REVIEW / 样品评审</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 轮次对比</Typography>
          <Typography color="text.secondary">
            服务端修订 {formatRevision(doc.revision)}
            {queue.length > 0 && ` · 本地待提交操作 ${queue.length} 项（${formatOpSeq(Math.min(...queue.map((op) => op.seq)))} 起）`}
            {' '}· 尺寸、批注与方案多人协作，冲突逐项合并不覆盖。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<PhotoCameraBackOutlinedIcon />}>上传样衣照片</Button>
          <Button
            variant="contained"
            disabled={locked}
            onClick={async () => {
              await api.simulateRemote(sample.id, 'annotation')
              void dispatch(pollSample(sample.id))
            }}
            startIcon={<PeopleAltOutlinedIcon />}
          >
            模拟他人修改
          </Button>
        </Stack>
      </Box>

      {!state.online && (
        <Alert severity="warning" icon={<WifiOffIcon />} sx={{ mb: 1.5 }}>
          当前断网：尺寸批注、留言和决定都在本地排队并持久化，网络恢复后将按操作号顺序自动合并，不会覆盖他人内容。
        </Alert>
      )}
      {locked && <Alert severity="success" sx={{ mb: 1.5 }}>该评审已在 {formatRevision(doc.revision)} 锁定，同次评审快照已冻结。解锁后将开启新修订分支。</Alert>}
      {doc.remoteNotice.length > 0 && (
        <Alert
          severity="info"
          sx={{ mb: 1.5 }}
          onClose={() => dispatch(dismissRemoteNotice(sample.id))}
        >
          <Typography fontWeight={800}>服务端有 {doc.remoteNotice.length} 条他人新修改，本地未提交内容已保留：</Typography>
          {doc.remoteNotice.map((op) => (
            <Box key={op.opId} sx={{ fontSize: 12, mt: 0.4 }}>
              <Chip size="small" label={opKindLabel(op.kind)} sx={{ mr: 0.6 }} />
              {op.author}：{opSummary(op)} <Typography component="span" color="text.secondary">（{formatRevision(op.rev)}）</Typography>
            </Box>
          ))}
        </Alert>
      )}
      {state.migrations.length > 0 && !state.migrationSeen && (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => dispatch(acknowledgeMigration())}>
          检测到旧版浏览器草稿，已迁移为 {state.migrations.reduce((sum, item) => sum + item.migratedOps.length, 0)} 条带修订号的协作操作，原有批注、决定、草稿和锁定快照均已保留。
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.15fr) minmax(340px,.85fr)' }, gap: 1.5 }}>
        <Box className="panel">
          <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography fontWeight={800}>尺寸实测差异</Typography>
            <Stack direction="row" spacing={1}>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>基准轮次</InputLabel>
                <Select label="基准轮次" value={state.roundA} onChange={(event) => dispatch(setRounds({ a: event.target.value as typeof state.roundA }))}>
                  {rounds.map((round) => <MenuItem key={round} value={round}>{round}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>对比轮次</InputLabel>
                <Select label="对比轮次" value={state.roundB} onChange={(event) => dispatch(setRounds({ b: event.target.value as typeof state.roundB }))}>
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
                  <TableCell>{state.roundA}</TableCell>
                  <TableCell>{state.roundB}</TableCell>
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
                    <TableCell sx={{ fontWeight: 800, color: item.inTolerance ? '#2d7665' : '#b44b2d' }}>{item.current.toFixed(1)}</TableCell>
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
            <Typography fontWeight={800} fontSize={13} mb={0.8}>
              轮次评审草稿（按作者保留，与他人草稿互不覆盖）
            </Typography>
            <TextField
              multiline
              minRows={2}
              fullWidth
              size="small"
              label={`${CURRENT_USER} 的草稿`}
              value={draftText !== '' ? draftText : myDraft}
              onChange={(event) => setDraftText(event.target.value)}
              placeholder="第二轮肩袖活动量已改善；建议采纳肩线内收方案，第三轮复核举臂舒适度。"
              disabled={locked}
            />
            <Stack direction="row" justifyContent="space-between" alignItems="center" mt={1}>
              <Typography fontSize={11} color="text.secondary">
                服务端已存草稿基于 {formatRevision(doc.revision)}；他人会话对同一草稿的修改不会覆盖本地版本，冲突时可逐项选择。
                {draftSavedAt && ` 上次本地保存于 ${draftSavedAt}（已进入队列）。`}
              </Typography>
              <Button size="small" variant="contained" disabled={locked || (draftText || myDraft).trim() === '' || draftText === ''} onClick={saveDraft}>
                保存当前草稿
              </Button>
            </Stack>
          </Box>
        </Box>

        <Box className="panel">
          <Box sx={{ px: 1.8, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between' }}>
            <Typography fontWeight={800}>样衣部位批注 · {state.roundB}</Typography>
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
                    dispatch(toggleAnnotation(state.activeAnnotation === annotation.id ? null : annotation.id))
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
                  {annotation.id.replace(/\D/g, '').slice(-2) || '•'}
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
                  <Stack direction="row" spacing={0.6} alignItems="center">
                    {pendingForAnnotation(annotation.id) && <Chip size="small" color="info" label="本地待提交" />}
                    <Button size="small" onClick={() => dispatch(toggleAnnotation(annotation.id))}>查看</Button>
                    <Button size="small" disabled={locked} onClick={() => toggleResolve(annotation.id, annotation.status)}>
                      {annotation.status === '待处理' ? '标记已解决' : '重新打开'}
                    </Button>
                  </Stack>
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
          {sample.proposals.map((proposal) => {
            const decision = sample.decisions.find((item) => item.proposalId === proposal.id)
            const pending = queue.find((op) => op.kind === 'proposal.decide' && op.decision.proposalId === proposal.id)
            return (
              <Box key={proposal.id} sx={{ p: 1.5, border: '1px solid #e2dfda', borderRadius: 1.2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={800}>{proposal.affectedPart} · {proposal.role}</Typography>
                  <Chip size="small" label={proposal.status} color={proposal.status === '已采纳' ? 'success' : proposal.status === '未采纳' ? 'default' : 'warning'} />
                </Stack>
                <Typography fontSize={13} mt={1}>{proposal.content}</Typography>
                <Typography color="text.secondary" fontSize={11} mt={0.7}>提交人：{proposal.author}</Typography>
                {decision && (
                  <Box sx={{ mt: 0.8, p: 1, bgcolor: '#f1f6f4', borderRadius: 1, fontSize: 11.5 }}>
                    <Typography fontWeight={800}>{decision.decision} · {decision.decidedBy} · {decision.decidedAt}</Typography>
                    <Typography color="text.secondary" mt={0.3}>{decision.reason}</Typography>
                  </Box>
                )}
                {pending && <Chip size="small" sx={{ mt: 0.8 }} color="info" label={`决定待提交 ${formatOpSeq(pending.seq)}`} />}
                {proposal.status === '待决定' && !pending && (
                  <Button size="small" variant="outlined" sx={{ mt: 1.2 }} onClick={() => setDecisionDialog(proposal.id)} disabled={locked}>
                    作出决定
                  </Button>
                )}
              </Box>
            )
          })}
        </Box>
      </Box>

      <Box className="panel" sx={{ mt: 1.5, p: 2 }}>
        <Typography fontWeight={800} mb={1}>评审留言（多人追加，按操作号顺序合并）</Typography>
        <Stack spacing={1} mb={1.5}>
          {sample.comments.map((item) => (
            <Box key={item.id} sx={{ p: 1.2, bgcolor: '#f8f7f4', borderRadius: 1 }}>
              <Stack direction="row" justifyContent="space-between">
                <Typography fontWeight={800} fontSize={12}>{item.author}</Typography>
                <Typography fontSize={11} color="text.secondary">{item.date}</Typography>
              </Stack>
              <Typography fontSize={12.5} mt={0.4}>{item.content}</Typography>
            </Box>
          ))}
          {queue
            .filter((op) => op.kind === 'comment.add')
            .map((op) => (
              <Box key={op.opId} sx={{ p: 1.2, bgcolor: '#eef4fb', borderRadius: 1, border: '1px dashed #9db9d8' }}>
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <Chip size="small" color="info" label={`本地 ${formatOpSeq(op.seq)}`} />
                  <Typography fontWeight={800} fontSize={12}>{op.comment.author}</Typography>
                </Stack>
                <Typography fontSize={12.5} mt={0.4}>{op.comment.content}</Typography>
              </Box>
            ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder="补充评审留言…（断网也可发送，将排队）"
            value={comment}
            disabled={locked}
            onChange={(event) => setComment(event.target.value)}
          />
          <Button
            variant="contained"
            startIcon={<SendOutlinedIcon />}
            disabled={locked || !comment.trim()}
            onClick={() => {
              dispatch(enqueue({ sampleId: sample.id, payload: { kind: 'comment.add', comment: newComment(comment, CURRENT_USER, '刚刚') } }))
              setComment('')
            }}
          >
            发送
          </Button>
        </Stack>
      </Box>

      <Dialog open={annotationOpen} onClose={() => setAnnotationOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加部位批注</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField label="详细部位" value={annotationDraft.part} onChange={(event) => setAnnotationDraft({ ...annotationDraft, part: event.target.value })} />
            <TextField multiline minRows={3} label="批注内容" value={annotationDraft.content} onChange={(event) => setAnnotationDraft({ ...annotationDraft, content: event.target.value })} />
            <Typography color="text.secondary" fontSize={12}>批注锚点：{annotationDraft.x}% / {annotationDraft.y}% · 轮次 {state.roundB} · 基于修订 {formatRevision(doc.revision)}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnotationOpen(false)}>取消</Button>
          <Button variant="contained" disabled={!annotationDraft.part.trim() || !annotationDraft.content.trim()} onClick={addAnnotation}>
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
    </Box>
  )
}
