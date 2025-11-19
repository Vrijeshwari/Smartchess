import './debug_helpers.js';
import { initializeGame, selectedStartDifficulty, currentPlayer, gameBoard, capturedWhite, capturedBlack, isNewGame, updateAIMode, switchPlayer, checkGameEnd, pieces, gameEnded, moveHistory, isSquareAttacked, isKingInCheck, incPlayerAggressiveScore, incPlayerDefensiveScore, markKingMoved, markRookMoved } from './game_core.js';
import { createBoard, handleSquareClick, handleDragStart, handleDragEnd, handleDragOver, handleDrop, updateGameInfo, updateGameStatus, updateCapturedPieces, openDifficultySelection, closeDifficultySelection, selectDifficulty, playSelectedDifficulty, toggleSettings, closeSettings, quitGame, confirmQuitGame, cancelQuitGame, showFeedbackPopup, clearSelection, highlightValidMoves, openGameStatistics, closeGameStatistics, clearMoveSuggestion, updateAIExplanation } from './ui_handlers.js';
import { initializeAudio, handleBackgroundMusic, playSound, soundElements, backgroundMusicElement } from './audio_manager.js';
import { updateOutcomePrediction, displayOutcomePrediction, initializePrediction, getEloPrediction, endGameWithStatistics, aiMove, showMoveSuggestion, applySuggestion, evaluateMove, saveGameDataWithAttributes, currentSuggestion } from './ai_integration.js';
import { exportGameAsPGN, boardToFEN, pieceToFEN, fenToBoard, fenToPiece, calculateCPL } from './utils.js';

export let gameSettings = {
    musicEnabled: true,
    soundEffectsEnabled: true,
    darkModeEnabled: false,
    // Toggle move-feedback calls to backend (enable after improving FEN handling)
    moveFeedbackEnabled: true
};

export function saveSettings() {
    localStorage.setItem('gameSettings', JSON.stringify(gameSettings));
}

export function loadSettings() {
    const savedSettings = localStorage.getItem('gameSettings');
    if (savedSettings) {
        const loadedSettings = JSON.parse(savedSettings);
        // Update properties of the existing gameSettings object
        for (const key in loadedSettings) {
            if (Object.prototype.hasOwnProperty.call(loadedSettings, key)) {
                gameSettings[key] = loadedSettings[key];
            }
        }
    }
    if (gameSettings.darkModeEnabled) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

export function applySettings() {
    // Only apply game-specific settings if elements exist (i.e., on game.html)
    if (document.getElementById('chessBoard')) {
        // Game Sounds toggle (in settings modal - on index.html, but also applied to game.html)
        const settingsSoundEffectsToggle = document.getElementById('soundEffectsToggle');
        if (settingsSoundEffectsToggle) {
            settingsSoundEffectsToggle.checked = gameSettings.soundEffectsEnabled;
        }

        // Music toggle (in settings modal)
        const settingsMusicToggle = document.getElementById('musicToggle');
        if (settingsMusicToggle) {
            settingsMusicToggle.checked = gameSettings.musicEnabled;
        }
        // Music toggle (in-game controls)
        const inGameMusicToggle = document.getElementById('inGameMusicToggle');
        if (inGameMusicToggle) {
            inGameMusicToggle.checked = gameSettings.musicEnabled;
        }
    }
    
    // Dark Mode toggle (apply to both pages)
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.checked = gameSettings.darkModeEnabled;
    }

    if (gameSettings.darkModeEnabled) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }

    // Only trigger music change if on game page, as backgroundMusicElement might not exist on index.html
    if (document.getElementById('gameWrapper')) {
        // Note: Music toggle is handled by toggleMusic() directly when changed
        // but needs to be applied on load
        if (gameSettings.musicEnabled && backgroundMusicElement) {
            backgroundMusicElement.play().catch(e => console.warn('Background music play failed on applySettings:', e));
        } else if (backgroundMusicElement) {
            backgroundMusicElement.pause();
        }
    }
}

export function startGame() {
    console.log('[DEBUG] startGame() called.');
    document.getElementById('startPanel').style.display = 'none';
    document.getElementById('gameWrapper').style.display = 'flex'; // Assuming game-container is flex
    initializeGame(); // From game_core.js
    // Start background music if enabled by default
    if (gameSettings.musicEnabled && backgroundMusicElement) {
        backgroundMusicElement.play().catch(e => console.warn('Background music play failed on start:', e));
    }
}

export function resetToDefaultSettings() {
    gameSettings = {
        musicEnabled: true,
        soundEffectsEnabled: true,
        darkModeEnabled: false
    };
    applySettings();
    saveSettings();
    console.log('Settings reset to default.');
}

// When making a move, push move to history (UCI format)
export function makeMove(fromRow, fromCol, toRow, toCol, confirmed = false) {
    // Capture FEN BEFORE the move is made
    const fenBeforeMove = boardToFEN();

    const piece = gameBoard[fromRow][fromCol];
    const capturedPiece = gameBoard[toRow][toCol];
    // Detect player-initiated castling and defer until user confirmation
    if (!confirmed && currentPlayer === 'white' && (piece === pieces.white.king || piece === pieces.black.king) && Math.abs(toCol - fromCol) === 2) {
        // Store pending castling details globally so UI modal can access them
        window.pendingCastling = { fromRow, fromCol, toRow, toCol, piece, capturedPiece, fenBeforeMove };
        if (window.requestCastlingConfirmation) {
            window.requestCastlingConfirmation();
        } else {
            console.warn('Castling confirmation UI not available; proceeding with move');
        }
        return false; // Defer actual move until confirmation
    }
    if (capturedPiece) {
        if (Object.values(pieces.white).includes(capturedPiece)) {
            capturedWhite.push(capturedPiece);
        } else {
            capturedBlack.push(capturedPiece);
        }
    }
    gameBoard[toRow][toCol] = piece;
    gameBoard[fromRow][fromCol] = '';

    // If this is a confirmed castling move (king moved two squares), move the rook accordingly
    if (confirmed && (piece === pieces.white.king || piece === pieces.black.king) && Math.abs(toCol - fromCol) === 2) {
        const isWhite = piece === pieces.white.king;
        const rookRow = isWhite ? 7 : 0;
        if (toCol > fromCol) {
            // King-side castling: rook from h-file (7) to f-file (5)
            gameBoard[rookRow][5] = isWhite ? pieces.white.rook : pieces.black.rook;
            gameBoard[rookRow][7] = '';
            markRookMoved(isWhite ? 'white' : 'black', 'h');
        } else {
            // Queen-side castling: rook from a-file (0) to d-file (3)
            gameBoard[rookRow][3] = isWhite ? pieces.white.rook : pieces.black.rook;
            gameBoard[rookRow][0] = '';
            markRookMoved(isWhite ? 'white' : 'black', 'a');
        }
    }

    // Handle pawn promotion
    if ((piece === pieces.white.pawn && toRow === 0) || (piece === pieces.black.pawn && toRow === 7)) {
        gameBoard[toRow][toCol] = (piece === pieces.white.pawn) ? pieces.white.queen : pieces.black.queen;
    }

    // Record move in UCI format: like 'e2e4'
    const moveStr = String.fromCharCode(97 + fromCol) + (8 - fromRow) +
                    String.fromCharCode(97 + toCol) + (8 - toRow);
    moveHistory.push({ move: moveStr, fenBefore: fenBeforeMove }); // Store move with FEN before the move
    // console.log('[DEBUG] makeMove params: fromRow:', fromRow, 'fromCol:', fromCol, 'toRow:', toRow, 'toCol:', toCol, 'moveStr:', moveStr);

    // --- Move Quality Feedback (AI/ML) ---
    // Only for user moves (not AI moves). This is behind a feature flag because
    // the backend move-feedback can return 400 for mismatched/illegal moves
    // (different FEN representation / missing castling info). Disable to avoid
    // repeated console errors and to keep gameplay uninterrupted.
    if (currentPlayer === 'white') {
        if (gameSettings.moveFeedbackEnabled) {
            // Use fenBeforeMove for the backend's move feedback
            const payload = { fen: fenBeforeMove, move: moveStr };
            fetch('http://127.0.0.1:5000/move-feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(async res => {
                try {
                    const data = await res.json();
                    if (res.ok && data.label) {
                        showFeedbackPopup(`${data.label}! Difference: ${data.difference}`, data.label.toLowerCase().replace(' ', '-'));
                    } else if (!res.ok) {
                        console.warn('Move feedback returned not-ok:', res.status, data.error);
                        if (data && data.error && data.error.toLowerCase().includes('illegal')) {
                            window.blunderCount = (window.blunderCount || 0) + 1;
                            // Show detailed illegal-move reason if available
                            const reason = data.illegal_reason || 'Illegal move';
                            showFeedbackPopup(`❌ ${reason}`, 'blunder');
                            console.log(`[DEBUG] Illegal move: ${reason}`);
                        }
                    }
                } catch (e) {
                    console.warn('[DEBUG] /move-feedback no JSON response or parsing error', e);
                }
            })
            .catch(err => {
                console.error('Failed to send move-feedback:', err);
            });
        }

        // --- Game Outcome Prediction (NEW) ---
        // Use fenBeforeMove for initial prediction (before AI moves)
        updateOutcomePrediction(fenBeforeMove);
    }

    if (currentPlayer === 'white') {
        if (capturedPiece) {
            incPlayerAggressiveScore();
        } else {
            if (!isKingInCheck(currentPlayer)) incPlayerDefensiveScore(); // Use helper to increment defensive score
        }
        updateAIMode();
    }
    // Mark king/rook moved flags to maintain accurate castling rights
    if (piece === pieces.white.king || piece === pieces.black.king) {
        const color = (piece === pieces.white.king) ? 'white' : 'black';
        markKingMoved(color);
    }
    if (piece === pieces.white.rook || piece === pieces.black.rook) {
        const color = (piece === pieces.white.rook) ? 'white' : 'black';
        // determine rook file
        const file = (fromCol === 0) ? 'a' : (fromCol === 7) ? 'h' : null;
        if (file) markRookMoved(color, file);
    }
    createBoard();
    updateCapturedPieces();
    return true;
}

// NEW: Toggle Sound Effects
function toggleSoundEffects() {
    gameSettings.soundEffectsEnabled = document.getElementById('soundEffectsToggle').checked;
    saveSettings(); // Save preference to localStorage
    console.log('Game Sounds:', gameSettings.soundEffectsEnabled ? 'ON' : 'OFF');
}

// Re-added: Toggle Music
function toggleMusic() {
    const settingsMusicToggle = document.getElementById('musicToggle');
    const inGameMusicToggle = document.getElementById('inGameMusicToggle');

    // Update gameSettings.musicEnabled based on the active toggle
    if (settingsMusicToggle && settingsMusicToggle === document.activeElement) {
        gameSettings.musicEnabled = settingsMusicToggle.checked;
    } else if (inGameMusicToggle && inGameMusicToggle === document.activeElement) {
        gameSettings.musicEnabled = inGameMusicToggle.checked;
    } else {
        // Fallback: If neither toggle is directly interacted, use current state or default to settingsModal if present
        if (settingsMusicToggle) {
            gameSettings.musicEnabled = settingsMusicToggle.checked;
        } else if (inGameMusicToggle) {
            gameSettings.musicEnabled = inGameMusicToggle.checked;
        }
    }

    handleBackgroundMusic(); // Use the new centralized function
    saveSettings(); // Save preference to localStorage
    console.log('Background Music:', gameSettings.musicEnabled ? 'ON' : 'OFF');
}

// Re-added: Toggle Dark Mode
function toggleDarkMode() {
    gameSettings.darkModeEnabled = document.getElementById('darkModeToggle').checked;
    if (gameSettings.darkModeEnabled) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    saveSettings(); // Save preference to localStorage
    console.log('Dark Mode:', gameSettings.darkModeEnabled ? 'ON' : 'OFF');
}

document.addEventListener('DOMContentLoaded', function() {
    loadSettings(); // Load settings on startup for both pages
    // Initialize backgroundMusicElement globally for all pages
    // backgroundMusicElement = document.getElementById('backgroundMusic'); // Removed this line
    handleBackgroundMusic(); // Apply music setting after loading

    if (document.getElementById('startPanel')) {
        // Code specific to index.html (start page)
        // Ensure modals are hidden on initial load for index page
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) settingsModal.style.display = 'none';
        const difficultySelectionModal = document.getElementById('difficultySelectionModal');
        if (difficultySelectionModal) difficultySelectionModal.style.display = 'none';
    } else if (document.getElementById('gameWrapper')) {
        // Code specific to game.html (game page)
        initializeAudio(); // Initialize game sound effects only on the game page
        initializeGame(); // Initialize game only on the game page
        createBoard();    // <--- ADD THIS LINE: Render the board after initialization
        updateCapturedPieces(); // Initialize captured pieces display
        updateGameInfo(); // Initialize game info display
        // Ensure modals are hidden on initial load for game page
        const quitConfirmationModal = document.getElementById('quitConfirmationModal');
        if (quitConfirmationModal) quitConfirmationModal.style.display = 'none';
        
        applySettings();
    }
    // Initialize and handle background music regardless of the specific page type
    // This will now apply to index.html, game.html, how_to_play.html, and chess_tricks.html
    handleBackgroundMusic();

    // Expose functions to the global scope for HTML onclick attributes
    window.openDifficultySelection = openDifficultySelection;
    window.closeDifficultySelection = closeDifficultySelection;
    window.toggleSettings = toggleSettings;
    window.closeSettings = closeSettings;
    window.selectDifficulty = selectDifficulty;
    window.playSelectedDifficulty = playSelectedDifficulty;
    window.toggleSoundEffects = toggleSoundEffects;
    window.toggleMusic = toggleMusic;
    window.toggleDarkMode = toggleDarkMode;
    window.resetToDefaultSettings = resetToDefaultSettings;
    window.quitGame = quitGame;
    window.confirmQuitGame = confirmQuitGame;
    window.cancelQuitGame = cancelQuitGame;
    window.startGame = startGame;
    window.showMoveSuggestion = showMoveSuggestion;
    window.applySuggestion = applySuggestion;
    // Expose makeMove and gameSettings globally to avoid circular module imports
    window.makeMove = makeMove;
    window.gameSettings = gameSettings;
    window.startNewGame = startNewGame; // Expose startNewGame globally
    window.startNewGameFromStats = startNewGameFromStats; // Expose for stats modal
});

export function startNewGame() {
    // Ensure game is initialized cleanly
    initializeGame(); 
    createBoard();
    updateCapturedPieces();
    updateGameInfo(); // Reset game status display to 'Game in progress'
    clearMoveSuggestion(); // Clear any existing AI suggestions
    initializePrediction(); // Re-initialize outcome prediction

    // Hide the game statistics modal if it's open
    closeGameStatistics();

    // Ensure the game wrapper is visible and start panel is hidden
    document.getElementById('startPanel').style.display = 'none';
    document.getElementById('gameWrapper').style.display = 'flex'; 

    console.log('[DEBUG] New game initiated via startNewGame().');
}

// In main.js
export function startNewGameFromStats() {
    // Close the statistics modal first
    closeGameStatistics();
    
    // Then reset the game
    initializeGame(); 
    createBoard();
    updateCapturedPieces();
    updateGameInfo();
    clearMoveSuggestion();
    initializePrediction();

    // Ensure the game wrapper is visible and start panel is hidden
    document.getElementById('startPanel').style.display = 'none';
    document.getElementById('gameWrapper').style.display = 'flex';
}