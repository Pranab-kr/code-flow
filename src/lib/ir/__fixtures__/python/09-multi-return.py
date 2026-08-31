def bounds_check(arr, i):
    if i < 0:
        return "negative"
    if i >= len(arr):
        return "too large"
    return arr[i]
