// Un trabajo a la vez: no se cargan varios modelos en la memoria del teléfono.
export function createSerialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const next = tail.then(task);
    tail = next.catch(() => {});
    return next;
  };
}
