#include <vector>

int bfs(std::vector<int> queue) {
    int visited = 0;
    while (!queue.empty()) {
        int node = queue.back();
        queue.pop_back();
        if (node >= 0) {
            visited++;
        }
    }
    return visited;
}
