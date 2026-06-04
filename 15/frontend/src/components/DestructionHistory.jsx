import React, { useRef, useEffect } from 'react';
import {
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Typography,
  Box,
  Divider,
  Chip
} from '@mui/material';
import {
  BrokenImage as BrokenIcon,
  LocationOn as LocationIcon,
  Bolt as ForceIcon
} from '@mui/icons-material';

function DestructionHistory({ records }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [records]);

  if (!records || records.length === 0) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" py={6}>
        <BrokenIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
        <Typography variant="body1" color="text.secondary">
          暂无破坏记录
        </Typography>
        <Typography variant="caption" color="text.disabled">
          等待风场作用于体素场景...
        </Typography>
      </Box>
    );
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--:--';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const getForceColor = (force) => {
    if (force < 50) return 'success';
    if (force < 100) return 'warning';
    return 'error';
  };

  return (
    <Box
      ref={listRef}
      sx={{
        maxHeight: 400,
        overflowY: 'auto',
        '&::-webkit-scrollbar': {
          width: 6,
        },
        '&::-webkit-scrollbar-track': {
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 3,
        },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(255,255,255,0.2)',
          borderRadius: 3,
        },
      }}
    >
      <List dense>
        {records.slice(0, 50).map((record, index) => (
          <React.Fragment key={record.id || index}>
            <ListItem
              alignItems="flex-start"
              sx={{
                py: 1.5,
                borderRadius: 1,
                transition: 'background 0.2s',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }
              }}
            >
              <ListItemAvatar sx={{ minWidth: 40 }}>
                <Avatar
                  sx={{
                    bgcolor: 'error.main',
                    width: 32,
                    height: 32
                  }}
                >
                  <BrokenIcon sx={{ fontSize: 18 }} />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" fontWeight="bold">
                      体素破坏
                    </Typography>
                    <Chip
                      size="small"
                      label={`${record.force?.toFixed(1) || '0'} 力`}
                      color={getForceColor(record.force)}
                      sx={{ height: 20, '& .MuiChip-label': { px: 1, fontSize: 10 } }}
                    />
                  </Box>
                }
                secondary={
                  <Box mt={0.5}>
                    <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                      <LocationIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                      <Typography variant="caption" color="text.secondary">
                        位置: ({record.voxelX}, {record.voxelY}, {record.voxelZ})
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <ForceIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                      <Typography variant="caption" color="text.secondary">
                        强度: {record.strength?.toFixed(1) || '0'} | 时间: {formatTime(record.destroyedAt || record.timestamp)}
                      </Typography>
                    </Box>
                  </Box>
                }
              />
            </ListItem>
            {index < records.length - 1 && index < 49 && (
              <Divider variant="inset" component="li" sx={{ ml: 5 }} />
            )}
          </React.Fragment>
        ))}
      </List>
      {records.length > 50 && (
        <Box py={2} textAlign="center">
          <Typography variant="caption" color="text.secondary">
            还有 {records.length - 50} 条历史记录
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default DestructionHistory;
