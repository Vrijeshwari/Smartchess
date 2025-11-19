import { gameBoard, currentPlayer, moveHistory, pieces, whiteKingMoved, whiteRookAMoved, whiteRookHMoved, blackKingMoved, blackRookAMoved, blackRookHMoved } from './game_core.js';

export function exportGameAsPGN() {
    if (moveHistory.length === 0) {
        return '[Event "AI Game"]\n[Site "Local"]\n[Result "*"]\n\n';
    }
    let pgnMoves = '';
    for (let i = 0; i < moveHistory.length; i++) {
        if (i % 2 === 0) {
            pgnMoves += `${Math.floor(i/2) + 1}. `;
        }
        // Support moveHistory entries that may be objects {move, fenBefore} or simple strings
        const entry = moveHistory[i];
        const mv = (entry && typeof entry === 'object') ? entry.move : entry;
        pgnMoves += `${mv} `;
    }
    return `[Event "AI Game"]\n[Site "Local"]\n[Result "*"]\n\n${pgnMoves.trim()}`;
}

export function boardToFEN() {
    // Build piece placement
    let fen = '';
    for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let c = 0; c < 8; c++) {
            const p = gameBoard[r][c];
            if (!p) {
                empty++;
            } else {
                if (empty > 0) { fen += empty; empty = 0; }
                fen += pieceToFEN(p);
            }
        }
        if (empty > 0) fen += empty;
        if (r < 7) fen += '/';
    }

    // Active color
    const activeColor = (currentPlayer === 'white') ? 'w' : 'b';

    // Castling rights: use tracked flags for accurate status
    let castling = '';
    if (!whiteKingMoved) {
        if (!whiteRookHMoved) castling += 'K';
        if (!whiteRookAMoved) castling += 'Q';
    }
    if (!blackKingMoved) {
        if (!blackRookHMoved) castling += 'k';
        if (!blackRookAMoved) castling += 'q';
    }
    if (castling === '') castling = '-';

    // En-passant: detect if last move was a pawn double-step
    let enpassant = '-';
    try {
        const lastEntry = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
        if (lastEntry && lastEntry.move) {
            const mv = lastEntry.move; // e.g. e2e4
            if (mv.length >= 4) {
                const fromFile = mv.charCodeAt(0) - 97;
                const fromRank = parseInt(mv[1], 10);
                const toFile = mv.charCodeAt(2) - 97;
                const toRank = parseInt(mv[3], 10);
                if (Math.abs(toRank - fromRank) === 2) {
                    // Need to check if the moved piece was a pawn in the position before the move
                    const fenBefore = lastEntry.fenBefore || null;
                    if (fenBefore) {
                        // parse fenBefore piece at from square without mutating global board
                        const rows = fenBefore.split(' ')[0].split('/');
                        const rIndex = 8 - fromRank; // convert rank to row
                        const rowStr = rows[rIndex];
                        // expand row
                        let colIndex = 0;
                        let pieceChar = null;
                        for (const ch of rowStr) {
                            if (!isNaN(ch)) {
                                colIndex += parseInt(ch, 10);
                            } else {
                                if (colIndex === fromFile) { pieceChar = ch; break; }
                                colIndex++;
                            }
                        }
                        if (pieceChar && (pieceChar === 'P' || pieceChar === 'p')) {
                            // en-passant target is square passed over
                            const epRank = (fromRank + toRank) / 2; // e.g., from 2 to 4 -> 3
                            const epFile = String.fromCharCode(97 + toFile);
                            enpassant = epFile + epRank;
                        }
                    }
                }
            }
        }
    } catch (e) {
        // fallback to '-'
        enpassant = '-';
    }

    // Halfmove clock and fullmove number: approximate
    let halfmove = 0;
    // if last move was a pawn move or capture try to set non-zero, but keep simple
    let fullmove = Math.floor(moveHistory.length / 2) + 1;

    fen += ' ' + activeColor + ' ' + castling + ' ' + enpassant + ' ' + halfmove + ' ' + fullmove;
    return fen;
}

export function pieceToFEN(p) {
    switch (p) {
        case pieces.white.king: return 'K';
        case pieces.white.queen: return 'Q';
        case pieces.white.rook: return 'R';
        case pieces.white.bishop: return 'B';
        case pieces.white.knight: return 'N';
        case pieces.white.pawn: return 'P';
        case pieces.black.king: return 'k';
        case pieces.black.queen: return 'q';
        case pieces.black.rook: return 'r';
        case pieces.black.bishop: return 'b';
        case pieces.black.knight: return 'n';
        case pieces.black.pawn: return 'p';
        default: return '';
    }
}

export function fenToBoard(fen) {
    const rows = fen.split(' ')[0].split('/');
    for (let r = 0; r < 8; r++) {
        let row = [];
        let i = 0;
        for (const ch of rows[r]) {
            if (!isNaN(ch)) {
                for (let k = 0; k < parseInt(ch); k++) row.push('');
            } else {
                row.push(fenToPiece(ch));
            }
        }
        gameBoard[r] = row;
    }
}

export function fenToPiece(ch) {
    switch (ch) {
        case 'K': return pieces.white.king;
        case 'Q': return pieces.white.queen;
        case 'R': return pieces.white.rook;
        case 'B': return pieces.white.bishop;
        case 'N': return pieces.white.knight;
        case 'P': return pieces.white.pawn;
        case 'k': return pieces.black.king;
        case 'q': return pieces.black.queen;
        case 'r': return pieces.black.rook;
        case 'b': return pieces.black.bishop;
        case 'n': return pieces.black.knight;
        case 'p': return pieces.black.pawn;
        default: return '';
    }
}

export function calculateCPL() {
    const blunders = window.blunderCount || 0;
    const moves = moveHistory.length;
    
    if (moves === 0) return 0;
    
    const baseCPL = 50;
    const blunderPenalty = blunders * 100;
    const gameLengthFactor = Math.max(0, (40 - moves) * 2);
    
    return Math.round((baseCPL * moves + blunderPenalty - gameLengthFactor) / moves);
}
