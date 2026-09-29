// nav.js — in-app navigation after an action (e.g. "Add box" opens the new
// box). Views call navigate('#/boxes/<id>') rather than assigning
// location.hash: main.js renders the new page synchronously, so the address
// bar and the screen never disagree, even for a moment on a slow machine.

let navigator = (hash) => { location.hash = hash; };

// main.js installs the real navigator once the router is ready.
export function setNavigator(fn) {
  navigator = fn;
}

export function navigate(hash) {
  navigator(hash);
}
