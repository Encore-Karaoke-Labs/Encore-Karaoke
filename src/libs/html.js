/*!
Html library by datkat21 on GitHub. Licensed under MIT
https://github.com/datkat21/html
!*/
export default class Html {
  /** The HTML element referenced in this instance. Change using `.swapRef()`, or remove using `.cleanup()`. */
  elm;
  /**
   * Create a new instance of the Html class.
   * @param elm The HTML element to be created or classified from.
   */
  constructor(elm) {
    if (elm instanceof HTMLElement) this.elm = elm;
    else this.elm = document.createElement(elm || "div");
  }
  /**
   * Sets the text of the current element.
   * @param val The text to set to.
   * @returns Html
   */
  text(val) {
    this.elm.innerText = val;
    return this;
  }
  /**
   * Sets the text of the current element.
   * @param val The text to set to.
   * @returns Html
   */
  html(val) {
    this.elm.innerHTML = val;
    return this;
  }
  /**
   * Safely remove the element. Can be used in combination with a `.swapRef()` to achieve a "delete & swap" result.
   * @returns Html
   */
  cleanup() {
    this.elm.remove();
    return this;
  }
  /**
   * querySelector something.
   * @param selector The query selector.
   * @returns The HTML element (not as Html)
   */
  query(selector) {
    return this.elm.querySelector(selector);
  }
  /**
   * An easier querySelector method.
   * @param query The string to query
   * @returns a new Html
   */
  qs(query) {
    if (this.elm.querySelector(query))
      return Html.from(this.elm.querySelector(query));
    else return null;
  }
  /**
   * An easier querySelectorAll method.
   * @param query The string to query
   * @returns a new Html
   */
  qsa(query) {
    if (this.elm.querySelector(query))
      return Array.from(this.elm.querySelectorAll(query)).map((e) =>
        Html.from(e)
      );
    else return null;
  }
  /**
   * Sets the ID of the element.
   * @param val The ID to set.
   * @returns Html
   */
  id(val) {
    this.elm.id = val;
    return this;
  }
  /**
   * Toggle on/off a class.
   * @param val The class to toggle.
   * @returns Html
   */
  class(...val) {
    for (let i = 0; i < val.length; i++) this.elm.classList.toggle(val[i]);
    return this;
  }
  /**
   * Toggles ON a class.
   * @param val The class to enable.
   * @returns Html
   */
  classOn(...val) {
    for (let i = 0; i < val.length; i++) this.elm.classList.add(val[i]);
    return this;
  }
  /**
   * Toggles OFF a class.
   * @param val The class to disable.
   * @returns Html
   */
  classOff(...val) {
    for (let i = 0; i < val.length; i++) this.elm.classList.remove(val[i]);
    return this;
  }
  /**
   * Apply CSS styles (dashed method.) Keys use CSS syntax, e.g. `background-color`.
   * @param obj The styles to apply (as an object of `key: value;`.)
   * @returns Html
   */
  style(obj) {
    for (const key of Object.keys(obj))
      this.elm.style.setProperty(key, obj[key]);
    return this;
  }
  /**
   * Apply CSS styles (JS method.) Keys use JS syntax, e.g. `backgroundColor`.
   * @param obj The styles to apply (as an object of `key: value;`)
   * @returns Html
   */
  styleJs(obj) {
    // @ts-expect-error
    for (const key of Object.keys(obj)) this.elm.style[key] = obj[key];
    return this;
  }
  /**
   * Apply an event listener.
   * @param ev The event listener type to add.
   * @param cb The event listener callback to add.
   * @returns Html
   */
  on(ev, cb) {
    this.elm.addEventListener(ev, cb);
    return this;
  }
  /**
   * Remove an event listener.
   * @param ev The event listener type to remove.
   * @param cb The event listener callback to remove.
   * @returns Html
   */
  un(ev, cb) {
    this.elm.removeEventListener(ev, cb);
    return this;
  }
  /**
   * Retrieve the corresponding HTMLElement.
   * @param element The element to retrieve. Can be an HTMLElement, Html instance, or a string (as query selector).
   * @returns The corresponding HTMLElement or null if QS and element are not found.
   */
  getElement(element) {
    let p = element instanceof Html ? element.elm : element;
    if (typeof element === "string") p = document.querySelector(element);
    if (p instanceof HTMLElement) return p;
    else throw new Error("Invalid element type.");
  }
  /**
   * Append this element to another element. Uses `appendChild()` on the parent.
   * @param parent Element to append to. HTMLElement, Html, and string (as querySelector) are supported.
   * @returns Html
   */
  appendTo(parent) {
    let p = this.getElement(parent);
    if (p instanceof HTMLElement) p.appendChild(this.elm);
    else throw new Error("Invalid parent element, exausted 3 checks.");
    return this;
  }
  /**
   * Prepend this element to another element. Uses `prepend()` on the parent.
   * @param parent Element to append to. HTMLElement, Html, and string (as querySelector) are supported.
   * @returns Html
   */
  prependTo(parent) {
    let p = this.getElement(parent);
    if (p instanceof HTMLElement) p.prepend(this.elm);
    return this;
  }
  /**
   * Append an element. Typically used as a `.append(new Html(...))` call.
   * @param elem The element to append.
   * @returns Html
   */
  append(elem) {
    let e = this.getElement(elem);
    if (e instanceof HTMLElement) this.elm.appendChild(e);
    else if (typeof elem === "string") {
      const newElem = document.createElement(elem);
      this.elm.appendChild(newElem);
      return new Html(newElem.tagName);
    }
    return this;
  }
  /**
   * Prepend an element. Typically used as a `.prepend(new Html(...))` call.
   * @param elem The element to prepend.
   * @returns Html
   */
  prepend(elem) {
    let e = this.getElement(elem);
    if (e instanceof HTMLElement) this.elm.prepend(e);
    else if (typeof elem === "string") {
      const newElem = document.createElement(elem);
      this.elm.prepend(newElem);
      return new Html(newElem.tagName);
    }
    return this;
  }
  /**
   * Append multiple elements. Typically used as a `.appendMany(new Html(...), new Html(...)` call.
   * @param elements The elements to append.
   * @returns Html
   */
  appendMany(...elements) {
    for (const elem of elements) this.append(elem);
    return this;
  }
  /**
   * Prepend multiple elements. Typically used as a `.prependMany(new Html(...), new Html(...)` call.
   * @param elements The elements to prepend.
   * @returns Html
   */
  prependMany(...elements) {
    for (const elem of elements) this.prepend(elem);
    return this;
  }
  /**
   * Clear the innerHTML of the element.
   * @returns Html
   */
  clear() {
    this.elm.innerHTML = "";
    return this;
  }
  /**
   * Set attributes (object method.)
   * @param obj The attributes to set (as an object of `key: value;`)
   * @returns Html
   */
  attr(obj) {
    for (let key in obj)
      if (obj[key] !== null && obj[key] !== undefined)
        this.elm.setAttribute(key, obj[key]);
      else this.elm.removeAttribute(key);
    return this;
  }
  /**
   * Set the text value of the element. Only works if element is `input` or `textarea`.
   * @param str The value to set.
   * @returns Html
   */
  val(str) {
    this.elm.value = str;
    return this;
  }
  /**
   * Retrieve text content from the element. (as innerText, not trimmed)
   * @returns string
   */
  getText() {
    return this.elm.innerText;
  }
  /**
   * Retrieve HTML content from the element.
   * @returns string
   */
  getHtml() {
    return this.elm.innerHTML;
  }
  /**
   * Retrieve the value of the element. Only applicable if it is an `input` or `textarea`.
   * @returns string
   */
  getValue() {
    return this.elm.value;
  }
  /**
   * Swap the local `elm` with a new HTMLElement.
   * @param elm The element to swap with.
   * @returns Html
   */
  swapRef(elm) {
    this.elm = elm;
    return this;
  }
  /**
   * An alternative method to create an Html instance.
   * @param elm Element to create from.
   * @returns Html
   */
  static from(elm) {
    const qs = () => Html.qs(elm);
    if (typeof elm === "string") return qs();
    return new Html(elm);
  }
  /**
   * An easier querySelector method.
   * @param query The string to query
   * @returns a new Html
   */
  static qs(query) {
    if (document.querySelector(query))
      return Html.from(document.querySelector(query));
    return null;
  }
  /**
   * An easier querySelectorAll method.
   * @param query The string to query
   * @returns a new Html
   */
  static qsa(query) {
    if (document.querySelector(query))
      return Array.from(document.querySelectorAll(query)).map((e) =>
        Html.from(e)
      );
    return null;
  }
}
