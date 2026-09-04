function bfs(queue) {
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.pop();
    if (node >= 0) {
      visited += 1;
    }
  }
  return visited;
}
