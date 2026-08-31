import { THEME_STORAGE_KEY } from '@/lib/theme';

/**
 * Applies the stored theme before first paint, so a dark-preferring user never
 * sees a flash of light paper.
 *
 * Only stamps `data-theme` for an explicit choice: leaving it absent lets the
 * `prefers-color-scheme` block in tokens.css handle 'system'.
 */
export function ThemeScript() {
  const js = `(function(){try{
var p=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';
if(p==='dark'||p==='light')document.documentElement.setAttribute('data-theme',p);
}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
