import React, { useEffect, useRef, useState, useCallback } from 'react';
import './App.css';

// Game Constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const PLAYER_SIZE = 20;
const BULLET_SIZE = 4;
const BULLET_SPEED = 8;
const PLAYER_SPEED = 3;
const PLAYER_MAX_HEALTH = 100;
const ROUNDS_TO_WIN = 3;

// Game State
let gameState = {
  players: {
    player1: {
      x: 100,
      y: 100,
      health: PLAYER_MAX_HEALTH,
      angle: 0,
      color: '#ff69b4', // Hot Pink for Player 1
      wins: 0,
      alive: true
    },
    player2: {
      x: 700,
      y: 500,
      health: PLAYER_MAX_HEALTH,
      angle: 0,
      color: '#ff1493', // Deep Pink for Player 2
      wins: 0,
      alive: true
    }
  },
  bullets: [],
  gamePhase: 'PLAYING', // 'PLAYING', 'ROUND_END', 'GAME_END'
  currentRound: 1,
  winner: null
};

// Input State
let keys = {};
let mousePos = { x: 0, y: 0 };

// Map obstacles (simple rectangles for now)
const MAP_OBSTACLES = [
  { x: 200, y: 150, width: 100, height: 20 },
  { x: 500, y: 300, width: 20, height: 100 },
  { x: 350, y: 450, width: 150, height: 20 },
  { x: 100, y: 350, width: 80, height: 20 },
  { x: 600, y: 100, width: 20, height: 80 }
];

function LoveRoyaleGame() {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const [gameStats, setGameStats] = useState({
    player1Wins: 0,
    player2Wins: 0,
    currentRound: 1,
    gamePhase: 'PLAYING'
  });

  // Collision detection
  const checkCollision = (rect1, rect2) => {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
  };

  // Check if position collides with map obstacles
  const checkMapCollision = (x, y, size) => {
    const playerRect = { x: x - size/2, y: y - size/2, width: size, height: size };
    return MAP_OBSTACLES.some(obstacle => checkCollision(playerRect, obstacle));
  };

  // Update player position with collision detection
  const updatePlayerPosition = (player, newX, newY) => {
    // Check boundaries
    if (newX < PLAYER_SIZE/2 || newX > CANVAS_WIDTH - PLAYER_SIZE/2) return;
    if (newY < PLAYER_SIZE/2 || newY > CANVAS_HEIGHT - PLAYER_SIZE/2) return;
    
    // Check map collision
    if (checkMapCollision(newX, newY, PLAYER_SIZE)) return;
    
    player.x = newX;
    player.y = newY;
  };

  // Handle input
  const handleInput = () => {
    const player1 = gameState.players.player1;
    const player2 = gameState.players.player2;

    // Player 1 controls (WASD)
    if (keys['w'] || keys['W']) updatePlayerPosition(player1, player1.x, player1.y - PLAYER_SPEED);
    if (keys['s'] || keys['S']) updatePlayerPosition(player1, player1.x, player1.y + PLAYER_SPEED);
    if (keys['a'] || keys['A']) updatePlayerPosition(player1, player1.x - PLAYER_SPEED, player1.y);
    if (keys['d'] || keys['D']) updatePlayerPosition(player1, player1.x + PLAYER_SPEED, player1.y);

    // Player 2 controls (Arrow Keys)
    if (keys['ArrowUp']) updatePlayerPosition(player2, player2.x, player2.y - PLAYER_SPEED);
    if (keys['ArrowDown']) updatePlayerPosition(player2, player2.x, player2.y + PLAYER_SPEED);
    if (keys['ArrowLeft']) updatePlayerPosition(player2, player2.x - PLAYER_SPEED, player2.y);
    if (keys['ArrowRight']) updatePlayerPosition(player2, player2.x + PLAYER_SPEED, player2.y);
  };

  // Shoot bullet
  const shootBullet = (player, targetX, targetY) => {
    if (gameState.gamePhase !== 'PLAYING') return;
    
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return;
    
    const bullet = {
      x: player.x,
      y: player.y,
      vx: (dx / length) * BULLET_SPEED,
      vy: (dy / length) * BULLET_SPEED,
      owner: player === gameState.players.player1 ? 'player1' : 'player2',
      color: player.color
    };
    
    gameState.bullets.push(bullet);
  };

  // Update bullets
  const updateBullets = () => {
    gameState.bullets = gameState.bullets.filter(bullet => {
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      
      // Remove bullets that hit boundaries
      if (bullet.x < 0 || bullet.x > CANVAS_WIDTH || bullet.y < 0 || bullet.y > CANVAS_HEIGHT) {
        return false;
      }
      
      // Check collision with map obstacles
      if (checkMapCollision(bullet.x, bullet.y, BULLET_SIZE)) {
        return false;
      }
      
      // Check collision with players
      Object.keys(gameState.players).forEach(playerKey => {
        const player = gameState.players[playerKey];
        if (bullet.owner !== playerKey && player.alive) {
          const distance = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.y - player.y) ** 2);
          if (distance < PLAYER_SIZE / 2 + BULLET_SIZE / 2) {
            player.health -= 25;
            if (player.health <= 0) {
              player.alive = false;
              endRound(bullet.owner);
            }
            return false;
          }
        }
      });
      
      return true;
    });
  };

  // End round
  const endRound = (winner) => {
    if (gameState.gamePhase !== 'PLAYING') return;
    
    gameState.gamePhase = 'ROUND_END';
    gameState.players[winner].wins++;
    
    // Check if game is won
    if (gameState.players[winner].wins >= ROUNDS_TO_WIN) {
      gameState.gamePhase = 'GAME_END';
      gameState.winner = winner;
    }
    
    // Auto-restart round after 2 seconds
    setTimeout(() => {
      if (gameState.gamePhase === 'ROUND_END') {
        startNewRound();
      }
    }, 2000);
  };

  // Start new round
  const startNewRound = () => {
    if (gameState.gamePhase === 'GAME_END') return;
    
    gameState.currentRound++;
    gameState.gamePhase = 'PLAYING';
    gameState.bullets = [];
    
    // Reset player positions and health
    gameState.players.player1.x = 100;
    gameState.players.player1.y = 100;
    gameState.players.player1.health = PLAYER_MAX_HEALTH;
    gameState.players.player1.alive = true;
    
    gameState.players.player2.x = 700;
    gameState.players.player2.y = 500;
    gameState.players.player2.health = PLAYER_MAX_HEALTH;
    gameState.players.player2.alive = true;
  };

  // Reset entire game
  const resetGame = () => {
    gameState.players.player1.wins = 0;
    gameState.players.player2.wins = 0;
    gameState.currentRound = 1;
    gameState.gamePhase = 'PLAYING';
    gameState.winner = null;
    startNewRound();
  };

  // Render game
  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Clear canvas with romantic background
    ctx.fillStyle = '#ffeef8';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Draw map obstacles
    ctx.fillStyle = '#d63384';
    MAP_OBSTACLES.forEach(obstacle => {
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    });
    
    // Draw players
    Object.values(gameState.players).forEach(player => {
      if (player.alive) {
        // Player body
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(player.x, player.y, PLAYER_SIZE/2, 0, 2 * Math.PI);
        ctx.fill();
        
        // Health bar
        const healthBarWidth = 30;
        const healthBarHeight = 4;
        const healthPercent = player.health / PLAYER_MAX_HEALTH;
        
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(player.x - healthBarWidth/2, player.y - PLAYER_SIZE/2 - 10, healthBarWidth, healthBarHeight);
        
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(player.x - healthBarWidth/2, player.y - PLAYER_SIZE/2 - 10, healthBarWidth * healthPercent, healthBarHeight);
      }
    });
    
    // Draw bullets
    gameState.bullets.forEach(bullet => {
      ctx.fillStyle = bullet.color;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, BULLET_SIZE/2, 0, 2 * Math.PI);
      ctx.fill();
    });
    
    // Draw UI
    ctx.fillStyle = '#333';
    ctx.font = '20px Arial';
    ctx.fillText(`Round ${gameState.currentRound}`, 20, 30);
    ctx.fillText(`Player 1: ${gameState.players.player1.wins} wins`, 20, 60);
    ctx.fillText(`Player 2: ${gameState.players.player2.wins} wins`, 20, 90);
    
    // Draw game state messages
    if (gameState.gamePhase === 'ROUND_END') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      
      ctx.fillStyle = '#fff';
      ctx.font = '40px Arial';
      ctx.textAlign = 'center';
      const winner = gameState.players.player1.wins > gameState.players.player2.wins ? 'Player 1' : 'Player 2';
      ctx.fillText(`${winner} Wins Round!`, CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
      ctx.font = '20px Arial';
      ctx.fillText('Next round starting...', CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 40);
      ctx.textAlign = 'left';
    }
    
    if (gameState.gamePhase === 'GAME_END') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      
      ctx.fillStyle = '#fff';
      ctx.font = '50px Arial';
      ctx.textAlign = 'center';
      const gameWinner = gameState.winner === 'player1' ? 'Player 1' : 'Player 2';
      ctx.fillText(`${gameWinner} Wins!`, CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
      ctx.font = '20px Arial';
      ctx.fillText('Press R to play again', CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 40);
      ctx.textAlign = 'left';
    }
  };

  // Game loop
  const gameLoop = useCallback(() => {
    if (gameState.gamePhase === 'PLAYING') {
      handleInput();
      updateBullets();
    }
    render();
    
    // Update React state for UI
    setGameStats({
      player1Wins: gameState.players.player1.wins,
      player2Wins: gameState.players.player2.wins,
      currentRound: gameState.currentRound,
      gamePhase: gameState.gamePhase
    });
    
    animationRef.current = requestAnimationFrame(gameLoop);
  }, []);

  // Event listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      keys[e.key] = true;
      
      // Shooting controls
      if (e.key === ' ') { // Spacebar for Player 1
        e.preventDefault();
        shootBullet(gameState.players.player1, mousePos.x, mousePos.y);
      }
      if (e.key === 'Enter') { // Enter for Player 2
        e.preventDefault();
        // Player 2 shoots towards Player 1
        shootBullet(gameState.players.player2, gameState.players.player1.x, gameState.players.player1.y);
      }
      
      // Reset game
      if (e.key === 'r' || e.key === 'R') {
        if (gameState.gamePhase === 'GAME_END') {
          resetGame();
        }
      }
    };
    
    const handleKeyUp = (e) => {
      keys[e.key] = false;
    };
    
    const handleMouseMove = (e) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        mousePos.x = e.clientX - rect.left;
        mousePos.y = e.clientY - rect.top;
      }
    };
    
    const handleMouseClick = (e) => {
      if (gameState.gamePhase === 'PLAYING') {
        shootBullet(gameState.players.player1, mousePos.x, mousePos.y);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('click', handleMouseClick);
    }
    
    // Start game loop
    animationRef.current = requestAnimationFrame(gameLoop);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (canvas) {
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('click', handleMouseClick);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [gameLoop]);

  return (
    <div className="love-royale-game">
      <div className="game-header">
        <h1 className="game-title">💕 Love Royale 💕</h1>
        <p className="game-subtitle">2-Player Tactical Romance Shooter</p>
      </div>
      
      <div className="game-container">
        <canvas 
          ref={canvasRef} 
          width={CANVAS_WIDTH} 
          height={CANVAS_HEIGHT}
          className="game-canvas"
        />
        
        <div className="controls-info">
          <div className="player-controls">
            <h3>🌹 Player 1 (Pink)</h3>
            <p>Move: WASD</p>
            <p>Shoot: Mouse Click or Spacebar</p>
            <p>Wins: {gameStats.player1Wins}</p>
          </div>
          
          <div className="player-controls">
            <h3>💖 Player 2 (Deep Pink)</h3>
            <p>Move: Arrow Keys</p>
            <p>Shoot: Enter Key</p>
            <p>Wins: {gameStats.player2Wins}</p>
          </div>
        </div>
      </div>
      
      <div className="game-info">
        <p>First to {ROUNDS_TO_WIN} wins takes the heart! 💘</p>
        {gameStats.gamePhase === 'GAME_END' && (
          <p>Press 'R' to play again! 🔄</p>
        )}
      </div>
    </div>
  );
}

export default LoveRoyaleGame;