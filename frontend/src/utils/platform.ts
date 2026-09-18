/**
 * iOS Safari's getUserMedia permission behavior is known to differ between
 * an installed (home-screen, standalone-display-mode) PWA and the same page
 * open in a regular Safari tab — see docs/ARCHITECTURE.md §7 risk #4. This
 * couldn't be verified against real iOS hardware in the build environment
 * (no iOS device or Safari engine available), so this is a defensive
 * best-effort detector used only to tailor an error message, not a fix.
 */
export function isIOSStandalone(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
  const nav = navigator as Navigator & { standalone?: boolean };
  const isStandalone = nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  return isIOS && Boolean(isStandalone);
}

export function iosStandaloneHint(): string {
  return isIOSStandalone()
    ? " You're using the installed app icon — camera/mic access can behave differently there on iOS. Try opening this same page in Safari directly instead."
    : "";
}
