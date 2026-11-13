/** Separates a normal click from a held press, without firing either during a drag. */
export function createPressMenu(onHold: () => void, delay = 450) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressClick = false;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  return {
    start() {
      cancel();
      suppressClick = false;
      timer = setTimeout(() => { timer = undefined; suppressClick = true; onHold(); }, delay);
    },
    cancel,
    drag() { cancel(); suppressClick = true; },
    click() { cancel(); const allowed = !suppressClick; suppressClick = false; return allowed; },
  };
}