export class UI {
    constructor() {
        this.scoreElement = this.ensureElement('score-display');
        this.levelElement = this.ensureElement('level-display');
        this.finalScoreElement = this.ensureElement('final-score');
        this.hudElement = this.ensureElement('hud');
        for (const id of ['menu-screen', 'game-over-screen', 'level-complete-screen']) {
            this.ensureElement(id, 'overlay');
        }
    }

    ensureElement(id, className) {
        let element = document.getElementById(id);
        if (!element) {
            element = document.createElement('div');
            element.id = id;
            // Fabricated overlays must carry the `overlay` class: the CSS only
            // hides via `.overlay.hidden`, so an overlay created without it
            // could never be visually hidden.
            if (className) {
                element.className = className;
            }
            document.body.appendChild(element);
        }
        return element;
    }

    showHUD() {
        const hud = document.getElementById('hud');
        if (hud) hud.style.display = 'flex';
    }

    hideHUD() {
        const hud = document.getElementById('hud');
        if (hud) hud.style.display = 'none';
    }

    updateScore(score) {
        if (this.scoreElement) {
            this.scoreElement.textContent = `Score: ${score}`;
        }
    }

    updateLevel(level) {
        if (this.levelElement) {
            this.levelElement.textContent = `Level: ${level}`;
        }
    }

    showOverlay(id) {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    hideOverlay(id) {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    showGameOver(score) {
        // The game-over overlay reads its score from #final-score, not the
        // HUD counter (the HUD is hidden behind the overlay).
        if (this.finalScoreElement) {
            this.finalScoreElement.textContent = `Score: ${score}`;
        }
        this.showOverlay('game-over-screen');
    }

    showLevelComplete() {
        this.showOverlay('level-complete-screen');
    }

    getScore() {
        if (this.scoreElement) {
            return parseInt(this.scoreElement.textContent.replace('Score: ', '')) || 0;
        }
        return 0;
    }

    getLevel() {
        if (this.levelElement) {
            return parseInt(this.levelElement.textContent.replace('Level: ', '')) || 1;
        }
        return 1;
    }
}
