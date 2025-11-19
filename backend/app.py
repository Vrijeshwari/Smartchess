
# --- Place this route after app = Flask(__name__) ---

import os
import random
import time
import pandas as pd
import chess
import chess.engine
import atexit
from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import deque
import numpy as np
import csv

# Ensure better randomization
random.seed(int(time.time()))

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://127.0.0.1:5501"], "allow_headers": "*", "methods": ["GET", "POST", "OPTIONS", "PUT", "DELETE"]}}, supports_credentials=True)

# --- Helper: Detect Why a Move is Illegal ---
def get_illegal_move_reason(board, move_uci):
    """
    Simple helper to provide a reason for why a move is illegal.
    Returns just a string message.
    """
    try:
        move = chess.Move.from_uci(move_uci)
        if move in board.legal_moves:
            return ""
        
        from_sq = move.from_square
        to_sq = move.to_square
        from_piece = board.piece_at(from_sq)
        
        if from_piece is None:
            return "No piece on source square."
        if from_piece.color != board.turn:
            return "Cannot move opponent's piece."
        
        test_board = board.copy()
        test_board.push(move)
        if test_board.is_check():
            return "Move leaves your King in check."
        
        from_name = chess.square_name(from_sq)
        to_name = chess.square_name(to_sq)
        return f"Illegal move from {from_name} to {to_name}."
    except:
        return "Illegal move."

# --- Move Quality Feedback Endpoint ---
@app.route('/move-feedback', methods=['POST', 'OPTIONS'])
def move_feedback():
    print("[DEBUG] /move-feedback endpoint hit")
    if request.method == 'OPTIONS':
        return '', 200
    try:
        data = request.get_json()
        print(f"[DEBUG] Incoming data: {data}")
        fen = data.get('fen')
        move_uci = data.get('move')
        if not fen or not move_uci:
            print("[DEBUG] Missing FEN or move in request data")
            return jsonify({'error': 'FEN and move are required'}), 400
        
        try:
            board = chess.Board(fen)
            move = chess.Move.from_uci(move_uci)
        except Exception as e:
            print(f"[ERROR] Failed to parse FEN or move: {e}")
            return jsonify({'error': f'Invalid FEN or move format: {str(e)}'}), 400
        
        # Check if move is illegal
        if move not in board.legal_moves:
            reason = get_illegal_move_reason(board, move_uci)
            print(f"[ILLEGAL MOVE] {move_uci}: {reason}")
            return jsonify({
                'error': 'Illegal move',
                'illegal_reason': reason,
                'move': move_uci
            }), 400

        # Evaluate before move
        # No need to push/pop for eval_before, as `fen` is already the board state before the move
        if stockfish_engine:
            res = analyze_with_retry(board, chess.engine.Limit(time=0.2))
            try:
                if isinstance(res, dict) and 'score' in res:
                    eval_before = res['score'].white().score(mate_score=10000)
                elif isinstance(res, list) and res and 'score' in res[0]:
                    eval_before = res[0]['score'].white().score(mate_score=10000)
            except Exception:
                eval_before = 0
        else:
            eval_before = 0

        # Evaluate after move
        board.push(move) # This is where the user's move is actually applied for eval_after
        if stockfish_engine:
            res = analyze_with_retry(board, chess.engine.Limit(time=0.2))
            try:
                if isinstance(res, dict) and 'score' in res:
                    eval_after = res['score'].white().score(mate_score=10000)
                elif isinstance(res, list) and res and 'score' in res[0]:
                    eval_after = res[0]['score'].white().score(mate_score=10000)
            except Exception:
                eval_after = 0
        else:
            eval_after = 0
        
        # The board is currently in the state *after* the user's move. Pop to get back to original for best move analysis.
        board.pop() 

        best_move = None
        best_eval = eval_before # Initialize with eval_before, as best move is relative to this state
        if stockfish_engine:
            print(f"[DEBUG] Stockfish analysis for best move...")
            try:
                best = analyze_with_retry(board, chess.engine.Limit(time=0.2), multipv=3)
                print(f"[DEBUG] Raw Stockfish best: {best}")
                if isinstance(best, list) and best:
                    best_info = best[0]
                    if 'pv' in best_info and best_info['pv'] and isinstance(best_info['pv'][0], chess.Move):
                        best_move = best_info['pv'][0].uci()
                    if 'score' in best_info:
                        try:
                            best_eval = best_info['score'].white().score(mate_score=10000)
                        except Exception:
                            best_eval = None
                elif isinstance(best, dict):
                    if 'pv' in best and best['pv'] and isinstance(best['pv'][0], chess.Move):
                        best_move = best['pv'][0].uci()
                    if 'score' in best:
                        try:
                            best_eval = best['score'].white().score(mate_score=10000)
                        except Exception:
                            best_eval = None
                else:
                    print(f"[DEBUG] Stockfish analysis did not return expected format: {best}")
            except Exception as e:
                print(f"[WARNING] Error parsing Stockfish best move analysis: {e}")
                best_move = None # Ensure best_move is explicitly None on error
        
        # Calculate difference
        diff = eval_after - best_eval if best_eval is not None else 0 # Handle case where best_eval might be None
        # Label
        if abs(diff) < 30:
            label = 'Best'
        elif abs(diff) < 100:
            label = 'Good'
        elif abs(diff) < 200:
            label = 'Inaccuracy'
        elif abs(diff) < 400:
            label = 'Mistake'
        else:
            label = 'Blunder'
        # Print feedback in terminal (for teacher demo)
        print("[MOVE FEEDBACK]")
        print(f"best_eval   : {best_eval}")
        print(f"best_move   : {best_move}")
        print(f"difference  : {diff}")
        print(f"eval_after  : {eval_after}")
        print(f"eval_before : {eval_before}")
        print(f"label       : {label}")
        print(f"your_move   : {move_uci}")
        resp = jsonify({
            'your_move': move_uci,
            'best_move': best_move,
            'eval_before': eval_before,
            'eval_after': eval_after,
            'best_eval': best_eval,
            'difference': diff,
            'label': label
        })
        resp.headers.add('Access-Control-Allow-Origin', 'http://127.0.0.1:5501')
        resp.headers.add('Access-Control-Allow-Credentials', 'true')
        return resp
    except Exception as e:
        print(f"[EXCEPTION] /move-feedback caught exception: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestClassifier
import joblib

# --- Game Outcome Prediction Model ---
class GameOutcomePredictor:
    def __init__(self):
        self.model = None
        self.is_trained = False
        
    def extract_position_features(self, board):
        """Extract features from chess position for ML prediction"""
        features = {}
        
        # Material count
        piece_values = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, 
                       chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
        white_material = black_material = 0
        white_pieces = black_pieces = 0
        
        # Piece mobility and attacks
        white_mobility = len(list(board.legal_moves)) if board.turn == chess.WHITE else 0
        board.turn = not board.turn  # Switch turn to count black mobility
        black_mobility = len(list(board.legal_moves)) if board.turn == chess.BLACK else 0
        board.turn = not board.turn  # Switch back
        
        # Count pieces and material
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece:
                value = piece_values[piece.piece_type]
                if piece.color == chess.WHITE:
                    white_material += value
                    white_pieces += 1
                else:
                    black_material += value
                    black_pieces += 1
        
        # King safety (simplified)
        white_king_square = board.king(chess.WHITE)
        black_king_square = board.king(chess.BLACK)

        # Handle cases where king might be missing (game over)
        white_king_attacks = len(board.attackers(chess.BLACK, white_king_square)) if white_king_square else 0
        black_king_attacks = len(board.attackers(chess.WHITE, black_king_square)) if black_king_square else 0
        
        features = {
            'material_advantage': white_material - black_material,
            'piece_advantage': white_pieces - black_pieces,
            'mobility_advantage': white_mobility - black_mobility,
            'king_safety_advantage': black_king_attacks - white_king_attacks,
            'game_phase': min(white_pieces + black_pieces, 32) / 32.0,  # 0=endgame, 1=opening
            'white_material': white_material,
            'black_material': black_material,
            'total_moves': len(board.move_stack)
        }
        
        return list(features.values())
    
    def predict_outcome(self, board):
        """Predict game outcome: 0=Black wins, 1=Draw, 2=White wins"""
        try:
            features = self.extract_position_features(board)
            
            # Simple heuristic if model not trained
            if not self.is_trained or self.model is None:
                material_diff = features[0]  # material_advantage
                if material_diff > 3:
                    return 2, 0.8  # White likely wins
                elif material_diff < -3:
                    return 0, 0.8  # Black likely wins
                else:
                    return 1, 0.6  # Draw likely
            
            # Use trained model
            prediction = self.model.predict([features])[0]
            probabilities = self.model.predict_proba([features])[0]
            confidence = max(probabilities)
            
            return int(prediction), float(confidence)
            
        except Exception as e:
            print(f"[ERROR] Prediction failed: {e}")
            return 1, 0.5  # Default to draw with low confidence
    
    def get_prediction_text(self, prediction, confidence):
        """Convert prediction to human readable text"""
        outcomes = {
            0: "Black likely to win",
            1: "Position is balanced", 
            2: "White likely to win"
        }
        
        confidence_text = ""
        if confidence > 0.8:
            confidence_text = " (High confidence)"
        elif confidence > 0.6:
            confidence_text = " (Medium confidence)"
        else:
            confidence_text = " (Low confidence)"
            
        return outcomes.get(prediction, "Unclear") + confidence_text

# Initialize game outcome predictor
game_predictor = GameOutcomePredictor()

def train_elo_model(data_path="user_game_data.csv"):
    if not os.path.exists(data_path):
        return None, None
    
    try:
        # Read CSV with headers
        df = pd.read_csv(data_path)
        print(f"[DEBUG] CSV loaded: {len(df)} rows, columns: {df.columns.tolist()}")
        
        # Check if we have the new format with estimated_elo column
        if 'estimated_elo' in df.columns:
            X = df[["blunders","cpl","moves"]]
            y = df["estimated_elo"]
            print(f"[DEBUG] Using estimated_elo column for training")
        elif 'elo' in df.columns:
            X = df[["blunders","cpl","moves"]]
            y = df["elo"]
            print(f"[DEBUG] Using elo column for training")
        else:
            # Fallback to mapping from result
            result_map = {"1-0": 1400, "0-1": 1000, "1/2-1/2": 1200, "win": 1400, "loss": 1000, "draw": 1200}
            df = df[df["result"].isin(result_map.keys())]
            df["elo"] = df["result"].map(result_map)
            X = df[["blunders","cpl","moves"]]
            y = df["elo"]
            print(f"[DEBUG] Using result mapping for training")
        
        if len(X) < 3:
            print(f"[DEBUG] Not enough data: {len(X)} rows")
            return None, None
            
        print(f"[DEBUG] Training model with {len(X)} samples")
        model = LinearRegression()
        model.fit(X, y)
        print(f"[DEBUG] Model trained successfully")
        return model, X.columns
        
    except Exception as e:
        print(f"[ERROR] Failed to train model: {e}")
        return None, None

def predict_elo(blunders, cpl, moves, model, feature_names):
    if model is None or feature_names is None:
        return None
    
    # Create DataFrame with proper feature names to avoid warnings
    import pandas as pd
    X_pred = pd.DataFrame({
        'blunders': [blunders],
        'cpl': [cpl], 
        'moves': [moves]
    })
    
    # Ensure X_pred columns match feature_names from training
    X_pred = X_pred[feature_names] 

    elo_pred = model.predict(X_pred)[0]
    return float(elo_pred)

class AdaptiveAI:
    def __init__(self, color=chess.BLACK, window=10):
        self.color = color
        self.window = window
        self.moves_window = deque(maxlen=window)
        self.captures = 0
        self.checks = 0
        self.pawn_pushes = 0
        self.total_tracked = 0
        self.center_control = 0
        self.move_count = 0
        self.adaptive_depth = 3
        self.adaptive_randomness = True

    def update_difficulty(self, recent_elo):
        """
        Adjust AI difficulty based on recent Elo (last 5 games average).
        Higher Elo = higher depth, less randomness. Lower Elo = easier AI.
        """
        if recent_elo is None:
            self.adaptive_depth = 3
            self.adaptive_randomness = True
            return
        if recent_elo >= 1350:
            self.adaptive_depth = 5
            self.adaptive_randomness = False
        elif recent_elo >= 1200:
            self.adaptive_depth = 4
            self.adaptive_randomness = False
        elif recent_elo >= 1100:
            self.adaptive_depth = 3
            self.adaptive_randomness = True
        else:
            self.adaptive_depth = 2
            self.adaptive_randomness = True

    def reset(self):
        print(f"[DEBUG] AdaptiveAI.reset() called - move_count before reset: {self.move_count}")
        self.moves_window.clear()
        self.captures = 0
        self.checks = 0
        self.pawn_pushes = 0
        self.total_tracked = 0
        self.center_control = 0
        self.move_count = 0
        print(f"[DEBUG] AdaptiveAI.reset() completed - move_count after reset: {self.move_count}")

    def register_player_move(self, board: chess.Board):
        if not board.move_stack:
            return
        last_move = board.peek()
        is_capture = board.is_capture(last_move)
        gives_check = board.is_check()
        promotion = last_move.promotion is not None
        moved_piece_type = board.piece_type_at(last_move.to_square)
        pawn_push = (moved_piece_type == chess.PAWN)
        center_sqs = {chess.D4, chess.E4, chess.D5, chess.E5}
        if last_move.to_square in center_sqs:
            self.center_control += 1
        if is_capture:
            self.captures += 1
        if gives_check:
            self.checks += 1
        if pawn_push:
            self.pawn_pushes += 1
        if promotion:
            self.pawn_pushes += 1
        self.total_tracked += 1

    def get_player_profile(self):
        if self.total_tracked == 0:
            return "Unknown"
        aggression = (self.captures + self.checks + self.pawn_pushes) / self.total_tracked
        defense = (self.total_tracked - self.captures - self.pawn_pushes) / self.total_tracked
        if aggression > 0.6:
            return "Aggressive"
        elif defense > 0.6:
            return "Defensive"
        else:
            return "Balanced"

    def evaluate_board(self, board: chess.Board):
        piece_values = {
            chess.PAWN: 100,
            chess.KNIGHT: 320,
            chess.BISHOP: 330,
            chess.ROOK: 500,
            chess.QUEEN: 900,
            chess.KING: 20000
        }
        
        # Check if either king is missing (game should be over)
        white_king = board.king(chess.WHITE) is not None
        black_king = board.king(chess.BLACK) is not None
        
        # Massive bonus/penalty for king captures
        if not white_king:
            return -999999  # Black wins (very negative for white)
        if not black_king:
            return 999999   # White wins (very positive for white)
        
        score = 0
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece:
                value = piece_values[piece.piece_type]
                score += value if piece.color == chess.WHITE else -value
        
        # Add king safety evaluation
        white_king_square = board.king(chess.WHITE)
        black_king_square = board.king(chess.BLACK)
        
        # Penalty for king being under attack
        white_king_attackers = len(board.attackers(chess.BLACK, white_king_square))
        black_king_attackers = len(board.attackers(chess.WHITE, black_king_square))
        
        score -= white_king_attackers * 50  # Penalty for white king being attacked
        score += black_king_attackers * 50  # Bonus for attacking black king
        
        return score

    def minimax(self, board, depth, alpha, beta, maximizing):
        if depth == 0 or board.is_game_over():
            return self.evaluate_board(board), None
        best_move = None
        if maximizing:
            max_eval = float("-inf")
            for move in board.legal_moves:
                board.push(move)
                eval_score, _ = self.minimax(board, depth - 1, alpha, beta, False)
                board.pop()
                if eval_score > max_eval:
                    max_eval = eval_score
                    best_move = move
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break
            return max_eval, best_move
        else:
            min_eval = float("inf")
            for move in board.legal_moves:
                board.push(move)
                eval_score, _ = self.minimax(board, depth - 1, alpha, beta, True)
                board.pop()
                if eval_score < min_eval:
                    min_eval = eval_score
                    best_move = move
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break
            return min_eval, best_move

    def get_ai_move(self, board: chess.Board, randomize=None, top_n=3, force_random=False):
        # Use adaptive difficulty
        depth = getattr(self, 'adaptive_depth', 3)
        use_random = self.adaptive_randomness if randomize is None else randomize
        
        # Safety check: ensure there are legal moves
        legal_moves = list(board.legal_moves)
        if not legal_moves:
            print("[ERROR] No legal moves available in get_ai_move!")
            return None
            
        if self.move_count == 0 or force_random:
            return random.choice(legal_moves)
        
        # CRITICAL FIX: Check for immediate king captures first
        king_capture_moves = []
        for move in legal_moves:
            target_piece = board.piece_at(move.to_square)
            if target_piece and target_piece.piece_type == chess.KING:
                king_capture_moves.append(move)
                print(f"[CRITICAL] Found king capture move: {move.uci()}")
        
        # Always prioritize king captures
        if king_capture_moves:
            selected_move = random.choice(king_capture_moves)
            print(f"[CRITICAL] AI selecting king capture: {selected_move.uci()}")
            return selected_move
            
        profile = self.get_player_profile()
        # Optionally, profile can still influence depth
        if profile == "Aggressive":
            depth = max(depth, 4)
        elif profile == "Defensive":
            depth = max(depth, 3)
            
        moves_scores = []
        try:
            maximizing_player = (board.turn == self.color) # Determine if AI is maximizing or minimizing
            for move in board.legal_moves:
                board.push(move)
                score, _ = self.minimax(board, depth - 1, float("-inf"), float("inf"), not maximizing_player) # Pass the correct maximizing/minimizing player
                board.pop()
                moves_scores.append((move, score))
        except Exception as e:
            print(f"[ERROR] Minimax evaluation failed: {e}")
            return random.choice(legal_moves)  # Fallback to random
            
        moves_scores.sort(key=lambda x: -x[1])
        if use_random and len(moves_scores) > 0:
            top_moves = [m[0] for m in moves_scores[:top_n]]
            return random.choice(top_moves)
        if moves_scores:
            return moves_scores[0][0]
        
        # Final fallback
        return random.choice(legal_moves)

STOCKFISH_PATH = r"C:\\Users\\user\\Desktop\\Project\\SmartChess\\stockfish_engine\\stockfish-windows-x86-64-avx2\\stockfish\\stockfish-windows-x86-64-avx2.exe"

def start_stockfish():
    try:
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        print(f"[INFO] Stockfish engine started at {STOCKFISH_PATH}.")
        return engine
    except Exception as e:
        print("[WARNING] Stockfish not found or failed to start:", e)
        return None

stockfish_engine = start_stockfish()
ai_engine = AdaptiveAI()


def analyze_with_retry(board, limit, multipv=None):
    """Run engine analysis with a restart-on-failure policy.

    Returns whatever `engine.analyse` returns, or None on failure.
    If the engine has died, attempt to restart it once and retry the analysis.
    """
    global stockfish_engine
    try:
        if not stockfish_engine:
            stockfish_engine = start_stockfish()
            if not stockfish_engine:
                return None

        if multipv is not None:
            return stockfish_engine.analyse(board, limit, multipv=multipv)
        return stockfish_engine.analyse(board, limit)

    except chess.engine.EngineTerminatedError as ete:
        print(f"[WARNING] Stockfish EngineTerminatedError: {ete}. Attempting restart...")
        try:
            stockfish_engine = start_stockfish()
            if not stockfish_engine:
                return None
            if multipv is not None:
                return stockfish_engine.analyse(board, limit, multipv=multipv)
            return stockfish_engine.analyse(board, limit)
        except Exception as e:
            print(f"[ERROR] Failed to restart/execute Stockfish after termination: {e}")
            return None
    except Exception as e:
        print(f"[WARNING] Stockfish analysis error: {e}")
        return None

@app.route('/ai-move', methods=['POST', 'OPTIONS'])
def ai_move():
    # --- Adaptive Difficulty: Calculate recent Elo and update AI ---
    try:
        if os.path.exists("user_game_data.csv") and os.path.getsize("user_game_data.csv") > 0:
            # Use a more robust CSV reader if issues persist
            df = pd.read_csv("user_game_data.csv")
            print(f"[DEBUG] CSV loaded: {len(df)} rows, columns: {df.columns.tolist()}")
            
            # Ensure columns exist before trying to access them
            if 'estimated_elo' in df.columns and not df.empty:
                recent_elo = df["estimated_elo"].tail(5).mean()
                print(f"[DEBUG] Using estimated_elo for adaptive difficulty: {recent_elo}")
            elif 'elo' in df.columns and not df.empty:
                recent_elo = df["elo"].tail(5).mean()
                print(f"[DEBUG] Using elo column for adaptive difficulty: {recent_elo}")
            else:
                print(f"[DEBUG] CSV has no valid Elo column or is empty, using default difficulty. Columns: {df.columns.tolist()}")
                recent_elo = None
        else:
            recent_elo = None
            print("[DEBUG] No CSV file or empty file, using default difficulty")
    except pd.errors.EmptyDataError:
        print("[WARNING] user_game_data.csv is empty, using default difficulty.")
        recent_elo = None
    except Exception as e:
        print(f"[WARNING] Could not read user_game_data.csv for adaptive difficulty: {e}")
        recent_elo = None
    ai_engine.update_difficulty(recent_elo)
    if request.method == 'OPTIONS':
        return '', 200

    data = request.get_json()
    fen = data.get('fen')
    last_player_move = data.get('last_move')
    is_new_game = data.get('is_new_game', False)
    suggested_move = data.get('suggested_move', None)

    if not fen:
        return jsonify({'error': 'FEN not provided'}), 400

    try:
        board = chess.Board(fen)
        # print(f"[DEBUG] Board turn after FEN initialization: {board.turn}")
    except Exception as e:
        return jsonify({'error': f'Invalid FEN: {str(e)}'}), 400

    # Check for no legal moves (checkmate or stalemate) - REMOVED insufficient material check
    if not board.legal_moves or board.is_game_over():
        if board.is_checkmate():
            winner = 'white' if board.turn == chess.BLACK else 'black'
            print(f"[GAME OVER] Checkmate! Winner: {winner}")
            return jsonify({
                'game_over': True,
                'reason': 'checkmate',
                'winner': winner,
                'fen': fen,
                'message': f'Checkmate! {winner.capitalize()} wins!'
            })
        elif board.is_stalemate():
            print("[GAME OVER] Stalemate!")
            return jsonify({
                'game_over': True,
                'reason': 'stalemate',
                'winner': 'draw',
                'fen': fen,
                'message': 'Stalemate! Game is a draw.'
            })
        else:
            print("[GAME OVER] Game over - other condition")
            return jsonify({
                'game_over': True,
                'reason': 'game_over',
                'winner': 'draw',
                'fen': fen,
                'message': 'Game over!'
            })

    # Enhanced game state detection
    starting_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    total_moves_in_game = len(board.move_stack)
    is_starting_position = (fen == starting_fen)
    
    # More comprehensive new game detection
    is_very_early_game = total_moves_in_game <= 2  # First couple moves
    is_reset_scenario = (is_new_game or is_starting_position)
    
    print(f"[DEBUG] ========== MOVE REQUEST ==========")
    # print(f"[DEBUG] FEN: {fen}")
    # print(f"[DEBUG] Total moves in game: {total_moves_in_game}")
    # print(f"[DEBUG] Is starting position: {is_starting_position}")
    # print(f"[DEBUG] AI move count before check: {ai_engine.move_count}")
    # print(f"[DEBUG] is_new_game flag: {is_new_game}")
    # print(f"[DEBUG] is_very_early_game: {is_very_early_game}")
    # print(f"[DEBUG] is_reset_scenario: {is_reset_scenario}")
    
    # CRITICAL FIX: Reset AI state for new games
    if is_new_game: # Only reset if frontend explicitly indicates new game
        ai_engine.reset()
        print(f"[INFO] *** GAME RESET *** - Reason: new_game={is_new_game}")
    else:
        print(f"[INFO] Continuing game (Total moves: {total_moves_in_game}, AI moves: {ai_engine.move_count})")

    # The board 'fen' is already the current state (after player's move).
    # last_player_move is for profiling only, do NOT re-push it.
    if last_player_move: # This is the player's move that led to the current FEN
        try:
            # CRITICAL FIX: Permanently apply the player's move to the board
            # so that `board.turn` is correctly set to black for AI analysis.
            board.push_uci(last_player_move)
            ai_engine.register_player_move(board)
            # No board.pop() here, as the player's move needs to persist for AI's turn
        except Exception as ex:
            print(f"[WARNING] Invalid last_move provided: {ex}")
    
    TOP_N = 3
    move = None
    engine_used = 'adaptive'
    stockfish_eval = None

    # FIXED: Check if this is first AI move AFTER potential reset
    is_first_ai_move = (ai_engine.move_count == 0)
    
    print(f"[DEBUG] After reset check - AI move_count: {ai_engine.move_count}")
    print(f"[DEBUG] is_first_ai_move: {is_first_ai_move}")
    
    if suggested_move:
        print(f"[DEBUG] Applying suggested move: {suggested_move}")
        move = chess.Move.from_uci(suggested_move)
        engine_used = 'suggested'
    elif is_first_ai_move:
        print(f"[DEBUG] *** MAKING FIRST AI MOVE ***")
        
        # For first move, make it completely random from ALL legal moves
        legal_moves = list(board.legal_moves)
        
        if not legal_moves:
            print("[CRITICAL] No legal moves available for first AI move!")
            return jsonify({'error': 'No legal moves available'}), 500
        
        # Debug: Show what types of moves are available
        move_types = {}
        for move_option in legal_moves:
            piece = board.piece_at(move_option.from_square)
            if piece:
                piece_name = chess.piece_name(piece.piece_type).title()
                if piece_name not in move_types:
                    move_types[piece_name] = []
                move_types[piece_name].append(move_option.uci())
        
        print(f"[DEBUG] Total legal moves available for first move: {len(legal_moves)}")
        print(f"[DEBUG] Available moves by piece type:")
        for piece_type, moves in move_types.items():
            print(f"  {piece_type}: {moves}")
        
        # Add extra randomization with time-based seed
        random.seed(int(time.time() * 1000000) % 1000000)
        
        # Select random move
        move = random.choice(legal_moves)
        ai_engine.move_count += 1  # Increment AFTER selection
        engine_used = 'random_first_move'
        
        print(f"[DEBUG] After first move selection, AI move_count: {ai_engine.move_count}")
        
        # Get Stockfish evaluation for the random move (quick analysis to avoid buffering)
        if stockfish_engine:
            try:
                res = analyze_with_retry(board, chess.engine.Limit(time=0.2))
                if isinstance(res, dict) and 'score' in res:
                    stockfish_eval = res['score'].white().score(mate_score=10000)
                elif isinstance(res, list) and res and 'score' in res[0]:
                    stockfish_eval = res[0]['score'].white().score(mate_score=10000)
                else:
                    print(f"[WARNING] Stockfish did not return a score for first AI move: {res}")
            except Exception as e:
                print(f"[ERROR] Error getting Stockfish eval for first AI move: {e}")
        
        selected_piece = board.piece_at(move.from_square)
        selected_piece_name = chess.piece_name(selected_piece.piece_type).title() if selected_piece else "Unknown"
        print(f"[INFO] AI selected RANDOM first move: {move.uci()} using {selected_piece_name} from {len(legal_moves)} total options")
    
    else:
        # print(f"[DEBUG] Strategic move generation for turn: {board.turn}")
        print(f"[DEBUG] Making strategic move (not first move)")
        
        # CRITICAL FIX: Check for immediate king captures first
        legal_moves = list(board.legal_moves)
        king_capture_moves = []
        
        for move in legal_moves:
            target_piece = board.piece_at(move.to_square)
            if target_piece and target_piece.piece_type == chess.KING:
                king_capture_moves.append(move)
                print(f"[CRITICAL] Stockfish found king capture move: {move.uci()}")
        
        # Always prioritize king captures over Stockfish analysis
        if king_capture_moves:
            move = random.choice(king_capture_moves)
            engine_used = 'king_capture_priority'
            print(f"[CRITICAL] Prioritizing king capture: {move.uci()}")
            # Get Stockfish evaluation for the king capture move
            if stockfish_engine:
                try:
                    res = analyze_with_retry(board, chess.engine.Limit(time=0.1))
                    if isinstance(res, dict) and 'score' in res:
                        stockfish_eval = res['score'].white().score(mate_score=10000)
                except Exception as e:
                    print("[WARNING] Stockfish evaluation error on king capture:", e)
                    stockfish_eval = 999999  # Assume mate value for king capture
        else:
            # For subsequent moves without king captures, use Stockfish strategically
            if stockfish_engine:
                try:
                    result = analyze_with_retry(board, chess.engine.Limit(time=0.3), multipv=TOP_N)
                    top_moves = []
                    eval_score = None

                    if isinstance(result, list):
                        for r in result:
                            try:
                                if 'pv' in r and r['pv'] and isinstance(r['pv'][0], chess.Move):
                                    top_moves.append(r['pv'][0])
                                if eval_score is None and 'score' in r:
                                    eval_score = r['score'].white().score(mate_score=10000)
                            except Exception:
                                continue
                    elif isinstance(result, dict):
                        if 'pv' in result and result['pv'] and isinstance(result['pv'][0], chess.Move):
                            top_moves.append(result['pv'][0])
                        if 'score' in result:
                            eval_score = result['score'].white().score(mate_score=10000)
                    
                    if top_moves:
                        move = random.choice(top_moves)
                        engine_used = 'stockfish'
                    else:
                        move = None
                    stockfish_eval = eval_score
                except Exception as e:
                    print(f"[WARNING] Stockfish error during strategic analysis: {e}")
                    move = None

            # Fallback to adaptive AI if Stockfish fails
            if not move:
                move = ai_engine.get_ai_move(board, randomize=True, top_n=TOP_N)
                engine_used = 'adaptive'
                ai_engine.move_count += 1  # Increment for adaptive AI moves too
                
                # Get evaluation from our adaptive AI when Stockfish unavailable
                if stockfish_eval is None:
                    try:
                        ai_eval = ai_engine.evaluate_board(board)
                        stockfish_eval = ai_eval / 10  # Scale down to centipawn-like values
                        print(f"[INFO] Using adaptive AI evaluation: {stockfish_eval}")
                    except Exception as e:
                        print(f"[WARNING] Adaptive evaluation error: {e}")
                        stockfish_eval = 0  # Neutral evaluation as fallback
            else:
                # Increment move count for Stockfish moves (except first move which was already incremented)
                # Ensure we only increment if the move was indeed selected by stockfish and not a fallback
                if engine_used == 'stockfish' and not is_first_ai_move: 
                    ai_engine.move_count += 1
        
        print(f"[DEBUG] Strategic move selected: {move.uci() if move else 'None'}")

    # Safety check with fallback - ensure move is a valid chess.Move object
    if not isinstance(move, chess.Move) or move not in board.legal_moves:
        print("ERROR: Selected move is not a legal chess.Move object or is None! Received:", type(move), move)
        print("[EMERGENCY] Generating fallback move...")
        
        # Emergency fallback: get ANY legal move
        legal_moves = list(board.legal_moves)
        if legal_moves:
            move = random.choice(legal_moves)
            engine_used = 'emergency_fallback'
            print(f"[EMERGENCY] Selected fallback move: {move.uci()}")
        else:
            print("[CRITICAL] No legal moves available!")
            return jsonify({'error': 'No legal moves available - game should be over'}), 500

    board.push(move)

    def predict_outcome(eval_score, board=None):
        # If Stockfish evaluation is available
        if eval_score is not None:
            if eval_score > 200:
                return "White likely to win"
            elif eval_score < -200:
                return "Black likely to win"
            else:
                return "Unclear/Equal"
        
        # Fallback: Use our own board evaluation when Stockfish fails
        if board:
            try:
                ai_eval = ai_engine.evaluate_board(board)
                
                if ai_eval > 500:
                    return "White likely to win"
                elif ai_eval < -500:
                    return "Black likely to win"
                elif abs(ai_eval) < 100:
                    return "Equal position"
                else:
                    return "Slight advantage"
            except Exception as e:
                print(f"[WARNING] Board evaluation error: {e}")
        
        if board and len(board.move_stack) > 40:
            return "Endgame - outcome unclear"
        elif board and len(board.move_stack) < 10:
            return "Opening - early to predict"
        else:
            return "Mid-game position"

    outcome = predict_outcome(stockfish_eval, board)

    # Natural language explanation for the AI move
    def explain_move(move, board_before, board_after):
        piece = board_before.piece_at(move.from_square)
        piece_name = chess.piece_name(piece.piece_type).title() if piece else "Piece"
        explanation = f"{piece_name} moved from {chess.square_name(move.from_square)} to {chess.square_name(move.to_square)}."

        # Determine if a piece was captured by checking the target square on board_before
        captured_piece = board_before.piece_at(move.to_square)
        # Guard against None values for piece or captured_piece
        if captured_piece and piece and getattr(captured_piece, 'color', None) is not None and getattr(piece, 'color', None) is not None:
            if captured_piece.color != piece.color:
                explanation += f" Captured {chess.piece_name(captured_piece.piece_type)}."
        
        # Check for check
        if board_after.is_check():
            explanation += " This move gives check."
        # Center control
        if move.to_square in [chess.D4, chess.E4, chess.D5, chess.E5]:
            explanation += " Controls the center."
        # Promotion
        if move.promotion:
            explanation += f" Promoted to {chess.piece_name(move.promotion)}."
        # Default
        return explanation

    # Make a copy of the board before move for explanation
    import copy
    board_before = copy.deepcopy(board)
    # board already has move pushed, so pop and push for before/after
    board.pop()
    board_after = copy.deepcopy(board)
    board.push(move)
    explanation = explain_move(move, board_before, board)

    # Get outcome prediction for current position
    try:
        outcome_pred, outcome_conf = game_predictor.predict_outcome(board)
        outcome_text = game_predictor.get_prediction_text(outcome_pred, outcome_conf)
    except Exception as e:
        print(f"[WARNING] Outcome prediction failed: {e}")
        outcome_pred, outcome_conf, outcome_text = 1, 0.5, "Position unclear"

    # CHECK FOR CHECKMATE OR STALEMATE AFTER AI MOVE
    game_over = False
    game_over_reason = None
    game_winner = None
    
    if not board.legal_moves or board.is_game_over():
        if board.is_checkmate():
            game_over = True
            game_over_reason = 'checkmate'
            game_winner = 'white' if board.turn == chess.BLACK else 'black'
            print(f"[GAME OVER] AI Move resulted in Checkmate! Winner: {game_winner}")
        elif board.is_stalemate():
            game_over = True
            game_over_reason = 'stalemate'
            game_winner = 'draw'
            print(f"[GAME OVER] AI Move resulted in Stalemate!")
        else:
            game_over = True
            game_over_reason = 'game_over'
            game_winner = 'draw'
            print(f"[GAME OVER] AI Move resulted in game over - other condition")

    response = {
        'move': move.uci(),
        'fen': board.fen(),
        'profile': ai_engine.get_player_profile(),
        'engine': engine_used,
        'outcome_prediction': outcome_text,
        'outcome_confidence': round(outcome_conf, 3),
        'eval_score': stockfish_eval if stockfish_eval is not None else "N/A",
        'move_number': ai_engine.move_count,
        'is_first_move': is_first_ai_move,
        'game_state': 'new_game' if is_first_ai_move else 'ongoing',
        'explanation': explanation,
        'position_analysis': {
            'material_balance': 'Check /predict-outcome for detailed analysis',
            'recommended_strategy': 'Focus on ' + ('attack' if outcome_pred == 2 else 'defense' if outcome_pred == 0 else 'balanced play')
        },
        'game_over': game_over,
        'reason': game_over_reason,
        'winner': game_winner
    }
    
    print(f"[DEBUG] ========== FINAL RESPONSE ==========")
    print("AI Response:", response)
    print(f"[DEBUG] ====================================")
    resp = jsonify(response)
    resp.headers.add('Access-Control-Allow-Origin', 'http://127.0.0.1:5501')
    resp.headers.add('Access-Control-Allow-Credentials', 'true')
    return resp

# Add a manual reset endpoint for debugging
@app.route('/force-reset', methods=['POST', 'OPTIONS'])
def force_reset():
    if request.method == 'OPTIONS':
        return '', 200
    
    global ai_engine
    ai_engine = AdaptiveAI()  # Fresh instance
    print("[INFO] *** FORCED RESET *** - AI completely reset")
    return jsonify({
        'message': 'AI forcefully reset', 
        'ai_move_count': ai_engine.move_count,
        'status': 'fresh_start'
    })

@app.route('/predict-outcome', methods=['POST', 'OPTIONS'])
def predict_game_outcome():
    """Real-time game outcome prediction endpoint"""
    if request.method == 'OPTIONS':
        return '', 200
    
    data = request.get_json()
    fen = data.get('fen')
    
    if not fen:
        return jsonify({'error': 'FEN string required'}), 400
    
    try:
        board = chess.Board(fen)
        
        # Get prediction
        prediction, confidence = game_predictor.predict_outcome(board)
        prediction_text = game_predictor.get_prediction_text(prediction, confidence)
        
        # Extract additional analysis
        features = game_predictor.extract_position_features(board)
        
        response = {
            'prediction': int(prediction),
            'confidence': round(confidence, 3),
            'prediction_text': prediction_text,
            'analysis': {
                'material_advantage': features[0],
                'mobility_advantage': features[2], 
                'game_phase': round(features[4], 2),
                'total_moves': features[7]
            },
            'recommendations': get_position_recommendations(board, prediction)
        }
        
        print(f"[OUTCOME PREDICTION] {prediction_text} (Confidence: {confidence:.2f})")
        return jsonify(response)
        
    except Exception as e:
        print(f"[ERROR] Outcome prediction failed: {e}")
        return jsonify({'error': str(e)}), 500

def get_position_recommendations(board, prediction):
    """Get strategic recommendations based on position"""
    recommendations = []
    
    # Basic recommendations based on prediction
    if prediction == 2:  # White advantage
        recommendations.append("White should maintain pressure and avoid trades")
        recommendations.append("Look for tactical opportunities to increase advantage")
    elif prediction == 0:  # Black advantage  
        recommendations.append("Black should consolidate advantage")
        recommendations.append("Consider simplifying to winning endgame")
    else:  # Balanced
        recommendations.append("Position is roughly equal")
        recommendations.append("Look for imbalances to create winning chances")
    
    # Game phase recommendations
    if len(board.move_stack) < 20:
        recommendations.append("Focus on piece development and king safety")
    elif len(board.move_stack) > 60:
        recommendations.append("Endgame: activate king and push passed pawns")
    else:
        recommendations.append("Middlegame: look for tactical combinations")
    
    return recommendations

# Add endpoint to check current AI state
@app.route('/ai-status', methods=['GET'])
def ai_status():
    return jsonify({
        'move_count': ai_engine.move_count,
        'profile': ai_engine.get_player_profile(),
        'total_tracked': ai_engine.total_tracked,
        'is_fresh_start': ai_engine.move_count == 0
    })

# --- ELO Prediction Endpoint ---
@app.route('/predict-elo', methods=['POST', 'OPTIONS'])
def predict_elo_api():
    if request.method == 'OPTIONS':
        return '', 200
    
    print("[DEBUG] predict-elo endpoint called")
    data = request.get_json()
    print(f"[DEBUG] Received data: {data}")
    
    # Validate input
    required_fields = ["blunders", "cpl", "moves"]
    if not all(field in data for field in required_fields):
        print(f"[ERROR] Missing fields. Got: {list(data.keys())}")
        return jsonify({"error": "Missing required fields: blunders, cpl, moves"}), 400
    
    try:
        blunders = int(data["blunders"])
        cpl = float(data["cpl"])
        moves = int(data["moves"])
        print(f"[DEBUG] Parsed values - blunders: {blunders}, cpl: {cpl}, moves: {moves}")
    except Exception as e:
        print(f"[ERROR] Invalid input types: {e}")
        return jsonify({"error": f"Invalid input types: {e}"}), 400

    # Train/load model
    print("[DEBUG] Training/loading model...")
    model, feature_names = train_elo_model("user_game_data.csv")
    if model is None or feature_names is None:
        print("[ERROR] Model training failed")
        return jsonify({"error": "Not enough data to train Elo model. Play and save more games first."}), 400

    # Predict Elo
    try:
        print("[DEBUG] Making prediction...")
        elo = predict_elo(blunders, cpl, moves, model, feature_names)
        print(f"[DEBUG] Predicted Elo: {elo}")
        return jsonify({"predicted_elo": round(elo, 2)})
    except Exception as e:
        print(f"[ERROR] Prediction failed: {e}")
        return jsonify({"error": f"Prediction failed: {e}"}), 500

@app.route('/save-game-data', methods=['POST', 'OPTIONS'])
def save_game_data():
    if request.method == 'OPTIONS':
        return '', 200
    
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    try:
        # Extract game data with proper attribute names
        result = data.get('result', 'draw')
        blunders = data.get('blunders', 0)
        cpl = data.get('cpl', 0)
        moves = data.get('moves', 1)
        captured_by_player = data.get('captured_by_player', 0)
        captured_by_ai = data.get('captured_by_ai', 0)
        estimated_elo = data.get('estimated_elo', 1200)
        
        # Ensure CSV file has headers if it's empty or doesn't exist
        csv_file = 'user_game_data.csv'
        file_exists = os.path.exists(csv_file)
        
        # Check if file is empty or doesn't have headers
        if not file_exists or os.path.getsize(csv_file) == 0:
            # Create CSV with headers
            with open(csv_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow([
                    'result', 'blunders', 'cpl', 'moves', 
                    'captured_by_player', 'captured_by_ai', 'estimated_elo'
                ])
        
        # Save to CSV with proper attributes
        with open(csv_file, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                result, blunders, cpl, moves, 
                captured_by_player, captured_by_ai, round(estimated_elo)
            ])
        
        print(f"[GAME DATA SAVED] Result: {result}, Blunders: {blunders}, CPL: {cpl}, Moves: {moves}")
        print(f"[GAME DATA SAVED] Captured by Player: {captured_by_player}, Captured by AI: {captured_by_ai}")
        print(f"[GAME DATA SAVED] Estimated ELO: {estimated_elo}")
        
        return jsonify({
            'success': True, 
            'estimated_elo': round(estimated_elo),
            'message': 'Game data saved successfully with proper attributes'
        })
    except Exception as e:
        print(f"[ERROR] Failed to save game data: {e}")
        return jsonify({'error': f'Failed to save game data: {e}'}), 500

@atexit.register
def cleanup():
    if stockfish_engine:
        try:
            stockfish_engine.quit()
        except Exception as e:
            print(f"[WARNING] Error quitting stockfish engine during cleanup: {e}")

# @app.after_request
# def after_request(response):
#     response.headers.add('Access-Control-Allow-Origin', 'http://127.0.0.1:5501')
#     response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
#     response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,DELETE')
#     response.headers.add('Access-Control-Allow-Credentials', 'true')
#     return response

# --- Difficulty Setting Endpoint ---
@app.route('/set-difficulty', methods=['POST', 'OPTIONS'])
def set_difficulty():
    if request.method == 'OPTIONS':
        return '', 200
    
    data = request.get_json()
    difficulty = data.get('difficulty', 'easy')
    
    # Update AI difficulty settings
    if difficulty == 'easy':
        ai_engine.adaptive_depth = 2
        ai_engine.adaptive_randomness = True
    elif difficulty == 'hard':
        ai_engine.adaptive_depth = 4
        ai_engine.adaptive_randomness = False
    elif difficulty == 'difficult':
        ai_engine.adaptive_depth = 5
        ai_engine.adaptive_randomness = False
    
    print(f"[SETTINGS] Difficulty set to: {difficulty} (depth: {ai_engine.adaptive_depth}, random: {ai_engine.adaptive_randomness})")
    
    return jsonify({
        'success': True,
        'difficulty': difficulty,
        'depth': ai_engine.adaptive_depth,
        'randomness': ai_engine.adaptive_randomness
    })

# --- Move Suggestion Endpoint ---
@app.route('/suggest-move', methods=['POST'])
def suggest_move():
    if request.method == 'OPTIONS':
        response = app.make_response('')
        response.headers.add('Access-Control-Allow-Origin', 'http://127.0.0.1:5501')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,DELETE')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    data = request.get_json()
    fen = data.get('fen')
    
    if not fen:
        return jsonify({'error': 'FEN string required'}), 400
    
    try:
        board = chess.Board(fen)
        
        if not board.legal_moves or board.is_game_over():
            return jsonify({'error': 'No legal moves available'}), 400
        
        suggested_move = None
        explanation = "No suggestion available"
        
        # Use Stockfish for best move suggestion
        if stockfish_engine:
            try:
                result = analyze_with_retry(board, chess.engine.Limit(time=1.0), multipv=1)
                if isinstance(result, list) and result:
                    if 'pv' in result[0] and result[0]['pv']:
                        suggested_move = result[0]['pv'][0].uci()
                elif isinstance(result, dict) and 'pv' in result and result['pv']:
                    suggested_move = result['pv'][0].uci()
                
                if suggested_move:
                    explanation = "This is the best move according to the engine"
            except Exception as e:
                print(f"[WARNING] Stockfish suggestion failed: {e}")
        
        # Fallback to adaptive AI if Stockfish fails
        if not suggested_move:
            fallback_move = ai_engine.get_ai_move(board, randomize=False, top_n=1)
            if fallback_move:
                suggested_move = fallback_move.uci()
                explanation = "AI suggests this move"
        
        return jsonify({
            'suggested_move': suggested_move,
            'explanation': explanation,
            'engine': 'stockfish' if stockfish_engine and suggested_move else 'adaptive'
        })
        
    except Exception as e:
        print(f"[ERROR] Move suggestion failed: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=False, use_reloader=False)