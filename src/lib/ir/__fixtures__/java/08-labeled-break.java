class LabeledBreak {
    int firstZeroRow(int[][] grid) {
        int found = -1;
        outer:
        for (int i = 0; i < grid.length; i++) {
            for (int j = 0; j < grid[i].length; j++) {
                if (grid[i][j] == 0) {
                    found = i;
                    break outer;
                }
            }
        }
        return found;
    }
}
