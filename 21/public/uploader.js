const CHUNK_SIZE = 1024 * 1024;
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const PROBE_PACKET_COUNT = 10;
const PROBE_PACKET_SIZE = 1024;
const PROBE_TIMEOUT = 500;

const socket = io();
let selectedFile = null;
let fileMd5 = null;
let sessionCode = null;
let peerConnection = null;
let dataChannel = null;
let useRelay = false;
let selectedChannel = null;
let chunks = [];
let totalChunks = 0;
let sentChunks = new Set();
let acknowledgedChunks = new Set();
let currentChunkIndex = 0;
let isTransferring = false;
const RELAY_WINDOW_SIZE = 10;
let relayUnackedCount = 0;

let transferStats = {
  startTime: 0,
  bytesTransferred: 0,
  lastUpdateTime: 0,
  lastBytesTransferred: 0,
  currentSpeed: 0,
  smoothedSpeed: 0
};

let probeResults = {
  webrtc: { rtts: [], packetLoss: 0, score: 0, successful: false },
  relay: { rtts: [], packetLoss: 0, score: 0, successful: false }
};

let probeState = {
  currentProbeId: 0,
  webrtcSent: 0,
  webrtcAcked: 0,
  relaySent: 0,
  relayAcked: 0,
  webrtcProbes: new Map(),
  relayProbes: new Map(),
  isProbing: false
};

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const createSessionBtn = document.getElementById('createSessionBtn');
const sessionCodeDiv = document.getElementById('sessionCode');
const codeDisplay = document.getElementById('codeDisplay');
const copyBtn = document.getElementById('copyBtn');
const statusDiv = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const md5Calculating = document.getElementById('md5Calculating');
const qualityPanel = document.getElementById('qualityPanel');
const channelBadge = document.getElementById('channelBadge');
const speedValue = document.getElementById('speedValue');
const rttValue = document.getElementById('rttValue');
const lossValue = document.getElementById('lossValue');
const scoreCircle = document.getElementById('scoreCircle');
const scoreValue = document.getElementById('scoreValue');
const probingStatus = document.getElementById('probingStatus');
const probingText = document.getElementById('probingText');
const probeProgress = document.getElementById('probeProgress');

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFileSelect(files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

createSessionBtn.addEventListener('click', createSession);

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(sessionCode);
  copyBtn.textContent = '已复制!';
  setTimeout(() => copyBtn.textContent = '复制', 2000);
});

function handleFileSelect(file) {
  if (file.size > MAX_FILE_SIZE) {
    alert('文件大小不能超过 500MB');
    return;
  }
  
  selectedFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileInfo.classList.add('show');
  createSessionBtn.disabled = true;
  
  calculateMD5(file);
}

function calculateMD5(file) {
  md5Calculating.classList.add('show');
  const chunkSize = 2097152;
  const chunks = Math.ceil(file.size / chunkSize);
  let currentChunk = 0;
  const spark = new SparkMD5.ArrayBuffer();
  const fileReader = new FileReader();

  fileReader.onload = (e) => {
    spark.append(e.target.result);
    currentChunk++;
    if (currentChunk < chunks) {
      loadNext();
    } else {
      fileMd5 = spark.end();
      md5Calculating.classList.remove('show');
      createSessionBtn.disabled = false;
    }
  };

  fileReader.onerror = () => {
    md5Calculating.classList.remove('show');
    alert('MD5计算失败');
  };

  function loadNext() {
    const start = currentChunk * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    fileReader.readAsArrayBuffer(file.slice(start, end));
  }

  loadNext();
}

async function createSession() {
  totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
  
  socket.emit('create-session', {
    fileName: selectedFile.name,
    fileSize: selectedFile.size,
    fileMd5: fileMd5,
    totalChunks: totalChunks
  }, (response) => {
    if (response.success) {
      sessionCode = response.code;
      codeDisplay.textContent = sessionCode;
      sessionCodeDiv.classList.add('show');
      createSessionBtn.classList.remove('show');
      
      showStatus('waiting', '等待下载者加入...');
      setupSocketHandlers();
    }
  });
}

function setupSocketHandlers() {
  socket.on('downloader-connected', async (data) => {
    showStatus('connected', '下载者已连接，正在建立P2P连接...');
    await setupWebRTC();
  });

  socket.on('downloader-disconnected', () => {
    showStatus('error', '下载者已断开连接');
    isTransferring = false;
  });

  socket.on('webrtc-answer', async (data) => {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });

  socket.on('webrtc-ice-candidate', async (data) => {
    if (peerConnection && data.candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  });

  socket.on('channel-selected', (data) => {
    selectedChannel = data.channel;
    useRelay = (data.channel === 'relay');
    updateChannelBadge(data.channel);
  });

  socket.on('probe-relay-ack', (data) => {
    handleRelayProbeAck(data);
  });

  socket.on('chunk-ack', (data) => {
    acknowledgedChunks.add(data.chunkIndex);
    const chunk = chunks[data.chunkIndex];
    if (chunk) {
      transferStats.bytesTransferred += chunk.size;
    }
    if (useRelay) {
      relayUnackedCount = Math.max(0, relayUnackedCount - 1);
    }
    updateProgress();
    updateTransferSpeed();
    sendNextChunk();
  });

  socket.on('request-missing-chunks', async (data) => {
    for (const chunkIndex of data.missingChunks) {
      await sendChunk(chunkIndex);
    }
  });
}

async function setupWebRTC() {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  peerConnection = new RTCPeerConnection(configuration);
  
  dataChannel = peerConnection.createDataChannel('fileTransfer', {
    ordered: true,
    maxRetransmits: 10
  });
  
  dataChannel.onopen = () => {
    console.log('DataChannel opened');
    startLinkProbing();
  };

  dataChannel.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'ack') {
      acknowledgedChunks.add(message.chunkIndex);
      const chunk = chunks[message.chunkIndex];
      if (chunk) {
        transferStats.bytesTransferred += chunk.size;
      }
      updateProgress();
      updateTransferSpeed();
      sendNextChunk();
    } else if (message.type === 'probe-ack') {
      handleWebRTCProbeAck(message);
    }
  };

  dataChannel.onclose = () => {
    console.log('DataChannel closed');
    if (probeState.isProbing) {
      probeResults.webrtc.successful = false;
    }
  };

  dataChannel.onerror = (error) => {
    console.error('DataChannel error:', error);
    if (probeState.isProbing) {
      probeResults.webrtc.successful = false;
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        code: sessionCode,
        candidate: event.candidate,
        target: 'downloader'
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'failed' || 
        peerConnection.connectionState === 'disconnected') {
      if (probeState.isProbing) {
        probeResults.webrtc.successful = false;
      } else if (!isTransferring && acknowledgedChunks.size < totalChunks) {
        switchToRelay();
      }
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  socket.emit('webrtc-offer', {
    code: sessionCode,
    offer: offer
  });
}

function startLinkProbing() {
  probeState.isProbing = true;
  probeResults = {
    webrtc: { rtts: [], packetLoss: 0, score: 0, successful: false },
    relay: { rtts: [], packetLoss: 0, score: 0, successful: false }
  };
  probeState.currentProbeId = 0;
  probeState.webrtcSent = 0;
  probeState.webrtcAcked = 0;
  probeState.relaySent = 0;
  probeState.relayAcked = 0;
  probeState.webrtcProbes.clear();
  probeState.relayProbes.clear();

  qualityPanel.classList.add('show');
  channelBadge.className = 'channel-badge probing';
  channelBadge.textContent = '探测中';
  probingStatus.style.display = 'block';
  probingText.textContent = '正在进行链路质量探测...';
  
  probeProgress.innerHTML = '';
  for (let i = 0; i < PROBE_PACKET_COUNT * 2; i++) {
    const dot = document.createElement('div');
    dot.className = 'probe-dot';
    probeProgress.appendChild(dot);
  }

  showStatus('connected', '正在探测两条链路质量，请稍候...');

  runProbeSequence();
}

async function runProbeSequence() {
  for (let i = 0; i < PROBE_PACKET_COUNT; i++) {
    probeState.currentProbeId = i;
    
    if (dataChannel && dataChannel.readyState === 'open') {
      sendWebRTCProbe(i);
    }
    
    sendRelayProbe(i);
    
    const dots = probeProgress.querySelectorAll('.probe-dot');
    if (dots[i * 2]) dots[i * 2].classList.add('active');
    if (dots[i * 2 + 1]) dots[i * 2 + 1].classList.add('active');
    
    await sleep(PROBE_TIMEOUT);
  }

  await sleep(1000);
  finalizeProbing();
}

function sendWebRTCProbe(id) {
  const payload = generateProbePayload();
  const sendTime = Date.now();
  
  probeState.webrtcProbes.set(id, { sendTime, payload });
  probeState.webrtcSent++;
  
  const message = {
    type: 'probe',
    probeId: id,
    sendTime,
    payload
  };
  
  if (dataChannel && dataChannel.readyState === 'open') {
    try {
      dataChannel.send(JSON.stringify(message));
    } catch (e) {
      console.error('WebRTC probe send error:', e);
    }
  }

  setTimeout(() => {
    if (probeState.webrtcProbes.has(id)) {
      probeState.webrtcProbes.delete(id);
      probeResults.webrtc.packetLoss++;
    }
  }, PROBE_TIMEOUT * 2);
}

function sendRelayProbe(id) {
  const payload = generateProbePayload();
  const sendTime = Date.now();
  
  probeState.relayProbes.set(id, { sendTime, payload });
  probeState.relaySent++;
  
  socket.emit('probe-relay', {
    code: sessionCode,
    probeId: id,
    sendTime,
    payload
  });

  setTimeout(() => {
    if (probeState.relayProbes.has(id)) {
      probeState.relayProbes.delete(id);
      probeResults.relay.packetLoss++;
    }
  }, PROBE_TIMEOUT * 2);
}

function handleWebRTCProbeAck(message) {
  const { probeId, sendTime, payload } = message;
  
  if (!probeState.webrtcProbes.has(probeId)) return;
  
  const probe = probeState.webrtcProbes.get(probeId);
  if (probe.payload === payload) {
    const rtt = Date.now() - sendTime;
    probeResults.webrtc.rtts.push(rtt);
    probeState.webrtcAcked++;
    
    const dots = probeProgress.querySelectorAll('.probe-dot');
    const dotIndex = probeId * 2;
    if (dots[dotIndex]) {
      dots[dotIndex].classList.remove('active');
      dots[dotIndex].classList.add('complete');
    }
    
    updateProbeUI('webrtc');
  }
  
  probeState.webrtcProbes.delete(probeId);
}

function handleRelayProbeAck(data) {
  const { probeId, sendTime, payload } = data;
  
  if (!probeState.relayProbes.has(probeId)) return;
  
  const probe = probeState.relayProbes.get(probeId);
  if (probe.payload === payload) {
    const rtt = Date.now() - sendTime;
    probeResults.relay.rtts.push(rtt);
    probeState.relayAcked++;
    
    const dots = probeProgress.querySelectorAll('.probe-dot');
    const dotIndex = probeId * 2 + 1;
    if (dots[dotIndex]) {
      dots[dotIndex].classList.remove('active');
      dots[dotIndex].classList.add('complete');
    }
    
    updateProbeUI('relay');
  }
  
  probeState.relayProbes.delete(probeId);
}

function updateProbeUI(channel) {
  const result = probeResults[channel];
  if (result.rtts.length > 0) {
    const avgRtt = Math.round(result.rtts.reduce((a, b) => a + b, 0) / result.rtts.length);
    const lossRate = Math.round((result.packetLoss / PROBE_PACKET_COUNT) * 100);
    
    if (channel === 'relay') {
      rttValue.textContent = avgRtt + ' ms';
      rttValue.className = 'value ' + getRttColorClass(avgRtt);
      
      lossValue.textContent = lossRate + ' %';
      lossValue.className = 'value ' + getLossColorClass(lossRate);
    }
  }
}

function finalizeProbing() {
  probeState.isProbing = false;
  
  if (probeState.webrtcAcked > PROBE_PACKET_COUNT * 0.5) {
    probeResults.webrtc.successful = true;
    calculateChannelScore('webrtc');
  }
  
  if (probeState.relayAcked > PROBE_PACKET_COUNT * 0.5) {
    probeResults.relay.successful = true;
    calculateChannelScore('relay');
  }
  
  const bestChannel = selectBestChannel();
  selectedChannel = bestChannel;
  useRelay = (bestChannel === 'relay');
  
  probingStatus.style.display = 'none';
  updateChannelBadge(bestChannel);
  
  const webrtcScore = probeResults.webrtc.score;
  const relayScore = probeResults.relay.score;
  probingText.textContent = `探测完成 - WebRTC: ${webrtcScore}分 | 中继: ${relayScore}分 | 已选择: ${bestChannel === 'webrtc' ? 'P2P直连' : '服务器中继'}`;
  
  socket.emit('select-channel', { code: sessionCode, channel: bestChannel });
  
  showStatus('connected', `链路探测完成，已选择${bestChannel === 'webrtc' ? 'P2P直连' : '服务器中继'}通道<div class="connection-type">连接方式: ${bestChannel === 'webrtc' ? 'P2P直连' : '服务器中继'}</div>`);
  
  setTimeout(() => {
    startTransfer();
  }, 1000);
}

function calculateChannelScore(channel) {
  const result = probeResults[channel];
  if (result.rtts.length === 0) {
    result.score = 0;
    return;
  }
  
  const avgRtt = result.rtts.reduce((a, b) => a + b, 0) / result.rtts.length;
  const jitter = result.rtts.length > 1 
    ? Math.sqrt(result.rtts.reduce((a, b) => a + Math.pow(b - avgRtt, 2), 0) / result.rtts.length)
    : 0;
  const lossRate = (result.packetLoss / PROBE_PACKET_COUNT) * 100;
  
  let score = 100;
  
  if (avgRtt < 50) score -= 0;
  else if (avgRtt < 100) score -= 10;
  else if (avgRtt < 200) score -= 25;
  else if (avgRtt < 500) score -= 45;
  else score -= 70;
  
  if (jitter < 20) score -= 0;
  else if (jitter < 50) score -= 10;
  else if (jitter < 100) score -= 20;
  else score -= 35;
  
  if (lossRate === 0) score -= 0;
  else if (lossRate < 2) score -= 15;
  else if (lossRate < 5) score -= 35;
  else if (lossRate < 10) score -= 60;
  else score -= 90;
  
  if (channel === 'webrtc') score += 10;
  
  result.score = Math.max(0, Math.min(100, Math.round(score)));
}

function selectBestChannel() {
  const webrtcScore = probeResults.webrtc.successful ? probeResults.webrtc.score : -1;
  const relayScore = probeResults.relay.successful ? probeResults.relay.score : -1;
  
  if (webrtcScore >= relayScore && webrtcScore > 0) {
    return 'webrtc';
  } else if (relayScore > 0) {
    return 'relay';
  } else {
    return 'relay';
  }
}

function updateChannelBadge(channel) {
  channelBadge.className = 'channel-badge ' + channel;
  channelBadge.textContent = channel === 'webrtc' ? 'P2P直连' : '服务器中继';
  
  const result = channel === 'webrtc' ? probeResults.webrtc : probeResults.relay;
  updateQualityScore(result.score);
  
  if (result.rtts.length > 0) {
    const avgRtt = Math.round(result.rtts.reduce((a, b) => a + b, 0) / result.rtts.length);
    const lossRate = Math.round((result.packetLoss / PROBE_PACKET_COUNT) * 100);
    
    rttValue.textContent = avgRtt + ' ms';
    rttValue.className = 'value ' + getRttColorClass(avgRtt);
    
    lossValue.textContent = lossRate + ' %';
    lossValue.className = 'value ' + getLossColorClass(lossRate);
  }
}

function updateQualityScore(score) {
  scoreValue.textContent = score;
  scoreCircle.style.setProperty('--score', score + '%');
  
  if (score >= 80) scoreValue.className = 'good';
  else if (score >= 50) scoreValue.className = 'warning';
  else scoreValue.className = 'bad';
}

function getRttColorClass(rtt) {
  if (rtt < 100) return 'good';
  if (rtt < 300) return 'warning';
  return 'bad';
}

function getLossColorClass(loss) {
  if (loss === 0) return 'good';
  if (loss < 5) return 'warning';
  return 'bad';
}

function generateProbePayload() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let payload = '';
  for (let i = 0; i < PROBE_PACKET_SIZE; i++) {
    payload += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return payload;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function switchToRelay() {
  if (useRelay) return;
  console.log('Switching to relay mode');
  socket.emit('enable-relay', { code: sessionCode });
}

async function startTransfer() {
  progressContainer.classList.add('show');
  isTransferring = true;
  currentChunkIndex = 0;
  relayUnackedCount = 0;
  
  transferStats.startTime = Date.now();
  transferStats.bytesTransferred = 0;
  transferStats.lastUpdateTime = Date.now();
  transferStats.lastBytesTransferred = 0;
  
  chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
    const chunk = selectedFile.slice(start, end);
    chunks.push(chunk);
  }
  
  setInterval(updateTransferSpeed, 500);
  
  sendNextChunk();
}

async function sendNextChunk() {
  if (!isTransferring) return;
  
  while (currentChunkIndex < totalChunks && acknowledgedChunks.has(currentChunkIndex)) {
    currentChunkIndex++;
  }
  
  if (currentChunkIndex >= totalChunks) {
    if (acknowledgedChunks.size === totalChunks) {
      completeTransfer();
    }
    return;
  }
  
  if (useRelay && relayUnackedCount >= RELAY_WINDOW_SIZE) {
    return;
  }
  
  await sendChunk(currentChunkIndex);
  
  if (useRelay) {
    relayUnackedCount++;
  }
  
  currentChunkIndex++;
  
  if (!useRelay || relayUnackedCount < RELAY_WINDOW_SIZE) {
    sendNextChunk();
  }
}

async function sendChunk(index) {
  if (sentChunks.has(index) && !useRelay) return;
  
  const chunk = chunks[index];
  const arrayBuffer = await chunk.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  const message = {
    type: 'chunk',
    index: index,
    total: totalChunks,
    data: Array.from(bytes)
  };
  
  if (useRelay) {
    socket.emit('relay-chunk', {
      code: sessionCode,
      chunkIndex: index,
      chunkData: message
    });
    sentChunks.add(index);
  } else if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(message));
    sentChunks.add(index);
  }
  
  if (index % 10 === 0) {
    updateProgress();
  }
}

function updateTransferSpeed() {
  const now = Date.now();
  const elapsed = (now - transferStats.lastUpdateTime) / 1000;
  
  if (elapsed >= 0.5 && transferStats.bytesTransferred > 0) {
    const bytesDelta = transferStats.bytesTransferred - transferStats.lastBytesTransferred;
    transferStats.currentSpeed = bytesDelta / elapsed;
    
    const alpha = 0.3;
    transferStats.smoothedSpeed = alpha * transferStats.currentSpeed + 
                                (1 - alpha) * (transferStats.smoothedSpeed || transferStats.currentSpeed);
    
    transferStats.lastUpdateTime = now;
    transferStats.lastBytesTransferred = transferStats.bytesTransferred;
    
    speedValue.textContent = formatSpeed(transferStats.smoothedSpeed);
  }
}

function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond < 1024) return Math.round(bytesPerSecond) + ' B/s';
  if (bytesPerSecond < 1024 * 1024) return (bytesPerSecond / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSecond / (1024 * 1024)).toFixed(2) + ' MB/s';
}

function updateProgress() {
  const progress = Math.round((acknowledgedChunks.size / totalChunks) * 100);
  progressFill.style.width = progress + '%';
  progressText.textContent = progress + '%';
}

function completeTransfer() {
  isTransferring = false;
  updateProgress();
  
  setTimeout(() => {
    socket.emit('transfer-complete', { code: sessionCode });
    showStatus('complete', '✅ 文件传输完成！');
    
    if (dataChannel && selectedChannel === 'webrtc') {
      dataChannel.send(JSON.stringify({ type: 'complete', md5: fileMd5 }));
    }
  }, 500);
}

function showStatus(type, message) {
  statusDiv.className = `status show ${type}`;
  statusDiv.innerHTML = message;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
