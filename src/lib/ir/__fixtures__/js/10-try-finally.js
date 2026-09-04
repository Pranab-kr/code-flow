function load(handle) {
  try {
    const data = handle.read();
    return data;
  } catch (e) {
    return null;
  } finally {
    if (handle) {
      handle.close();
    }
  }
}
