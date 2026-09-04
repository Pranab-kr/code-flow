function quicksort(values, low, high) {
  if (low >= high) {
    return 0;
  }
  const pivot = values[high];
  const split = low;
  quicksort(values, low, split - 1);
  quicksort(values, split + 1, high);
  return pivot;
}
