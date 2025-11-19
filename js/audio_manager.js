import { gameSettings } from './main.js';

export let soundElements = {};
export let backgroundMusicElement = null;

// Game settings (will be imported/managed centrally in main.js later)
// let gameSettings = {
//     musicEnabled: true,
//     soundEffectsEnabled: true,
// };

export function initializeAudio() {
    if (document.getElementById('gameWrapper')) { // Only initialize game sounds if on game.html
        soundElements.move = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBz2G0fPTgjMGHm7A7+OZURE=');
        soundElements.capture = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBz2G0fPTgjMGHm7A7+OZURE=');
        soundElements.check = new Audio('data:audio/wav;base64,UklGRq4HAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQwHAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBz2G0fPTgjMGHm7A7+OZURQ=');
        soundElements.victory = new Audio('data:audio/wav;base64,UklGRq4HAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQwHAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBz2G0fPTgjMGHm7A7+OZURQ=');
    }
}

export function handleBackgroundMusic() {
    if (!backgroundMusicElement) {
        backgroundMusicElement = document.getElementById('backgroundMusic');
    }
    if (backgroundMusicElement) {
        backgroundMusicElement.volume = 0.3;
        if (gameSettings.musicEnabled) {
            backgroundMusicElement.play().catch(e => console.warn('Background music play failed:', e));
        } else {
            backgroundMusicElement.pause();
        }
    }
}

export function playSound(soundType) {
    if (gameSettings.soundEffectsEnabled && soundElements[soundType]) {
        soundElements[soundType].currentTime = 0;
        soundElements[soundType].play().catch(e => console.log('Audio play failed:', e));
    }
}
