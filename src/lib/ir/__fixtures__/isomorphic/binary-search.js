function binary_search(values, target) {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (values[mid] === target) {
      return mid;
    } else if (values[mid] < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}
