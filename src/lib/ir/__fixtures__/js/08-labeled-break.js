function findZero(grid) {
  let found = -1;
  outer:
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (grid[i][j] === 0) {
        found = i;
        break outer;
      }
    }
  }
  return found;
}
