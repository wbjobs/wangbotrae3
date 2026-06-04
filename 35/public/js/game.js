const STORAGE_KEYS = {
  PLAYER_ID: 'space_mining_player_id',
  PLAYER_NAME: 'space_mining_player_name',
  PLAYER_ROOM: 'space_mining_room_id'
};

const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 10
});

let reconnectAttempts = 0;
let isReconnecting = false;

let gameConfig = {
  maxFuel: 10,
  miningSuccessRate: 0.7,
  minOreValue: 10,
  maxOreValue: 100,
  emptyBlastFuelCost: 1
};

let currentPlayer = {
  id: null,
  name: null,
  state: null,
  roomId: null
};

let isMining = false;
let gameActive = false;

const Storage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  },
  clear: () => {
    try {
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
    } catch (e) {}
  }
};

const savePlayerSession = () => {
  if (currentPlayer.id) Storage.set(STORAGE_KEYS.PLAYER_ID, currentPlayer.id);
  if (currentPlayer.name) Storage.set(STORAGE_KEYS.PLAYER_NAME, currentPlayer.name);
  if (currentPlayer.roomId) Storage.set(STORAGE_KEYS.PLAYER_ROOM, currentPlayer.roomId);
};

const getSavedPlayerSession = () => ({
  playerId: Storage.get(STORAGE_KEYS.PLAYER_ID),
  playerName: Storage.get(STORAGE_KEYS.PLAYER_NAME),
  roomId: Storage.get(STORAGE_KEYS.PLAYER_ROOM)
});

const clearPlayerSession = () => {
  Storage.clear();
};

let phaserGame = null;
let spaceship = null;
let asteroids = [];
let particles = null;
let stars = null;
let miningTarget = null;

class SpaceScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SpaceScene' });
  }

  preload() {}

  create() {
    const { width, height } = this.scale;

    stars = this.add.group();
    for (let i = 0; i < 200; i++) {
      const x = Phaser.Math.Between(0, width);
      const y = Phaser.Math.Between(0, height);
      const size = Phaser.Math.Between(1, 3);
      const star = this.add.circle(x, y, size, 0xffffff, Phaser.Math.FloatBetween(0.3, 1));
      star.setData('speed', Phaser.Math.FloatBetween(0.1, 0.5));
      stars.add(star);
    }

    const asteroidColors = [0x8b4513, 0xa0522d, 0x696969, 0x808080, 0x556b2f];
    for (let i = 0; i < 15; i++) {
      const x = Phaser.Math.Between(100, width - 100);
      const y = Phaser.Math.Between(100, height - 200);
      const radius = Phaser.Math.Between(20, 50);
      const color = Phaser.Utils.Array.GetRandom(asteroidColors);
      
      const asteroid = this.add.circle(x, y, radius, color);
      asteroid.setStrokeStyle(3, 0x333333);
      asteroid.setData('originalX', x);
      asteroid.setData('originalY', y);
      asteroid.setData('floatOffset', Phaser.Math.FloatBetween(0, Math.PI * 2));
      asteroid.setData('floatSpeed', Phaser.Math.FloatBetween(0.01, 0.03));
      asteroid.setData('rotationSpeed', Phaser.Math.FloatBetween(-0.01, 0.01));
      asteroid.setData('radius', radius);
      
      this.add.circle(x - radius * 0.3, y - radius * 0.2, radius * 0.25, 0x000000, 0.3);
      this.add.circle(x + radius * 0.2, y + radius * 0.3, radius * 0.15, 0x000000, 0.3);
      
      asteroids.push(asteroid);
    }

    spaceship = this.add.container(width / 2, height - 120);
    
    const body = this.add.triangle(0, -20, 0, -30, -25, 25, 25, 25, 0x4488ff);
    body.setStrokeStyle(2, 0x88ccff);
    
    const cockpit = this.add.circle(0, -5, 12, 0x00ffff);
    cockpit.setStrokeStyle(2, 0x88ffff);
    
    const leftWing = this.add.triangle(-25, 15, -20, 5, -40, 25, -25, 30, 0x2266dd);
    const rightWing = this.add.triangle(25, 15, 20, 5, 40, 25, 25, 30, 0x2266dd);
    
    const engineGlow = this.add.circle(0, 28, 10, 0xff6600, 0.8);
    engineGlow.setData('isGlow', true);
    
    spaceship.add([body, leftWing, rightWing, cockpit, engineGlow]);

    particles = this.add.particles(0, 0, {
      speed: { min: 50, max: 100 },
      angle: { min: 80, max: 100 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 500,
      quantity: 0,
      tint: 0xff6600,
      follow: spaceship,
      followOffset: { x: 0, y: 30 }
    });

    miningTarget = this.add.circle(0, 0, 15, 0xffff00);
    miningTarget.setVisible(false);
    miningTarget.setStrokeStyle(3, 0xffffff);

    this.tweens.add({
      targets: spaceship,
      y: spaceship.y - 10,
      duration: 1500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });
  }

  update() {
    const { width, height } = this.scale;

    stars.children.each(star => {
      star.y += star.getData('speed');
      if (star.y > height) {
        star.y = 0;
        star.x = Phaser.Math.Between(0, width);
      }
    });

    asteroids.forEach((asteroid, index) => {
      const offset = asteroid.getData('floatOffset');
      const speed = asteroid.getData('floatSpeed');
      const originalX = asteroid.getData('originalX');
      const originalY = asteroid.getData('originalY');
      const rotationSpeed = asteroid.getData('rotationSpeed');
      
      asteroid.x = originalX + Math.sin(offset + this.time.now * speed) * 15;
      asteroid.y = originalY + Math.cos(offset + this.time.now * speed * 0.7) * 10;
      asteroid.rotation += rotationSpeed;
    });

    if (spaceship) {
      spaceship.each(child => {
        if (child.getData('isGlow')) {
          child.scale = 0.8 + Math.sin(this.time.now * 0.01) * 0.3;
        }
      });
    }
  }

  startMiningAnimation(asteroid, success, oreValue) {
    return new Promise((resolve) => {
      const asteroidRadius = asteroid.getData('radius');
      
      miningTarget.setPosition(asteroid.x, asteroid.y);
      miningTarget.setVisible(true);
      miningTarget.setScale(0);
      
      this.tweens.add({
        targets: miningTarget,
        scale: { from: 0, to: 1.5 },
        alpha: { from: 1, to: 0 },
        duration: 500,
        ease: 'Cubic.Out'
      });

      this.tweens.add({
        targets: spaceship,
        x: asteroid.x,
        y: asteroid.y + asteroidRadius + 60,
        duration: 800,
        ease: 'Cubic.InOut',
        onComplete: () => {
          particles.setQuantity(10);
          particles.setSpeed({ min: 100, max: 200 });
          
          setTimeout(() => {
            particles.setQuantity(0);
            
            if (success) {
              const oreText = this.add.text(asteroid.x, asteroid.y - 30, `+${oreValue}`, {
                fontFamily: 'Arial',
                fontSize: '32px',
                fontWeight: 'bold',
                fill: '#00ff88',
                stroke: '#000000',
                strokeThickness: 4
              });
              
              this.tweens.add({
                targets: oreText,
                y: oreText.y - 80,
                alpha: { from: 1, to: 0 },
                scale: { from: 1, to: 1.5 },
                duration: 1200,
                ease: 'Cubic.Out',
                onComplete: () => oreText.destroy()
              });

              const sparkle = this.add.particles(asteroid.x, asteroid.y, {
                speed: { min: 50, max: 150 },
                angle: { min: 0, max: 360 },
                scale: { start: 0.3, end: 0 },
                alpha: { start: 1, end: 0 },
                lifespan: 800,
                quantity: 20,
                tint: [0xffff00, 0xffaa00, 0x00ff88],
                stopAfter: 20
              });

              this.tweens.add({
                targets: asteroid,
                scale: { from: 1, to: 0.9, yoyo: true },
                duration: 200,
                ease: 'Sine.InOut'
              });
            } else {
              const explosion = this.add.particles(asteroid.x, asteroid.y, {
                speed: { min: 100, max: 300 },
                angle: { min: 0, max: 360 },
                scale: { start: 0.5, end: 0 },
                alpha: { start: 1, end: 0 },
                lifespan: 600,
                quantity: 30,
                tint: [0xff4444, 0xff8800, 0xffff00],
                stopAfter: 30
              });

              const flash = this.add.circle(asteroid.x, asteroid.y, asteroidRadius * 2, 0xffffff, 0.8);
              this.tweens.add({
                targets: flash,
                alpha: 0,
                scale: 2,
                duration: 300,
                onComplete: () => flash.destroy()
              });

              this.cameras.main.shake(300, 0.01);
            }

            setTimeout(() => {
              this.tweens.add({
                targets: spaceship,
                x: this.scale.width / 2,
                y: this.scale.height - 120,
                duration: 800,
                ease: 'Cubic.InOut',
                onComplete: () => {
                  miningTarget.setVisible(false);
                  resolve();
                }
              });
            }, 500);
          }, 400);
        }
      });
    });
  }

  returnAnimation() {
    return new Promise((resolve) => {
      const { width } = this.scale;
      
      particles.setQuantity(20);
      particles.setSpeed({ min: 200, max: 300 });
      
      this.tweens.add({
        targets: spaceship,
        y: -100,
        duration: 1500,
        ease: 'Cubic.In',
        onComplete: () => {
          particles.setQuantity(0);
          
          this.tweens.add({
            targets: spaceship,
            x: width / 2,
            y: this.scale.height - 120,
            duration: 0,
            onComplete: resolve
          });
        }
      });
    });
  }
}

function initPhaser() {
  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    scene: SpaceScene,
    backgroundColor: '#0a0a1a',
    transparent: false
  };
  
  phaserGame = new Phaser.Game(config);
  
  window.addEventListener('resize', () => {
    phaserGame.scale.resize(window.innerWidth, window.innerHeight);
  });
}

function showMessage(text, type = 'success') {
  const container = document.getElementById('message-container');
  const msg = document.createElement('div');
  msg.className = `game-message message-${type}`;
  msg.textContent = text;
  container.appendChild(msg);
  
  setTimeout(() => {
    msg.remove();
  }, 2000);
}

function updateHUD() {
  if (!currentPlayer.state) return;
  
  document.getElementById('hud-player-name').textContent = currentPlayer.name;
  document.getElementById('hud-ore-value').textContent = currentPlayer.state.totalOreValue;
  document.getElementById('hud-mining-count').textContent = currentPlayer.state.miningCount;
  document.getElementById('hud-fuel').textContent = `${currentPlayer.state.fuel}/${gameConfig.maxFuel}`;
  
  const fuelPercent = (currentPlayer.state.fuel / gameConfig.maxFuel) * 100;
  document.getElementById('fuel-bar').style.width = `${fuelPercent}%`;
  
  const successRate = currentPlayer.state.miningCount > 0
    ? ((currentPlayer.state.successCount / currentPlayer.state.miningCount) * 100).toFixed(1)
    : 0;
  document.getElementById('hud-success-rate').textContent = `${successRate}%`;
  
  const equipmentLevel = currentPlayer.state.equipmentLevel || 1;
  const stars = '⭐'.repeat(equipmentLevel) + '☆'.repeat(5 - equipmentLevel);
  document.getElementById('hud-equipment-level').textContent = `Lv.${equipmentLevel} ${stars.slice(0, equipmentLevel)}`;
  
  const combatBonus = equipmentLevel;
  document.getElementById('hud-combat-bonus').textContent = `+${combatBonus}`;
}

function updateEquipmentPanel() {
  if (!currentPlayer.state) return;
  
  const equipmentLevel = currentPlayer.state.equipmentLevel || 1;
  const maxLevel = 5;
  
  const starsHtml = Array.from({ length: maxLevel }, (_, i) => 
    `<span class="${i < equipmentLevel ? 'star-active' : 'star-inactive'}">⭐</span>`
  ).join('');
  document.getElementById('equipment-stars').innerHTML = starsHtml;
  
  document.getElementById('equipment-level').textContent = `${equipmentLevel} / ${maxLevel}`;
  document.getElementById('equipment-bonus').textContent = `+${equipmentLevel}`;
  
  const encounters = currentPlayer.state.pirateEncounters || 0;
  document.getElementById('pirate-encounters').textContent = encounters;
  
  const wins = currentPlayer.state.pirateWins || 0;
  const losses = currentPlayer.state.pirateLosses || 0;
  const totalBattles = wins + losses;
  const winRate = totalBattles > 0 ? ((wins / totalBattles) * 100).toFixed(1) : 0;
  document.getElementById('pirate-winrate').textContent = `${winRate}%`;
  
  socket.emit('equipment:checkUpgrade');
}

function showPirateModal(pirateEvent, playerState) {
  const modal = document.getElementById('pirate-modal');
  const battleArea = document.getElementById('battle-area');
  const battleResult = document.getElementById('battle-result');
  const buttons = document.getElementById('pirate-buttons');
  
  battleArea.classList.add('hidden');
  battleResult.classList.add('hidden');
  buttons.classList.remove('hidden');
  
  document.getElementById('pirate-level').textContent = pirateEvent.pirateLevel;
  document.getElementById('pirate-demand').textContent = `${pirateEvent.oreDemand} 矿石`;
  document.getElementById('player-combat-power').textContent = `? +${pirateEvent.equipmentBonus}`;
  document.getElementById('pirate-combat-power').textContent = `? +${pirateEvent.pirateLevel * 2}`;
  document.getElementById('surrender-loss').textContent = pirateEvent.oreDemand;
  
  modal.style.display = 'flex';
  
  document.getElementById('btn-mine').disabled = true;
  document.getElementById('btn-return').disabled = true;
  document.getElementById('btn-upgrade').disabled = true;
}

function hidePirateModal() {
  const modal = document.getElementById('pirate-modal');
  modal.style.display = 'none';
  
  document.getElementById('btn-mine').disabled = false;
  document.getElementById('btn-return').disabled = false;
  document.getElementById('btn-upgrade').disabled = false;
}

function handleFightPirate() {
  const buttons = document.getElementById('pirate-buttons');
  const battleArea = document.getElementById('battle-area');
  
  buttons.classList.add('hidden');
  battleArea.classList.remove('hidden');
  document.getElementById('battle-result-text').textContent = '投掷骰子中...';
  
  socket.emit('pirate:fight');
  
  socket.once('pirate:fightResult', (data) => {
    const battleArea = document.getElementById('battle-area');
    const battleResult = document.getElementById('battle-result');
    
    battleArea.classList.add('hidden');
    battleResult.classList.remove('hidden');
    battleResult.className = `battle-result ${data.victory ? 'battle-victory' : 'battle-defeat'}`;
    
    const resultHtml = `
      <div>🎲 你的骰子: ${data.playerRoll} + ${currentPlayer.state.equipmentLevel} 装备 = <strong>${data.playerPower}</strong></div>
      <div>🎲 海盗骰子: ${data.pirateRoll} + ${data.piratePower - data.pirateRoll} 等级 = <strong>${data.piratePower}</strong></div>
      <div style="margin-top: 10px; font-size: 20px;">${data.message}</div>
    `;
    battleResult.innerHTML = resultHtml;
    
    currentPlayer.state = data.playerState;
    updateHUD();
    updateEquipmentPanel();
    
    showMessage(data.message, data.victory ? 'success' : 'danger');
    
    if (data.fuelLost && currentPlayer.state.fuel <= 0) {
      setTimeout(() => {
        hidePirateModal();
        showGameOver('crashed', currentPlayer.state);
      }, 2000);
    } else {
      setTimeout(() => {
        hidePirateModal();
      }, 2500);
    }
    
    socket.off('pirate:fightResult');
  });
}

function handleSurrenderPirate() {
  socket.emit('pirate:surrender');
  
  socket.once('pirate:surrenderResult', (data) => {
    const battleResult = document.getElementById('battle-result');
    const buttons = document.getElementById('pirate-buttons');
    const battleArea = document.getElementById('battle-area');
    
    buttons.classList.add('hidden');
    battleArea.classList.add('hidden');
    battleResult.classList.remove('hidden');
    battleResult.className = 'battle-result battle-defeat';
    battleResult.innerHTML = `<div style="font-size: 20px;">${data.message}</div>`;
    
    currentPlayer.state = data.playerState;
    updateHUD();
    updateEquipmentPanel();
    
    showMessage(data.message, 'warning');
    
    setTimeout(() => {
      hidePirateModal();
    }, 2000);
    
    socket.off('pirate:surrenderResult');
  });
}

function handleUpgradeEquipment() {
  socket.emit('equipment:upgrade');
  
  socket.once('equipment:upgradeResult', (data) => {
    if (data.success) {
      currentPlayer.state = data.playerState;
      updateHUD();
      updateEquipmentPanel();
      showMessage(data.message, 'success');
      
      if (phaserGame) {
        const scene = phaserGame.scene.keys['SpaceScene'];
        scene.cameras.main.shake(300, 0.01);
      }
    } else {
      showMessage(data.message, 'danger');
    }
    socket.off('equipment:upgradeResult');
  });
}

function updatePlayersList(players) {
  const list = document.getElementById('players-list');
  const countEl = document.getElementById('player-count');
  
  countEl.textContent = players.length;
  
  list.innerHTML = players.map(player => `
    <div class="player-item">
      <div class="player-status status-${player.gameStatus}"></div>
      <span class="player-name">${player.playerName}</span>
      <span class="player-score">${player.totalOreValue}</span>
    </div>
  `).join('');
}

function updateLeaderboard(leaderboard) {
  const list = document.getElementById('leaderboard-list');
  
  list.innerHTML = leaderboard.map(player => `
    <div class="leaderboard-item">
      <span class="leaderboard-rank rank-${player.rank}">${player.rank}</span>
      <span class="leaderboard-name">${player.playerName}</span>
      <span class="leaderboard-score">${player.totalOreValue}</span>
    </div>
  `).join('');
}

function showGameOver(status, finalStats) {
  const modal = document.getElementById('game-over-modal');
  const title = document.getElementById('game-over-title');
  
  if (status === 'completed') {
    title.textContent = '🎉 返航成功！';
    title.className = 'game-over-title title-success';
  } else {
    title.textContent = '💥 任务失败！';
    title.className = 'game-over-title title-failed';
  }
  
  document.getElementById('final-ore-value').textContent = finalStats.totalOreValue;
  document.getElementById('final-mining-count').textContent = finalStats.miningCount;
  document.getElementById('final-success-count').textContent = finalStats.successCount;
  
  const successRate = finalStats.miningCount > 0
    ? ((finalStats.successCount / finalStats.miningCount) * 100).toFixed(1)
    : 0;
  document.getElementById('final-success-rate').textContent = `${successRate}%`;
  document.getElementById('final-blast-count').textContent = finalStats.blastCount;
  
  modal.style.display = 'flex';
  gameActive = false;
  
  document.getElementById('btn-mine').disabled = true;
  document.getElementById('btn-return').disabled = true;
}

async function handleMine() {
  if (isMining || !gameActive || !currentPlayer.state || currentPlayer.state.gameStatus !== 'playing') return;
  
  if (currentPlayer.state.pendingPirateEvent) {
    showMessage('有待处理的海盗事件！请先解决海盗问题。', 'danger');
    return;
  }
  
  isMining = true;
  document.getElementById('btn-mine').disabled = true;
  document.getElementById('btn-return').disabled = true;
  
  const randomAsteroid = asteroids[Math.floor(Math.random() * asteroids.length)];
  
  socket.emit('game:mine');
  
  socket.once('game:mineResult', async (data) => {
    const scene = phaserGame.scene.keys['SpaceScene'];
    await scene.startMiningAnimation(randomAsteroid, data.success, data.oreValue);
    
    currentPlayer.state = data.playerState;
    updateHUD();
    
    if (data.success) {
      showMessage(`+${data.oreValue} 矿石！`, 'success');
    } else {
      showMessage(`空爆！-${data.fuelUsed} 燃料`, 'danger');
    }
    
    updateEquipmentPanel();
    
    if (data.gameOver) {
      showGameOver('crashed', data.playerState);
    } else if (!data.pirateEncounter) {
      isMining = false;
      document.getElementById('btn-mine').disabled = false;
      document.getElementById('btn-return').disabled = false;
    } else {
      isMining = false;
    }
    
    socket.off('game:mineResult');
  });
}

async function handleReturn() {
  if (isMining || !gameActive || !currentPlayer.state || currentPlayer.state.gameStatus !== 'playing') return;
  
  document.getElementById('btn-mine').disabled = true;
  document.getElementById('btn-return').disabled = true;
  
  const scene = phaserGame.scene.keys['SpaceScene'];
  await scene.returnAnimation();
  
  socket.emit('game:return');
  
  socket.once('game:returnResult', (data) => {
    if (data.blocked) {
      showMessage(data.message, 'danger');
      document.getElementById('btn-mine').disabled = false;
      document.getElementById('btn-return').disabled = false;
    } else {
      currentPlayer.state = data.playerState;
      updateHUD();
      showMessage(`返航成功！+${data.totalEarnings}`, 'success');
      showGameOver('completed', data.playerState);
    }
    socket.off('game:returnResult');
  });
}

function handlePlayAgain() {
  const modal = document.getElementById('game-over-modal');
  modal.style.display = 'none';
  
  socket.emit('game:restart');
  
  socket.once('game:restarted', (data) => {
    currentPlayer.state = data.playerState;
    updateHUD();
    updateEquipmentPanel();
    showMessage('新的冒险开始了！', 'success');
    gameActive = true;
    isMining = false;
    
    document.getElementById('btn-mine').disabled = false;
    document.getElementById('btn-return').disabled = false;
    socket.off('game:restarted');
  });
}

function applyFullStateSync(stateData) {
  if (stateData.playerState) {
    currentPlayer.state = stateData.playerState;
    updateHUD();
  }
  
  if (stateData.roomPlayers) {
    updatePlayersList(stateData.roomPlayers);
  }
  
  if (stateData.roomLeaderboard) {
    updateLeaderboard(stateData.roomLeaderboard);
  } else if (stateData.globalLeaderboard && stateData.globalLeaderboard.byEarnings) {
    updateLeaderboard(stateData.globalLeaderboard.byEarnings);
  }
  
  console.log('State synced:', stateData.syncType, 'at:', new Date(stateData.syncTimestamp).toLocaleTimeString());
}

function handlePendingEvents(events) {
  if (!events || events.length === 0) return;
  
  console.log('Processing pending events:', events.length);
  
  events.forEach(event => {
    switch (event.type) {
      case 'mine':
        if (event.data.success) {
          showMessage(`[断线期间] +${event.data.oreValue} 矿石！`, 'success');
        } else {
          showMessage(`[断线期间] 空爆！-${event.data.fuelUsed} 燃料`, 'danger');
        }
        break;
      case 'return':
        showMessage(`[断线期间] 返航成功！+${event.data.totalEarnings}`, 'success');
        break;
      case 'game_over':
        showMessage(`[断线期间] 游戏结束：${event.data.status}`, event.data.status === 'completed' ? 'success' : 'danger');
        break;
    }
  });
  
  if (events.length > 0) {
    showMessage(`已同步 ${events.length} 条断线期间的事件`, 'warning');
  }
}

function attemptReconnect() {
  const savedSession = getSavedPlayerSession();
  
  if (savedSession.playerId && savedSession.playerName && savedSession.roomId) {
    console.log('Attempting to reconnect with saved session:', savedSession.playerId);
    isReconnecting = true;
    
    socket.emit('player:reconnect', {
      playerId: savedSession.playerId,
      playerName: savedSession.playerName,
      roomId: savedSession.roomId
    });
  }
}

function setupSocketEvents() {
  socket.on('player:joined', (data) => {
    currentPlayer.id = data.playerId;
    currentPlayer.state = data.playerState;
    currentPlayer.roomId = data.playerState.roomId;
    gameConfig.maxFuel = data.maxFuel;
    
    savePlayerSession();
    
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');
    document.getElementById('leaderboard-panel').classList.remove('hidden');
    document.getElementById('players-panel').classList.remove('hidden');
    document.getElementById('equipment-panel').classList.remove('hidden');
    
    updateHUD();
    updateEquipmentPanel();
    gameActive = true;
    isReconnecting = false;
    reconnectAttempts = 0;
    
    if (data.playerState.pendingPirateEvent) {
      showPirateModal(data.playerState.pendingPirateEvent, data.playerState);
    }
    
    showMessage(`欢迎，${currentPlayer.name}！`, 'success');
  });

  socket.on('player:reconnected', (data) => {
    currentPlayer.id = data.playerId;
    currentPlayer.state = data.playerState;
    currentPlayer.roomId = data.playerState.roomId;
    gameConfig.maxFuel = data.maxFuel;
    
    savePlayerSession();
    
    if (data.syncType === 'full') {
      applyFullStateSync({
        playerState: data.playerState,
        syncTimestamp: Date.now(),
        syncType: 'full'
      });
    }
    
    if (data.pendingEvents && data.pendingEvents.length > 0) {
      handlePendingEvents(data.pendingEvents);
    }
    
    if (document.getElementById('login-screen').classList.contains('hidden') === false) {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      document.getElementById('controls').classList.remove('hidden');
      document.getElementById('leaderboard-panel').classList.remove('hidden');
      document.getElementById('players-panel').classList.remove('hidden');
      document.getElementById('equipment-panel').classList.remove('hidden');
    }
    
    updateEquipmentPanel();
    
    gameActive = true;
    isReconnecting = false;
    reconnectAttempts = 0;
    
    const gameOverModal = document.getElementById('game-over-modal');
    if (data.playerState.gameStatus === 'playing') {
      gameOverModal.style.display = 'none';
      document.getElementById('btn-mine').disabled = false;
      document.getElementById('btn-return').disabled = false;
      
      if (data.playerState.pendingPirateEvent) {
        showPirateModal(data.playerState.pendingPirateEvent, data.playerState);
      }
    } else {
      showGameOver(data.playerState.gameStatus, data.playerState);
    }
    
    showMessage(`已重连！恢复会话状态`, 'success');
  });

  socket.on('player:reconnect:failed', (data) => {
    console.log('Reconnect failed:', data.message);
    isReconnecting = false;
    clearPlayerSession();
    
    if (reconnectAttempts >= 3) {
      showMessage('会话已过期，请重新登录', 'danger');
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('controls').classList.add('hidden');
      document.getElementById('leaderboard-panel').classList.add('hidden');
      document.getElementById('players-panel').classList.add('hidden');
      reconnectAttempts = 0;
    } else {
      reconnectAttempts++;
      setTimeout(attemptReconnect, 1000);
    }
  });
  
  socket.on('room:state', (data) => {
    updatePlayersList(data.players);
  });
  
  socket.on('room:leaderboard', (data) => {
    updateLeaderboard(data);
  });
  
  socket.on('leaderboard:global', (data) => {
    if (data && data.byEarnings) {
      updateLeaderboard(data.byEarnings);
    }
  });

  socket.on('state:update', (data) => {
    applyFullStateSync(data);
  });

  socket.on('state:update:partial', (data) => {
    if (data.playerState) {
      currentPlayer.state = data.playerState;
      updateHUD();
    }
  });
  
  socket.on('pirate:encounter', (data) => {
    console.log('Pirate encounter:', data.pirateEvent);
    showPirateModal(data.pirateEvent, data.playerState);
    
    if (phaserGame) {
      const scene = phaserGame.scene.keys['SpaceScene'];
      scene.cameras.main.shake(500, 0.02);
    }
    
    showMessage('⚠️ 遭遇海盗！', 'danger');
  });
  
  socket.on('equipment:upgradeInfo', (data) => {
    const btnUpgrade = document.getElementById('btn-upgrade');
    const costEl = document.getElementById('upgrade-cost');
    const nextBonusEl = document.getElementById('next-bonus');
    
    if (data.canUpgrade) {
      btnUpgrade.disabled = false;
      btnUpgrade.textContent = `⚙️ 升级装备 (${data.cost} 矿石)`;
      costEl.textContent = `升级需要: ${data.cost} 矿石`;
      nextBonusEl.textContent = `升级后: +${data.nextBonus} 战斗加成`;
    } else {
      btnUpgrade.disabled = true;
      if (data.currentLevel >= data.maxLevel) {
        btnUpgrade.textContent = '⚙️ 已达最高等级';
        costEl.textContent = '已达到最高等级';
        nextBonusEl.textContent = '';
      } else {
        btnUpgrade.textContent = `⚙️ 升级装备 (${data.cost} 矿石)`;
        costEl.textContent = data.reason;
        nextBonusEl.textContent = `升级后: +${data.nextBonus} 战斗加成`;
      }
    }
  });
  
  socket.on('game:ended', (data) => {
    currentPlayer.state = data.playerState;
    updateHUD();
    showGameOver(data.status, data.playerState);
  });
  
  socket.on('error', (data) => {
    showMessage(data.message, 'danger');
  });
  
  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
    showMessage('连接断开，正在尝试重连...', 'warning');
    isReconnecting = true;
    
    document.getElementById('btn-mine').disabled = true;
    document.getElementById('btn-return').disabled = true;
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    showMessage('已重新连接，恢复会话中...', 'warning');
    
    if (currentPlayer.id) {
      attemptReconnect();
    }
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('Reconnect attempt:', attemptNumber);
    showMessage(`重连尝试中... (${attemptNumber}/10)`, 'warning');
  });

  socket.on('reconnect_failed', () => {
    console.log('Reconnect failed');
    showMessage('重连失败，请刷新页面', 'danger');
    isReconnecting = false;
    clearPlayerSession();
  });
}

function setupUIEvents() {
  const savedSession = getSavedPlayerSession();
  if (savedSession.playerName) {
    document.getElementById('player-name').value = savedSession.playerName;
  }

  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const playerName = document.getElementById('player-name').value.trim();
    if (playerName.length > 0) {
      currentPlayer.name = playerName;
      
      const savedSession = getSavedPlayerSession();
      if (savedSession.playerId && savedSession.playerName === playerName) {
        console.log('Attempting to reconnect with saved session');
        socket.emit('player:join', {
          playerName,
          playerId: savedSession.playerId,
          roomId: savedSession.roomId
        });
      } else {
        socket.emit('player:join', { playerName });
      }
    }
  });
  
  document.getElementById('btn-mine').addEventListener('click', handleMine);
  document.getElementById('btn-return').addEventListener('click', handleReturn);
  document.getElementById('btn-play-again').addEventListener('click', handlePlayAgain);
  document.getElementById('btn-fight').addEventListener('click', handleFightPirate);
  document.getElementById('btn-surrender').addEventListener('click', handleSurrenderPirate);
  document.getElementById('btn-upgrade').addEventListener('click', handleUpgradeEquipment);
  
  document.addEventListener('keydown', (e) => {
    if (!gameActive) return;
    
    const pirateModal = document.getElementById('pirate-modal');
    const isPirateModalOpen = pirateModal.style.display === 'flex';
    
    if (isPirateModalOpen) {
      if (e.code === 'KeyF' || e.code === 'Digit1') {
        e.preventDefault();
        const buttons = document.getElementById('pirate-buttons');
        if (!buttons.classList.contains('hidden')) {
          handleFightPirate();
        }
      } else if (e.code === 'KeyS' || e.code === 'Digit2') {
        e.preventDefault();
        const buttons = document.getElementById('pirate-buttons');
        if (!buttons.classList.contains('hidden')) {
          handleSurrenderPirate();
        }
      }
      return;
    }
    
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      handleMine();
    } else if (e.code === 'KeyR' || e.code === 'Escape') {
      e.preventDefault();
      handleReturn();
    } else if (e.code === 'KeyU') {
      e.preventDefault();
      const btnUpgrade = document.getElementById('btn-upgrade');
      if (!btnUpgrade.disabled) {
        handleUpgradeEquipment();
      }
    }
  });
}

async function fetchGameConfig() {
  try {
    const response = await fetch('/api/game/config');
    const config = await response.json();
    gameConfig = { ...gameConfig, ...config };
  } catch (error) {
    console.log('Using default config');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await fetchGameConfig();
  initPhaser();
  setupSocketEvents();
  setupUIEvents();
});
