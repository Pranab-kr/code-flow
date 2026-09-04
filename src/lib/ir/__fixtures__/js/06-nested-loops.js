function pairs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.push([i, j]);
    }
  }
  return out;
}
