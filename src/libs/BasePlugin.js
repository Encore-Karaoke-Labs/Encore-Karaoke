export default class BasePlugin {
  constructor(audioContext) {
    if (this.constructor === BasePlugin) {
      throw new Error(
        "BasePlugin is an abstract class and cannot be instantiated directly.",
      );
    }
    this.audioContext = audioContext;
    this.input = this.audioContext.createGain();
    this.output = this.audioContext.createGain();
    this.name = "Base Plugin";

    // This object will hold the current values and definitions of all controllable parameters.
    // The UI will read from this to build itself.
    this.parameters = {};
  }

  /**
   * Sets a parameter value. Must be implemented by subclasses.
   * @param {string} key - The name of the parameter.
   * @param {any} value - The value to set.
   */
  setParameter(key, value) {
    throw new Error(`setParameter() must be implemented by ${this.name}.`);
  }

  /**
   * Disconnects all internal nodes to allow for clean removal.
   */
  disconnect() {
    this.input.disconnect();
    // Subclasses should also disconnect their internal nodes from the output.
  }
}
