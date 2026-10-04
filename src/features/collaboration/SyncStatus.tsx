import { useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined'
import SyncIcon from '@mui/icons-material/Sync'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { flushQueue, pollSample } from './thunks'
import { dismissRemoteNotice, resolveConflict, retryOp, setOnline } from './collaborationSlice'
import { diffWithRemote, formatOpSeq, formatRevision, opKindLabel, opSummary } from './model'
import { api } from './service'

export default function SyncStatus() {
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(false)
  const { online, queue, flushInFlight, lastError, lastSyncAt, docs, selectedId } = useAppSelector(
    (state) => state.collaboration,
  )

  const conflictCount = queue.filter((op) => op.state === 'conflict').length
  const pendingCount = queue.filter((op) => op.state !== 'syncing').length
  const remoteCount = Object.values(docs).reduce((sum, doc) => sum + doc.remoteNotice.length, 0)
  const badgeCount = conflictCount + pendingCount + remoteCount

  const statusColor = !online ? 'warning' : conflictCount ? 'error' : pendingCount ? 'info' : 'success'
  const StatusIcon = !online ? CloudOffIcon : conflictCount ? SyncProblemIcon : pendingCount ? SyncIcon : CloudDoneOutlinedIcon
  const title = !online
    ? '断网中，操作已本地排队'
    : conflictCount
      ? `${conflictCount} 项与他人修改冲突`
      : pendingCount
        ? `${pendingCount} 项待同步`
        : '全部修订已同步'

  return (
    <>
      <Tooltip title={title}>
        <Badge badgeContent={badgeCount} color={statusColor === 'success' ? 'primary' : statusColor} max={99}>
          <Button
            onClick={() => setOpen(true)}
            sx={{
              color: 'inherit',
              borderColor: 'rgba(255,255,255,.25)',
              justifyContent: 'flex-start',
              minWidth: 0,
              px: 1.2,
            }}
            variant="outlined"
            size="small"
            startIcon={<StatusIcon sx={{ color: !online ? '#e0b15e' : conflictCount ? '#e08a7a' : '#74b79d' }} />}
          >
            <Box sx={{ textAlign: 'left', overflow: 'hidden' }}>
              <Typography fontSize={11} fontWeight={800} noWrap>{title}</Typography>
              <Typography fontSize={9.5} color="#8f9a98" noWrap>
                {online ? (lastSyncAt ? `上次同步 ${new Date(lastSyncAt).toLocaleTimeString('zh-CN')}` : '等待同步') : '联网后自动按序合并'}
              </Typography>
            </Box>
          </Button>
        </Badge>
      </Tooltip>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
        <Box sx={{ width: { xs: 320, sm: 420 }, p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
            <Typography fontWeight={850}>协作与修订同步</Typography>
            <Chip size="small" icon={online ? <CloudDoneOutlinedIcon /> : <WifiOffIcon />} color={online ? 'success' : 'warning'} label={online ? '在线' : '离线排队'} />
          </Stack>

          <Typography color="text.secondary" fontSize={12} mb={1.5}>
            每次保存带修订号（R#）与操作号（#0001）；服务端有他人修改时，本地未提交内容保留并逐项对比。
          </Typography>

          <Stack direction="row" spacing={1} mb={2}>
            <Button size="small" variant="contained" startIcon={<AutorenewIcon />} disabled={!online || pendingCount === 0 || flushInFlight} onClick={() => void dispatch(flushQueue())}>
              {flushInFlight ? '同步中…' : '立即重试 / 同步'}
            </Button>
            <Chip size="small" variant="outlined" icon={<PeopleAltOutlinedIcon />} label={`${remoteCount} 条他人新修改`} color={remoteCount ? 'warning' : 'default'} />
          </Stack>

          {lastError && (
            <Box sx={{ p: 1.2, mb: 1.5, borderRadius: 1, bgcolor: '#fdeee7', border: '1px solid #f0c6b3' }}>
              <Typography fontSize={12} fontWeight={750} color="#a64a26">上次同步失败：{lastError}</Typography>
              <Typography fontSize={11} color="#8a5d4c" mt={0.4}>未完成操作均已保留，联网或服务端恢复后可重试。</Typography>
            </Box>
          )}

          {/* 他人修改提示（非阻塞） */}
          {Object.entries(docs).map(([sampleId, doc]) =>
            doc.remoteNotice.length === 0 ? null : (
              <Box key={sampleId} sx={{ mb: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.8}>
                  <Typography fontWeight={800} fontSize={13}>{sampleId} · 他人新修改</Typography>
                  <Button size="small" onClick={() => dispatch(dismissRemoteNotice(sampleId))}>知道了</Button>
                </Stack>
                <List dense disablePadding>
                  {doc.remoteNotice.map((op) => (
                    <ListItem key={op.opId} sx={{ px: 1, bgcolor: '#fbf6ec', borderRadius: 1, mb: 0.6, display: 'block' }}>
                      <Stack direction="row" spacing={0.6} alignItems="center">
                        <Chip size="small" label={opKindLabel(op.kind)} color="warning" />
                        <Chip size="small" variant="outlined" label={formatRevision(op.rev)} />
                        <Typography fontSize={11} color="text.secondary">{op.author}</Typography>
                      </Stack>
                      <Typography fontSize={12} mt={0.5}>{opSummary(op)}</Typography>
                    </ListItem>
                  ))}
                </List>
              </Box>
            ),
          )}

          <Divider textAlign="left" sx={{ mb: 1.5 }}>
            <Chip size="small" label={`本地操作队列（${queue.length}）`} />
          </Divider>

          {queue.length === 0 && (
            <Typography color="text.secondary" fontSize={12} align="center" py={3}>没有未提交操作。</Typography>
          )}

          <List dense disablePadding sx={{ gap: 1, display: 'grid' }}>
            {[...queue]
              .sort((a, b) => a.seq - b.seq)
              .map((op) => {
                const doc = docs[op.sampleId]
                return (
                  <ListItem key={op.opId} sx={{ p: 1.2, border: '1px solid #e5e1da', borderRadius: 1.5, display: 'block' }}>
                    <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap">
                      <Chip size="small" label={formatOpSeq(op.seq)} sx={{ fontFamily: 'monospace' }} />
                      <Chip size="small" variant="outlined" label={`基于 ${formatRevision(op.baseRev)}`} />
                      <Chip size="small" label={opKindLabel(op.kind)} color={op.state === 'conflict' ? 'error' : op.state === 'blocked' ? 'warning' : op.state === 'syncing' ? 'info' : 'default'} />
                      {op.migrated && <Chip size="small" color="secondary" label="旧草稿迁移" />}
                      {op.attempts > 0 && <Chip size="small" variant="outlined" label={`已尝试 ${op.attempts} 次`} />}
                      <Typography fontSize={10.5} color="text.secondary" ml="auto">{op.sampleId}</Typography>
                    </Stack>
                    <Typography fontSize={12} mt={0.6}>{opSummary(op)}</Typography>

                    {op.state === 'conflict' && op.remote && (
                      <Box sx={{ mt: 1, p: 1, bgcolor: '#fdeee7', borderRadius: 1 }}>
                        <Typography fontSize={11} fontWeight={800} color="#a64a26" mb={0.5}>服务端已有他人修改，双方内容均未丢失：</Typography>
                        {diffWithRemote(op, op.remote).map((row) => (
                          <Box key={row.label} sx={{ display: 'grid', gridTemplateColumns: '52px 1fr 1fr', gap: 0.8, fontSize: 11, mb: 0.4 }}>
                            <Typography color="text.secondary">{row.label}</Typography>
                            <Box sx={{ p: 0.6, bgcolor: '#fff', borderRadius: 0.6, border: '1px dashed #e2b49c' }}>
                              <Typography fontSize={9.5} color="#a64a26">本地</Typography>
                              {row.mine}
                            </Box>
                            <Box sx={{ p: 0.6, bgcolor: '#eef4f1', borderRadius: 0.6, border: '1px dashed #9fc4b8' }}>
                              <Typography fontSize={9.5} color="#397c69">服务端</Typography>
                              {row.theirs}
                            </Box>
                          </Box>
                        ))}
                        <Stack direction="row" spacing={1} mt={0.8}>
                          <Button size="small" variant="contained" color="primary" disabled={!online} onClick={() => { dispatch(resolveConflict({ opId: op.opId, resolution: 'mine' })) }}>
                            以我的为准
                          </Button>
                          <Button size="small" variant="outlined" color="inherit" onClick={() => dispatch(resolveConflict({ opId: op.opId, resolution: 'theirs' }))}>
                            采用服务端版本
                          </Button>
                          <Button size="small" disabled={!online} onClick={() => dispatch(retryOp(op.opId))}>稍后重试</Button>
                        </Stack>
                      </Box>
                    )}

                    {op.state === 'blocked' && (
                      <Box sx={{ mt: 1, p: 1, bgcolor: '#fdf4e3', borderRadius: 1, border: '1px solid #ecd6a4' }}>
                        <Typography fontSize={11} fontWeight={800} color="#8a6a2e">{op.error}</Typography>
                        <Typography fontSize={10.5} color="#8a6a2e" mt={0.4}>操作已保留，不会自动重试；请到修订历史页解锁（开启新修订分支）后再重试本操作。</Typography>
                        <Button size="small" sx={{ mt: 0.6 }} disabled={!online || Boolean(doc?.locked)} onClick={() => dispatch(retryOp(op.opId))}>解锁后重试</Button>
                      </Box>
                    )}

                    {op.state !== 'conflict' && op.state !== 'blocked' && (
                      <Stack direction="row" spacing={1} mt={0.6} alignItems="center">
                        <Chip size="small" variant="outlined" label={op.state === 'syncing' ? '提交中…' : online ? '等待同步' : '离线排队'} />
                        {doc && <Typography fontSize={10.5} color="text.secondary">服务端当前 {formatRevision(doc.revision)}</Typography>}
                        {op.state !== 'syncing' && (
                          <Button size="small" sx={{ ml: 'auto' }} disabled={!online} onClick={() => dispatch(retryOp(op.opId))}>重试</Button>
                        )}
                      </Stack>
                    )}
                  </ListItem>
                )
              })}
          </List>

          {selectedId && (
            <Box sx={{ mt: 2, p: 1.2, border: '1px dashed #cdb98e', borderRadius: 1.2, bgcolor: '#fdf9ef' }}>
              <Typography fontSize={11} fontWeight={800} mb={0.8}>协作演练（产品 / 版师 / 供应商同时编辑）</Typography>
              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                <Button size="small" onClick={() => { dispatch(setOnline(false)) }} startIcon={<WifiOffIcon />}>模拟断网</Button>
                <Button size="small" variant="outlined" onClick={() => { dispatch(setOnline(true)) }}>恢复联网</Button>
                <Button size="small" onClick={() => void api.failNext(1)}>模拟下次同步失败</Button>
                <Button size="small" onClick={async () => { await api.simulateRemote(selectedId, 'annotation'); void dispatch(pollSample(selectedId)) }}>他人改批注</Button>
                <Button size="small" onClick={async () => { await api.simulateRemote(selectedId, 'decision'); void dispatch(pollSample(selectedId)) }}>他人采纳方案</Button>
                <Button size="small" onClick={async () => { await api.simulateRemote(selectedId, 'comment'); void dispatch(pollSample(selectedId)) }}>他人留言</Button>
                <Button size="small" onClick={async () => { await api.simulateRemote(selectedId, 'draft'); void dispatch(pollSample(selectedId)) }}>他人改草稿</Button>
              </Stack>
              <Typography fontSize={10} color="text.secondary" mt={0.8}>“他人改批注/采纳/草稿”会让服务端修订号领先，下一次提交同类操作时即出现逐项差异。</Typography>
            </Box>
          )}
        </Box>
      </Drawer>
    </>
  )
}
