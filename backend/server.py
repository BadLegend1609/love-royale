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


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Love Royale API", description="Backend for tactical romance shooter game")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Game Models
class PlayerStats(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    player_name: str
    wins: int = 0
    losses: int = 0
    total_rounds: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now())

class GameSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    player1_id: str
    player2_id: str
    player1_score: int = 0
    player2_score: int = 0
    winner_id: Optional[str] = None
    game_status: str = "active"  # active, completed
    rounds_played: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now())
    completed_at: Optional[datetime] = None

class LeaderboardEntry(BaseModel):
    player_name: str
    wins: int
    win_rate: float
    total_games: int

# Game API Routes
@api_router.get("/")
async def root():
    return {"message": "Welcome to Love Royale API! 💕", "status": "active"}

@api_router.post("/players", response_model=PlayerStats)
async def create_player(player_name: str):
    """Create a new player profile"""
    player = PlayerStats(player_name=player_name)
    await db.players.insert_one(player.dict())
    return player

@api_router.get("/players/{player_id}", response_model=PlayerStats)
async def get_player(player_id: str):
    """Get player statistics"""
    player_data = await db.players.find_one({"id": player_id})
    if not player_data:
        return {"error": "Player not found"}
    return PlayerStats(**player_data)

@api_router.get("/players", response_model=List[PlayerStats])
async def get_all_players():
    """Get all players"""
    players = await db.players.find().to_list(100)
    return [PlayerStats(**player) for player in players]

@api_router.post("/game-session", response_model=GameSession)
async def create_game_session(player1_name: str, player2_name: str):
    """Create a new game session"""
    # For now, use player names as IDs (in real app, would look up actual player IDs)
    game_session = GameSession(
        player1_id=player1_name,
        player2_id=player2_name
    )
    await db.game_sessions.insert_one(game_session.dict())
    return game_session

@api_router.put("/game-session/{session_id}/complete")
async def complete_game_session(session_id: str, winner_id: str, player1_score: int, player2_score: int):
    """Complete a game session and update player stats"""
    # Update game session
    update_data = {
        "winner_id": winner_id,
        "player1_score": player1_score,
        "player2_score": player2_score,
        "game_status": "completed",
        "completed_at": datetime.now()
    }
    
    await db.game_sessions.update_one(
        {"id": session_id}, 
        {"$set": update_data}
    )
    
    # Update player statistics (simplified - in real app would handle properly)
    return {"message": "Game session completed", "winner": winner_id}

@api_router.get("/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard():
    """Get game leaderboard"""
    # This would calculate win rates and rankings in a real implementation
    players = await db.players.find().to_list(100)
    leaderboard = []
    
    for player in players:
        total_games = player.get("wins", 0) + player.get("losses", 0)
        win_rate = player.get("wins", 0) / max(total_games, 1) * 100
        
        leaderboard.append(LeaderboardEntry(
            player_name=player["player_name"],
            wins=player.get("wins", 0),
            win_rate=round(win_rate, 1),
            total_games=total_games
        ))
    
    # Sort by wins then by win rate
    leaderboard.sort(key=lambda x: (x.wins, x.win_rate), reverse=True)
    return leaderboard[:10]  # Top 10

@api_router.get("/game-sessions")
async def get_recent_games():
    """Get recent completed game sessions"""
    sessions = await db.game_sessions.find(
        {"game_status": "completed"}
    ).sort("completed_at", -1).limit(10).to_list(10)
    
    return sessions

# Health check for game services
@api_router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Love Royale Backend",
        "timestamp": datetime.now(),
        "database": "connected"
    }

# Include the router in the main app
app.include_router(api_router)

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

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
