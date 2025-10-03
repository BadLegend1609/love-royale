from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
import uuid
from datetime import datetime
import socketio
import asyncio
import json
import random
import math


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Love Royale API", description="Multiplayer tactical romance shooter")

# Create SocketIO server for real-time multiplayer
sio = socketio.AsyncServer(
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True
)

# Game state management
active_rooms = {}  # room_code -> room_data
player_sessions = {}  # session_id -> player_data

# Game constants
MAP_CONFIGS = {
    'first_date_cafe': {
        'name': 'First Date Café',
        'width': 800,
        'height': 600,
        'obstacles': [
            {'x': 200, 'y': 150, 'width': 100, 'height': 20},
            {'x': 500, 'y': 300, 'width': 20, 'height': 100},
            {'x': 350, 'y': 450, 'width': 150, 'height': 20},
            {'x': 100, 'y': 350, 'width': 80, 'height': 20},
            {'x': 600, 'y': 100, 'width': 20, 'height': 80}
        ],
        'player_spawns': [{'x': 100, 'y': 100}, {'x': 700, 'y': 500}]
    },
    'moonlit_garden': {
        'name': 'Moonlit Garden',
        'width': 800,
        'height': 600,
        'obstacles': [
            {'x': 300, 'y': 200, 'width': 200, 'height': 20},
            {'x': 150, 'y': 400, 'width': 100, 'height': 20},
            {'x': 550, 'y': 350, 'width': 100, 'height': 20},
            {'x': 400, 'y': 100, 'width': 20, 'height': 150},
            {'x': 250, 'y': 300, 'width': 20, 'height': 100}
        ],
        'player_spawns': [{'x': 80, 'y': 80}, {'x': 720, 'y': 520}]
    }
}

class Room(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    code: str
    host_id: str
    players: List[dict] = []
    game_mode: str = "coop_waves"  # "coop_waves" or "pvp_1v1"
    map_id: str = "first_date_cafe"
    status: str = "waiting"  # "waiting", "playing", "finished"
    current_wave: int = 1
    enemies: List[dict] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now())

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Game state helper functions
def generate_room_code():
    """Generate a 4-character room code"""
    return ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', k=4))

def create_enemy(enemy_type, x, y):
    """Create an enemy with given type and position"""
    enemy_id = str(uuid.uuid4())
    
    if enemy_type == "love_zombie":
        return {
            "id": enemy_id,
            "type": "love_zombie",
            "x": x,
            "y": y,
            "health": 50,
            "max_health": 50,
            "speed": 1,
            "damage": 10,
            "color": "#8b5a2b",
            "size": 15,
            "target_player": None
        }
    elif enemy_type == "heartbreaker":
        return {
            "id": enemy_id,
            "type": "heartbreaker",
            "x": x,
            "y": y,
            "health": 25,
            "max_health": 25,
            "speed": 2,
            "damage": 15,
            "color": "#dc143c",
            "size": 12,
            "last_shot": 0
        }
    
    return None

def spawn_wave_enemies(room_code, wave_number):
    """Spawn enemies for the current wave"""
    if room_code not in active_rooms:
        return
    
    room = active_rooms[room_code]
    room['enemies'] = []
    
    # Basic wave progression
    zombie_count = min(3 + wave_number, 10)
    heartbreaker_count = min(wave_number // 2, 5)
    
    map_config = MAP_CONFIGS[room['map_id']]
    map_width = map_config['width']
    map_height = map_config['height']
    
    # Spawn love zombies
    for _ in range(zombie_count):
        # Spawn at random edges
        if random.choice([True, False]):
            x = random.choice([50, map_width - 50])
            y = random.randint(50, map_height - 50)
        else:
            x = random.randint(50, map_width - 50)
            y = random.choice([50, map_height - 50])
            
        enemy = create_enemy("love_zombie", x, y)
        if enemy:
            room['enemies'].append(enemy)
    
    # Spawn heartbreakers (starting from wave 2)
    if wave_number >= 2:
        for _ in range(heartbreaker_count):
            x = random.randint(100, map_width - 100)
            y = random.randint(100, map_height - 100)
            
            enemy = create_enemy("heartbreaker", x, y)
            if enemy:
                room['enemies'].append(enemy)

# SocketIO event handlers
@sio.event
async def connect(sid, environ):
    print(f"Client {sid} connected")
    player_sessions[sid] = {
        "id": sid,
        "room_code": None,
        "player_name": f"Player_{sid[:6]}",
        "connected_at": datetime.now()
    }

@sio.event
async def disconnect(sid):
    print(f"Client {sid} disconnected")
    
    if sid in player_sessions:
        player_data = player_sessions[sid]
        room_code = player_data.get("room_code")
        
        # Remove player from room
        if room_code and room_code in active_rooms:
            room = active_rooms[room_code]
            room['players'] = [p for p in room['players'] if p['id'] != sid]
            
            # Notify other players
            await sio.emit('player_left', {
                'player_id': sid,
                'players': room['players']
            }, room=room_code)
            
            # Remove room if empty
            if len(room['players']) == 0:
                del active_rooms[room_code]
        
        del player_sessions[sid]

@sio.event
async def create_room(sid, data):
    """Create a new game room"""
    try:
        room_code = generate_room_code()
        while room_code in active_rooms:  # Ensure unique code
            room_code = generate_room_code()
        
        game_mode = data.get('game_mode', 'coop_waves')
        map_id = data.get('map_id', 'first_date_cafe')
        player_name = data.get('player_name', f'Player_{sid[:6]}')
        
        room_data = {
            'id': str(uuid.uuid4()),
            'code': room_code,
            'host_id': sid,
            'players': [{
                'id': sid,
                'name': player_name,
                'x': MAP_CONFIGS[map_id]['player_spawns'][0]['x'],
                'y': MAP_CONFIGS[map_id]['player_spawns'][0]['y'],
                'health': 100,
                'max_health': 100,
                'score': 0,
                'alive': True,
                'color': '#ff69b4'
            }],
            'game_mode': game_mode,
            'map_id': map_id,
            'status': 'waiting',
            'current_wave': 1,
            'enemies': [],
            'bullets': [],
            'created_at': datetime.now()
        }
        
        active_rooms[room_code] = room_data
        player_sessions[sid]['room_code'] = room_code
        player_sessions[sid]['player_name'] = player_name
        
        # Join socket room
        await sio.enter_room(sid, room_code)
        
        await sio.emit('room_created', {
            'room_code': room_code,
            'room_data': room_data,
            'map_config': MAP_CONFIGS[map_id]
        }, room=sid)
        
    except Exception as e:
        await sio.emit('error', {'message': f'Failed to create room: {str(e)}'}, room=sid)

@sio.event
async def join_room(sid, data):
    """Join an existing room"""
    try:
        room_code = data.get('room_code', '').upper()
        player_name = data.get('player_name', f'Player_{sid[:6]}')
        
        if room_code not in active_rooms:
            await sio.emit('error', {'message': 'Room not found'}, room=sid)
            return
        
        room = active_rooms[room_code]
        
        if len(room['players']) >= 2:
            await sio.emit('error', {'message': 'Room is full'}, room=sid)
            return
        
        if room['status'] != 'waiting':
            await sio.emit('error', {'message': 'Game already in progress'}, room=sid)
            return
        
        # Add player to room
        spawn_index = len(room['players'])
        spawn_pos = MAP_CONFIGS[room['map_id']]['player_spawns'][spawn_index]
        
        new_player = {
            'id': sid,
            'name': player_name,
            'x': spawn_pos['x'],
            'y': spawn_pos['y'],
            'health': 100,
            'max_health': 100,
            'score': 0,
            'alive': True,
            'color': '#ff1493' if spawn_index == 1 else '#ff69b4'
        }
        
        room['players'].append(new_player)
        player_sessions[sid]['room_code'] = room_code
        player_sessions[sid]['player_name'] = player_name
        
        # Join socket room
        await sio.enter_room(sid, room_code)
        
        # Notify all players in room
        await sio.emit('player_joined', {
            'player': new_player,
            'room_data': room,
            'map_config': MAP_CONFIGS[room['map_id']]
        }, room=room_code)
        
    except Exception as e:
        await sio.emit('error', {'message': f'Failed to join room: {str(e)}'}, room=sid)

@sio.event
async def start_game(sid, data):
    """Start the game (host only)"""
    try:
        if sid not in player_sessions:
            return
        
        room_code = player_sessions[sid]['room_code']
        if not room_code or room_code not in active_rooms:
            return
        
        room = active_rooms[room_code]
        
        # Check if player is host
        if room['host_id'] != sid:
            await sio.emit('error', {'message': 'Only host can start the game'}, room=sid)
            return
        
        # Check minimum players for co-op mode
        if room['game_mode'] == 'coop_waves' and len(room['players']) < 1:
            await sio.emit('error', {'message': 'Need at least 1 player for co-op mode'}, room=sid)
            return
        
        # Start the game
        room['status'] = 'playing'
        room['current_wave'] = 1
        
        # Spawn first wave
        spawn_wave_enemies(room_code, 1)
        
        await sio.emit('game_started', {
            'room_data': room,
            'wave': 1
        }, room=room_code)
        
    except Exception as e:
        await sio.emit('error', {'message': f'Failed to start game: {str(e)}'}, room=sid)

@sio.event
async def player_move(sid, data):
    """Handle player movement"""
    try:
        if sid not in player_sessions:
            return
        
        room_code = player_sessions[sid]['room_code']
        if not room_code or room_code not in active_rooms:
            return
        
        room = active_rooms[room_code]
        
        # Find player in room
        player = None
        for p in room['players']:
            if p['id'] == sid:
                player = p
                break
        
        if not player or not player['alive']:
            return
        
        # Update player position
        player['x'] = data.get('x', player['x'])
        player['y'] = data.get('y', player['y'])
        
        # Broadcast to other players
        await sio.emit('player_moved', {
            'player_id': sid,
            'x': player['x'],
            'y': player['y']
        }, room=room_code, skip_sid=sid)
        
    except Exception as e:
        print(f"Error in player_move: {e}")

@sio.event
async def player_shoot(sid, data):
    """Handle player shooting"""
    try:
        if sid not in player_sessions:
            return
        
        room_code = player_sessions[sid]['room_code']
        if not room_code or room_code not in active_rooms:
            return
        
        room = active_rooms[room_code]
        
        # Find player
        player = None
        for p in room['players']:
            if p['id'] == sid:
                player = p
                break
        
        if not player or not player['alive']:
            return
        
        # Create bullet
        bullet = {
            'id': str(uuid.uuid4()),
            'x': player['x'],
            'y': player['y'],
            'vx': data.get('vx', 0),
            'vy': data.get('vy', 0),
            'owner_id': sid,
            'damage': 25,
            'color': player['color']
        }
        
        if 'bullets' not in room:
            room['bullets'] = []
        
        room['bullets'].append(bullet)
        
        # Broadcast bullet creation
        await sio.emit('bullet_fired', {
            'bullet': bullet
        }, room=room_code)
        
    except Exception as e:
        print(f"Error in player_shoot: {e}")

# Game loop for AI and physics
async def game_update_loop():
    """Main game update loop for AI enemies and physics"""
    while True:
        try:
            for room_code, room in list(active_rooms.items()):
                if room['status'] != 'playing':
                    continue
                
                # Update enemies
                for enemy in room.get('enemies', []):
                    if enemy.get('health', 0) <= 0:
                        continue
                    
                    # Find nearest player
                    nearest_player = None
                    min_distance = float('inf')
                    
                    for player in room['players']:
                        if not player['alive']:
                            continue
                        
                        distance = math.sqrt((enemy['x'] - player['x'])**2 + (enemy['y'] - player['y'])**2)
                        if distance < min_distance:
                            min_distance = distance
                            nearest_player = player
                    
                    if nearest_player:
                        # Move towards player
                        dx = nearest_player['x'] - enemy['x']
                        dy = nearest_player['y'] - enemy['y']
                        length = math.sqrt(dx*dx + dy*dy)
                        
                        if length > 0:
                            enemy['x'] += (dx / length) * enemy['speed']
                            enemy['y'] += (dy / length) * enemy['speed']
                        
                        # Check collision with player
                        if min_distance < 30:
                            nearest_player['health'] -= enemy['damage']
                            if nearest_player['health'] <= 0:
                                nearest_player['alive'] = False
                
                # Update bullets
                if 'bullets' in room:
                    active_bullets = []
                    for bullet in room['bullets']:
                        bullet['x'] += bullet['vx']
                        bullet['y'] += bullet['vy']
                        
                        # Check bounds
                        map_config = MAP_CONFIGS[room['map_id']]
                        if (bullet['x'] < 0 or bullet['x'] > map_config['width'] or 
                            bullet['y'] < 0 or bullet['y'] > map_config['height']):
                            continue
                        
                        # Check enemy collisions
                        hit_enemy = False
                        for enemy in room.get('enemies', []):
                            if enemy.get('health', 0) <= 0:
                                continue
                            
                            distance = math.sqrt((bullet['x'] - enemy['x'])**2 + (bullet['y'] - enemy['y'])**2)
                            if distance < 20:
                                enemy['health'] -= bullet['damage']
                                hit_enemy = True
                                
                                # Award score to shooter
                                for player in room['players']:
                                    if player['id'] == bullet['owner_id']:
                                        player['score'] += 10
                                        break
                                
                                break
                        
                        if not hit_enemy:
                            active_bullets.append(bullet)
                    
                    room['bullets'] = active_bullets
                
                # Remove dead enemies
                room['enemies'] = [e for e in room.get('enemies', []) if e.get('health', 0) > 0]
                
                # Check wave completion
                if room['game_mode'] == 'coop_waves' and len(room['enemies']) == 0:
                    room['current_wave'] += 1
                    if room['current_wave'] <= 10:  # Max 10 waves
                        spawn_wave_enemies(room_code, room['current_wave'])
                        await sio.emit('wave_complete', {
                            'wave': room['current_wave'],
                            'enemies': room['enemies']
                        }, room=room_code)
                    else:
                        room['status'] = 'finished'
                        await sio.emit('game_complete', {
                            'players': room['players']
                        }, room=room_code)
                
                # Broadcast game state
                await sio.emit('game_update', {
                    'players': room['players'],
                    'enemies': room.get('enemies', []),
                    'bullets': room.get('bullets', []),
                    'wave': room['current_wave']
                }, room=room_code)
                
        except Exception as e:
            print(f"Error in game update loop: {e}")
        
        await asyncio.sleep(1/30)  # 30 FPS update rate

# Start game loop
async def startup():
    asyncio.create_task(game_update_loop())

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Welcome to Love Royale Multiplayer API! 💕", "status": "active"}

@api_router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Love Royale Multiplayer",
        "active_rooms": len(active_rooms),
        "connected_players": len(player_sessions),
        "timestamp": datetime.now()
    }

@api_router.get("/maps")
async def get_maps():
    """Get available maps"""
    return {
        "maps": [
            {
                "id": map_id,
                "name": config["name"],
                "width": config["width"],
                "height": config["height"]
            }
            for map_id, config in MAP_CONFIGS.items()
        ]
    }

@api_router.get("/rooms")
async def get_active_rooms():
    """Get list of active rooms"""
    return {
        "rooms": [
            {
                "code": room["code"],
                "players": len(room["players"]),
                "max_players": 2,
                "status": room["status"],
                "game_mode": room["game_mode"],
                "map_name": MAP_CONFIGS[room["map_id"]]["name"]
            }
            for room in active_rooms.values()
            if room["status"] == "waiting"
        ]
    }

# Include the router in the main app
app.include_router(api_router)

# Mount SocketIO - Create combined app
socket_app = socketio.ASGIApp(sio, app)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    await startup()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# Export the socket_app for uvicorn
app = socket_app
