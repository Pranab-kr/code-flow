def bfs(queue):
    visited = 0
    while queue:
        node = queue.pop()
        if node >= 0:
            visited += 1
    return visited
