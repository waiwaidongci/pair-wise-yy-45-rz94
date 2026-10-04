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
  Divider,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import MergeTypeOutlinedIcon from '@mui/icons-material/MergeTypeOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { resolveConflict } from '../features/collabSlice'

type Resolution = 'local' | 'server'

export default function ConflictDialog({ sampleId }: { sampleId: string }) {
  const dispatch = useAppDispatch()
  const conflict = useAppSelector((state) => state.collab.conflicts[sampleId])
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})

  useEffect(() => {
    if (conflict) {
      const init: Record<string, Resolution> = {}
      for (const diff of conflict.diffs) {
        init[diff.key] = diff.localOnly ? 'local' : diff.serverOnly ? 'server' : 'local'
      }
      setResolutions(init)
    }
  }, [conflict])

  if (!conflict) return null

  const setResolution = (key: string, value: Resolution) => {
    setResolutions((prev) => ({ ...prev, [key]: value }))
  }

  const handleConfirm = () => {
    void dispatch(resolveConflict({ sampleId, resolutions }))
  }

  const localCount = Object.values(resolutions).filter((r) => r === 'local').length
  const serverCount = Object.values(resolutions).filter((r) => r === 'server').length

  return (
    <Dialog open fullWidth maxWidth="md" onClose={() => undefined}>
      <DialogTitle>
        <Stack direction="row" alignItems="center" gap={1}>
          <MergeTypeOutlinedIcon color="warning" />
          <Box>
            <Typography fontWeight={800}>检测到协作者已保存（服务器 v{conflict.serverRevision}）</Typography>
            <Typography color="text.secondary" fontSize={12}>
              你有未提交的本地修改。请逐项选择保留本地内容或采用服务器版本，不会覆盖对方的修改。
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 1.5 }}>
          共同一项请选择保留方；仅一方存在的内容会自动保留。合并后将按操作顺序重新提交。
        </Alert>
        <Stack spacing={1.2}>
          {conflict.diffs.map((diff) => (
            <Box key={diff.key} sx={{ border: '1px solid #e2dfda', borderRadius: 1.2, p: 1.3 }}>
              <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                <Typography fontWeight={800} fontSize={13}>{diff.label}</Typography>
                {diff.localOnly && <Chip size="small" label="仅本地" color="primary" variant="outlined" />}
                {diff.serverOnly && <Chip size="small" label="仅服务器" color="secondary" variant="outlined" />}
                {diff.bothChanged && <Chip size="small" label="双方均修改" color="warning" />}
              </Stack>
              <RadioGroup
                row
                value={resolutions[diff.key] ?? 'local'}
                onChange={(event) => setResolution(diff.key, event.target.value as Resolution)}
                sx={{ mt: 0.8 }}
              >
                <FormControlLabel
                  value="local"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography fontSize={12} fontWeight={700}>保留本地未提交</Typography>
                      <Typography fontSize={11} color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                        {diff.localValue}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start', mr: 3 }}
                />
                <FormControlLabel
                  value="server"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography fontSize={12} fontWeight={700}>采用服务器版本</Typography>
                      <Typography fontSize={11} color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                        {diff.serverValue}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: 'flex-start' }}
                />
              </RadioGroup>
            </Box>
          ))}
        </Stack>
        <Divider sx={{ my: 1.5 }} />
        <Typography color="text.secondary" fontSize={12}>
          合并方案：保留本地 {localCount} 项 · 采用服务器 {serverCount} 项
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleConfirm} variant="contained">
          合并并重新提交
        </Button>
      </DialogActions>
    </Dialog>
  )
}
