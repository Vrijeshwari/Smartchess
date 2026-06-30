// Avoid circular import with main.js by accessing shared globals via `window`
import { playSound } from './audio_manager.js';
import { endGameWithStatistics, aiMove } from './ai_integration.js';
import { initializeGame, selectedStartDifficulty, currentPlayer, gameBoard, capturedWhite, capturedBlack, pieces, gameEnded, moveHistory, isSquareAttacked, isValidMove, isPieceOwnedByCurrentPlayer, switchPlayer, checkGameEnd } from './game_core.js';

// UI-related global variables (should be minimized or managed by a UI state object if complex)
let currentSelectedSquare = null; // Renamed to avoid conflict with imported selectedSquare

// CRITICAL: Setup simple modal visibility control
function setupModalProtection() {
    const modal = document.getElementById('gameStatisticsModal');
    if (!modal) {
        console.warn('[WARNING] gameStatisticsModal not found');
        return;
    }

    // Simple MutationObserver to restore the 'show' class if removed
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                if (window.gameStatisticsModalOpen && !modal.classList.contains('show')) {
                    console.warn('[PROTECTION] Restoring modal show class');
                    modal.classList.add('show');
                }
            }
        });
    });

    observer.observe(modal, {
        attributes: true,
        attributeFilter: ['class']
    });

    console.debug('[SETUP] Modal protection initialized');
}

// Initialize modal protection when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupModalProtection);
} else {
    setupModalProtection();
}

// Create the chess board
export function createBoard() {
    const board = document.getElementById('chessBoard');
    board.innerHTML = '';

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('div');
            square.classList.add('square');
            square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark');
            square.dataset.row = row;
            square.dataset.col = col;
            
            const piece = gameBoard[row][col];
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.classList.add('piece');
                pieceElement.textContent = piece;
                pieceElement.draggable = true;
                square.appendChild(pieceElement);
            }

            square.addEventListener('click', handleSquareClick);
            square.addEventListener('dragover', handleDragOver);
            square.addEventListener('drop', handleDrop);
            
            if (square.querySelector('.piece')) {
                square.querySelector('.piece').addEventListener('dragstart', handleDragStart);
                square.querySelector('.piece').addEventListener('dragend', handleDragEnd);
            }

            board.appendChild(square);
        }
    }
}

// Handle square clicks
export function handleSquareClick(e) {
    if (gameEnded) return;
    const square = e.currentTarget;
    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    
    if (currentSelectedSquare) {
        if (currentSelectedSquare.row === row && currentSelectedSquare.col === col) {
            clearSelection();
        } else if (isValidMove(currentSelectedSquare.row, currentSelectedSquare.col, row, col)) {
            // call the shared makeMove exposed by main.js to avoid circular module imports
            if (window && typeof window.makeMove === 'function') {
                const applied = window.makeMove(currentSelectedSquare.row, currentSelectedSquare.col, row, col);
                clearSelection();
                if (applied) {
                    // only switch player if the move was actually applied
                    switchPlayer();
                    console.log('[DEBUG] After player move, before AI trigger. gameEnded:', gameEnded, 'currentPlayer:', currentPlayer);
                    // After player move, if game not ended and it's AI's turn, trigger AI move
                    if (!gameEnded && typeof aiMove === 'function' && currentPlayer === 'black') {
                        // fire and forget AI move
                        aiMove().catch(err => console.error('AI move failed:', err));
                    }
                }
            } else {
                console.warn('makeMove not available on window');
            }
        } else {
            const piece = gameBoard[row][col];
            if (piece && isPieceOwnedByCurrentPlayer(piece)) {
                selectSquare(row, col);
            } else {
                clearSelection();
            }
        }
    } else {
        const piece = gameBoard[row][col];
        if (piece && isPieceOwnedByCurrentPlayer(piece)) {
            selectSquare(row, col);
        }
    }
}

// Select a square
export function selectSquare(row, col) {
    clearSelection();
    currentSelectedSquare = { row, col };
    const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    square.classList.add('selected');
    highlightValidMoves(row, col);
}

// Clear selection
export function clearSelection() {
    currentSelectedSquare = null;
    document.querySelectorAll('.square').forEach(square => {
        square.classList.remove('selected', 'valid-move');
    });
}

// Highlight valid moves
export function highlightValidMoves(row, col) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (isValidMove(row, col, r, c)) {
                const square = document.querySelector(`[data-row="${r}"][data-col="${c}"]`);
                square.classList.add('valid-move');
            }
        }
    }
}

// Drag and drop handlers
export function handleDragStart(e) {
    if (gameEnded) {
        e.preventDefault();
        return;
    }
    const piece = e.target.textContent;
    if (!isPieceOwnedByCurrentPlayer(piece)) {
        e.preventDefault();
        return;
    }
    e.target.classList.add('dragging');
    const square = e.target.parentElement;
    currentSelectedSquare = {
        row: parseInt(square.dataset.row),
        col: parseInt(square.dataset.col)
    };
    highlightValidMoves(currentSelectedSquare.row, currentSelectedSquare.col);
}

export function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    clearSelection();
}

export function handleDragOver(e) {
    e.preventDefault();
}

export function handleDrop(e) {
    e.preventDefault();
    if (!currentSelectedSquare) return;
    const square = e.currentTarget;
    const toRow = parseInt(square.dataset.row);
    const toCol = parseInt(square.dataset.col);
        if (isValidMove(currentSelectedSquare.row, currentSelectedSquare.col, toRow, toCol)) {
        if (window && typeof window.makeMove === 'function') {
            const applied = window.makeMove(currentSelectedSquare.row, currentSelectedSquare.col, toRow, toCol);
            // After move, switch player and let AI respond only if move applied
            if (applied) {
                switchPlayer();
                console.log('[DEBUG] After player move, before AI trigger. gameEnded:', gameEnded, 'currentPlayer:', currentPlayer);
                checkGameEnd(endGameWithStatistics);
                if (!gameEnded && typeof aiMove === 'function' && currentPlayer === 'black') {
                    aiMove().catch(err => console.error('AI move failed:', err));
                }
            }
        } else {
            console.warn('makeMove not available on window');
        }
    } else {
        if (!window.blunderCount) window.blunderCount = 0;
        window.blunderCount++;
    }
    clearSelection();
}

// Update game information
export function updateGameInfo() {
    document.getElementById('currentPlayer').textContent = `Current Player: ${currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1)}`;
    document.getElementById('gameStatus').textContent = 'Game in progress';
}

// Update game status for game end
export function updateGameStatus(status) {
    document.getElementById('gameStatus').textContent = status;
    document.getElementById('gameStatus').style.color = '#e74c3c';
    document.getElementById('gameStatus').style.fontWeight = 'bold';
}

// Update captured pieces display
export function updateCapturedPieces() {
    document.getElementById('capturedWhite').textContent = capturedWhite.join(' ');
    document.getElementById('capturedBlack').textContent = capturedBlack.join(' ');
}

// UI related functions for modals and settings on index.html and game.html

// NEW: Functions for Difficulty Selection Modal on index.html
export function openDifficultySelection() {
    const modal = document.getElementById('difficultySelectionModal');
    if (modal) {
        modal.style.display = 'block';
        document.querySelectorAll('#difficultySelectionModal .difficulty-btn').forEach(btn => {
            if (btn.dataset.level === selectedStartDifficulty) {
                btn.classList.add('active');
                // selectedStartDifficulty = btn.dataset.level; // No longer needed as it's directly from gameSettings
            } else {
                btn.classList.remove('active');
            }
        });
    }
}

export function closeDifficultySelection() {
    const modal = document.getElementById('difficultySelectionModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

export function selectDifficulty(level, gameSettings, selectedStartDifficulty) {
    document.querySelectorAll('#difficultySelectionModal .difficulty-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`#difficultySelectionModal .difficulty-btn[data-level="${level}"]`).classList.add('active');
    selectedStartDifficulty = level;
    console.log(`Selected difficulty for start: ${selectedStartDifficulty}`);
}

export function playSelectedDifficulty() {
    // Access gameSettings and saveSettings from window (or use direct references)
    if (window && window.gameSettings && window.saveSettings) {
        window.gameSettings.difficulty = selectedStartDifficulty;
        window.saveSettings();
    }
    // Navigate to game page
    window.location.href = '/pages/game.html';
}

// Castling confirmation UI handlers
export function requestCastlingConfirmation() {
    const modal = document.getElementById('castlingConfirmationModal');
    const msg = document.getElementById('castlingMessage');
    if (!modal || !window.pendingCastling) return;
    const { fromRow, fromCol, toRow, toCol } = window.pendingCastling;
    const fromFile = String.fromCharCode(97 + fromCol) + (8 - fromRow);
    const toFile = String.fromCharCode(97 + toCol) + (8 - toRow);
    if (msg) msg.textContent = `Castling from ${fromFile} to ${toFile}. Confirm to complete castling.`;
    // Wire buttons
    const confirmBtn = document.getElementById('confirmCastlingBtn');
    const cancelBtn = document.getElementById('cancelCastlingBtn');
    if (confirmBtn) confirmBtn.onclick = confirmCastling;
    if (cancelBtn) cancelBtn.onclick = cancelCastling;
    modal.style.display = 'block';
}

export function confirmCastling() {
    const modal = document.getElementById('castlingConfirmationModal');
    if (!window.pendingCastling) return;
    const { fromRow, fromCol, toRow, toCol } = window.pendingCastling;
    // Call global makeMove with confirmed=true to perform the move including rook handling
    if (window && typeof window.makeMove === 'function') {
        window.makeMove(fromRow, fromCol, toRow, toCol, true);
        // After applying the confirmed move, switch player and trigger AI if needed
        try {
            switchPlayer();
        } catch (e) {
            if (window && window.switchPlayer) window.switchPlayer();
        }
        if (!gameEnded && typeof aiMove === 'function' && currentPlayer === 'black') {
            aiMove().catch(err => console.error('AI move failed after castling:', err));
        }
    }
    // cleanup
    window.pendingCastling = null;
    if (modal) modal.style.display = 'none';
}

export function cancelCastling() {
    const modal = document.getElementById('castlingConfirmationModal');
    // simply clear pending castling; user can attempt another move
    window.pendingCastling = null;
    if (modal) modal.style.display = 'none';
}

// Expose castling handlers globally so main.js can call them without circular imports
if (typeof window !== 'undefined') {
    window.requestCastlingConfirmation = requestCastlingConfirmation;
    window.confirmCastling = confirmCastling;
    window.cancelCastling = cancelCastling;
}

// Settings functions
export function toggleSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
        const soundEffectsToggle = document.getElementById('soundEffectsToggle');
        const musicToggle = document.getElementById('musicToggle');
        const darkModeToggle = document.getElementById('darkModeToggle');

        // Access shared settings via window to avoid circular import
        const gs = (window && window.gameSettings) ? window.gameSettings : { soundEffectsEnabled: true, musicEnabled: true, darkModeEnabled: false };
        if (soundEffectsToggle) soundEffectsToggle.checked = gs.soundEffectsEnabled;
        if (musicToggle) musicToggle.checked = gs.musicEnabled;
        if (darkModeToggle) darkModeToggle.checked = gs.darkModeEnabled;
    }
}

export function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

export function quitGame() {
    document.getElementById('quitConfirmationModal').style.display = 'block';
}

export function confirmQuitGame() {
    window.location.href = 'index.html';
}

export function cancelQuitGame() {
    document.getElementById('quitConfirmationModal').style.display = 'none';
}

// Feedback Popup
export function openGameStatistics(moves, capturedByPlayer, capturedByAI, blunders, cpl, eloPrediction, winner, endType) {
    const modal = document.getElementById('gameStatisticsModal');
    const gameOutcomeElement = document.getElementById('gameOutcome');
    
    // Populate the modal with data
    document.getElementById('finalMoves').textContent = moves;
    document.getElementById('finalUserCaptured').textContent = capturedByPlayer;
    document.getElementById('finalAICaptured').textContent = capturedByAI;
    document.getElementById('finalBlunders').textContent = blunders;
    document.getElementById('finalCPL').textContent = cpl;
    document.getElementById('finalELO').textContent = eloPrediction;

    let outcomeMessage = `Winner: ${winner}`;
    let outcomeClass = '';

    if (endType === 'checkmate') {
        outcomeClass = winner.includes('User') ? 'win' : 'lose';
        outcomeMessage = `${winner.includes('User') ? 'You Win!' : 'You Lose!'} by Checkmate! 🎉`;
    } else if (endType === 'stalemate') {
        outcomeClass = 'draw';
        outcomeMessage = `Stalemate! It's a Draw! 🤝`;
    } else if (winner.includes('User')) {
        outcomeClass = 'win';
        outcomeMessage = `You Win! 🎉`;
    } else if (winner.includes('AI')) {
        outcomeClass = 'lose';
        outcomeMessage = `You Lose! 😔`;
    } else {
        outcomeClass = 'draw';
        outcomeMessage = `It's a Draw! 🤝`;
    }

    gameOutcomeElement.textContent = outcomeMessage;
    gameOutcomeElement.className = `game-outcome ${outcomeClass}`;

    if (modal) {
        console.debug('[UI] Opening game statistics modal');
        window.gameStatisticsModalOpen = true;
        modal.classList.add('show');
        console.debug('[UI] modal.show applied, computed style next will be checked');
        // Verify modal became visible — if not, create a lightweight fallback modal
        setTimeout(() => {
            try {
                const style = window.getComputedStyle(modal);
                if (style.display !== 'flex' && style.visibility !== 'visible') {
                    console.warn('[UI] Primary modal not visible, creating fallback modal');
                    let fallback = document.getElementById('gameStatisticsModalFallback');
                    if (!fallback) {
                        fallback = document.createElement('div');
                        fallback.id = 'gameStatisticsModalFallback';
                        fallback.style.position = 'fixed';
                        fallback.style.left = '50%';
                        fallback.style.top = '50%';
                        fallback.style.transform = 'translate(-50%, -50%)';
                        fallback.style.zIndex = '3000';
                        fallback.style.background = 'rgba(255,255,255,0.98)';
                        fallback.style.color = '#222';
                        fallback.style.padding = '20px';
                        fallback.style.borderRadius = '12px';
                        fallback.style.boxShadow = '0 10px 40px rgba(0,0,0,0.3)';
                        fallback.style.maxWidth = '640px';
                        fallback.style.width = '90%';
                        fallback.innerHTML = `
                            <h2 style="margin:0 0 8px 0">Game Over</h2>
                            <div style="font-weight:700;margin-bottom:6px">${gameOutcomeElement.textContent}</div>
                            <div style="margin-bottom:12px">Moves: <strong id=\"fbMoves\">${document.getElementById('finalMoves').textContent}</strong></div>
                            <div style="display:flex;gap:8px;justify-content:center">
                                <button id="fbPlayAgain" style="padding:8px 14px;border-radius:8px;background:#8B7355;color:white;border:none;">Play Again</button>
                                <button id="fbHome" style="padding:8px 14px;border-radius:8px;background:#6B5B47;color:white;border:none;">Home</button>
                            </div>
                        `;
                        document.body.appendChild(fallback);
                        document.getElementById('fbPlayAgain').addEventListener('click', () => {
                            fallback.remove();
                            if (window.startNewGameFromStats) window.startNewGameFromStats();
                        });
                        document.getElementById('fbHome').addEventListener('click', () => {
                            window.location.href = 'index.html';
                        });
                    }
                }
            } catch (e) {
                console.warn('[UI] Failed to verify modal visibility', e);
            }
        }, 120);
    }
}

export function closeGameStatistics() {
    const modal = document.getElementById('gameStatisticsModal');
    if (!modal) return;
    console.debug('[UI] Closing game statistics modal');
    modal.classList.remove('show');
    window.gameStatisticsModalOpen = false;
}

export function showFeedbackPopup(message, type = 'good-move') {
    const content = document.getElementById('feedbackContent');
    
    content.textContent = message;
    content.className = `${type}`;
    
    // Removed setTimeout to prevent auto-closing
}

export function clearMoveSuggestion() {
    const content = document.getElementById('suggestionContent');
    const applyBtn = document.querySelector('.apply-suggestion-btn');
    
    if (content) {
        content.textContent = 'Click Hint for move suggestion';
    }
    if (applyBtn) {
        applyBtn.style.display = 'none';
    }
    // currentSuggestion = null; // currentSuggestion is in ai_integration.js
}

export function updateAIExplanation(explanation) {
    const panel = document.getElementById('explanationContent');
    if (panel) {
        panel.textContent = explanation || 'Waiting for AI move...';
    }
}
