import Html from "/libs/html.js";

let currentDialog = null;
let dialogTimeout = null;

/**
 * Generates a temporary dialog element that auto-dismisses after a specified duration
 * @param {HTMLElement} elm - The element to display in the dialog
 * @param {number} [duration=5000] - Duration in milliseconds before auto-cleanup (default: 5000ms)
 */
export default function generateDialog(elm, duration = 5000) {
  if (currentDialog) {
    currentDialog.cleanup();
    clearTimeout(dialogTimeout);
  }

  let dialog = new Html("div")
    .classOn("temp-dialog")
    .append(elm)
    .appendTo("body");

  currentDialog = dialog;
  dialogTimeout = setTimeout(() => {
    dialog.cleanup();
    currentDialog = null;
    clearTimeout(dialogTimeout);
  }, duration);
}
