// Minimal stand-in for ecma-proposal-math-extensions (butterchurn only needs Math.clamp).
if (!Math.clamp) Math.clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
