// Temporary debug helpers for developer/testing only
import { openGameStatistics } from './ui_handlers.js';

window.forceShowStatsForDebug = function() {
    try {
        console.debug('[DEBUG_HELPER] Forcing display of game statistics modal with sample data');
        openGameStatistics(42, 3, 2, 1, 12, '1200', 'User (White)', 'checkmate');
    } catch (e) {
        console.error('[DEBUG_HELPER] Failed to show stats:', e);
    }
};

console.debug('[DEBUG_HELPER] forceShowStatsForDebug is available on window');
