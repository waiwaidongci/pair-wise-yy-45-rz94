import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import type { Snapshot } from '../api/types'

export default function SnapshotDialog({
  snapshot,
  onClose,
}: {
  snapshot: Snapshot | null
  onClose: () => void
}) {
  if (!snapshot) return null
  const { state } = snapshot

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>
        <Stack direction="row" alignItems="center" gap={1}>
          <LockOutlinedIcon color="success" />
          <Box>
            <Typography fontWeight={800}>冻结的评审快照 · 修订 v{snapshot.revision}</Typography>
            <Typography color="text.secondary" fontSize={12}>
              冻结于 {new Date(snapshot.frozenAt).toLocaleString('zh-CN')} · 操作人 {snapshot.frozenBy}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {snapshot.reason && (
          <Box sx={{ mb: 1.5, p: 1.2, bgcolor: '#f4f8f6', borderRadius: 1 }}>
            <Typography fontSize={12} color="text.secondary">锁定说明</Typography>
            <Typography fontSize={13}>{snapshot.reason}</Typography>
          </Box>
        )}

        <Typography fontWeight={800} fontSize={13} mb={1}>尺寸实测（冻结）</Typography>
        <Table size="small" sx={{ mb: 2 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: '#f6f5f2' }}>
              <TableCell>部位</TableCell>
              <TableCell>规格</TableCell>
              <TableCell>第一轮</TableCell>
              <TableCell>第二轮</TableCell>
              <TableCell>第三轮</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {state.measurements['第三轮'].map((item) => (
              <TableRow key={item.key}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.spec} cm</TableCell>
                <TableCell>{state.measurements['第一轮'].find((m) => m.key === item.key)?.actual.toFixed(1)}</TableCell>
                <TableCell>{state.measurements['第二轮'].find((m) => m.key === item.key)?.actual.toFixed(1)}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{item.actual.toFixed(1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Divider sx={{ my: 1.5 }} />
        <Typography fontWeight={800} fontSize={13} mb={1}>批注（{state.annotations.length}）</Typography>
        <Stack spacing={0.6} mb={2}>
          {state.annotations.map((ann) => (
            <Box key={ann.id} sx={{ p: 1, borderLeft: `3px solid ${ann.status === '待处理' ? '#cf6236' : '#397c69'}`, bgcolor: '#faf9f7', borderRadius: 0.5 }}>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography fontWeight={700} fontSize={12}>{ann.part}</Typography>
                <Chip size="small" label={ann.status} sx={{ height: 18, fontSize: 10 }} />
                <Typography color="text.secondary" fontSize={11}>{ann.author}</Typography>
              </Stack>
              <Typography fontSize={12} mt={0.3}>{ann.content}</Typography>
            </Box>
          ))}
        </Stack>

        <Typography fontWeight={800} fontSize={13} mb={1}>改版方案与决定（{state.proposals.length}）</Typography>
        <Stack spacing={0.6}>
          {state.proposals.map((prop) => (
            <Box key={prop.id} sx={{ p: 1, border: '1px solid #e2dfda', borderRadius: 0.5 }}>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography fontWeight={700} fontSize={12}>{prop.affectedPart} · {prop.role}</Typography>
                <Chip size="small" label={prop.status} color={prop.status === '已采纳' ? 'success' : prop.status === '未采纳' ? 'default' : 'warning'} sx={{ height: 18, fontSize: 10 }} />
              </Stack>
              <Typography fontSize={12} mt={0.3}>{prop.content}</Typography>
            </Box>
          ))}
        </Stack>

        {state.draftNotes && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography fontWeight={800} fontSize={13} mb={0.5}>评审草稿</Typography>
            <Typography fontSize={13} color="text.secondary">{state.draftNotes}</Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
