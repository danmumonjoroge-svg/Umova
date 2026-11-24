// Build-time switch for the parent-only phone app. Build with REACT_APP_APP_MODE=parent to get an app that opens on the parent sign-in
// and never shows the staff sign-in link. The normal web build is unaffected.
export const isParentApp = () => (typeof process !== 'undefined' && process.env && process.env.REACT_APP_APP_MODE === 'parent');
