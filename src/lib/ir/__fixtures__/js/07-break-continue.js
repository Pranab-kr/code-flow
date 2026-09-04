function firstEven(items) {
  for (const x of items) {
    if (x === 0) {
      continue;
    }
    if (x % 2 === 0) {
      break;
    }
  }
  return x;
}
