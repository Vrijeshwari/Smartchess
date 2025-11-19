export const pieces = {
    white: {
        king: '♔',
        queen: '♕',
        rook: '♖',
        bishop: '♗',
        knight: '♘',
        pawn: '♙'
    },
    black: {
        king: '♚',
        queen: '♛',
        rook: '♜',
        bishop: '♝',
        knight: '♞',
        pawn: '♟'
    }
};

export const initialBoard = [
    ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
    ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'],
    ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖']
];

export let currentPlayer = 'white';
export let gameBoard = [];
export let capturedWhite = [];
export let capturedBlack = [];
export let gameEnded = false;
export let playerAggressiveScore = 0;
export let playerDefensiveScore = 0;
export let aiMode = 'default';
export let selectedStartDifficulty = 'easy';
export let isNewGame = true;
export let moveHistory = [];
// Castling / movement flags
export let whiteKingMoved = false;
export let whiteRookAMoved = false;
export let whiteRookHMoved = false;
export let blackKingMoved = false;
export let blackRookAMoved = false;
export let blackRookHMoved = false;

export function setNewGameStatus(status) {
    isNewGame = status;
}

export function markKingMoved(color) {
    if (color === 'white') whiteKingMoved = true;
    else blackKingMoved = true;
}

export function markRookMoved(color, file) {
    if (color === 'white') {
        if (file === 'a') whiteRookAMoved = true;
        if (file === 'h') whiteRookHMoved = true;
    } else {
        if (file === 'a') blackRookAMoved = true;
        if (file === 'h') blackRookHMoved = true;
    }
}

export function setGameEndedStatus(status) {
    gameEnded = status;
}

export function isKingInCheck(color) {
    let kingRow = -1, kingCol = -1;
    const kingSymbol = color === 'white' ? pieces.white.king : pieces.black.king;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (gameBoard[r][c] === kingSymbol) {
                kingRow = r; kingCol = c;
            }
        }
    }
    if (kingRow === -1) return false;
    const attackerColor = color === 'white' ? 'black' : 'white';
    return isSquareAttacked(kingRow, kingCol, attackerColor);
}

export function hasAnyLegalMove(color) {
    for (let fromRow = 0; fromRow < 8; fromRow++) {
        for (let fromCol = 0; fromCol < 8; fromCol++) {
            const piece = gameBoard[fromRow][fromCol];
            if (!piece) continue;
            if (color === 'white' && !Object.values(pieces.white).includes(piece)) continue;
            if (color === 'black' && !Object.values(pieces.black).includes(piece)) continue;
            for (let toRow = 0; toRow < 8; toRow++) {
                for (let toCol = 0; toCol < 8; toCol++) {
                    if (fromRow === toRow && fromCol === toCol) continue;
                    if (!isValidMove(fromRow, fromCol, toRow, toCol)) continue;

                    const backupFrom = gameBoard[fromRow][fromCol];
                    const backupTo = gameBoard[toRow][toCol];
                    gameBoard[toRow][toCol] = gameBoard[fromRow][fromCol];
                    gameBoard[fromRow][fromCol] = '';
                    let safe = true;
                    if (piece === (color === 'white' ? pieces.white.king : pieces.black.king)) {
                        safe = !isSquareAttacked(toRow, toCol, color === 'white' ? 'black' : 'white');
                    } else {
                        safe = !isKingInCheck(color);
                    }
                    gameBoard[fromRow][fromCol] = backupFrom;
                    gameBoard[toRow][toCol] = backupTo;
                    if (safe) return true;
                }
            }
        }
    }
    return false;
}

export function isSquareAttacked(row, col, attackerColor) {
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = gameBoard[r][c];
            if (piece && ((attackerColor === 'white' && Object.values(pieces.white).includes(piece)) ||
                (attackerColor === 'black' && Object.values(pieces.black).includes(piece)))) {
                if (isValidMove(r, c, row, col)) return true;
            }
        }
    }
    return false;
}

export function isValidMove(fromRow, fromCol, toRow, toCol) {
    if (gameEnded) return false;
    if (fromRow === toRow && fromCol === toCol) return false;
    if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return false;
    const piece = gameBoard[fromRow][fromCol];
    const targetPiece = gameBoard[toRow][toCol];
    if (targetPiece && isPieceOwnedByCurrentPlayer(targetPiece)) return false;

    const rowDiff = Math.abs(toRow - fromRow);
    const colDiff = Math.abs(toCol - fromCol);

    if (piece === pieces.white.pawn || piece === pieces.black.pawn) {
        const direction = piece === pieces.white.pawn ? -1 : 1;
        const startRow = piece === pieces.white.pawn ? 6 : 1;
        if (fromCol === toCol && !targetPiece) {
            if (toRow === fromRow + direction) return true;
            if (fromRow === startRow && toRow === fromRow + 2 * direction) return true;
        }
        if (Math.abs(fromCol - toCol) === 1 && toRow === fromRow + direction && targetPiece) {
            return true;
        }
        return false;
    }
    if (piece === pieces.white.rook || piece === pieces.black.rook) {
        if (fromRow === toRow || fromCol === toCol) {
            return isPathClear(fromRow, fromCol, toRow, toCol);
        }
        return false;
    }
    if (piece === pieces.white.bishop || piece === pieces.black.bishop) {
        if (rowDiff === colDiff) {
            return isPathClear(fromRow, fromCol, toRow, toCol);
        }
        return false;
    }
    if (piece === pieces.white.queen || piece === pieces.black.queen) {
        if (fromRow === toRow || fromCol === toCol || rowDiff === colDiff) {
            return isPathClear(fromRow, fromCol, toRow, toCol);
        }
        return false;
    }
    if (piece === pieces.white.king || piece === pieces.black.king) {
        return rowDiff <= 1 && colDiff <= 1;
    }
    if (piece === pieces.white.knight || piece === pieces.black.knight) {
        return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
    }
    return false;
}

export function isPathClear(fromRow, fromCol, toRow, toCol) {
    const rowStep = toRow > fromRow ? 1 : toRow < fromRow ? -1 : 0;
    const colStep = toCol > fromCol ? 1 : toCol < fromCol ? -1 : 0;
    let currentRow = fromRow + rowStep;
    let currentCol = fromCol + colStep;
    while (currentRow !== toRow || currentCol !== toCol) {
        if (gameBoard[currentRow][currentCol] !== '') {
            return false;
        }
        currentRow += rowStep;
        currentCol += colStep;
    }
    return true;
}

export function isPieceOwnedByCurrentPlayer(piece) {
    const whitePieces = Object.values(pieces.white);
    const blackPieces = Object.values(pieces.black);
    
    if (currentPlayer === 'white') {
        return whitePieces.includes(piece);
    } else {
        return blackPieces.includes(piece);
    }
}

export function initializeGame() {
    console.log('[DEBUG] initializeGame() called.');
    gameBoard = initialBoard.map(row => [...row]);
    currentPlayer = 'white';
    // selectedSquare = null; // This is UI state, handled elsewhere
    capturedWhite = [];
    capturedBlack = [];
    moveHistory = [];
    playerAggressiveScore = 0;
    playerDefensiveScore = 0;
    isNewGame = true;
    gameEnded = false;
    window.blunderCount = 0;
    window.nonCaptureMoves = 0;

    // reset castling flags
    whiteKingMoved = false;
    whiteRookAMoved = false;
    whiteRookHMoved = false;
    blackKingMoved = false;
    blackRookAMoved = false;
    blackRookHMoved = false;
}

export function updateAIMode() {
    if (playerAggressiveScore - playerDefensiveScore > 2) {
        aiMode = 'defensive';
    } else if (playerDefensiveScore - playerAggressiveScore > 2) {
        aiMode = 'aggressive';
    } else {
        aiMode = 'default';
    }
}

// Helper functions to safely modify exported score counters from other modules
export function incPlayerAggressiveScore() {
    playerAggressiveScore++;
}

export function incPlayerDefensiveScore() {
    playerDefensiveScore++;
}

export function switchPlayer() {
    currentPlayer = currentPlayer === 'white' ? 'black' : 'white';
}

export function checkGameEnd(updateGameStatus, endGameWithStatistics) {
    let whiteKing = false, blackKing = false;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const boardPiece = gameBoard[r][c];
            if (boardPiece) {
                if (boardPiece === pieces.white.king) whiteKing = true;
                if (boardPiece === pieces.black.king) blackKing = true;
            }
        }
    }
    
    if (!whiteKing || !blackKing) {
        console.log('[GAME END] King captured');
        setTimeout(() => {
            const winner = whiteKing ? 'User (White)' : 'AI (Black)';
            endGameWithStatistics(winner, 'king_captured');
        }, 500);
        return;
    }
    
    const nextPlayer = currentPlayer === 'white' ? 'black' : 'white';
    
    if (!hasAnyLegalMove(nextPlayer)) {
        if (isKingInCheck(nextPlayer)) {
            console.log('[GAME END] Checkmate');
            const winner = nextPlayer === 'white' ? 'AI (Black)' : 'User (White)';
            endGameWithStatistics(winner, 'checkmate');
        } else {
            console.log('[GAME END] Stalemate');
            endGameWithStatistics('Draw', 'stalemate');
        }
        return;
    }
    
    if (moveHistory.length >= 80) {
        console.log('[GAME END] Move limit reached');
        endGameWithStatistics('Draw', 'move_limit');
        return;
    }
}
