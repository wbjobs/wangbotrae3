const CHUNK_SIZE = 1024 * 1024;

const socket = io();
let sessionCode = null;
let peerConnection = null;
let dataChannel = null;
let useRelay = false;
let selectedChannel = null;
let receivedChunks = new Map();
let receivedChunkIndices = new Set();
let totalChunks = 0;
let fileName = '';
let fileSize = 0;
let fileMd5 = '';
let isComplete = false;
let recoveryCount = 0;

let transferStats = {
  startTime: 0,
  bytesReceived: 0,
  lastUpdateTime: 0,
  lastBytesReceived: 0,
  currentSpeed: 0,
  smoothedSpeed: 0
};

const codeInputs = document.querySelectorAll('.code-inputs input');
const joinBtn = document.getElementById('joinBtn');
const fileInfo = document.getElementById('fileInfo');
const fileNameEl = document.getElementById('fileName');
const fileSizeEl = document.getElementById('fileSize');
const fileMd5El = document.getElementById('fileMd5');
const statusDiv = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const downloadBtn = document.getElementById('downloadBtn');
const verifying = document.getElementById('verifying');
const resumeInfo = document.getElementById('resumeInfo');
const checkStatusLink = document.getElementById('checkStatusLink');
const qualityPanel = document.getElementById('qualityPanel');
const channelBadge = document.getElementById('channelBadge');
const speedValue = document.getElementById('speedValue');
const receivedValue = document.getElementById('receivedValue');
const recoveryValue = document.getElementById('recoveryValue');
const scoreCircle = document.getElementById('scoreCircle');
const scoreValue = document.getElementById('scoreValue');

codeInputs.forEach((input, index) => {
  input.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
    if (e.target.value && index < codeInputs.length - 1) {
      codeInputs[index + 1].focus();
    }
    updateJoinButton();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !e.target.value && index > 0) {
      codeInputs[index - 1].focus();
    }
  });

  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pastedText = (e.clipboardData || window.clipboardData).getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (let i = 0; i < pastedText.length && i + index < codeInputs.length; i++) {
      codeInputs[index + i].value = pastedText[i];
    }
    if (index + pastedText.length < codeInputs.length) {
      codeInputs[Math.min(index + pastedText.length, codeInputs.length - 1)].focus();
    }
    updateJoinButton();
  });
});

function updateJoinButton() {
  const code = Array.from(codeInputs).map(input => input.value).join('');
  joinBtn.disabled = code.length !== 6;
}

joinBtn.addEventListener('click', joinSession);

checkStatusLink.addEventListener('click', async () => {
  const code = Array.from(codeInputs).map(input => input.value).join('');
  if (code.length !== 6) {
    alert('请输入完整的6位会话码');
    return;
  }
  
  try {
    const response = await fetch(`/status/${code}`);
    const data = await response.json();
    
    if (data.exists) {
      alert(`会话状态: 活跃\n文件名: ${data.fileName || '未知'}\n文件大小: ${formatFileSize(data.fileSize || 0)}\n上传者在线: ${data.hasUploader ? '是' : '否'}\n下载者在线: ${data.hasDownloader ? '是' : '否'}`);
    } else {
      alert('会话不存在或已过期');
    }
  } catch (error) {
    alert('检查状态失败: ' + error.message);
  }
});

function joinSession() {
  sessionCode = Array.from(codeInputs).map(input => input.value).join('').toUpperCase();
  
  showStatus('connecting', '正在连接...');
  joinBtn.disabled = true;
  
  socket.emit('join-session', { code: sessionCode }, (response) => {
    if (!response.success) {
      showStatus('error', response.error || '连接失败');
      joinBtn.disabled = false;
      return;
    }
    
    fileName = response.fileName;
    fileSize = response.fileSize;
    fileMd5 = response.fileMd5;
    totalChunks = response.totalChunks;
    
    fileNameEl.textContent = fileName;
    fileSizeEl.textContent = formatFileSize(fileSize);
    fileMd5El.textContent = `MD5: ${fileMd5}`;
    fileInfo.classList.add('show');
    
    qualityPanel.classList.add('show');
    receivedValue.textContent = `0 / ${totalChunks}`;
    
    if (response.uploadedChunks && response.uploadedChunks.length > 0) {
      response.uploadedChunks.forEach(index => receivedChunkIndices.add(index));
      resumeInfo.classList.add('show');
      recoveryCount = response.uploadedChunks.length;
      recoveryValue.textContent = recoveryCount + ' 次';
    }
    
    showStatus('connecting', '等待上传者进行链路探测...');
    setupSocketHandlers();
  });
}

function setupSocketHandlers() {
  socket.on('webrtc-offer', async (data) => {
    await setupWebRTC(data.offer);
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
    
    transferStats.startTime = Date.now();
    transferStats.bytesReceived = 0;
    transferStats.lastUpdateTime = Date.now();
    transferStats.lastBytesReceived = 0;
    
    setInterval(updateTransferSpeed, 500);
    
    progressContainer.classList.add('show');
    updateProgress();
    
    showStatus('connected', `已选择${data.channel === 'webrtc' ? 'P2P直连' : '服务器中继'}通道，准备接收文件...<div class="connection-type">连接方式: ${data.channel === 'webrtc' ? 'P2P直连' : '服务器中继'}</div>`);
  });

  socket.on('probe-relay', (data) => {
    handleRelayProbe(data);
  });

  socket.on('relay-chunk', (data) => {
    handleChunk(data.chunkData);
  });

  socket.on('uploader-disconnected', () => {
    if (!isComplete) {
      showStatus('error', '上传者已断开连接');
    }
  });

  socket.on('transfer-complete', () => {
    if (receivedChunkIndices.size === totalChunks && receivedChunks.size === totalChunks) {
      verifyAndDownload();
    } else {
      requestMissingChunks();
    }
  });
}

async function setupWebRTC(offer) {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  peerConnection = new RTCPeerConnection(configuration);
  
  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    
    dataChannel.onopen = () => {
      console.log('DataChannel opened');
      channelBadge.className = 'channel-badge probing';
      channelBadge.textContent = '探测中';
      showStatus('connecting', 'P2P连接已建立，正在进行链路质量探测...');
    };

    dataChannel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'probe') {
        handleWebRTCProbe(message);
      } else if (message.type === 'chunk') {
        handleChunk(message);
        sendAck(message.index, false);
      } else if (message.type === 'complete') {
        if (receivedChunkIndices.size === totalChunks && receivedChunks.size === totalChunks) {
          verifyAndDownload();
        } else {
          requestMissingChunks();
        }
      }
    };

    dataChannel.onclose = () => {
      console.log('DataChannel closed');
    };

    dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        code: sessionCode,
        candidate: event.candidate,
        target: 'uploader'
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  
  socket.emit('webrtc-answer', {
    code: sessionCode,
    answer: answer
  });
}

function handleWebRTCProbe(message) {
  const { probeId, sendTime, payload } = message;
  
  const ackMessage = {
    type: 'probe-ack',
    probeId,
    sendTime,
    payload
  };
  
  if (dataChannel && dataChannel.readyState === 'open') {
    try {
      dataChannel.send(JSON.stringify(ackMessage));
    } catch (e) {
      console.error('WebRTC probe ack error:', e);
    }
  }
}

function handleRelayProbe(data) {
  const { probeId, sendTime, relayTime, payload } = data;
  
  socket.emit('probe-relay-ack', {
    code: sessionCode,
    probeId,
    sendTime,
    relayTime,
    payload
  });
}

function updateChannelBadge(channel) {
  channelBadge.className = 'channel-badge ' + channel;
  channelBadge.textContent = channel === 'webrtc' ? 'P2P直连' : '服务器中继';
  
  const baseScore = channel === 'webrtc' ? 85 : 70;
  updateQualityScore(baseScore);
}

function updateQualityScore(score) {
  scoreValue.textContent = score;
  scoreCircle.style.setProperty('--score', score + '%');
  
  if (score >= 80) scoreValue.className = 'good';
  else if (score >= 50) scoreValue.className = 'warning';
  else scoreValue.className = 'bad';
}

function handleChunk(message) {
  if (receivedChunks.has(message.index)) {
    recoveryCount++;
    recoveryValue.textContent = recoveryCount + ' 次';
    if (useRelay) {
      sendAck(message.index, true);
    }
    return;
  }
  
  const chunkData = new Uint8Array(message.data);
  receivedChunks.set(message.index, chunkData);
  receivedChunkIndices.add(message.index);
  
  transferStats.bytesReceived += chunkData.length;
  
  receivedValue.textContent = `${receivedChunkIndices.size} / ${totalChunks}`;
  
  updateProgress();
  
  if (useRelay) {
    sendAck(message.index, true);
  }
}

function sendAck(chunkIndex, isRelay) {
  if (isRelay) {
    socket.emit('chunk-ack', { code: sessionCode, chunkIndex });
  } else if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'ack', chunkIndex }));
  }
}

function requestMissingChunks() {
  const missingChunks = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!receivedChunkIndices.has(i)) {
      missingChunks.push(i);
    }
  }
  
  if (missingChunks.length > 0) {
    socket.emit('request-missing-chunks', { code: sessionCode, missingChunks });
  }
}

function updateTransferSpeed() {
  const now = Date.now();
  const elapsed = (now - transferStats.lastUpdateTime) / 1000;
  
  if (elapsed >= 0.5 && transferStats.bytesReceived > 0) {
    const bytesDelta = transferStats.bytesReceived - transferStats.lastBytesReceived;
    transferStats.currentSpeed = bytesDelta / elapsed;
    
    const alpha = 0.3;
    transferStats.smoothedSpeed = alpha * transferStats.currentSpeed + 
                                (1 - alpha) * (transferStats.smoothedSpeed || transferStats.currentSpeed);
    
    transferStats.lastUpdateTime = now;
    transferStats.lastBytesReceived = transferStats.bytesReceived;
    
    speedValue.textContent = formatSpeed(transferStats.smoothedSpeed);
  }
}

function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond < 1024) return Math.round(bytesPerSecond) + ' B/s';
  if (bytesPerSecond < 1024 * 1024) return (bytesPerSecond / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSecond / (1024 * 1024)).toFixed(2) + ' MB/s';
}

function updateProgress() {
  const progress = Math.round((receivedChunkIndices.size / totalChunks) * 100);
  progressFill.style.width = progress + '%';
  progressText.textContent = `${progress}% (${receivedChunkIndices.size}/${totalChunks}块)`;
}

async function verifyAndDownload() {
  isComplete = true;
  verifying.classList.add('show');
  
  try {
    const allChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunk = receivedChunks.get(i);
      if (!chunk) {
        throw new Error(`缺少块 ${i}`);
      }
      allChunks.push(chunk);
    }
    
    const fileBlob = new Blob(allChunks, { type: 'application/octet-stream' });
    const calculatedMd5 = await calculateMD5(fileBlob);
    
    verifying.classList.remove('show');
    
    if (calculatedMd5 === fileMd5) {
      showStatus('complete', '✅ 文件校验通过，传输完成！');
      
      const url = URL.createObjectURL(fileBlob);
      downloadBtn.style.display = 'block';
      downloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
      };
    } else {
      showStatus('error', `❌ 文件校验失败，MD5不匹配<br>期望: ${fileMd5}<br>实际: ${calculatedMd5}`);
    }
  } catch (error) {
    verifying.classList.remove('show');
    showStatus('error', '校验失败: ' + error.message);
  }
}

function calculateMD5(blob) {
  return new Promise((resolve, reject) => {
    const chunkSize = 2097152;
    const chunks = Math.ceil(blob.size / chunkSize);
    let currentChunk = 0;
    const spark = new SparkMD5.ArrayBuffer();
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      spark.append(e.target.result);
      currentChunk++;
      if (currentChunk < chunks) {
        loadNext();
      } else {
        resolve(spark.end());
      }
    };

    fileReader.onerror = () => {
      reject(new Error('MD5计算失败'));
    };

    function loadNext() {
      const start = currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, blob.size);
      fileReader.readAsArrayBuffer(blob.slice(start, end));
    }

    loadNext();
  });
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
