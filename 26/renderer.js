let currentFlows = [];
let selectedFlowKey = null;
let currentChartData = null;
let showAllPackets = false;
const MAX_PACKETS_RENDER = 5000;

window.pcapAPI.onParseProgress((data) => {
  updateProgress(data);
});

window.pcapAPI.onParseComplete(async () => {
  hideProgress();
  await loadAndShowStatistics();
  await handleRefreshPlugins();
});

function updateProgress(data) {
  const overlay = document.getElementById('progress-overlay');
  const bar = document.getElementById('progress-bar');
  const detail = document.getElementById('progress-detail');
  if (!overlay.classList.contains('active')) {
    overlay.classList.add('active');
  }
  bar.style.width = `${data.percent}%`;
  const mbProcessed = (data.bytesProcessed / 1024 / 1024).toFixed(1);
  const mbTotal = (data.totalBytes / 1024 / 1024).toFixed(1);
  detail.textContent = `${data.packetCount.toLocaleString()} packets · ${mbProcessed}/${mbTotal} MB`;
}

function hideProgress() {
  const overlay = document.getElementById('progress-overlay');
  overlay.classList.remove('active');
}

async function handleOpenFile() {
  const overlay = document.getElementById('progress-overlay');
  overlay.classList.add('active');
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-detail').textContent = 'Initializing...';

  const result = await window.pcapAPI.openFile();
  hideProgress();

  if (!result.success) {
    if (result.error !== 'No file selected') {
      alert('Error: ' + result.error);
    }
    return;
  }
  document.getElementById('stat-file').textContent = result.filePath.split(/[\\/]/).pop();
  document.getElementById('stat-packets').textContent = result.totalPackets.toLocaleString();
  document.getElementById('stat-flows').textContent = result.flowCount;
  currentFlows = result.flows;
  selectedFlowKey = null;
  showAllPackets = false;
  renderFlowList(currentFlows);
  clearChart();
  clearDetail();
  hideSamplingToggle();
}

function renderFlowList(flows) {
  const container = document.getElementById('flow-list');
  document.getElementById('flow-count-label').textContent = flows.length.toLocaleString();
  if (flows.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">No flows found</div>';
    return;
  }
  container.innerHTML = flows.map((f, idx) => {
    const isActive = f.key === selectedFlowKey;
    const protoClass = f.protocol === 'TCP' ? 'proto-tcp' : 'proto-udp';
    return `<div class="flow-item ${isActive ? 'active' : ''}" data-index="${idx}">
      <div class="flow-endpoints">
        ${f.srcIp}:${f.srcPort} <span class="arrow">&#x2194;</span> ${f.dstIp}:${f.dstPort}
      </div>
      <div class="flow-meta">
        <span class="proto-badge ${protoClass}">${f.protocol}</span>
        <span>${f.packetCount.toLocaleString()} pkts</span>
        <span>${f.duration < 1 ? f.duration.toFixed(6) : f.duration.toFixed(3)}s</span>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('flow-list').addEventListener('click', function(e) {
  const item = e.target.closest('.flow-item');
  if (!item) return;
  const idx = parseInt(item.dataset.index, 10);
  if (isNaN(idx) || !currentFlows[idx]) return;
  selectFlow(currentFlows[idx].key);
});

async function selectFlow(flowKey) {
  selectedFlowKey = flowKey;
  showAllPackets = false;

  const maxPackets = showAllPackets ? null : MAX_PACKETS_RENDER;
  const result = await window.pcapAPI.getFlowDetail(flowKey, maxPackets);
  if (!result.success) {
    alert('Error: ' + result.error);
    return;
  }

  renderFlowList(currentFlows);
  renderChart(result.flow);

  if (result.flow.isSampled) {
    showSamplingToggle(result.flow.packets.length, result.flow.actualPacketCount, result.flow.sampleRate);
  } else {
    hideSamplingToggle();
  }

  document.getElementById('btn-export-json').disabled = false;
  document.getElementById('btn-export-bin').disabled = false;
}

async function toggleSampling() {
  if (!selectedFlowKey) return;

  showAllPackets = !showAllPackets;
  const switchEl = document.getElementById('sampling-switch');
  if (showAllPackets) {
    switchEl.classList.add('on');
  } else {
    switchEl.classList.remove('on');
  }

  const maxPackets = showAllPackets ? null : MAX_PACKETS_RENDER;
  const result = await window.pcapAPI.getFlowDetail(selectedFlowKey, maxPackets);
  if (!result.success) {
    alert('Error: ' + result.error);
    return;
  }

  renderChart(result.flow);

  if (result.flow.isSampled) {
    showSamplingToggle(result.flow.packets.length, result.flow.actualPacketCount, result.flow.sampleRate);
  } else {
    hideSamplingToggle();
  }
}

function showSamplingToggle(sampledCount, totalCount, sampleRate) {
  const toggle = document.getElementById('sampling-toggle');
  document.getElementById('sampled-count').textContent = sampledCount.toLocaleString();
  document.getElementById('total-count').textContent = totalCount.toLocaleString();
  document.getElementById('sample-rate').textContent = sampleRate;
  toggle.classList.add('active');
  if (showAllPackets) {
    document.getElementById('sampling-switch').classList.add('on');
  } else {
    document.getElementById('sampling-switch').classList.remove('on');
  }
}

function hideSamplingToggle() {
  const toggle = document.getElementById('sampling-toggle');
  toggle.classList.remove('active');
}

function getPacketClass(pkt) {
  if (pkt.isDup) return 'dot-dup';
  if (pkt.isReorder) return 'dot-reorder';
  if (pkt.protocol === 'UDP') return 'dot-udp';
  if (pkt.tcpFlags) {
    if (pkt.tcpFlags.rst) return 'dot-rst';
    if (pkt.tcpFlags.fin) return 'dot-fin';
    if (pkt.tcpFlags.syn && !pkt.tcpFlags.ack) return 'dot-syn';
  }
  return 'dot-tcp';
}

function renderChart(flow) {
  const container = document.getElementById('chart-container');
  const emptyEl = document.getElementById('chart-empty');
  const legendEl = document.getElementById('chart-legend');

  emptyEl.style.display = 'none';
  legendEl.style.display = 'flex';

  const packets = flow.packets;
  if (!packets || packets.length === 0) {
    clearChart();
    return;
  }

  const startTime = flow.startTime;
  const points = packets.map(p => ({
    x: p.timestamp - startTime,
    y: p.capturedLength,
    payloadLength: p.payloadLength,
    packet: p
  }));

  currentChartData = { flow, points };

  d3.select('#chart-container svg').remove();

  const rect = container.getBoundingClientRect();
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = rect.width - margin.left - margin.right;
  const height = rect.height - margin.top - margin.bottom;

  const svg = d3.select('#chart-container')
    .append('svg')
    .attr('width', rect.width)
    .attr('height', rect.height);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const xExtent = d3.extent(points, d => d.x);
  const yExtent = d3.extent(points, d => d.y);
  if (xExtent[0] === xExtent[1]) { xExtent[0] -= 0.001; xExtent[1] += 0.001; }
  if (yExtent[0] === yExtent[1]) { yExtent[0] = 0; yExtent[1] += 1; }
  yExtent[0] = 0;

  const xScale = d3.scaleLinear().domain(xExtent).range([0, width]).nice();
  const yScale = d3.scaleLinear().domain(yExtent).range([height, 0]).nice();

  g.append('g')
    .attr('class', 'd3-grid')
    .call(d3.axisLeft(yScale).tickSize(-width).tickFormat(''));

  g.append('g')
    .attr('class', 'd3-grid')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(xScale).tickSize(-height).tickFormat(''));

  const xAxis = d3.axisBottom(xScale).ticks(Math.min(10, points.length));
  const yAxis = d3.axisLeft(yScale);

  g.append('g')
    .attr('class', 'd3-axis x-axis')
    .attr('transform', `translate(0,${height})`)
    .call(xAxis);

  g.append('text')
    .attr('class', 'x-axis-label')
    .attr('x', width / 2)
    .attr('y', height + 34)
    .attr('fill', '#94a3b8')
    .attr('text-anchor', 'middle')
    .style('font-size', '11px')
    .text('Time (seconds from flow start)');

  g.append('g')
    .attr('class', 'd3-axis y-axis')
    .call(yAxis);

  g.append('text')
    .attr('class', 'y-axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', -44)
    .attr('fill', '#94a3b8')
    .attr('text-anchor', 'middle')
    .style('font-size', '11px')
    .text('Packet Length (bytes)');

  const zoom = d3.zoom()
    .scaleExtent([1, 50])
    .translateExtent([[0, 0], [width, height]])
    .extent([[0, 0], [width, height]])
    .on('zoom', function(event) {
      const t = event.transform;
      const newX = t.rescaleX(xScale);
      const newY = t.rescaleY(yScale);

      g.selectAll('.dot')
        .attr('cx', d => newX(d.x))
        .attr('cy', d => newY(d.y));

      g.select('.x-axis').call(xAxis.scale(newX));
      g.select('.y-axis').call(yAxis.scale(newY));
    });

  svg.call(zoom);

  const dotSize = points.length > 1000 ? 2.5 : 4;
  g.selectAll('.dot')
    .data(points)
    .enter()
    .append('circle')
    .attr('class', d => 'dot ' + getPacketClass(d.packet))
    .attr('cx', d => xScale(d.x))
    .attr('cy', d => yScale(d.y))
    .attr('r', d => d.packet.isDup ? 6 : dotSize)
    .attr('opacity', d => d.packet.isDup ? 0.9 : 0.75)
    .style('cursor', 'pointer')
    .style('stroke', d => d.packet.isDup ? '#f59e0b' : 'transparent')
    .style('stroke-width', d => d.packet.isDup ? 2 : 0)
    .on('mouseenter', function(event, d) {
      d3.select(this).attr('r', d.packet.isDup ? 8 : 7).attr('opacity', 1);
      showTooltip(event, d);
    })
    .on('mouseleave', function(event, d) {
      d3.select(this).attr('r', d.packet.isDup ? 6 : dotSize).attr('opacity', d.packet.isDup ? 0.9 : 0.75);
      hideTooltip();
    })
    .on('click', function(event, d) {
      showPacketDetail(d.packet, flow);
    });

  svg.append('text')
    .attr('x', margin.left + width / 2)
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('fill', '#f1f5f9')
    .style('font-size', '13px')
    .style('font-weight', '600')
    .text(`${flow.srcIp}:${flow.srcPort} \u2194 ${flow.dstIp}:${flow.dstPort} [${flow.protocol}] - ${flow.packetCount.toLocaleString()} packets`);
}

function showTooltip(event, d) {
  const tooltip = document.getElementById('chart-tooltip');
  const pkt = d.packet;
  const flags = pkt.tcpFlags ? Object.entries(pkt.tcpFlags).filter(([,v]) => v).map(([k]) => k.toUpperCase()).join(', ') : 'N/A';
  const markers = [];
  if (pkt.isDup) markers.push('<span style="color:#f59e0b">DUP</span>');
  if (pkt.isReorder) markers.push('<span style="color:#a855f7">REORDER</span>');
  const markerText = markers.length ? `[${markers.join(' ')}] ` : '';
  tooltip.innerHTML = `
    <div style="margin-bottom:4px;">${markerText}<strong>Time:</strong> ${d.x.toFixed(6)}s</div>
    <div style="margin-bottom:4px;"><strong>Length:</strong> ${pkt.capturedLength} bytes</div>
    <div style="margin-bottom:4px;"><strong>Payload:</strong> ${pkt.payloadLength} bytes</div>
    <div><strong>Flags:</strong> ${flags}</div>
  `;
  tooltip.style.display = 'block';
  const rect = document.getElementById('chart-container').getBoundingClientRect();
  let left = event.clientX - rect.left + 12;
  let top = event.clientY - rect.top - 10;
  if (left + 250 > rect.width) left = left - 260;
  if (top + 100 > rect.height) top = top - 100;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function hideTooltip() {
  document.getElementById('chart-tooltip').style.display = 'none';
}

function showPacketDetail(pkt, flow) {
  const content = document.getElementById('detail-content');
  const flagsHtml = pkt.tcpFlags ? Object.entries(pkt.tcpFlags).map(([k, v]) =>
    `<span class="flag-badge ${v ? 'flag-on' : 'flag-off'}">${k}</span>`
  ).join('') : '<span style="color:var(--text-muted)">N/A (UDP)</span>';

  const markers = [];
  if (pkt.isDup) markers.push('<span class="flag-badge flag-on" style="background:rgba(245,158,11,0.2);color:#fbbf24;">DUP</span>');
  if (pkt.isReorder) markers.push('<span class="flag-badge flag-on" style="background:rgba(168,85,247,0.2);color:#c084fc;">REORDER</span>');
  const markersHtml = markers.length ? `<div class="detail-field"><span class="label">Markers: </span><span class="value"><div class="flags-display">${markers.join('')}</div></span></div>` : '';

  const hexStr = pkt.hexPreview || '';
  let hexDisplay = '';
  for (let i = 0; i < hexStr.length; i += 2) {
    if (i > 0 && i % 32 === 0) hexDisplay += '<br>';
    else if (i > 0 && i % 8 === 0) hexDisplay += '<span class="hex-separator"> </span>';
    hexDisplay += `<span class="hex-byte">${hexStr.substr(i, 2)}</span>`;
  }

  const relTime = flow ? (pkt.timestamp - flow.startTime).toFixed(6) : pkt.timestamp.toFixed(6);

  content.innerHTML = `
    <div class="detail-header">
      <h3>Packet Detail</h3>
      <span style="font-size:11px;color:var(--text-muted);">${pkt.protocol} #${flow ? flow.packets.indexOf(pkt) + 1 : '?'}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-field"><span class="label">Source: </span><span class="value">${pkt.srcIp}:${pkt.srcPort}</span></div>
      <div class="detail-field"><span class="label">Destination: </span><span class="value">${pkt.dstIp}:${pkt.dstPort}</span></div>
      <div class="detail-field"><span class="label">Protocol: </span><span class="value">${pkt.protocol}</span></div>
      <div class="detail-field"><span class="label">Captured Length: </span><span class="value">${pkt.capturedLength} bytes</span></div>
      <div class="detail-field"><span class="label">Original Length: </span><span class="value">${pkt.originalLength} bytes</span></div>
      <div class="detail-field"><span class="label">Payload Length: </span><span class="value">${pkt.payloadLength} bytes</span></div>
      <div class="detail-field"><span class="label">Relative Time: </span><span class="value">${relTime}s</span></div>
      <div class="detail-field"><span class="label">Timestamp: </span><span class="value">${pkt.timestamp.toFixed(6)}</span></div>
      ${pkt.tcpSeq !== undefined ? `<div class="detail-field"><span class="label">TCP Seq: </span><span class="value">${pkt.tcpSeq}</span></div>` : ''}
      ${pkt.tcpAck !== undefined ? `<div class="detail-field"><span class="label">TCP Ack: </span><span class="value">${pkt.tcpAck}</span></div>` : ''}
      <div class="detail-field"><span class="label">Direction: </span><span class="value">${pkt.direction === 0 ? 'Client \u2192 Server' : 'Server \u2192 Client'}</span></div>
      ${markersHtml}
      <div class="detail-field" style="grid-column:1/-1;"><span class="label">Flags: </span><span class="value"><div class="flags-display">${flagsHtml}</div></span></div>
    </div>
    <div style="margin-top:10px;">
      <span style="font-size:11px;color:var(--text-muted);">Raw Hex (first 64 bytes):</span>
      <div class="hex-view">${hexDisplay}</div>
    </div>
    ${renderAppLayerData(pkt.appLayerData)}
  `;
}

function clearChart() {
  d3.select('#chart-container svg').remove();
  document.getElementById('chart-empty').style.display = 'flex';
  document.getElementById('chart-legend').style.display = 'none';
  document.getElementById('chart-tooltip').style.display = 'none';
}

function clearDetail() {
  document.getElementById('detail-content').innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Click a packet on the chart to view details</p>';
}

function getFilterValues() {
  return {
    ip: document.getElementById('filter-ip').value.trim(),
    port: document.getElementById('filter-port').value.trim(),
    protocol: document.getElementById('filter-protocol').value,
    minLength: document.getElementById('filter-min-len').value.trim(),
    maxLength: document.getElementById('filter-max-len').value.trim(),
    timeStart: document.getElementById('filter-time-start').value.trim(),
    timeEnd: document.getElementById('filter-time-end').value.trim()
  };
}

async function applyFilters() {
  const filters = getFilterValues();
  const result = await window.pcapAPI.getFlows(filters);
  if (!result.success) {
    alert('Error: ' + result.error);
    return;
  }
  currentFlows = result.flows;
  selectedFlowKey = null;
  showAllPackets = false;
  renderFlowList(currentFlows);
  clearChart();
  clearDetail();
  hideSamplingToggle();
  document.getElementById('stat-packets').textContent = result.totalPackets.toLocaleString();
  document.getElementById('stat-flows').textContent = result.flowCount;
  document.getElementById('btn-export-json').disabled = true;
  document.getElementById('btn-export-bin').disabled = true;
}

function clearFilters() {
  document.getElementById('filter-ip').value = '';
  document.getElementById('filter-port').value = '';
  document.getElementById('filter-protocol').value = '';
  document.getElementById('filter-min-len').value = '';
  document.getElementById('filter-max-len').value = '';
  document.getElementById('filter-time-start').value = '';
  document.getElementById('filter-time-end').value = '';
  applyFilters();
}

async function handleExportJSON() {
  if (!selectedFlowKey) return;
  const result = await window.pcapAPI.exportFlowJSON(selectedFlowKey);
  if (result.success) {
    showNotification('JSON exported to ' + result.filePath);
  }
}

async function handleExportBinary() {
  if (!selectedFlowKey) return;
  const result = await window.pcapAPI.exportFlowBinary(selectedFlowKey);
  if (result.success) {
    showNotification('Binary exported to ' + result.filePath);
  }
}

function showNotification(msg) {
  const notif = document.createElement('div');
  notif.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#22c55e;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:fadeIn 0.3s;max-width:400px;';
  notif.textContent = msg;
  document.body.appendChild(notif);
  setTimeout(() => { notif.style.opacity = '0'; notif.style.transition = 'opacity 0.3s'; setTimeout(() => notif.remove(), 300); }, 3000);
}

window.addEventListener('resize', () => {
  if (currentChartData) {
    renderChart(currentChartData.flow);
  }
});

document.querySelectorAll('.filter-input').forEach(input => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFilters();
  });
});

window.addEventListener('DOMContentLoaded', async () => {
  await handleRefreshPlugins();
});

let currentStatistics = null;

function switchRightPanel(tab) {
  document.querySelectorAll('.right-panel-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('panel-stats').style.display = tab === 'stats' ? 'block' : 'none';
  document.getElementById('panel-plugins').style.display = tab === 'plugins' ? 'block' : 'none';

  if (tab === 'stats' && currentStatistics) {
    renderStatistics(currentStatistics);
  }
  if (tab === 'plugins') {
    handleRefreshPlugins();
  }
}

async function handleLoadPlugin() {
  const result = await window.pcapAPI.openPluginFile();
  if (!result.success) return;
  const loadResult = await window.pcapAPI.loadPlugin(result.filePath);
  if (loadResult.success) {
    showNotification('Plugin loaded: ' + loadResult.plugin.name);
    handleRefreshPlugins();
  } else {
    alert('Failed to load plugin: ' + loadResult.error);
  }
}

async function handleRefreshPlugins() {
  const result = await window.pcapAPI.listPlugins();
  if (result.success) {
    renderPluginList(result.plugins);
  }
}

async function togglePlugin(pluginId, enabled) {
  const result = await window.pcapAPI.setPluginEnabled(pluginId, enabled);
  if (result.success) {
    handleRefreshPlugins();
  }
}

async function removePlugin(pluginId) {
  if (!confirm('Are you sure you want to unload this plugin?')) return;
  const result = await window.pcapAPI.unloadPlugin(pluginId);
  if (result.success) {
    showNotification('Plugin unloaded');
    handleRefreshPlugins();
  } else {
    alert('Failed to unload plugin: ' + result.error);
  }
}

function renderPluginList(plugins) {
  const container = document.getElementById('plugins-list');
  if (plugins.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:30px 10px;">No plugins loaded</div>';
    return;
  }

  container.innerHTML = plugins.map(p => `
    <div class="plugin-item">
      <div class="plugin-header">
        <div class="plugin-name">${p.name}</div>
        <div class="plugin-actions">
          <div class="plugin-switch ${p.enabled ? 'on' : ''}" onclick="togglePlugin('${p.id}', ${!p.enabled})"></div>
          <button class="plugin-btn danger" onclick="removePlugin('${p.id}')">Unload</button>
        </div>
      </div>
      <div class="plugin-description">${p.description || 'No description'}</div>
      <div class="plugin-meta">
        <span>v${p.version}</span>
        ${p.author ? `<span>by ${p.author}</span>` : ''}
        ${p.ports && p.ports.length > 0 ? `<span>Ports: ${p.ports.join(', ')}</span>` : ''}
        ${p.protocols ? `<span>${p.protocols.join(', ')}</span>` : ''}
      </div>
    </div>
  `).join('');
}

async function loadAndShowStatistics() {
  const result = await window.pcapAPI.getStatistics();
  if (result.success) {
    currentStatistics = result.statistics;
    renderStatistics(result.statistics);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function renderStatistics(stats) {
  const container = document.getElementById('panel-stats');
  if (!stats) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:30px 10px;">No statistics available</div>';
    return;
  }

  const retransClass = stats.tcpStats.retransmissionRate > 5 ? 'danger' : stats.tcpStats.retransmissionRate > 1 ? 'warning' : '';

  container.innerHTML = `
    <div class="stats-section">
      <h4>Capture Summary</h4>
      <div class="stats-card">
        <div class="stats-row"><span class="stats-label">Total Packets</span><span class="stats-value">${stats.totalPackets.toLocaleString()}</span></div>
        <div class="stats-row"><span class="stats-label">Total Bytes</span><span class="stats-value">${formatBytes(stats.totalBytes)}</span></div>
        <div class="stats-row"><span class="stats-label">Duration</span><span class="stats-value">${stats.duration.toFixed(3)}s</span></div>
        <div class="stats-row"><span class="stats-label">IPv4 / IPv6</span><span class="stats-value">${stats.ipv4Count.toLocaleString()} / ${stats.ipv6Count.toLocaleString()}</span></div>
        <div class="stats-row"><span class="stats-label">TCP Packets</span><span class="stats-value">${stats.tcpStats.totalPackets.toLocaleString()}</span></div>
        <div class="stats-row"><span class="stats-label">UDP Packets</span><span class="stats-value">${stats.udpStats.totalPackets.toLocaleString()}</span></div>
      </div>
    </div>

    <div class="stats-section">
      <h4>Protocol Distribution</h4>
      <div class="stats-chart-container" id="pie-chart-container"></div>
    </div>

    <div class="stats-section">
      <h4>Traffic Rate (kbps) by Minute</h4>
      <div class="stats-chart-container" id="bar-chart-container"></div>
    </div>

    <div class="stats-section">
      <h4>TCP Reliability</h4>
      <div class="stats-card">
        <div class="stats-row"><span class="stats-label">Retransmission Rate</span><span class="stats-value ${retransClass}">${stats.tcpStats.retransmissionRate}%</span></div>
        <div class="stats-row"><span class="stats-label">Duplicate Packets</span><span class="stats-value ${stats.tcpStats.dupPackets > 0 ? 'warning' : ''}">${stats.tcpStats.dupPackets.toLocaleString()}</span></div>
        <div class="stats-row"><span class="stats-label">Out-of-Order Packets</span><span class="stats-value ${stats.tcpStats.reorderPackets > 0 ? 'warning' : ''}">${stats.tcpStats.reorderPackets.toLocaleString()}</span></div>
      </div>
    </div>

    <div class="stats-section">
      <h4>TCP Flag Counts</h4>
      <div class="flag-grid">
        <div class="flag-item"><span class="flag-name">SYN</span><span class="flag-count">${stats.tcpFlags.syn.toLocaleString()}</span></div>
        <div class="flag-item"><span class="flag-name">SYN-ACK</span><span class="flag-count">${stats.tcpFlags.synAck.toLocaleString()}</span></div>
        <div class="flag-item"><span class="flag-name">FIN</span><span class="flag-count">${stats.tcpFlags.fin.toLocaleString()}</span></div>
        <div class="flag-item"><span class="flag-name">RST</span><span class="flag-count" style="color:var(--danger);">${stats.tcpFlags.rst.toLocaleString()}</span></div>
        <div class="flag-item"><span class="flag-name">ACK</span><span class="flag-count">${stats.tcpFlags.ack.toLocaleString()}</span></div>
        <div class="flag-item"><span class="flag-name">PSH</span><span class="flag-count">${stats.tcpFlags.psh.toLocaleString()}</span></div>
        <div class="flag-item"><span class="flag-name">URG</span><span class="flag-count">${stats.tcpFlags.urg.toLocaleString()}</span></div>
      </div>
    </div>
  `;

  renderProtocolPieChart(stats.protocolDistribution);
  renderTrafficBarChart(stats.trafficTimeline);
}

function renderProtocolPieChart(data) {
  const container = d3.select('#pie-chart-container');
  container.selectAll('svg').remove();

  const width = 320;
  const height = 180;
  const radius = Math.min(width, height) / 2;

  const svg = container.append('svg')
    .attr('width', width)
    .attr('height', height);

  const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);

  const color = d3.scaleOrdinal()
    .domain(data.map(d => d.protocol))
    .range(['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1']);

  const pie = d3.pie().value(d => d.bytes).sort(null);
  const arc = d3.arc().innerRadius(radius * 0.4).outerRadius(radius - 2);

  const arcs = g.selectAll('.arc')
    .data(pie(data))
    .enter().append('g')
    .attr('class', 'arc');

  arcs.append('path')
    .attr('d', arc)
    .attr('fill', d => color(d.data.protocol))
    .attr('opacity', 0.8)
    .append('title')
    .text(d => `${d.data.protocol}: ${formatBytes(d.data.bytes)} (${d.data.percentage}%)`);

  arcs.append('text')
    .attr('transform', d => `translate(${arc.centroid(d)})`)
    .attr('text-anchor', 'middle')
    .attr('fill', '#fff')
    .style('font-size', '10px')
    .style('font-weight', '600')
    .style('text-shadow', '0 0 2px rgba(0,0,0,0.8)')
    .text(d => d.data.percentage > 3 ? d.data.protocol : '');

  const legend = svg.append('g')
    .attr('transform', `translate(${width - 90}, 10)`);

  const legendItems = legend.selectAll('.legend-item')
    .data(data.slice(0, 5))
    .enter().append('g')
    .attr('transform', (d, i) => `translate(0,${i * 16})`);

  legendItems.append('rect')
    .attr('width', 10).attr('height', 10)
    .attr('fill', d => color(d.protocol));

  legendItems.append('text')
    .attr('x', 14).attr('y', 9)
    .attr('fill', '#94a3b8')
    .style('font-size', '10px')
    .text(d => `${d.protocol} (${d.percentage}%)`);
}

function renderTrafficBarChart(data) {
  const container = d3.select('#bar-chart-container');
  container.selectAll('svg').remove();

  const width = 320;
  const height = 160;
  const margin = { top: 10, right: 10, bottom: 25, left: 40 };

  const svg = container.append('svg')
    .attr('width', width)
    .attr('height', height);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const xScale = d3.scaleBand()
    .domain(data.map(d => d.relativeTime))
    .range([0, chartWidth])
    .padding(0.2);

  const yMax = d3.max(data, d => d.kbps);
  const yScale = d3.scaleLinear()
    .domain([0, yMax || 1])
    .range([chartHeight, 0])
    .nice();

  g.selectAll('.bar')
    .data(data)
    .enter().append('rect')
    .attr('class', 'bar')
    .attr('x', d => xScale(d.relativeTime))
    .attr('y', d => yScale(d.kbps))
    .attr('width', xScale.bandwidth())
    .attr('height', d => chartHeight - yScale(d.kbps))
    .attr('fill', '#3b82f6')
    .attr('opacity', 0.7)
    .append('title')
    .text(d => `Minute ${d.relativeTime}s: ${d.kbps.toFixed(1)} kbps, ${d.packets} packets`);

  g.append('g')
    .attr('transform', `translate(0,${chartHeight})`)
    .call(d3.axisBottom(xScale).tickValues(xScale.domain().filter((_, i, arr) => arr.length <= 8 ? true : i % Math.ceil(arr.length / 8) === 0)))
    .selectAll('text')
    .attr('fill', '#64748b')
    .style('font-size', '9px');

  g.append('g')
    .call(d3.axisLeft(yScale).ticks(4))
    .selectAll('text')
    .attr('fill', '#64748b')
    .style('font-size', '9px');

  g.selectAll('.domain, .tick line').attr('stroke', '#334155');
}

function renderAppLayerData(appData) {
  if (!appData) return '';

  let html = '';
  for (const [pluginId, data] of Object.entries(appData)) {
    if (data.error) {
      html += `
        <div style="margin-bottom:10px;">
          <h4 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--danger);margin-bottom:6px;">
            ${data.pluginName} (Error)
          </h4>
          <div style="font-size:11px;color:var(--text-secondary);">${data.error}</div>
        </div>
      `;
      continue;
    }

    const entries = Object.entries(data).filter(([k]) => !['pluginName', 'pluginVersion', 'protocol'].includes(k));
    const rows = entries.map(([key, val]) => {
      const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `<div class="row"><span class="key">${key}:</span> <span class="value">${displayVal}</span></div>`;
    }).join('');

    html += `
      <div class="app-layer-section">
        <h4>${data.pluginName || pluginId} ${data.protocol ? `(${data.protocol})` : ''}</h4>
        <div class="app-layer-data">${rows}</div>
      </div>
    `;
  }
  return html;
}
