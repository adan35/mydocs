/** Portaled modal layers may nest; only the last closing layer unlocks the app. */
let layers = 0;
let originallyInert = false;

export function lockBackground(): () => void {
  const root = document.getElementById('root');
  if (layers === 0) originallyInert = root?.inert ?? false;
  layers++;
  if (root) root.inert = true;
  return () => {
    layers--;
    if (layers === 0 && root) root.inert = originallyInert;
  };
}
