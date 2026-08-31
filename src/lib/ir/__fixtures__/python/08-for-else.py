def find(xs, target):
    for i in range(len(xs)):
        if xs[i] == target:
            break
    else:
        return -1
    return i
