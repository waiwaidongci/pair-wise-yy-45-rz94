import { useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined'
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined'
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { flushOutbox, retryAll, setOnline } from '../features/collabSlice'

function formatTime(iso: string | null): string {
  if (!iso) return '尚未同步'
  const date = new Date(iso)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function CollabStatus() {
  const dispatch = useAppDispatch()
  const online = useAppSelector((state) => state.collab.online)
  const syncing = useAppSelector((state) => state.collab.syncing)
  const outbox = useAppSelector((state) => state.collab.outbox)
  const lastSyncedAt = useAppSelector((state) => state.collab.lastSyncedAt)
  const [expanded, setExpanded] = useState(false)

  const pending = outbox.filter((op) => op.status === 'pending').length
  const failed = outbox.filter((op) => op.status === 'failed').length
  const total = outbox.filter((op) => op.status !== 'applied').length

  const offlineSim = (() => {
    try {
      return localStorage.getItem('garment-sampling-offline') === '1'
    } catch {
      return false
    }
  })()

  const toggleOfflineSim = () => {
    const next = !offlineSim
    try {
      if (next) localStorage.setItem('garment-sampling-offline', '1')
      else localStorage.removeItem('garment-sampling-offline')
    } catch {
      /* ignore */
    }
    dispatch(setOnline(!next))
    if (!next) void dispatch(flushOutbox())
  }

  return (
    <Box sx={{ mx: 1.5, mt: 'auto', p: 1.5, border: '1px solid rgba(255,255,255,.1)', borderRadius: 1.5 }}>
      <Stack direction="row" alignItems="center" gap={0.7}>
        {online ? (
          <CloudDoneOutlinedIcon sx={{ fontSize: 16, color: '#74b79d' }} />
        ) : (
          <CloudOffOutlinedIcon sx={{ fontSize: 16, color: '#d48b5e' }} />
        )}
        <Typography fontSize={11} sx={{ color: '#eef1ef' }}>
          {online ? '协作已连接' : '离线 · 操作排队中'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="立即同步">
          <IconButton size="small" onClick={() => void dispatch(flushOutbox())} sx={{ color: '#9aa6a3' }}>
            <SyncOutlinedIcon sx={{ fontSize: 15, animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" gap={0.6} mt={0.8} flexWrap="wrap">
        {total > 0 && (
          <Chip
            size="small"
            label={`待提交 ${pending}`}
            sx={{ height: 20, fontSize: 10, bgcolor: 'rgba(255,255,255,.08)', color: '#cbd3d1' }}
          />
        )}
        {failed > 0 && (
          <Chip
            size="small"
            icon={<WarningAmberOutlinedIcon sx={{ fontSize: 12, color: '#f0a868 !important' }} />}
            label={`失败 ${failed}`}
            sx={{ height: 20, fontSize: 10, bgcolor: 'rgba(212,139,94,.18)', color: '#f0a868' }}
          />
        )}
        {total === 0 && (
          <Typography color="#8f9a98" fontSize={10}>最后同步 {formatTime(lastSyncedAt)}</Typography>
        )}
      </Stack>

      {failed > 0 && (
        <Button
          size="small"
          fullWidth
          variant="outlined"
          sx={{ mt: 1, color: '#f0a868', borderColor: 'rgba(240,168,104,.4)', fontSize: 11, py: 0.3 }}
          onClick={() => void dispatch(retryAll())}
        >
          重试失败操作
        </Button>
      )}

      <Collapse in={expanded}>
        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,.08)' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography color="#8f9a98" fontSize={10}>模拟断网（演示）</Typography>
            <Chip
              size="small"
              label={offlineSim ? '断开' : '正常'}
              onClick={toggleOfflineSim}
              sx={{
                height: 20,
                fontSize: 10,
                cursor: 'pointer',
                bgcolor: offlineSim ? 'rgba(212,139,94,.25)' : 'rgba(116,183,157,.2)',
                color: offlineSim ? '#f0a868' : '#74b79d',
              }}
            />
          </Stack>
        </Box>
      </Collapse>

      <Button
        size="small"
        fullWidth
        onClick={() => setExpanded((v) => !v)}
        sx={{ mt: 0.5, color: '#8f9a98', fontSize: 10, py: 0.2, minWidth: 0 }}
      >
        {expanded ? '收起' : '高级'}
      </Button>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  )
}
