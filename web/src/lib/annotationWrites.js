// Quantifin: serialize canvas writes across navigation to the scale review page.
const writes = new WeakMap();

export function saveAnnotationsQueued(store, payload) {
  const next = (writes.get(store) || Promise.resolve()).catch(() => {}).then(() => store.saveAnnotations(payload));
  writes.set(store, next);
  return next;
}

export async function awaitAnnotationWrites(store) {
  await writes.get(store);
}
