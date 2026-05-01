/**
 * Top banner pinned to the top of every screen.
 * Sits above all game UI (z-[60]) but below toasts.
 */
export default function DevBanner() {
  return (
    <a
      href="https://x.com/boogaav"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 py-1.5 px-3 text-[11px] sm:text-xs font-mono font-bold text-white bg-gradient-to-r from-purple-700 via-fuchsia-600 to-red-600 hover:from-purple-600 hover:via-fuchsia-500 hover:to-red-500 transition-colors shadow-lg shadow-purple-900/40 border-b border-fuchsia-400/30"
    >
      <span className="hidden sm:inline">📨</span>
      <span>DM the Dev</span>
      <span className="text-fuchsia-200 underline underline-offset-2">@boogaav</span>
      <span aria-hidden>↗</span>
    </a>
  );
}
