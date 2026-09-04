function pick(items, target) {
  if (items.length === 0) {
    return null;
  }
  if (items[0] === target) {
    return items[0];
  }
  return undefined;
}
