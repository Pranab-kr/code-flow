int readCount(const std::string& path) {
    std::ifstream* handle = nullptr;
    try {
        handle = new std::ifstream(path);
        return countBytes(handle);
    } catch (const std::exception& e) {
        return 0;
    }
}
