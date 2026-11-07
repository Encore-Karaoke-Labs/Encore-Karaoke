const playNavSfx = (ctx, sfxName) => {
  if (ctx.state.isNavSfxEnabled === false) return;

  const now = Date.now();
  if (now - playNavSfx.lastNavSfxTime < 80) return;

  playNavSfx.lastNavSfxTime = now;
  ctx.services.Forte?.playSfx(`/assets/audio/${sfxName}.wav`);
};

playNavSfx.lastNavSfxTime = 0;

export default playNavSfx;
