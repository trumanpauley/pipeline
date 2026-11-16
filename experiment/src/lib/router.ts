import { useEffect, useState } from 'react';

// A tiny pathname router — three routes don't justify a dependency.
export function navigate(path: string, replace = false) {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event('px:navigate'));
  window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener('px:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('px:navigate', update);
    };
  }, []);
  return path;
}
