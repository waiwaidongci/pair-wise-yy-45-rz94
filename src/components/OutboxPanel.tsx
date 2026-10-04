import { useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Chip,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import OutboxOutlinedIcon from '@mui/icons-material/OutboxOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { retryOp } from '../features/collabSlice'

const opTypeLabel: Record<string, string> = {
  'measurement.update': '尺寸修改',
  'annotation.add': '新增批注',
  'annotation.resolve': '批注状态',
  'proposal.decide': '方案决定',
  'draft.save': '草稿保存',
  'review.lock': '审核锁定',
  'review.unlock': '解锁',
}

export default function OutboxPanel() {
  const dispatch = useAppDispatch()
  const outbox = useAppSelector((state) => state.collab.outbox)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const queued = outbox.filter((op) => op.status !== 'applied')
  const failed = queued.filter((op) => op.status === 'failed').length
  const pending = queued.filter((op) => op.status === 'pending').length

  return (
    <>
      <Tooltip title="待提交操作队列">
        <IconButton onClick={(event) => setAnchor(event.currentTarget)} sx={{ color: 'inherit' }}>
          <Badge badgeContent={queued.length} color={failed ? 'error' : 'primary'} max={99}>
            <OutboxOutlinedIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 380, maxWidth: '92vw', p: 1.5 } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography fontWeight={800} fontSize={14}>操作队列</Typography>
          <Stack direction="row" gap={0.5}>
            <Chip size="small" icon={<ScheduleOutlinedIcon sx={{ fontSize: 13 }} />} label={`待提交 ${pending}`} />
            {failed > 0 && (
              <Chip size="small" icon={<WarningAmberOutlinedIcon sx={{ fontSize: 13 }} />} label={`失败 ${failed}`} color="error" />
            )}
          </Stack>
        </Stack>

        {queued.length === 0 && (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <CheckCircleOutlineIcon color="success" sx={{ fontSize: 32 }} />
            <Typography color="text.secondary" fontSize={12} mt={1}>所有修改已同步到服务器</Typography>
          </Box>
        )}

        <Stack spacing={0.8} sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {queued.map((op) => (
            <Box
              key={op.opId}
              sx={{
                p: 1,
                border: '1px solid',
                borderColor: op.status === 'failed' ? '#e8b4a0' : '#e2dfda',
                borderRadius: 1,
                bgcolor: op.status === 'failed' ? '#fdf3ef' : '#faf9f7',
              }}
            >
              <Stack direction="row" alignItems="center" gap={0.7}>
                <Typography fontWeight={800} fontSize={12} fontFamily="monospace">{op.opId}</Typography>
                <Chip size="small" label={opTypeLabel[op.type] ?? op.type} sx={{ height: 18, fontSize: 10 }} />
                <Box sx={{ flex: 1 }} />
                {op.status === 'failed' ? (
                  <Tooltip title="重试">
                    <IconButton size="small" onClick={() => void dispatch(retryOp(op.opId))}>
                      <RefreshOutlinedIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <ScheduleOutlinedIcon sx={{ fontSize: 14, color: '#9aa6a3' }} />
                )}
              </Stack>
              <Typography color="text.secondary" fontSize={11} mt={0.4}>
                样衣 {op.sampleId} · 基准修订 v{op.baseRevision}
              </Typography>
              {op.status === 'failed' && op.lastError && (
                <Typography color="#b44b2d" fontSize={11} mt={0.3}>失败：{op.lastError}（已重试 {op.attempts} 次）</Typography>
              )}
            </Box>
          ))}
        </Stack>

        {failed > 0 && (
          <Button
            fullWidth
            size="small"
            variant="contained"
            color="warning"
            sx={{ mt: 1 }}
            startIcon={<RefreshOutlinedIcon />}
            onClick={() => queued.filter((op) => op.status === 'failed').forEach((op) => void dispatch(retryOp(op.opId)))}
          >
            重试全部失败操作
          </Button>
        )}
      </Popover>
    </>
  )
}
