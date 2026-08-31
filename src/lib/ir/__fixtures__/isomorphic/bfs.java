import java.util.List;

class Bfs {
    int bfs(List<Integer> queue) {
        int visited = 0;
        while (!queue.isEmpty()) {
            int node = queue.remove(queue.size() - 1);
            if (node >= 0) {
                visited++;
            }
        }
        return visited;
    }
}
