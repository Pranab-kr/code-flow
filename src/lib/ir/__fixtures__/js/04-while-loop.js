function countdown(n) {
  while (n > 0) {
    n--;
  }
  return n;
}

function repeatUntil(done) {
  do {
    done = poll();
  } while (!done);
  return done;
}
