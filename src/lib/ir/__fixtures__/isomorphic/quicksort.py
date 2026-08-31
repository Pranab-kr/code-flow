def quicksort(values, low, high):
    if low >= high:
        return 0
    pivot = values[high]
    split = low
    quicksort(values, low, split - 1)
    quicksort(values, split + 1, high)
    return pivot
