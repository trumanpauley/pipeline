// A random id that stays in this browser. The server stores only a salted hash
// and uses it to stop one browser from joining twice or referring itself.
const KEY = 'px.device';

export function deviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export function resetDeviceId() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
