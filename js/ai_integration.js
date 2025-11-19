import { currentPlayer, gameBoard, moveHistory, gameEnded, isNewGame, pieces, capturedWhite, capturedBlack, isPieceOwnedByCurrentPlayer, isValidMove, updateAIMode, switchPlayer, checkGameEnd, setNewGameStatus, setGameEndedStatus } from './game_core.js';
import { createBoard, updateCapturedPieces, updateGameInfo, updateGameStatus, showFeedbackPopup, openGameStatistics, updateAIExplanation, clearMoveSuggestion, clearSelection } from './ui_handlers.js';
import { playSound } from './audio_manager.js';
import { boardToFEN, fenToBoard, calculateCPL } from './utils.js';

export let currentSuggestion = null;

// --- Game Outcome Prediction Functions (NEW AI/ML Feature) ---
export async function updateOutcomePrediction(fen) {
    try {
        const response = await fetch('http://127.0.0.1:5000/predict-outcome', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fen: fen })
        });
        
        if (response.ok) {
            const data = await response.json();
            displayOutcomePrediction(data);
        } else {
            console.warn('Outcome prediction failed');
        }
    } catch (error) {
        console.warn('Could not get outcome prediction:', error);
    }
}

export function displayOutcomePrediction(predictionData) {
    const outcomeElement = document.getElementById('outcomePrediction');
    const confidenceElement = document.getElementById('predictionConfidence');
    
    if (outcomeElement && confidenceElement) {
        outcomeElement.textContent = `🎯 ${predictionData.prediction_text}`;
        confidenceElement.textContent = `📊 Confidence: ${(predictionData.confidence * 100).toFixed(1)}%`;
        
        // Color coding based on prediction
        outcomeElement.className = 'outcome-prediction';
        if (predictionData.prediction === 2) {
            outcomeElement.style.color = '#4CAF50'; // Green for White advantage
        } else if (predictionData.prediction === 0) {
            outcomeElement.style.color = '#f44336'; // Red for Black advantage
        } else {
            outcomeElement.style.color = '#FF9800'; // Orange for balanced
        }
    }
}

// Call prediction on game start
export function initializePrediction() {
    const fen = boardToFEN();
    console.log('[DEBUG] Initializing prediction with FEN:', fen);
    updateOutcomePrediction(fen);
}

// Call backend to get Elo prediction after game ends
export async function getEloPrediction() {
    // --- Automatic calculation of blunders, cpl, result ---
    // Blunders: count illegal move attempts (tracked globally)
    const blunders = window.blunderCount || 0;
    // CPL: proxy as number of non-capture moves (for demo)
    const cpl = window.nonCaptureMoves || 0;
    const moves = moveHistory.length;

    // Result: win if black king captured, loss if white king captured, draw if both kings present at end of 80 moves
    let result = 'draw';
    let whiteKing = false, blackKing = false;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (gameBoard[r][c] === pieces.white.king) whiteKing = true;
            if (gameBoard[r][c] === pieces.black.king) blackKing = true;
        }
    }
    if (!blackKing && whiteKing) result = 'win';
    else if (!whiteKing && blackKing) result = 'loss';
    else if (moves >= 80) result = 'draw';

    // Save game data to backend for training
    try {
        await fetch('http://127.0.0.1:5000/save-game-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result, blunders, cpl, moves })
        });
    } catch (err) {
        console.warn('Game data save failed:', err);
    }
    try {
        const res = await fetch('http://127.0.0.1:5000/predict-elo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blunders, cpl, moves })
        });
        const data = await res.json();
        if (data.predicted_elo) {
            // Enhanced Elo prediction - keep logic but remove alert
            const eloRating = Math.round(data.predicted_elo);
            let eloDescription = '';
            
            if (eloRating >= 1400) {
                eloDescription = 'Strong Player 💪';
            } else if (eloRating >= 1200) {
                eloDescription = 'Intermediate Player 📈';
            } else if (eloRating >= 1000) {
                eloDescription = 'Beginner Player 🌱';
            } else {
                eloDescription = 'Learning Player 📚';
            }
            
            // Log to console instead of showing alert
            console.log(`🏆 Your Performance Analysis:`);
            console.log(`⭐ Estimated Elo: ${eloRating}`);
            console.log(`📊 Skill Level: ${eloDescription}`);
            console.log(`📈 Game Stats:`);
            console.log(`• Total Moves: ${moves}`);
            console.log(`• Blunders: ${blunders}`);
            console.log(`• Average CPL: ${cpl}`);
            console.log(`💡 Keep playing to improve your rating!`);
        } else {
            console.log('📊 Not enough data to estimate Elo yet. Play more games to get your rating!');
        }
    } catch (err) {
        console.warn('Failed to contact backend for Elo prediction. Please ensure the Python server is running.');
    }
}

// End game and show statistics in the game statistics panel
export async function endGameWithStatistics(winner, endType) {
    console.debug('[AI] endGameWithStatistics called. winner:', winner, 'endType:', endType);
    setGameEndedStatus(true);
    updateGameStatus(`Game Over!`);
    
    const moves = moveHistory.length;
    const capturedByPlayer = capturedBlack.length;
    const capturedByAI = capturedWhite.length;
    const blunders = window.blunderCount || 0;
    const cpl = calculateCPL();
    
    let eloPrediction = 'Calculating...';
    try {
        const eloResponse = await fetch('http://127.0.0.1:5000/predict-elo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                blunders: blunders, 
                cpl: cpl, 
                moves: moves 
            })
        });
        
        if (eloResponse.ok) {
            const eloData = await eloResponse.json();
            if (eloData.predicted_elo) {
                eloPrediction = Math.round(eloData.predicted_elo);
            } else {
                eloPrediction = 'Insufficient data';
            }
        }
    } catch (error) {
        console.warn('ELO prediction failed:', error);
        eloPrediction = 'Unavailable';
    }
    
    await saveGameDataWithAttributes(winner, blunders, cpl, moves, capturedByPlayer, capturedByAI);
    
    openGameStatistics(moves, capturedByPlayer, capturedByAI, blunders, cpl, eloPrediction, winner, endType);
    
    if (winner.includes('User')) {
        playSound('victory');
    } else if (winner.includes('AI')) {
        // console.log('🤖 AI Victory! Better luck next time!'); // REMOVED DEBUG LOG
    }
    
    getEloPrediction();
}

// --- UPDATED AI Move via Python Backend ---
export async function aiMove(suggestedMove = null) {
    const fen = boardToFEN();
    const lastMoveEntry = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
    // Support both legacy string entries and new object entries
    const lastMove = lastMoveEntry ? (lastMoveEntry.move || lastMoveEntry) : null; // Extract move string or use legacy string
    const fenBeforeLastMove = lastMoveEntry ? (lastMoveEntry.fenBefore || fen) : fen; // Use fenBefore if available, else current fen
    
    // Determine current player color for difficulty context
    const playerColor = currentPlayer === 'white' ? 'black' : 'white';
    
    try {
        const res = await fetch('http://127.0.0.1:5000/ai-move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fen: fenBeforeLastMove, // Send FEN before the last move
                last_move: lastMove,
                is_new_game: isNewGame,
                suggested_move: suggestedMove, // Pass the suggested move to the backend
                difficulty: window.gameSettings?.difficulty || 'easy', // Pass difficulty setting
                player_color: playerColor // Pass current AI player color
            })
        });
        const data = await res.json();
        
        if (data.game_over) {
            console.debug('[AI] aiMove received game_over from backend:', data);
            let winner = '';
            let endType = data.reason;
            
            if (data.winner === 'white') {
                winner = 'User (White)';
            } else if (data.winner === 'black') {
                winner = 'AI (Black)';
            } else {
                winner = 'Draw';
            }
            
            setGameEndedStatus(true);
            endGameWithStatistics(winner, endType);
            return;
        }
        
        if (data.move && data.fen) {
            const previousBoard = gameBoard.map(row => [...row]);

            fenToBoard(data.fen);
            // Record AI's move in the same object format used for player moves
            moveHistory.push({ move: data.move, fenBefore: fenBeforeLastMove });
            
            // Detect captures by comparing piece counts before and after the AI move.
            // This counts symbols rather than comparing square-by-square so moved pieces
            // aren't mis-classified as captures.
            function countPieces(board) {
                const counts = {};
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        const p = board[r][c];
                        if (!p) continue;
                        counts[p] = (counts[p] || 0) + 1;
                    }
                }
                return counts;
            }

            const beforeCounts = countPieces(previousBoard);
            const afterCounts = countPieces(gameBoard);

            // For any symbol whose count decreased, record the difference as captured pieces.
            Object.keys(beforeCounts).forEach(sym => {
                const beforeN = beforeCounts[sym] || 0;
                const afterN = afterCounts[sym] || 0;
                if (afterN < beforeN) {
                    const lost = beforeN - afterN;
                    for (let i = 0; i < lost; i++) {
                        if (Object.values(pieces.white).includes(sym)) {
                            // White piece was captured by AI
                            capturedWhite.push(sym);
                        } else if (Object.values(pieces.black).includes(sym)) {
                            // Black piece was captured (rare on AI move) by player
                            capturedBlack.push(sym);
                        } else {
                            // Unknown symbol: record in capturedWhite by default
                            capturedWhite.push(sym);
                        }
                    }
                }
            });
            
            createBoard();
            updateCapturedPieces();
            switchPlayer(); // Use the exported function to switch player
            updateGameInfo();

            checkGameEnd(updateGameStatus, endGameWithStatistics);

            if (isNewGame) {
                setNewGameStatus(false);
                updateAIExplanation('AI made its first move.'); // Clear and set initial explanation
            }
            
            const newFen = boardToFEN();
            updateOutcomePrediction(newFen);
            
            if (data.explanation) {
                updateAIExplanation(data.explanation);
            } else if (data.engine === 'random_first_move') {
                updateAIExplanation('AI made a random opening move.');
            } else {
                updateAIExplanation('AI made a strategic move');
            }
            
            clearMoveSuggestion();
        } else {
            console.error('AI error: ', data.error || 'Unknown error');
        }
    } catch (err) {
        console.error('AI Backend Error:', err);
        // alert('Failed to contact AI backend. Is Python server running?'); // Removed alert
    }
}

// Move Suggestion System
export async function showMoveSuggestion() {
    if (currentPlayer !== 'white') {
        showFeedbackPopup('Wait for your turn!', 'inaccuracy');
        return;
    }
    
    const fen = boardToFEN();
    
    try {
        const response = await fetch('http://127.0.0.1:5000/suggest-move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fen: fen })
        });
        
        if (response.ok) {
            const data = await response.json();
            currentSuggestion = data;
            
            const content = document.getElementById('suggestionContent');
            const applyBtn = document.querySelector('.apply-suggestion-btn');
            
            if (data.suggested_move) {
                content.textContent = `Best move: ${data.suggested_move} (${data.explanation || 'Good move'})`;
                if (applyBtn) applyBtn.style.display = 'block';
            } else {
                content.textContent = 'No suggestions available';
                if (applyBtn) applyBtn.style.display = 'none';
            }
        }
    } catch (error) {
        console.warn('Move suggestion failed:', error);
        showFeedbackPopup('Suggestion unavailable', 'inaccuracy');
    }
}

export function applySuggestion() {
    if (!currentSuggestion || !currentSuggestion.suggested_move) return;
    
    const move = currentSuggestion.suggested_move;
    if (move.length >= 4) {
        const fromCol = move.charCodeAt(0) - 97;
        const fromRow = 8 - parseInt(move[1]);
        const toCol = move.charCodeAt(2) - 97;
        const toRow = 8 - parseInt(move[3]);

        if (window.makeMove) {
            // Directly apply the suggested move as if the player made it
            window.makeMove(fromRow, fromCol, toRow, toCol);
            clearSelection();
            clearMoveSuggestion();
            
            // After applying suggestion, switch player and trigger AI move
            switchPlayer();
            if (!gameEnded && currentPlayer === 'black') {
                // Trigger AI to respond after suggestion applied
                aiMove().catch(err => console.error('AI move after suggestion failed:', err));
            }
        } else {
            console.error("makeMove is not globally available for applying suggestion.");
            showFeedbackPopup('Game logic not initialized', 'blunder');
        }
    } else {
        showFeedbackPopup('Invalid move format!', 'blunder');
    }
}

// Clear move suggestion display
// function clearMoveSuggestion() { // Moved to ui_handlers.js
//     const content = document.getElementById('suggestionContent');
//     const applyBtn = document.querySelector('.apply-suggestion-btn');
    
//     if (content) {
//         content.textContent = 'Click Hint for move suggestion';
//     }
//     if (applyBtn) {
//         applyBtn.style.display = 'none';
//     }
//     currentSuggestion = null;
// }

export async function evaluateMove(fromRow, fromCol, toRow, toCol) {
    const fen = boardToFEN();
    const moveStr = String.fromCharCode(97 + fromCol) + (8 - fromRow) +
                    String.fromCharCode(97 + toCol) + (8 - toRow);
    
    try {
        const response = await fetch('http://127.0.0.1:5000/move-feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fen: fen, move: moveStr })
        });
        
        if (response.ok) {
            const data = await response.json();
            return data;
        }
    } catch (error) {
        console.warn('Move evaluation failed:', error);
    }
    
    return null;
}

// Save game data with proper CSV attributes
export async function saveGameDataWithAttributes(winner, blunders, cpl, moves, capturedByPlayer, capturedByAI) {
    try {
        // Determine game result
        let result = 'draw';
        if (winner.includes('User')) {
            result = 'win';
        } else if (winner.includes('AI')) {
            result = 'loss';
        }
        
        // Estimate Elo based on performance
        let estimatedElo = 1200; // Base rating
        if (result === 'win') {
            estimatedElo = 1200 + (50 - blunders * 10) - (cpl * 2);
        } else if (result === 'loss') {
            estimatedElo = 1000 + (30 - blunders * 8) - (cpl * 1.5);
        } else {
            estimatedElo = 1150 + (40 - blunders * 9) - (cpl * 1.8);
        }
        
        estimatedElo = Math.max(800, Math.min(1600, estimatedElo)); // Clamp between 800-1600
        
        const gameData = {
            result: result,
            blunders: blunders,
            cpl: cpl,
            moves: moves,
            captured_by_player: capturedByPlayer,
            captured_by_ai: capturedByAI,
            estimated_elo: Math.round(estimatedElo)
        };
        
        await fetch('http://127.0.0.1:5000/save-game-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(gameData)
        });
        
        console.log('Game data saved with attributes:', gameData);
    } catch (error) {
        console.warn('Failed to save game data:', error);
    }
}
