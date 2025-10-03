import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import './App.css';

// Game Constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 20;
const BULLET_SIZE = 4;
const BULLET_SPEED = 8;
const PLAYER_SPEED = 3;

// Mobile detection
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

function LoveRoyaleMultiplayer() {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const socketRef = useRef(null);
  const [gameState, setGameState] = useState({
    screen: 'menu', // 'menu', 'lobby', 'playing'
    roomCode: '',
    playerName: '',
    roomData: null,
    mapConfig: null,
    connected: false,
    error: null
  });
  
  // Mobile controls state
  const [mobileControls, setMobileControls] = useState({
    joystick: { active: false, x: 0, y: 0, startX: 0, startY: 0 },
    fireButton: { pressed: false }
  });
  
  // Game rendering state
  const [renderData, setRenderData] = useState({
    players: [],
    enemies: [],
    bullets: [],
    wave: 1
  });

  // Socket connection
  useEffect(() => {
    const backendUrl = process.env.REACT_APP_BACKEND_URL;
    socketRef.current = io(backendUrl, {
      transports: ['polling', 'websocket'],
      timeout: 20000,
      forceNew: true
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Connected to server');
      setGameState(prev => ({ ...prev, connected: true, error: null }));
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setGameState(prev => ({ ...prev, connected: false }));
    });

    socket.on('error', (data) => {
      setGameState(prev => ({ ...prev, error: data.message }));
    });

    socket.on('room_created', (data) => {
      setGameState(prev => ({
        ...prev,
        screen: 'lobby',
        roomCode: data.room_code,
        roomData: data.room_data,
        mapConfig: data.map_config,
        error: null
      }));
    });

    socket.on('player_joined', (data) => {
      setGameState(prev => ({
        ...prev,
        roomData: data.room_data,
        mapConfig: data.map_config
      }));
    });

    socket.on('player_left', (data) => {
      setGameState(prev => ({
        ...prev,
        roomData: prev.roomData ? {
          ...prev.roomData,
          players: data.players
        } : null
      }));
    });

    socket.on('game_started', (data) => {
      setGameState(prev => ({
        ...prev,
        screen: 'playing',
        roomData: data.room_data
      }));
      setRenderData({
        players: data.room_data.players,
        enemies: data.room_data.enemies,
        bullets: [],
        wave: data.wave
      });
    });

    socket.on('game_update', (data) => {
      setRenderData({
        players: data.players,
        enemies: data.enemies,
        bullets: data.bullets,
        wave: data.wave
      });
    });

    socket.on('player_moved', (data) => {
      setRenderData(prev => ({
        ...prev,
        players: prev.players.map(p => 
          p.id === data.player_id 
            ? { ...p, x: data.x, y: data.y }
            : p
        )
      }));
    });

    socket.on('bullet_fired', (data) => {
      setRenderData(prev => ({
        ...prev,
        bullets: [...prev.bullets, data.bullet]
      }));
    });

    socket.on('wave_complete', (data) => {
      setRenderData(prev => ({
        ...prev,
        wave: data.wave,
        enemies: data.enemies
      }));
    });

    socket.on('game_complete', (data) => {
      alert('Congratulations! You completed all waves! 💕');
      setGameState(prev => ({ ...prev, screen: 'lobby' }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Player movement
  const movePlayer = useCallback((dx, dy) => {
    if (!socketRef.current || gameState.screen !== 'playing') return;

    const myPlayer = renderData.players.find(p => p.id === socketRef.current.id);
    if (!myPlayer || !myPlayer.alive) return;

    const newX = Math.max(PLAYER_SIZE/2, Math.min(CANVAS_WIDTH - PLAYER_SIZE/2, myPlayer.x + dx * PLAYER_SPEED));
    const newY = Math.max(PLAYER_SIZE/2, Math.min(CANVAS_HEIGHT - PLAYER_SIZE/2, myPlayer.y + dy * PLAYER_SPEED));

    // Check collision with obstacles
    if (gameState.mapConfig) {
      const playerRect = { x: newX - PLAYER_SIZE/2, y: newY - PLAYER_SIZE/2, width: PLAYER_SIZE, height: PLAYER_SIZE };
      const collision = gameState.mapConfig.obstacles.some(obstacle => 
        playerRect.x < obstacle.x + obstacle.width &&
        playerRect.x + playerRect.width > obstacle.x &&
        playerRect.y < obstacle.y + obstacle.height &&
        playerRect.y + playerRect.height > obstacle.y
      );
      
      if (collision) return;
    }

    socketRef.current.emit('player_move', { x: newX, y: newY });

    // Update local state immediately for smooth movement
    setRenderData(prev => ({
      ...prev,
      players: prev.players.map(p => 
        p.id === socketRef.current.id ? { ...p, x: newX, y: newY } : p
      )
    }));
  }, [gameState.mapConfig, gameState.screen, renderData.players]);

  // Player shooting
  const shootBullet = useCallback((targetX, targetY) => {
    if (!socketRef.current || gameState.screen !== 'playing') return;

    const myPlayer = renderData.players.find(p => p.id === socketRef.current.id);
    if (!myPlayer || !myPlayer.alive) return;

    const dx = targetX - myPlayer.x;
    const dy = targetY - myPlayer.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return;

    const vx = (dx / length) * BULLET_SPEED;
    const vy = (dy / length) * BULLET_SPEED;

    socketRef.current.emit('player_shoot', { vx, vy });
  }, [gameState.screen, renderData.players]);

  // Keyboard controls
  useEffect(() => {
    if (isMobile || gameState.screen !== 'playing') return;

    const keys = {};
    
    const handleKeyDown = (e) => {
      keys[e.key] = true;
      
      if (e.key === ' ') {
        e.preventDefault();
        // Shoot towards mouse position or center of nearest enemy
        const myPlayer = renderData.players.find(p => p.id === socketRef.current?.id);
        if (myPlayer) {
          const nearestEnemy = renderData.enemies.reduce((nearest, enemy) => {
            if (!nearest) return enemy;
            const distToNearest = Math.sqrt((myPlayer.x - nearest.x)**2 + (myPlayer.y - nearest.y)**2);
            const distToEnemy = Math.sqrt((myPlayer.x - enemy.x)**2 + (myPlayer.y - enemy.y)**2);
            return distToEnemy < distToNearest ? enemy : nearest;
          }, null);
          
          if (nearestEnemy) {
            shootBullet(nearestEnemy.x, nearestEnemy.y);
          } else {
            shootBullet(myPlayer.x + 100, myPlayer.y);
          }
        }
      }
    };
    
    const handleKeyUp = (e) => {
      keys[e.key] = false;
    };
    
    const gameLoop = () => {
      let dx = 0, dy = 0;
      
      if (keys['w'] || keys['W'] || keys['ArrowUp']) dy = -1;
      if (keys['s'] || keys['S'] || keys['ArrowDown']) dy = 1;
      if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx = -1;
      if (keys['d'] || keys['D'] || keys['ArrowRight']) dx = 1;
      
      if (dx !== 0 || dy !== 0) {
        movePlayer(dx, dy);
      }
      
      animationRef.current = requestAnimationFrame(gameLoop);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    animationRef.current = requestAnimationFrame(gameLoop);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [gameState.screen, renderData.players, renderData.enemies, movePlayer, shootBullet]);

  // Mobile touch controls
  const handleTouchStart = (e, type) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    if (type === 'joystick') {
      setMobileControls(prev => ({
        ...prev,
        joystick: {
          active: true,
          startX: x,
          startY: y,
          x: x,
          y: y
        }
      }));
    } else if (type === 'fire') {
      setMobileControls(prev => ({
        ...prev,
        fireButton: { pressed: true }
      }));
      
      // Auto-shoot at nearest enemy
      const myPlayer = renderData.players.find(p => p.id === socketRef.current?.id);
      if (myPlayer) {
        const nearestEnemy = renderData.enemies.reduce((nearest, enemy) => {
          if (!nearest) return enemy;
          const distToNearest = Math.sqrt((myPlayer.x - nearest.x)**2 + (myPlayer.y - nearest.y)**2);
          const distToEnemy = Math.sqrt((myPlayer.x - enemy.x)**2 + (myPlayer.y - enemy.y)**2);
          return distToEnemy < distToNearest ? enemy : nearest;
        }, null);
        
        if (nearestEnemy) {
          shootBullet(nearestEnemy.x, nearestEnemy.y);
        }
      }
    }
  };

  const handleTouchMove = (e, type) => {
    e.preventDefault();
    if (type === 'joystick' && mobileControls.joystick.active) {
      const touch = e.touches[0];
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      const dx = x - mobileControls.joystick.startX;
      const dy = y - mobileControls.joystick.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const maxDistance = 50;

      if (distance > 10) {
        const normalizedDx = distance > maxDistance ? (dx / distance) * maxDistance : dx;
        const normalizedDy = distance > maxDistance ? (dy / distance) * maxDistance : dy;
        
        movePlayer(normalizedDx / maxDistance, normalizedDy / maxDistance);
      }

      setMobileControls(prev => ({
        ...prev,
        joystick: { ...prev.joystick, x: x, y: y }
      }));
    }
  };

  const handleTouchEnd = (e, type) => {
    e.preventDefault();
    if (type === 'joystick') {
      setMobileControls(prev => ({
        ...prev,
        joystick: { active: false, x: 0, y: 0, startX: 0, startY: 0 }
      }));
    } else if (type === 'fire') {
      setMobileControls(prev => ({
        ...prev,
        fireButton: { pressed: false }
      }));
    }
  };

  // Render game
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || gameState.screen !== 'playing') return;

    const ctx = canvas.getContext('2d');
    
    const render = () => {
      // Clear canvas
      ctx.fillStyle = '#ffeef8';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      
      // Draw map obstacles
      if (gameState.mapConfig) {
        ctx.fillStyle = '#d63384';
        gameState.mapConfig.obstacles.forEach(obstacle => {
          ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        });
      }
      
      // Draw players
      renderData.players.forEach(player => {
        if (player.alive) {
          ctx.fillStyle = player.color;
          ctx.beginPath();
          ctx.arc(player.x, player.y, PLAYER_SIZE/2, 0, 2 * Math.PI);
          ctx.fill();
          
          // Health bar
          const healthPercent = player.health / player.max_health;
          const barWidth = 30;
          const barHeight = 4;
          
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(player.x - barWidth/2, player.y - PLAYER_SIZE/2 - 10, barWidth, barHeight);
          
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(player.x - barWidth/2, player.y - PLAYER_SIZE/2 - 10, barWidth * healthPercent, barHeight);
          
          // Player name
          ctx.fillStyle = '#333';
          ctx.font = '12px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(player.name, player.x, player.y - PLAYER_SIZE/2 - 15);
        }
      });
      
      // Draw enemies
      renderData.enemies.forEach(enemy => {
        if (enemy.health > 0) {
          ctx.fillStyle = enemy.color;
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, enemy.size/2, 0, 2 * Math.PI);
          ctx.fill();
          
          // Enemy health bar
          const healthPercent = enemy.health / enemy.max_health;
          const barWidth = 20;
          const barHeight = 3;
          
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(enemy.x - barWidth/2, enemy.y - enemy.size/2 - 8, barWidth, barHeight);
          
          ctx.fillStyle = '#00ff00';
          ctx.fillRect(enemy.x - barWidth/2, enemy.y - enemy.size/2 - 8, barWidth * healthPercent, barHeight);
        }
      });
      
      // Draw bullets
      renderData.bullets.forEach(bullet => {
        ctx.fillStyle = bullet.color;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, BULLET_SIZE/2, 0, 2 * Math.PI);
        ctx.fill();
      });
      
      requestAnimationFrame(render);
    };
    
    render();
  }, [gameState.screen, gameState.mapConfig, renderData]);

  // UI Actions
  const createRoom = () => {
    if (!gameState.playerName.trim()) {
      setGameState(prev => ({ ...prev, error: 'Please enter your name' }));
      return;
    }
    
    socketRef.current?.emit('create_room', {
      player_name: gameState.playerName,
      game_mode: 'coop_waves',
      map_id: 'first_date_cafe'
    });
  };

  const joinRoom = () => {
    if (!gameState.playerName.trim() || !gameState.roomCode.trim()) {
      setGameState(prev => ({ ...prev, error: 'Please enter your name and room code' }));
      return;
    }
    
    socketRef.current?.emit('join_room', {
      room_code: gameState.roomCode,
      player_name: gameState.playerName
    });
  };

  const startGame = () => {
    socketRef.current?.emit('start_game', {});
  };

  const leaveRoom = () => {
    setGameState(prev => ({
      ...prev,
      screen: 'menu',
      roomCode: '',
      roomData: null,
      mapConfig: null,
      error: null
    }));
  };

  // Render UI based on screen
  const renderScreen = () => {
    switch (gameState.screen) {
      case 'menu':
        return (
          <div className="menu-screen">
            <div className="menu-header">
              <h1 className="game-title">💕 Love Royale 💕</h1>
              <p className="game-subtitle">Multiplayer Romance Shooter</p>
              {!gameState.connected && (
                <div className="connection-status error">
                  🔴 Connecting to server...
                </div>
              )}
              {gameState.connected && (
                <div className="connection-status success">
                  🟢 Connected
                </div>
              )}
            </div>
            
            <div className="menu-form">
              <input
                type="text"
                placeholder="Your name"
                value={gameState.playerName}
                onChange={(e) => setGameState(prev => ({ ...prev, playerName: e.target.value }))}
                className="name-input"
              />
              
              <div className="menu-buttons">
                <button 
                  onClick={createRoom}
                  disabled={!gameState.connected}
                  className="create-room-btn"
                >
                  Create Room
                </button>
                
                <div className="join-room-section">
                  <input
                    type="text"
                    placeholder="Room Code"
                    value={gameState.roomCode}
                    onChange={(e) => setGameState(prev => ({ ...prev, roomCode: e.target.value.toUpperCase() }))}
                    className="room-code-input"
                    maxLength={4}
                  />
                  <button 
                    onClick={joinRoom}
                    disabled={!gameState.connected}
                    className="join-room-btn"
                  >
                    Join Room
                  </button>
                </div>
              </div>
              
              {gameState.error && (
                <div className="error-message">{gameState.error}</div>
              )}
            </div>
          </div>
        );

      case 'lobby':
        return (
          <div className="lobby-screen">
            <div className="lobby-header">
              <h2>Room: {gameState.roomCode}</h2>
              <button onClick={leaveRoom} className="leave-btn">Leave Room</button>
            </div>
            
            <div className="lobby-info">
              <h3>Players ({gameState.roomData?.players?.length || 0}/2):</h3>
              <ul className="player-list">
                {gameState.roomData?.players?.map(player => (
                  <li key={player.id} className="player-item">
                    <span className="player-color" style={{ backgroundColor: player.color }}></span>
                    {player.name}
                    {player.id === gameState.roomData.host_id && <span className="host-badge">👑 Host</span>}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="game-mode-info">
              <h3>🎮 Co-op vs AI Waves</h3>
              <p>Work together to survive increasing waves of Love Zombies and Heartbreakers!</p>
              <p>📍 Map: {gameState.mapConfig?.name}</p>
            </div>
            
            {gameState.roomData?.host_id === socketRef.current?.id && (
              <button 
                onClick={startGame}
                className="start-game-btn"
                disabled={!gameState.roomData?.players?.length}
              >
                Start Game 💕
              </button>
            )}
            
            {gameState.roomData?.host_id !== socketRef.current?.id && (
              <p className="waiting-message">Waiting for host to start the game...</p>
            )}
          </div>
        );

      case 'playing':
        return (
          <div className="game-screen">
            <div className="game-hud">
              <div className="hud-left">
                <div className="wave-info">Wave {renderData.wave}</div>
                <div className="enemies-count">Enemies: {renderData.enemies.length}</div>
              </div>
              <div className="hud-right">
                <div className="players-info">
                  {renderData.players.map(player => (
                    <div key={player.id} className="player-hud">
                      <span className="player-name">{player.name}</span>
                      <div className="player-health">
                        <div 
                          className="health-bar" 
                          style={{ width: `${(player.health / player.max_health) * 100}%` }}
                        ></div>
                      </div>
                      <span className="player-score">Score: {player.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="canvas-container">
              <canvas 
                ref={canvasRef} 
                width={CANVAS_WIDTH} 
                height={CANVAS_HEIGHT}
                className="game-canvas"
              />
              
              {/* Mobile Controls */}
              {isMobile && (
                <div className="mobile-controls">
                  <div 
                    className="virtual-joystick"
                    onTouchStart={(e) => handleTouchStart(e, 'joystick')}
                    onTouchMove={(e) => handleTouchMove(e, 'joystick')}
                    onTouchEnd={(e) => handleTouchEnd(e, 'joystick')}
                  >
                    <div className="joystick-base">
                      <div 
                        className="joystick-knob"
                        style={{
                          transform: mobileControls.joystick.active 
                            ? `translate(${mobileControls.joystick.x - mobileControls.joystick.startX}px, ${mobileControls.joystick.y - mobileControls.joystick.startY}px)`
                            : 'translate(0, 0)'
                        }}
                      ></div>
                    </div>
                  </div>
                  
                  <div 
                    className={`fire-button ${mobileControls.fireButton.pressed ? 'pressed' : ''}`}
                    onTouchStart={(e) => handleTouchStart(e, 'fire')}
                    onTouchEnd={(e) => handleTouchEnd(e, 'fire')}
                  >
                    🔫
                  </div>
                </div>
              )}
            </div>
            
            <div className="game-controls-info">
              {!isMobile && (
                <p>Move: WASD/Arrow Keys | Shoot: Spacebar (auto-aims at nearest enemy)</p>
              )}
              {isMobile && (
                <p>Use virtual joystick to move and fire button to shoot!</p>
              )}
            </div>
          </div>
        );

      default:
        return <div>Loading...</div>;
    }
  };

  return (
    <div className="love-royale-app">
      {renderScreen()}
    </div>
  );
}

export default LoveRoyaleMultiplayer;