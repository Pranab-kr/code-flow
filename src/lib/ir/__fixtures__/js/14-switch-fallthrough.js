function describe(x) {
  let out = '';
  switch (x) {
    case 0:
    case 1:
      out = 'low';
      break;
    case 2:
      out = 'two';
      break;
    default:
      out = 'high';
  }
  return out;
}
