import { test, expect } from "bun:test";
import { Timer } from "../../js/timer.js";

test("Timer counts down correctly", () => {
    const timer = new Timer(60); // 60 seconds
    
    timer.update(0.016, false); // ~60 FPS, no coin collected
    
    expect(timer.timeRemaining).toBeLessThan(60);
});

test("Timer carries over between levels", () => {
    const timer = new Timer(60);
    
    timer.update(1.5, false); // Use 1.5 seconds
    const remaining = timer.getTimeRemaining();
    
    expect(remaining).toBeCloseTo(58.5, 1);
});

test("Coin bonus adds time to timer", () => {
    const timer = new Timer(60);
    const initialTime = timer.getTimeRemaining();
    
    timer.addCoinBonus();
    
    expect(timer.getTimeRemaining()).toBe(initialTime + 2); // +2 seconds
});

test("Timer handles zero time (game over)", () => {
    const timer = new Timer(1);
    
    timer.update(1.5, false); // Exceed time limit
    
    expect(timer.isTimeUp()).toBe(true);
});

test("Timer persists across levels", () => {
    const timer = new Timer(60);
    
    timer.update(10, false); // Use 10 seconds
    const level1Remaining = timer.getTimeRemaining();
    
    // Simulate level transition
    timer.startNextLevel();
    
    expect(timer.getTimeRemaining()).toBeCloseTo(level1Remaining, 1);
});
