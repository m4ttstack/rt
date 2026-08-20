/** LIFO stack of open layers (modals, drawers, menus). Escape pops only the
    top: with a drawer over a menu over the board, one press closes one layer. */
const layerStack: Array<() => void> = [];

/** Register a layer's close handler. Returns a pop function that removes
    exactly this registration (by identity, from the top down) -- callers own
    calling it once, on cleanup/close. */
function pushLayer(onClose: () => void): () => void {
  layerStack.push(onClose);
  return () => {
    const i = layerStack.lastIndexOf(onClose);
    if (i >= 0) layerStack.splice(i, 1);
  };
}

/** Fire the topmost layer's close handler, if any. */
function handleEscape(): void {
  layerStack[layerStack.length - 1]?.();
}

export { pushLayer, handleEscape };
