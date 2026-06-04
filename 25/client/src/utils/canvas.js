export function drawNode(ctx, node, options = {}) {
  const { selected, heatLevel = 0, isStart = false, highlightType } = options;
  const { x, y, width = 220, height = 80, title = '', content = '' } = node;

  ctx.save();

  let highlightColors = {
    added: { fill: 'rgba(46, 204, 113, 0.3)', stroke: '#2ecc71', glow: '#2ecc71', label: '✓ ADDED' },
    removed: { fill: 'rgba(231, 76, 60, 0.3)', stroke: '#e74c3c', glow: '#e74c3c', label: '✗ REMOVED' },
    updated: { fill: 'rgba(241, 196, 15, 0.3)', stroke: '#f1c40f', glow: '#f1c40f', label: '↻ UPDATED' },
  };

  const baseR = 12;
  const baseG = 20;
  const baseB = 38;
  const heatR = 255;
  const heatG = 80;
  const heatB = 30;

  const t = Math.min(heatLevel, 1);
  const r = Math.round(baseR + (heatR - baseR) * t);
  const g = Math.round(baseG + (heatG - baseG) * t);
  const b = Math.round(baseB + (heatB - baseB) * t);

  let fillStyle = `rgb(${r},${g},${b})`;
  let strokeStyle = selected ? '#6c5ce7' : isStart ? '#00cec9' : '#4a5568';
  let lineWidth = selected ? 3 : isStart ? 2.5 : 1.5;

  if (highlightType && highlightColors[highlightType]) {
    const colors = highlightColors[highlightType];
    fillStyle = colors.fill;
    strokeStyle = colors.stroke;
    lineWidth = 2.5;
  }

  if (highlightType) {
    ctx.shadowColor = highlightColors[highlightType]?.glow || 'transparent';
    ctx.shadowBlur = 12;
  }

  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;

  roundRect(ctx, x, y, width, height, 10);
  ctx.fill();
  ctx.stroke();

  if (isStart) {
    ctx.strokeStyle = '#00cec9';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    roundRect(ctx, x - 4, y - 4, width + 8, height + 8, 12);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 14px "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const titleText = title.length > 18 ? title.slice(0, 18) + '…' : title;
  ctx.fillText(titleText, x + 12, y + 10);

  ctx.fillStyle = '#a0aec0';
  ctx.font = '12px "Segoe UI", sans-serif';
  const contentText =
    content.length > 24 ? content.slice(0, 24) + '…' : content;
  ctx.fillText(contentText, x + 12, y + 32);

  if (isStart) {
    ctx.fillStyle = '#00cec9';
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('START', x + width - 10, y + 10);
  }

  if (heatLevel > 0) {
    ctx.fillStyle = 'rgba(255,200,0,0.8)';
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`🔥 ${Math.round(heatLevel * 100)}%`, x + width - 8, y + height - 6);
  }

  if (highlightType) {
    const colors = { added: '#2ecc71', removed: '#e74c3c', updated: '#f1c40f' };
    const labels = { added: '✓ NEW', removed: '✗ DEL', updated: '↻ UPD' };
    ctx.fillStyle = colors[highlightType] || '#fff';
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(labels[highlightType] || '', x + 10, y + height - 8);
  }

  ctx.restore();
}

export function drawEdge(ctx, edge, nodes, options = {}) {
  const { selected = false, heatLevel = 0, isPath = false, highlightType } = options;
  const fromNode = nodes[edge.from];
  const toNode = nodes[edge.to];
  if (!fromNode || !toNode) return;

  const fromCx = fromNode.x + (fromNode.width || 220) / 2;
  const fromCy = fromNode.y + (fromNode.height || 80) / 2;
  const toCx = toNode.x + (toNode.width || 220) / 2;
  const toCy = toNode.y + (toNode.height || 80) / 2;

  const dx = toCx - fromCx;
  const dy = toCy - fromCy;
  const fromPortX = fromNode.x + (fromNode.width || 220) / 2 + (dx > 0 ? (fromNode.width || 220) / 2 : -(fromNode.width || 220) / 2);
  const fromPortY = fromNode.y + (fromNode.height || 80) / 2;
  const toPortX = toNode.x + (toNode.width || 220) / 2 - (dx > 0 ? (toNode.width || 220) / 2 : -(toNode.width || 220) / 2);
  const toPortY = toNode.y + (toNode.height || 80) / 2;

  const midX = (fromPortX + toPortX) / 2;
  const cpOffset = Math.abs(dy) * 0.3 + 30;

  ctx.save();

  const highlightColors = {
    added: { stroke: '#2ecc71', width: 3 },
    removed: { stroke: '#e74c3c', width: 3 },
    updated: { stroke: '#f1c40f', width: 3 },
  };

  if (highlightType && highlightColors[highlightType]) {
    ctx.strokeStyle = highlightColors[highlightType].stroke;
    ctx.lineWidth = highlightColors[highlightType].width;
    ctx.shadowColor = highlightColors[highlightType].stroke;
    ctx.shadowBlur = 8;
  } else if (heatLevel > 0) {
    const t = Math.min(heatLevel, 1);
    const r = Math.round(74 + (255 - 74) * t);
    const g = Math.round(85 + (80 - 85) * t);
    const b = Math.round(104 + (30 - 104) * t);
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 2 + t * 3;
  } else if (isPath) {
    ctx.strokeStyle = '#00cec9';
    ctx.lineWidth = 3;
  } else if (selected) {
    ctx.strokeStyle = '#6c5ce7';
    ctx.lineWidth = 2.5;
  } else {
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1.5;
  }

  ctx.beginPath();
  ctx.moveTo(fromPortX, fromPortY);
  ctx.bezierCurveTo(
    fromPortX + (dx > 0 ? cpOffset : -cpOffset),
    fromPortY,
    toPortX - (dx > 0 ? cpOffset : -cpOffset),
    toPortY,
    toPortX,
    toPortY
  );
  ctx.stroke();

  const angle = Math.atan2(toPortY - fromPortY, toPortX - fromPortX);
  const arrowLen = 10;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(toPortX, toPortY);
  ctx.lineTo(
    toPortX - arrowLen * Math.cos(angle - 0.3),
    toPortY - arrowLen * Math.sin(angle - 0.3)
  );
  ctx.lineTo(
    toPortX - arrowLen * Math.cos(angle + 0.3),
    toPortY - arrowLen * Math.sin(angle + 0.3)
  );
  ctx.closePath();
  ctx.fill();

  if (edge.label) {
    const labelX = midX;
    const labelY = (fromPortY + toPortY) / 2 - 8;
    ctx.fillStyle = '#1a202c';
    const metrics = ctx.measureText(edge.label);
    const padding = 6;
    roundRect(
      ctx,
      labelX - metrics.width / 2 - padding,
      labelY - 8 - padding / 2,
      metrics.width + padding * 2,
      16 + padding,
      4
    );
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(edge.label, labelX, labelY);
  }

  ctx.restore();
}

export function drawCursor(ctx, cursor, userName, color) {
  const { x, y } = cursor;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 18);
  ctx.lineTo(x + 6, y + 14);
  ctx.lineTo(x + 12, y + 14);
  ctx.closePath();
  ctx.fill();

  ctx.font = 'bold 11px "Segoe UI", sans-serif';
  const textWidth = ctx.measureText(userName || '?').width;
  ctx.fillStyle = color;
  roundRect(ctx, x + 12, y + 10, textWidth + 8, 18, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(userName || '?', x + 16, y + 19);

  ctx.restore();
}

export function drawGrid(ctx, width, height, offsetX, offsetY, cellSize = 30) {
  ctx.save();
  ctx.strokeStyle = '#1e2a3a';
  ctx.lineWidth = 0.5;
  const startX = offsetX % cellSize;
  const startY = offsetY % cellSize;
  for (let x = startX; x < width; x += cellSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = startY; y < height; y += cellSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function hitTestNode(nodes, worldX, worldY) {
  for (const node of Object.values(nodes)) {
    const { x, y, width = 220, height = 80 } = node;
    if (worldX >= x && worldX <= x + width && worldY >= y && worldY <= y + height) {
      return node;
    }
  }
  return null;
}

export function hitTestNodePort(nodes, worldX, worldY, portRadius = 10) {
  for (const node of Object.values(nodes)) {
    const { x, y, width = 220, height = 80 } = node;
    const portX = x + width;
    const portY = y + height / 2;
    const dist = Math.sqrt((worldX - portX) ** 2 + (worldY - portY) ** 2);
    if (dist <= portRadius) {
      return { node, portX, portY, side: 'right' };
    }
    const leftPortX = x;
    const leftDist = Math.sqrt((worldX - leftPortX) ** 2 + (worldY - portY) ** 2);
    if (leftDist <= portRadius) {
      return { node, portX: leftPortX, portY, side: 'left' };
    }
  }
  return null;
}
