let draining = false;

const connections = new Set<() => void>();

export function isDraining() {
  return draining;
}

export function trackConnection(close: () => void) {
  if (draining) {
    close();
    return () => {};
  }
  connections.add(close);
  return () => {
    connections.delete(close);
  };
}

export function beginDrain() {
  draining = true;
  for (const close of connections) {
    try {
      close();
    } catch {}
  }
  connections.clear();
}
